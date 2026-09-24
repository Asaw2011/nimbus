// Nimbus partner-flowing relay — a Cloudflare Worker plus one Durable Object
// per room.
//
// It replaces Supabase Realtime BROADCAST for partner flowing, and nothing else:
// login stays on Supabase, and so does the fallback. A room is a relay — no flow
// content is ever stored, logged or inspected beyond its size.
//
// The client half is `src/lib/model/realtime.ts` (`RelayChannel`). The wire
// protocol is deliberately tiny, text frames of JSON:
//
//   client → relay   {"t":"join","token":<supabase jwt>,"key":<clientId>,"meta":{…}}
//                    {"t":"b","e":<event>,"p":<payload>}      a broadcast
//                    {"t":"hb"}                               heartbeat (exact string)
//   relay → client   {"t":"joined"}
//                    {"t":"presence","peers":[{key,meta}…]}   the FULL list, every change
//                    {"t":"b","e":…,"p":…}                    a peer's broadcast, verbatim
//                    {"t":"hb"}
//                    {"t":"err","code":…}                     then a close, see CLOSE below
//
// The behaviours this MUST keep (each one was a real Nimbus bug on Supabase):
//  1. No echo — a broadcast goes to every OTHER joined socket, never the sender.
//  2. In order — a Durable Object handles one event at a time, and the relay
//     path never awaits, so frames leave in the order they arrived.
//  3. Oversized frames are REFUSED LOUDLY (error frame + close 4009), never
//     dropped in silence. Supabase's silent drop was the 1.3.1 data loss.
//  5. Presence — the full peer list goes to everyone on every join and leave.
//  8. Auth — a valid Supabase login is required to join.

import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  /** The emergency switch: anything but "on" refuses new connections (4010). */
  RELAY_MODE: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  /**
   * LOCAL TESTING ONLY, passed as `wrangler dev --var DEV_FAKE_TOKENS:yes-local-only`
   * (`.dev.vars` does not reach the Durable Object locally): accept fake tokens
   * of the form `dev.<email>` so the protocol can be tested without a login.
   * The Worker refuses to serve anything at all if this is set anywhere but on
   * localhost, so it cannot be left on in production by accident.
   */
  DEV_FAKE_TOKENS?: string;
}

/**
 * Close codes. The client treats 4003 as "this account is not allowed" and
 * 4010 as "the relay is switched off — use Supabase". Everything else is an
 * ordinary failure it retries.
 */
export const CLOSE = {
  PROTOCOL: 4001,
  FORBIDDEN: 4003,
  BAD_ROOM: 4004,
  ROOM_FULL: 4008,
  TOO_BIG: 4009,
  RELAY_OFF: 4010,
  AUTH: 4011,
  REPLACED: 4012,
  RATE: 4029,
} as const;

/** Nimbus frames are ≤48,000 chars of payload today (FRAME_CHARS in
 *  session.svelte.ts). The client refuses anything over this BEFORE sending, so
 *  this check is a backstop that should never fire. */
const MAX_FRAME_CHARS = 256 * 1024;
/** A room is two partners. Headroom for a reconnect overlapping its own ghost
 *  and a declined third party, not for a crowd. */
const MAX_SOCKETS = 8;
/** An accepted socket that has not joined by now is closed. */
const JOIN_DEADLINE_MS = 15_000;
/** No heartbeat for this long = a socket whose client is gone without a close.
 *  Generous on purpose: a backgrounded window's timers can slow to once a
 *  minute, and its heartbeat with them. */
const GHOST_MS = 150_000;
/** Runaway-loop guard, not a throttle. A big import sends a burst of ~50 frames
 *  and steady typing ~6/s, so neither comes near it. */
const BUCKET_SIZE = 3_000;
const BUCKET_REFILL_PER_S = 30;

const HB = '{"t":"hb"}';
const DEV_HEADER = "x-nimbus-dev-fake-tokens";
const ROOM_RE = /^nimbus(-lab)?-flow-[A-Z0-9]{6}$/;

// ---- the Worker: routing and the emergency switch -------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (env.DEV_FAKE_TOKENS && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      return new Response("misconfigured: DEV_FAKE_TOKENS is set outside localhost", { status: 500 });
    }
    if (url.pathname === "/v1/health") {
      return new Response(JSON.stringify({ ok: true, relay: env.RELAY_MODE === "on" }), {
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }
    const m = url.pathname.match(/^\/v1\/room\/([A-Za-z0-9-]{1,64})$/);
    if (!m) return new Response("not found", { status: 404 });
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket", { status: 426 });
    }
    // Refusals are delivered AS a websocket close, never as an HTTP error: a
    // browser reports every failed upgrade identically, so an HTTP 503 would be
    // indistinguishable from bad wifi and the client would retry forever.
    if (env.RELAY_MODE !== "on") return refuse(CLOSE.RELAY_OFF, "relay off");
    if (!ROOM_RE.test(m[1])) return refuse(CLOSE.BAD_ROOM, "bad room");
    // The room learns about fake-token testing from this header, set only here
    // and only on localhost (checked above) — a client can never supply it.
    const fwd = new Request(req);
    fwd.headers.delete(DEV_HEADER);
    if (env.DEV_FAKE_TOKENS === "yes-local-only") fwd.headers.set(DEV_HEADER, "1");
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(fwd);
  },
} satisfies ExportedHandler<Env>;

function refuse(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

// ---- the room -------------------------------------------------------------

interface Att {
  joined: boolean;
  key: string;
  meta: Record<string, unknown>;
  /** When the socket was accepted (join deadline) — not updated per message. */
  at: number;
  /** Local testing only; see DEV_FAKE_TOKENS. */
  dev?: boolean;
}

const OPEN = 1;

export class Room extends DurableObject<Env> {
  /** Per-socket rate buckets. In memory only: hibernation resets them, which
   *  errs towards letting people flow. */
  private buckets = new Map<WebSocket, { n: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime WITHOUT waking this object, so an
    // idle room costs no duration while keeping every client's staleness check
    // fed.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HB, HB));
  }

  async fetch(req: Request): Promise<Response> {
    this.sweep();
    const dev = req.headers.get(DEV_HEADER) === "1";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    if (this.ctx.getWebSockets().length > MAX_SOCKETS) {
      server.close(CLOSE.ROOM_FULL, "room full");
    } else {
      server.serializeAttachment({ joined: false, key: "", meta: {}, at: Date.now(), dev } satisfies Att);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    if (typeof msg !== "string") return this.kill(ws, CLOSE.PROTOCOL, "text frames only");
    if (msg.length > MAX_FRAME_CHARS) {
      // ⚠ LOUD, never silent. See behaviour 3 in the header.
      this.sendTo(ws, { t: "err", code: "too_big", n: msg.length, max: MAX_FRAME_CHARS });
      return this.kill(ws, CLOSE.TOO_BIG, "frame too big");
    }
    if (!this.spend(ws)) {
      this.sendTo(ws, { t: "err", code: "rate" });
      return this.kill(ws, CLOSE.RATE, "too many messages");
    }
    let m: { t?: unknown; token?: unknown; key?: unknown; meta?: unknown };
    try {
      m = JSON.parse(msg);
    } catch {
      return this.kill(ws, CLOSE.PROTOCOL, "bad json");
    }
    const a = att(ws);
    if (!a?.joined) return this.join(ws, m);

    if (m.t === "b") {
      // Forwarded exactly as received — no re-serialisation, so the peer gets
      // byte-for-byte what was sent. No await anywhere on this path: that is
      // what keeps delivery in order (behaviour 2).
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue; // behaviour 1: never echo
        if (!att(other)?.joined) continue;
        try {
          other.send(msg);
        } catch {
          // A socket that died mid-send is cleaned up by its own close event.
        }
      }
    }
    // Anything else from a joined client is ignored, so a newer client can
    // add message types without breaking an older relay.
  }

  private async join(
    ws: WebSocket,
    m: { t?: unknown; token?: unknown; key?: unknown; meta?: unknown },
  ): Promise<void> {
    if (m.t !== "join") return this.kill(ws, CLOSE.PROTOCOL, "join first");
    const key = String(m.key ?? "").slice(0, 64);
    if (!key) return this.kill(ws, CLOSE.PROTOCOL, "no key");
    const who = await verifyToken(String(m.token ?? ""), this.env, !!att(ws)?.dev);
    if (ws.readyState !== OPEN) return; // it left while we were checking
    if (!who.ok) {
      this.sendTo(ws, { t: "err", code: who.code });
      return this.kill(ws, CLOSE.AUTH, who.code);
    }
    // The same client reconnecting before we noticed its old socket die: the
    // old one is a ghost, and two sockets under one key would double-count it.
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && att(other)?.key === key) this.kill(other, CLOSE.REPLACED, "replaced");
    }
    const meta = cleanMeta(m.meta);
    // The address the partner is shown comes from the verified login, not
    // from whatever the client claimed.
    if (who.email) meta.email = who.email;
    ws.serializeAttachment({ joined: true, key, meta, at: Date.now() } satisfies Att);
    this.sendTo(ws, { t: "joined" });
    this.presence();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.buckets.delete(ws);
    // ⚠ Echo a VALID code. A client that closes without one arrives as 1005,
    // which may not be sent back — close() throws, the handshake never
    // completes, and the client sits in "closing" until its own timeout.
    const reply = code >= 3000 && code <= 4999 ? code : 1000;
    try {
      ws.close(reply, reason.slice(0, 120));
    } catch {
      // Already closed.
    }
    if (att(ws)?.joined) this.presence(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.buckets.delete(ws);
    if (att(ws)?.joined) this.presence(ws);
  }

  /** Tell everyone in the room who is in it. `gone` is a socket on its way out
   *  that the runtime may still list. */
  private presence(gone?: WebSocket): void {
    this.sweep();
    const socks = this.ctx
      .getWebSockets()
      .filter((s) => s !== gone && s.readyState === OPEN && att(s)?.joined);
    const frame = JSON.stringify({
      t: "presence",
      peers: socks.map((s) => ({ key: att(s)!.key, meta: att(s)!.meta })),
    });
    for (const s of socks) {
      try {
        s.send(frame);
      } catch {
        // Cleaned up by its own close event.
      }
    }
  }

  /** Close sockets that never joined, and joined ones that went silent. Runs on
   *  connects and presence changes only — never on the broadcast path. */
  private sweep(): void {
    const now = Date.now();
    for (const s of this.ctx.getWebSockets()) {
      const a = att(s);
      if (!a) continue;
      if (!a.joined) {
        if (now - a.at > JOIN_DEADLINE_MS) this.kill(s, CLOSE.PROTOCOL, "join timeout");
        continue;
      }
      const hb = this.ctx.getWebSocketAutoResponseTimestamp(s)?.getTime() ?? a.at;
      if (now - Math.max(hb, a.at) > GHOST_MS) this.kill(s, CLOSE.PROTOCOL, "silent");
    }
  }

  private spend(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { n: BUCKET_SIZE, at: now };
    b.n = Math.min(BUCKET_SIZE, b.n + ((now - b.at) / 1000) * BUCKET_REFILL_PER_S);
    b.at = now;
    this.buckets.set(ws, b);
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  }

  private sendTo(ws: WebSocket, frame: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // Closing anyway.
    }
  }

  private kill(ws: WebSocket, code: number, reason: string): void {
    this.buckets.delete(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}

function att(ws: WebSocket): Att | null {
  try {
    return ws.deserializeAttachment() as Att | null;
  } catch {
    return null;
  }
}

/** Presence meta is small, flat and client-supplied: keep strings, numbers and
 *  booleans, cap their size, drop the rest. */
function cleanMeta(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 16)) {
    if (typeof v === "string") out[k.slice(0, 32)] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k.slice(0, 32)] = v;
  }
  return out;
}

// ---- auth: verify a Supabase access token ----------------------------------
//
// The project publishes its signing key (ES256) at /auth/v1/.well-known/jwks.json,
// so a token is checked locally with WebCrypto — no secret, and no round trip to
// Supabase per join once the key is cached. A token signed some other way (a
// project still on the legacy shared secret) is checked by asking Supabase
// directly, which needs nothing but the public key either.

type Verdict = { ok: true; sub: string; email: string } | { ok: false; code: string };

let jwks: { keys: Array<JsonWebKey & { kid?: string }>; at: number } | null = null;
let jwksFetchedAt = 0;
const cryptoKeys = new Map<string, CryptoKey>();
const JWKS_TTL_MS = 60 * 60_000;
const JWKS_MIN_REFETCH_MS = 30_000;
/** Clock skew allowance between Supabase and Cloudflare. */
const LEEWAY_S = 60;

async function verifyToken(token: string, env: Env, devFake: boolean): Promise<Verdict> {
  if (devFake && token.startsWith("dev.")) {
    return { ok: true, sub: token, email: token.slice(4) };
  }
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, code: "no_token" };
  let header: { alg?: string; kid?: string };
  let claims: { sub?: string; email?: string; exp?: number; iss?: string; role?: string };
  try {
    header = JSON.parse(utf8(b64u(parts[0])));
    claims = JSON.parse(utf8(b64u(parts[1])));
  } catch {
    return { ok: false, code: "bad_token" };
  }
  const now = Date.now() / 1000;
  if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S < now) return { ok: false, code: "expired" };
  if (claims.iss !== `${env.SUPABASE_URL}/auth/v1`) return { ok: false, code: "wrong_issuer" };
  if (claims.role !== "authenticated" || !claims.sub) return { ok: false, code: "not_signed_in" };

  if (header.alg === "ES256" && header.kid) {
    const key = await keyFor(header.kid, env);
    if (!key) return { ok: false, code: "unknown_key" };
    const good = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64u(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    return good ? { ok: true, sub: claims.sub, email: String(claims.email ?? "") } : { ok: false, code: "bad_signature" };
  }
  // Not a key we can check locally — let Supabase say whether it is real.
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, code: "rejected_by_supabase" };
    const u = (await r.json()) as { id?: string; email?: string };
    return u.id ? { ok: true, sub: u.id, email: String(u.email ?? "") } : { ok: false, code: "rejected_by_supabase" };
  } catch {
    return { ok: false, code: "auth_unreachable" };
  }
}

async function keyFor(kid: string, env: Env): Promise<CryptoKey | null> {
  const cached = cryptoKeys.get(kid);
  if (cached && jwks && Date.now() - jwks.at < JWKS_TTL_MS) return cached;
  const stale = !jwks || Date.now() - jwks.at > JWKS_TTL_MS;
  const missing = !jwks?.keys.some((k) => k.kid === kid);
  if ((stale || missing) && Date.now() - jwksFetchedAt > JWKS_MIN_REFETCH_MS) {
    jwksFetchedAt = Date.now();
    try {
      const r = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
      if (r.ok) {
        const body = (await r.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
        jwks = { keys: body.keys ?? [], at: Date.now() };
        cryptoKeys.clear();
      }
    } catch {
      // Keep whatever we had; a stale key still verifies tokens it signed.
    }
  }
  const jwk = jwks?.keys.find((k) => k.kid === kid);
  if (!jwk) return cached ?? null;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    cryptoKeys.set(kid, key);
    return key;
  } catch {
    return null;
  }
}

function b64u(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
