// Minimal Supabase Realtime client - enough to run a partner flowing session,
// and nothing more.
//
// Supabase Realtime is a Phoenix channels server. The wire protocol is small
// and stable, so this speaks it directly instead of pulling in
// @supabase/supabase-js (~200KB + deps) for the one feature we use. That also
// matches how `auth.svelte.ts` already talks to the same project with raw
// fetch rather than the SDK.
//
// What this is used for: BROADCAST only. No database tables, no schema, no
// migrations - a channel is just a name, and the server relays messages
// between whoever joined it. Nothing about a flow is ever stored server-side.
//
// ⚠ This is NOT on the launch path and must never become so. A partner session
// is something you opt into from inside a flow; every failure here has to
// degrade to "you are flowing alone", never to a broken app.

/** Verified against the live project: a join + broadcast round-trip succeeds
 *  with only the publishable key, no user token and no extra project config. */
const SUPABASE_URL = "https://oovgzakdweswenhohgwh.supabase.co";
const SUPABASE_KEY = "sb_publishable_4xgCsUBklrsJUOspF4a6VA_maYxtlHg";

/** Phoenix expects a heartbeat well inside its 60s idle timeout. */
const HEARTBEAT_MS = 25_000;
/** Reconnect backoff, in order; the last value repeats forever. Deliberately
 *  capped low - tournament wifi drops constantly and we want to be back fast. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
/**
 * Heard nothing for this long while supposedly joined = the connection is dead
 * even though the socket still claims to be OPEN.
 *
 * ⚠ This is not paranoia, it is reproduced behaviour. A hidden tab (which is
 * what a minimised Tauri window is) has its timers throttled to roughly once a
 * minute, so our 25s heartbeat stops landing, the server drops us, and the
 * WebSocket sits at readyState OPEN receiving nothing - verified with a direct
 * probe that never arrived. Heartbeat replies alone keep this fresh in a normal
 * tab, so anything past 45s of total silence is genuinely wrong.
 */
const STALE_MS = 45_000;

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "joined"
  | "reconnecting"
  /** The relay refused us and retrying won't help - a dead end, not a wait. */
  | "refused"
  | "closed";

export interface PresencePeer {
  /** The presence key - our per-client id. */
  key: string;
  meta: Record<string, unknown>;
}

interface Handlers {
  onStatus?: (s: RealtimeStatus) => void;
  /** A broadcast from ANOTHER client (we never receive our own). */
  onMessage?: (event: string, payload: unknown) => void;
  /** The full peer list, recomputed on every presence change. */
  onPresence?: (peers: PresencePeer[]) => void;
  /**
   * The relay refused to let us join, and retrying without a token didn't help
   * either. Today that only happens if the project itself is misconfigured;
   * once the relay requires a subscription it is how "you aren't allowed on
   * this" reaches the UI, instead of an endless silent retry.
   */
  onRejected?: (response: unknown) => void;
}

/**
 * What `session.svelte.ts` holds. The whole of the sync layer talks to the
 * transport through exactly this, so the relay behind it can change without
 * the sync logic changing at all.
 */
export interface Channel {
  status: RealtimeStatus;
  /** Set once queued work had to be dropped; the two sides may disagree. */
  readonly overflowed: boolean;
  /** Broadcasts queued while down. */
  readonly pending: number;
  /** TRUE only if the frame really left. See SupabaseChannel.broadcast. */
  broadcast(event: string, payload: unknown, queueIfDown?: boolean): boolean;
  ensureFresh(): void;
  close(): void;
}

/**
 * One joined Supabase channel. Reconnects on its own until closed.
 *
 * ⚠ Unchanged from the Supabase-only builds apart from its name. It is the
 * fallback under the Cloudflare relay (see {@link DualChannel}), and every old
 * build still speaks only this.
 */
class SupabaseChannel implements Channel {
  status: RealtimeStatus = "idle";

  private ws: WebSocket | null = null;
  private ref = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;
  private joined = false;
  /** Broadcasts made while the socket was down, replayed on rejoin. Bounded so
   *  a long outage can't grow without limit - a resync covers the rest. */
  private outbox: Array<{ event: string; payload: unknown }> = [];
  private presence = new Map<string, PresencePeer>();
  /** Set once the outbox has had to drop a message. Past that point the two
   *  sides can no longer be assumed to agree, and the session says so rather
   *  than quietly diverging. */
  overflowed = false;
  /** When we last received ANY frame, including heartbeat replies. */
  private lastFrameAt = 0;

  constructor(
    private topic: string,
    private presenceKey: string,
    private presenceMeta: Record<string, unknown>,
    private handlers: Handlers,
    /**
     * Supplies a currently-valid access token, or "" when there isn't one.
     *
     * ⚠ Sent so the RELAY can tell who is connecting. Nothing checks it yet -
     * the server currently accepts the publishable key alone - but a token
     * cannot be added to a build that is already on someone's disk, so it ships
     * ahead of the check. When authorization is switched on, every client that
     * has updated by then keeps working and only genuinely old builds are cut
     * off; ship it late and the cutover strands everybody at once.
     *
     * Called before each connect, so a reconnect after a long round carries a
     * fresh token rather than the one from when the session started.
     */
    private getToken: () => Promise<string> = async () => "",
  ) {}

  /** The token sent on the current socket, so the heartbeat can notice when it
   *  has been rotated and tell the server about it mid-session. */
  private sentToken = "";

  /**
   * Which kind of channel we are joining. The ladder is: **public first, then
   * private if the relay refuses.**
   *
   * ⚠ This order is what makes the paywall a purely SERVER-SIDE switch, with no
   * new build and no coordinated release:
   *
   * - Today, public is allowed, so the first attempt succeeds and this costs
   *   exactly nothing - the behaviour is identical to before it existed.
   * - Turn "Allow public access to channels" off on the project, and the first
   *   attempt is refused. This client then retries privately with the user's
   *   token, which the RLS policy answers: subscribers are let in, everybody
   *   else is refused and told why.
   * - Builds without this ladder only ever ask for a public channel, so the
   *   same switch locks them out for good.
   *
   * Try-private-first would be tidier to read and worse to run: it would put an
   * extra round trip in front of every session today, for a check nothing is
   * making yet. Once a private join succeeds we stay private for the rest of
   * the session, so reconnects don't walk the ladder again.
   */
  private mode: "public" | "private" = "public";

  /** Oldest queued broadcasts are dropped past this; the peer resyncs instead. */
  static readonly OUTBOX_LIMIT = 500;

  connect(): void {
    if (this.closed) return;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(
        `${SUPABASE_URL.replace(/^https/, "wss")}/realtime/v1/websocket` +
          `?apikey=${encodeURIComponent(SUPABASE_KEY)}&vsn=1.0.0`,
      );
    } catch {
      // Constructing a WebSocket can throw outright (bad URL, blocked scheme).
      // Treat it exactly like a failed connection so the retry loop owns it.
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = async () => {
      // ⚠ The token is fetched HERE rather than before opening the socket, so a
      // slow or failed refresh can't stop us connecting - it only decides
      // whether a private join can prove who we are.
      let token = "";
      if (this.mode === "private") {
        try {
          token = await this.getToken();
        } catch {
          token = ""; // Refused below, which is the honest outcome.
        }
      }
      // The socket can be torn down while that await was in flight.
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
      this.sentToken = token;
      this.send({
        topic: this.topic,
        event: "phx_join",
        payload: {
          config: {
            // We never want our own messages echoed back - the local store has
            // already applied them, and re-applying would fight the cursor.
            broadcast: { self: false },
            presence: { key: this.presenceKey },
            // Public today. See the note on `mode`.
            private: this.mode === "private",
          },
          // Only a private channel is authorised, and an empty token would be a
          // malformed credential rather than no credential.
          ...(token ? { access_token: token } : {}),
        },
      });
    };

    ws.onmessage = (e) => {
      let m: { topic?: string; event?: string; payload?: unknown; ref?: string };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return; // Never let a malformed frame take the socket down.
      }
      this.lastFrameAt = Date.now();
      this.handleFrame(m);
    };

    ws.onerror = () => {
      // Errors are always followed by a close; let onclose drive the retry so
      // we can't schedule two reconnects for one failure.
    };

    ws.onclose = () => {
      this.joined = false;
      this.stopHeartbeat();
      if (this.closed) {
        this.setStatus("closed");
        return;
      }
      this.scheduleRetry();
    };
  }

  private handleFrame(m: {
    topic?: string;
    event?: string;
    payload?: unknown;
  }): void {
    if (m.topic !== this.topic && m.event !== "phx_reply") return;
    switch (m.event) {
      case "phx_reply": {
        const p = m.payload as { status?: string; response?: unknown } | undefined;
        if (m.topic === this.topic && p?.status === "ok" && !this.joined) {
          this.joined = true;
          this.lastFrameAt = Date.now();
          this.attempt = 0;
          this.setStatus("joined");
          this.startHeartbeat();
          this.track();
          this.flushOutbox();
        } else if (m.topic === this.topic && p?.status === "error" && !this.joined) {
          this.onJoinRejected(p.response);
        }
        break;
      }
      case "broadcast": {
        const p = m.payload as { event?: string; payload?: unknown } | undefined;
        if (p?.event) this.handlers.onMessage?.(p.event, p.payload);
        break;
      }
      case "presence_state": {
        this.presence.clear();
        this.mergeJoins(m.payload as PresenceMap);
        this.emitPresence();
        break;
      }
      case "presence_diff": {
        const d = m.payload as { joins?: PresenceMap; leaves?: PresenceMap };
        for (const key of Object.keys(d.leaves ?? {})) this.presence.delete(key);
        this.mergeJoins(d.joins ?? {});
        this.emitPresence();
        break;
      }
      case "phx_error":
      case "phx_close":
        // The SERVER dropped us from the topic while the socket stayed up.
        // Marking ourselves un-joined is not enough - nothing would ever
        // rejoin, and we would sit silently deaf. Tear the socket down and let
        // the retry loop own recovery.
        this.joined = false;
        this.forceReconnect();
        break;
    }
  }

  private mergeJoins(map: PresenceMap): void {
    for (const [key, v] of Object.entries(map ?? {})) {
      const meta = (v?.metas?.[0] ?? {}) as Record<string, unknown>;
      this.presence.set(key, { key, meta });
    }
  }

  private emitPresence(): void {
    this.handlers.onPresence?.([...this.presence.values()]);
  }

  /** Announce ourselves. Re-sent after every rejoin - presence is per-socket,
   *  so a reconnect starts with us absent from our own channel. */
  private track(): void {
    this.send({
      topic: this.topic,
      event: "presence",
      payload: {
        type: "presence",
        event: "track",
        payload: this.presenceMeta,
      },
    });
  }

  /**
   * Send a broadcast. Queued (not dropped) while the socket is down.
   *
   * Returns TRUE only if the frame actually went out. Queued is not sent, and
   * `joined` is not the same as deliverable: a socket can be closing, or
   * already dead, while we still think we are joined - so callers that must
   * know whether the far side really got it have to read this, not `joined`.
   *
   * `queueIfDown: false` is for traffic that REGENERATES itself - the cell
   * diff, which recomputes from scratch every tick. Queueing that is pointless
   * and actively harmful: it fills the outbox with work the next diff would
   * produce anyway, and an outbox that overflows is what marks the session
   * desynced.
   */
  broadcast(event: string, payload: unknown, queueIfDown = true): boolean {
    if (this.closed) return false;
    if (!this.joined) {
      if (!queueIfDown) return false;
      this.outbox.push({ event, payload });
      if (this.outbox.length > SupabaseChannel.OUTBOX_LIMIT) {
        this.outbox.shift();
        this.overflowed = true;
      }
      return false;
    }
    return this.send({
      topic: this.topic,
      event: "broadcast",
      payload: { type: "broadcast", event, payload },
    });
  }

  /** True when there is queued work waiting on the socket. */
  get pending(): number {
    return this.outbox.length;
  }

  private flushOutbox(): void {
    const queued = this.outbox;
    this.outbox = [];
    for (const q of queued) this.broadcast(q.event, q.payload);
  }

  /** True only when the frame actually reached the wire. */
  private send(frame: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ ...frame, ref: String(++this.ref) }));
      return true;
    } catch {
      // A send can fail on a socket that is closing; onclose drives recovery.
      return false;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ topic: "phoenix", event: "heartbeat", payload: {} });
      // ⚠ Access tokens expire inside an hour; a round plus prep can outlast
      // one. Phoenix keeps the socket open either way, but once the relay
      // starts checking the token, an expired one makes the channel go quiet
      // rather than error - the worst possible failure mid-round. Rotate it on
      // the heartbeat we already send, and only when it has actually changed.
      void this.refreshToken();
    }, HEARTBEAT_MS);
  }

  /**
   * The relay refused the join.
   *
   * ⚠ Measured, not assumed: Supabase Realtime rejects a malformed or expired
   * JWT outright - the channel never joins and the socket just sits there. So
   * attaching a token is NOT free, and a client whose token is bad for a reason
   * it can't see (a rotated project secret, a skewed clock) would silently lose
   * partner flowing with no message.
   *
   * While nothing checks the token, one retry WITHOUT it restores exactly the
   * old behaviour, so a bad token can never be worse than no token. Once the
   * relay starts requiring one, that retry is refused too - which is the
   * correct outcome, and the point at which this should surface a real message
   * rather than a silent retry.
   */
  private onJoinRejected(response: unknown): void {
    if (this.mode === "public") {
      // Public is closed on this project - climb to a private, authorised join.
      this.mode = "private";
      this.forceReconnect();
      return;
    }
    // Private was refused too: this account genuinely isn't allowed on. Stop -
    // retrying forever would just look like a connection that never comes up.
    this.closed = true;
    this.stopHeartbeat();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.handlers.onRejected?.(response);
    this.setStatus("refused");
  }

  /** Hand the relay a newer token if ours has been rotated since we joined. */
  private async refreshToken(): Promise<void> {
    // A public channel isn't authorised, so there is nothing to keep fresh -
    // and asking for a token on every heartbeat would be pure waste today.
    if (this.mode !== "private") return;
    let token = "";
    try {
      token = await this.getToken();
    } catch {
      return; // Keep the socket on the token it has; a retry follows in 25s.
    }
    if (!token || token === this.sentToken) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.sentToken = token;
    this.send({ topic: this.topic, event: "access_token", payload: { access_token: token } });
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry) return;
    const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.setStatus("reconnecting");
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
  }

  /**
   * Drop a connection that has gone quiet and reconnect.
   *
   * Call it whenever the app comes back to the foreground: while hidden we
   * cannot trust our own timers, so returning is the moment to find out
   * whether the connection survived.
   */
  ensureFresh(): void {
    if (this.closed || !this.joined) return;
    if (Date.now() - this.lastFrameAt < STALE_MS) return;
    this.forceReconnect();
  }

  private forceReconnect(): void {
    if (this.closed) return;
    this.joined = false;
    try {
      this.ws?.close();   // onclose schedules the retry
    } catch {
      this.scheduleRetry();
    }
  }

  private setStatus(s: RealtimeStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.handlers.onStatus?.(s);
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.outbox = [];
    this.presence.clear();
    try {
      this.ws?.close();
    } catch {
      // Already gone; nothing to do.
    }
    this.ws = null;
    this.setStatus("closed");
  }
}

type PresenceMap = Record<string, { metas?: Array<Record<string, unknown>> }>;

// ===========================================================================
// The Cloudflare relay (relay/ in this repo) — the cheap path.
// ===========================================================================
//
// Supabase bills every broadcast twice between two partners (one sent, one
// received), and a partner-flowed round is ~27k of them. The relay is our own
// Worker + Durable Object, billed a fraction of that, with the SAME behaviours:
// no echo, in order, oversized frames refused loudly, "sent" means it left,
// presence, reconnect, stale detection. The protocol is documented at the top
// of relay/src/index.ts.

/**
 * Where the relay lives. Empty = no relay: every session runs on Supabase
 * exactly as before this existed.
 *
 * ⚠ It must be a domain Adam controls, so it can be re-pointed without an app
 * update if the hosting ever has to move.
 */
const RELAY_URL = "wss://relay.nimbusdebate.com";
/** A tester's override (localStorage): a ws(s):// URL, or "" to force Supabase. */
const RELAY_URL_KEY = "nimbus.relayUrl";

function relayUrl(): string {
  try {
    const o = globalThis.localStorage?.getItem(RELAY_URL_KEY);
    if (typeof o === "string") return o;
  } catch {
    // No storage (private window, tests) — the built-in default stands.
  }
  return RELAY_URL;
}

/**
 * Must equal MAX_FRAME_CHARS in relay/src/index.ts.
 *
 * ⚠ Checked BEFORE a frame is sent, and a frame over it is refused with
 * `false` — never sent and never queued. That keeps "sent means sent" honest:
 * a frame the relay would refuse is reported undelivered here, instead of
 * leaving and dying there, which is exactly how 1.3.1 lost an imported 1NC.
 * Nimbus frames are ≤48,000 chars today, so this should never fire.
 */
const RELAY_MAX_FRAME_CHARS = 256 * 1024;
/** Answered by the relay without waking it; keeps `lastFrameAt` fresh. */
const RELAY_HB = '{"t":"hb"}';
/** Consecutive login refusals before the relay is written off for this
 *  session. Supabase takes over, so a login problem can never end partner
 *  flowing — the relay may only ever make things better. */
const RELAY_AUTH_GIVE_UP = 4;
/** Close codes from relay/src/index.ts that end the relay for this session. */
const RELAY_CLOSE = { FORBIDDEN: 4003, BAD_ROOM: 4004, TOO_BIG: 4009, OFF: 4010, AUTH: 4011 } as const;

type RelayDeath = "off" | "forbidden" | "bad-room" | "auth";

interface RelayHandlers extends Handlers {
  /** The relay said no in a way retrying won't fix. Supabase takes over. */
  onDead?: (why: RelayDeath) => void;
}

/**
 * One room on the Cloudflare relay. The same shape as {@link SupabaseChannel}
 * — outbox, backoff, heartbeat, stale detection — so the two behave alike
 * under the coordinator.
 */
class RelayChannel implements Channel {
  status: RealtimeStatus = "idle";
  overflowed = false;

  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;
  private joined = false;
  /** Serialized frames made while down, replayed on rejoin. */
  private outbox: string[] = [];
  private lastFrameAt = 0;
  private authFails = 0;

  constructor(
    private base: string,
    private room: string,
    private presenceKey: string,
    private presenceMeta: Record<string, unknown>,
    private handlers: RelayHandlers,
    private getToken: () => Promise<string>,
  ) {}

  connect(): void {
    if (this.closed) return;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${this.base.replace(/\/+$/, "")}/v1/room/${encodeURIComponent(this.room)}`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = async () => {
      let token = "";
      try {
        token = await this.getToken();
      } catch {
        token = "";
      }
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
      // No usable login at this moment (a refresh in flight, a blip offline).
      // That is a wait, not a refusal — try again on the ordinary backoff.
      if (!token) {
        this.forceReconnect();
        return;
      }
      this.lastFrameAt = Date.now();
      this.raw(JSON.stringify({ t: "join", token, key: this.presenceKey, meta: this.presenceMeta }));
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let m: { t?: string; e?: unknown; p?: unknown; peers?: unknown; code?: unknown };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.lastFrameAt = Date.now();
      switch (m.t) {
        case "joined":
          this.joined = true;
          this.attempt = 0;
          this.authFails = 0;
          this.setStatus("joined");
          this.startHeartbeat();
          this.flushOutbox();
          break;
        case "presence": {
          const peers = Array.isArray(m.peers) ? (m.peers as Array<{ key?: unknown; meta?: unknown }>) : [];
          this.handlers.onPresence?.(
            peers.map((p) => ({ key: String(p.key ?? ""), meta: (p.meta ?? {}) as Record<string, unknown> })),
          );
          break;
        }
        case "b":
          if (typeof m.e === "string") this.handlers.onMessage?.(m.e, m.p);
          break;
        case "err":
          if (m.code === "too_big") {
            console.error("[relay] a frame was refused as too big and was NOT delivered", m);
          }
          break;
      }
    };

    ws.onerror = () => {
      // Always followed by a close; onclose owns recovery.
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.joined = false;
      this.stopHeartbeat();
      // We can no longer see who is in the room.
      this.handlers.onPresence?.([]);
      if (this.closed) {
        this.setStatus("closed");
        return;
      }
      switch (e.code) {
        case RELAY_CLOSE.OFF:
          return this.die("off");
        case RELAY_CLOSE.FORBIDDEN:
          return this.die("forbidden");
        case RELAY_CLOSE.BAD_ROOM:
          return this.die("bad-room");
        case RELAY_CLOSE.AUTH:
          if (++this.authFails >= RELAY_AUTH_GIVE_UP) return this.die("auth");
          break;
        case RELAY_CLOSE.TOO_BIG:
          console.error("[relay] the relay closed us over an oversized frame; it was NOT delivered");
          break;
      }
      this.scheduleRetry();
    };
  }

  /** Same contract as SupabaseChannel.broadcast: TRUE only if it left. */
  broadcast(event: string, payload: unknown, queueIfDown = true): boolean {
    if (this.closed) return false;
    if (!this.joined && !queueIfDown) return false;
    const frame = JSON.stringify({ t: "b", e: event, p: payload });
    if (frame.length > RELAY_MAX_FRAME_CHARS) {
      console.error(`[relay] refusing to send a ${frame.length}-char "${event}" frame; the limit is ${RELAY_MAX_FRAME_CHARS}`);
      return false;
    }
    if (!this.joined) {
      this.outbox.push(frame);
      if (this.outbox.length > SupabaseChannel.OUTBOX_LIMIT) {
        this.outbox.shift();
        this.overflowed = true;
      }
      return false;
    }
    return this.raw(frame);
  }

  get pending(): number {
    return this.outbox.length;
  }

  private flushOutbox(): void {
    const queued = this.outbox;
    this.outbox = [];
    for (const f of queued) if (!this.joined || !this.raw(f)) this.outbox.push(f);
  }

  /** True only when the frame reached the wire. */
  private raw(s: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(s);
      return true;
    } catch {
      return false;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.raw(RELAY_HB), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private die(why: RelayDeath): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.outbox = [];
    this.setStatus("refused");
    this.handlers.onDead?.(why);
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry) return;
    const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.setStatus("reconnecting");
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
  }

  /** Same staleness rule as SupabaseChannel.ensureFresh. */
  ensureFresh(): void {
    if (this.closed || !this.joined) return;
    if (Date.now() - this.lastFrameAt < STALE_MS) return;
    this.forceReconnect();
  }

  /**
   * Drop the socket and reconnect NOW.
   *
   * ⚠ Does not wait for the old socket's close event. On a dead network the
   * closing handshake can hang for a long time, and that is exactly when the
   * stale check calls this — so the old socket is abandoned (its handlers
   * ignore it from here on) and the retry starts immediately.
   */
  private forceReconnect(): void {
    if (this.closed) return;
    const ws = this.ws;
    this.ws = null;
    this.joined = false;
    this.stopHeartbeat();
    try {
      ws?.close(1000);
    } catch {
      // Already gone.
    }
    this.handlers.onPresence?.([]);
    this.scheduleRetry();
  }

  private setStatus(s: RealtimeStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.handlers.onStatus?.(s);
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.outbox = [];
    try {
      this.ws?.close(1000);
    } catch {
      // Already gone.
    }
    this.ws = null;
    this.setStatus("closed");
  }
}

// ===========================================================================
// The coordinator: which relay a session runs on.
// ===========================================================================

/** A message that arrived over Supabase waits this long for the same partner
 *  to turn up on the relay before the session settles on Supabase. */
const RELAY_GRACE_MS = 1_500;
/** The partner missing from the relay this long mid-session: also listen on
 *  Supabase, in case THEY had to fall back to it. */
const LURK_AFTER_MS = 8_000;

/**
 * Runs a session on the Cloudflare relay when both partners can reach it, and
 * on Supabase when either one can't — decided per session, by where the
 * partner is actually heard.
 *
 * Until the partner is first heard it listens on BOTH and says everything on
 * both. The first message decides: over the relay settles it at once; over
 * Supabase waits {@link RELAY_GRACE_MS} for the same partner on the relay
 * first, so the cheap path wins whenever it works. That one rule covers:
 *  - an old build (Supabase only) on either side → Supabase;
 *  - wifi that blocks the relay's domain on either side → Supabase;
 *  - the emergency switch (the relay refusing with 4010) → Supabase;
 *  - both on new builds with a working relay → the relay.
 * Two partners can never settle on different relays, because each only
 * settles on the one it actually heard the other on.
 *
 * Mid-session, if the relay is lost for good (switched off, or refusing the
 * login), the session moves to Supabase, and the partner — seeing us vanish
 * from the relay — starts listening there too and follows. Either move is
 * presented to the sync layer as an ordinary reconnect ("reconnecting", then
 * "joined" only once the partner is present on the new relay), so the existing
 * rejoin → resendEverything machinery re-delivers anything said into the gap.
 */
class DualChannel implements Channel {
  status: RealtimeStatus = "idle";
  /** Which relay this session settled on; null until the partner is heard. */
  active: "relay" | "supabase" | null = null;

  private relay: RelayChannel | null = null;
  private supa: SupabaseChannel | null = null;
  private relayDead = false;
  private supaRefused = false;
  private relayPeers: PresencePeer[] = [];
  private supaPeers: PresencePeer[] = [];
  /** Supabase messages waiting out the grace period, in arrival order. */
  private held: Array<[string, unknown]> = [];
  private heldSince = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private relayAbsentSince = 0;
  private lurkTimer: ReturnType<typeof setTimeout> | null = null;
  /** Mid-session move in progress: "joined" is held back until the partner is
   *  on the new relay, so the rejoin hello it triggers actually reaches them. */
  private switching = false;
  private closed = false;

  constructor(
    private name: string,
    private key: string,
    private meta: Record<string, unknown>,
    private handlers: Handlers,
    private getToken: () => Promise<string>,
  ) {}

  start(): void {
    const url = relayUrl();
    if (!url) {
      // No relay configured: exactly the Supabase-only behaviour.
      this.active = "supabase";
      this.openSupa();
      return;
    }
    this.openRelay(url);
    this.openSupa();
  }

  // ---- the two transports -------------------------------------------------

  private openRelay(url: string): void {
    const ch: RelayChannel = new RelayChannel(url, this.name, this.key, this.meta, {
      onStatus: (s) => {
        if (this.relay === ch) this.onSubStatus("relay");
      },
      onMessage: (e, p) => {
        if (this.relay === ch) this.fromRelay(e, p);
      },
      onPresence: (peers) => {
        if (this.relay === ch) this.onRelayPresence(peers);
      },
      onDead: () => {
        if (this.relay === ch) this.onRelayDead();
      },
    }, this.getToken);
    this.relay = ch;
    ch.connect();
  }

  private openSupa(): void {
    if (this.supa || this.supaRefused || this.closed) return;
    const ch: SupabaseChannel = new SupabaseChannel(`realtime:${this.name}`, this.key, this.meta, {
      onStatus: () => {
        if (this.supa === ch) this.onSubStatus("supabase");
      },
      onMessage: (e, p) => {
        if (this.supa === ch) this.fromSupa(e, p);
      },
      onPresence: (peers) => {
        if (this.supa === ch) this.onSupaPresence(peers);
      },
      onRejected: (r) => {
        if (this.supa === ch) this.onSupaRejected(r);
      },
    }, this.getToken);
    this.supa = ch;
    ch.connect();
  }

  // ⚠ Detach BEFORE closing: close() reports "closed" synchronously, and that
  // must not be mistaken for news from a live transport.
  private closeRelay(): void {
    const ch = this.relay;
    this.relay = null;
    this.relayPeers = [];
    ch?.close();
  }

  private closeSupa(): void {
    const ch = this.supa;
    this.supa = null;
    this.supaPeers = [];
    this.dropHeld();
    ch?.close();
  }

  private others(peers: PresencePeer[]): PresencePeer[] {
    return peers.filter((p) => p.key !== this.key);
  }

  // ---- arriving messages --------------------------------------------------

  private fromRelay(event: string, payload: unknown): void {
    if (this.active === null) this.settleOnRelay();
    if (this.active === "relay") this.handlers.onMessage?.(event, payload);
  }

  private fromSupa(event: string, payload: unknown): void {
    if (this.active === "supabase") return this.deliverSupa(event, payload);
    if (this.relayDead || !this.relay) {
      this.switchToSupa();
      return this.deliverSupa(event, payload);
    }
    // Hold it: the same partner is most likely about to be heard on the relay,
    // and then this copy is a duplicate to throw away.
    this.held.push([event, payload]);
    if (!this.heldSince) this.heldSince = Date.now();
    this.checkGrace();
  }

  private deliverSupa(event: string, payload: unknown): void {
    // A message means the partner is here, so a move in progress is complete.
    if (this.switching) this.finishSwitch();
    this.handlers.onMessage?.(event, payload);
  }

  // ---- deciding -----------------------------------------------------------

  private settleOnRelay(): void {
    this.active = "relay";
    this.relayAbsentSince = 0;
    // The partner is on the relay; Supabase is no longer needed.
    this.closeSupa();
    this.clearLurk();
    this.emitPresence();
    this.syncStatus();
  }

  /**
   * Settle on Supabase: pre-session (the partner was only heard there) or
   * mid-session (the relay is gone, or the partner moved).
   */
  private switchToSupa(): void {
    const wasLive = this.active === "relay";
    this.active = "supabase";
    // Presented to the sync layer as a reconnect (see the class comment). Set
    // before opening Supabase, whose own "connecting" must not leak through.
    if (wasLive) {
      this.switching = true;
      this.setStatus("reconnecting");
    }
    this.clearGrace();
    this.clearLurk();
    this.closeRelay();
    if (!this.supa) this.openSupa();
    const held = this.held;
    this.held = [];
    this.heldSince = 0;
    this.trySwitchDone();
    for (const [e, p] of held) this.deliverSupa(e, p);
    this.emitPresence();
    if (!this.switching) this.syncStatus();
    if (!this.supa && this.supaRefused) this.giveUp(undefined);
  }

  private trySwitchDone(): void {
    if (this.switching && this.supa?.status === "joined" && this.others(this.supaPeers).length) {
      this.finishSwitch();
    }
  }

  private finishSwitch(): void {
    this.switching = false;
    // ⚠ "joined" after "reconnecting" is what makes the sync layer announce a
    // rejoin, which makes the partner resend everything we may have missed.
    this.setStatus("joined");
  }

  /** Held Supabase messages: settle on Supabase once the grace is over, unless
   *  the relay has settled it first. Also run from ensureFresh, because a
   *  backgrounded window's timers cannot be trusted to fire on time. */
  private checkGrace(): void {
    if (!this.heldSince || this.active === "supabase" || this.closed) return;
    // Mid-session: the partner reappearing on the relay settles it for the relay.
    if (this.active === "relay" && this.others(this.relayPeers).length) {
      this.dropHeld();
      this.stopLurk();
      return;
    }
    const left = RELAY_GRACE_MS - (Date.now() - this.heldSince);
    if (left <= 0) return this.switchToSupa();
    if (!this.graceTimer) {
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        this.checkGrace();
      }, left + 10);
    }
  }

  private dropHeld(): void {
    this.held = [];
    this.heldSince = 0;
    this.clearGrace();
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  // ---- presence -----------------------------------------------------------

  private onRelayPresence(peers: PresencePeer[]): void {
    this.relayPeers = peers;
    if (this.active === "relay") {
      if (this.others(peers).length) {
        this.relayAbsentSince = 0;
        this.dropHeld();
        this.stopLurk();
      } else {
        if (!this.relayAbsentSince) this.relayAbsentSince = Date.now();
        this.checkLurk();
      }
    }
    if (this.active !== "supabase") this.emitPresence();
  }

  private onSupaPresence(peers: PresencePeer[]): void {
    this.supaPeers = peers;
    if (this.active === "supabase") {
      this.trySwitchDone();
      this.emitPresence();
      return;
    }
    if (this.active === "relay") {
      // Lurking, and the partner showed up on Supabase while absent from the
      // relay — they may have fallen back. Same grace as a held message.
      if (this.others(peers).length && !this.others(this.relayPeers).length) {
        if (!this.heldSince) this.heldSince = Date.now();
        this.checkGrace();
      }
      return;
    }
    this.emitPresence();
  }

  /** Partner absent from the relay long enough: listen on Supabase as well. */
  private checkLurk(): void {
    if (this.active !== "relay" || !this.relayAbsentSince || this.supa || this.supaRefused || this.closed) return;
    const left = LURK_AFTER_MS - (Date.now() - this.relayAbsentSince);
    if (left <= 0) {
      this.clearLurk();
      this.openSupa();
      return;
    }
    if (!this.lurkTimer) {
      this.lurkTimer = setTimeout(() => {
        this.lurkTimer = null;
        this.checkLurk();
      }, left + 10);
    }
  }

  private stopLurk(): void {
    this.clearLurk();
    if (this.active === "relay" && this.supa) this.closeSupa();
  }

  private clearLurk(): void {
    if (this.lurkTimer) clearTimeout(this.lurkTimer);
    this.lurkTimer = null;
  }

  private emitPresence(): void {
    if (this.active === "relay") return this.handlers.onPresence?.(this.relayPeers);
    if (this.active === "supabase") return this.handlers.onPresence?.(this.supaPeers);
    const all = new Map<string, PresencePeer>();
    for (const p of [...this.supaPeers, ...this.relayPeers]) all.set(p.key, p);
    this.handlers.onPresence?.([...all.values()]);
  }

  // ---- failures -----------------------------------------------------------

  private onRelayDead(): void {
    this.relayDead = true;
    this.relay = null;
    this.relayPeers = [];
    if (this.active === "relay" || this.held.length) this.switchToSupa();
    else if (this.active === null) {
      this.openSupa();
      this.emitPresence();
      this.syncStatus();
    }
  }

  private onSupaRejected(response: unknown): void {
    this.supaRefused = true;
    this.supa = null;
    this.supaPeers = [];
    this.dropHeld();
    // Only the end of partner flowing if the relay can't carry it either.
    if (this.active === "supabase" || this.relayDead || !this.relay) this.giveUp(response);
  }

  private giveUp(response: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.clearGrace();
    this.clearLurk();
    this.closeRelay();
    this.handlers.onRejected?.(response);
    this.setStatus("refused");
  }

  // ---- status -------------------------------------------------------------

  private onSubStatus(which: "relay" | "supabase"): void {
    if (this.switching) {
      if (which === "supabase") this.trySwitchDone();
      return;
    }
    if (this.active === null || this.active === which) this.syncStatus();
  }

  private syncStatus(): void {
    if (this.closed || this.switching) return;
    const sub = this.active === "relay" ? this.relay : this.active === "supabase" ? this.supa : null;
    if (sub) {
      if (sub.status !== "refused" && sub.status !== "idle") this.setStatus(sub.status);
      return;
    }
    // Not settled yet: up as soon as either is.
    const any = this.relay?.status === "joined" || this.supa?.status === "joined";
    this.setStatus(any ? "joined" : "connecting");
  }

  private setStatus(s: RealtimeStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.handlers.onStatus?.(s);
  }

  // ---- the Channel interface ----------------------------------------------

  broadcast(event: string, payload: unknown, queueIfDown = true): boolean {
    if (this.closed) return false;
    if (this.active === "relay") return this.relay?.broadcast(event, payload, queueIfDown) ?? false;
    if (this.active === "supabase") return this.supa?.broadcast(event, payload, queueIfDown) ?? false;
    // Not settled: say it on both. The partner is on at least one of them.
    const a = this.relay?.broadcast(event, payload, queueIfDown) ?? false;
    const b = this.supa?.broadcast(event, payload, queueIfDown) ?? false;
    return a || b;
  }

  get pending(): number {
    if (this.active === "relay") return this.relay?.pending ?? 0;
    if (this.active === "supabase") return this.supa?.pending ?? 0;
    return Math.max(this.relay?.pending ?? 0, this.supa?.pending ?? 0);
  }

  get overflowed(): boolean {
    if (this.active === "relay") return this.relay?.overflowed ?? false;
    if (this.active === "supabase") return this.supa?.overflowed ?? false;
    return (this.relay?.overflowed ?? false) || (this.supa?.overflowed ?? false);
  }

  ensureFresh(): void {
    this.relay?.ensureFresh();
    this.supa?.ensureFresh();
    this.checkGrace();
    this.checkLurk();
  }

  close(): void {
    this.closed = true;
    this.clearGrace();
    this.clearLurk();
    this.closeRelay();
    this.closeSupa();
    this.setStatus("closed");
  }
}

export function openChannel(
  name: string,
  presenceKey: string,
  presenceMeta: Record<string, unknown>,
  handlers: Handlers,
  getToken?: () => Promise<string>,
): Channel {
  const ch = new DualChannel(name, presenceKey, presenceMeta, handlers, getToken ?? (async () => ""));
  ch.start();
  return ch;
}

/** Room codes get read aloud across a table, so the alphabet drops the
 *  characters that get misheard or mistyped under time pressure: O/0, I/1/L,
 *  S/5. 27 symbols over 6 places is ~387 million codes, and a code only exists
 *  for the length of one round. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ23467";

export function makeRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Normalize what someone typed: case, spaces, and the dash people add. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
