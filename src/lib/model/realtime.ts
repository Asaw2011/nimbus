// Minimal Supabase Realtime client — enough to run a partner flowing session,
// and nothing more.
//
// Supabase Realtime is a Phoenix channels server. The wire protocol is small
// and stable, so this speaks it directly instead of pulling in
// @supabase/supabase-js (~200KB + deps) for the one feature we use. That also
// matches how `auth.svelte.ts` already talks to the same project with raw
// fetch rather than the SDK.
//
// What this is used for: BROADCAST only. No database tables, no schema, no
// migrations — a channel is just a name, and the server relays messages
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
 *  capped low — tournament wifi drops constantly and we want to be back fast. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
/**
 * Heard nothing for this long while supposedly joined = the connection is dead
 * even though the socket still claims to be OPEN.
 *
 * ⚠ This is not paranoia, it is reproduced behaviour. A hidden tab (which is
 * what a minimised Tauri window is) has its timers throttled to roughly once a
 * minute, so our 25s heartbeat stops landing, the server drops us, and the
 * WebSocket sits at readyState OPEN receiving nothing — verified with a direct
 * probe that never arrived. Heartbeat replies alone keep this fresh in a normal
 * tab, so anything past 45s of total silence is genuinely wrong.
 */
const STALE_MS = 45_000;

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "joined"
  | "reconnecting"
  | "closed";

export interface PresencePeer {
  /** The presence key — our per-client id. */
  key: string;
  meta: Record<string, unknown>;
}

interface Handlers {
  onStatus?: (s: RealtimeStatus) => void;
  /** A broadcast from ANOTHER client (we never receive our own). */
  onMessage?: (event: string, payload: unknown) => void;
  /** The full peer list, recomputed on every presence change. */
  onPresence?: (peers: PresencePeer[]) => void;
}

/**
 * One joined channel. Create with {@link openChannel}; call {@link Channel.close}
 * when done. Reconnects on its own until closed.
 */
export class Channel {
  status: RealtimeStatus = "idle";

  private ws: WebSocket | null = null;
  private ref = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;
  private joined = false;
  /** Broadcasts made while the socket was down, replayed on rejoin. Bounded so
   *  a long outage can't grow without limit — a resync covers the rest. */
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
  ) {}

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

    ws.onopen = () => {
      this.send({
        topic: this.topic,
        event: "phx_join",
        payload: {
          config: {
            // We never want our own messages echoed back — the local store has
            // already applied them, and re-applying would fight the cursor.
            broadcast: { self: false },
            presence: { key: this.presenceKey },
          },
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
        const p = m.payload as { status?: string } | undefined;
        if (m.topic === this.topic && p?.status === "ok" && !this.joined) {
          this.joined = true;
          this.lastFrameAt = Date.now();
          this.attempt = 0;
          this.setStatus("joined");
          this.startHeartbeat();
          this.track();
          this.flushOutbox();
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
        // Marking ourselves un-joined is not enough — nothing would ever
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

  /** Announce ourselves. Re-sent after every rejoin — presence is per-socket,
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

  /** Send a broadcast. Queued (not dropped) while the socket is down. */
  broadcast(event: string, payload: unknown): void {
    if (this.closed) return;
    if (!this.joined) {
      this.outbox.push({ event, payload });
      if (this.outbox.length > Channel.OUTBOX_LIMIT) {
        this.outbox.shift();
        this.overflowed = true;
      }
      return;
    }
    this.send({
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

  private send(frame: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ ...frame, ref: String(++this.ref) }));
    } catch {
      // A send can fail on a socket that is closing; onclose drives recovery.
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ topic: "phoenix", event: "heartbeat", payload: {} });
    }, HEARTBEAT_MS);
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

export function openChannel(
  name: string,
  presenceKey: string,
  presenceMeta: Record<string, unknown>,
  handlers: Handlers,
): Channel {
  const ch = new Channel(`realtime:${name}`, presenceKey, presenceMeta, handlers);
  ch.connect();
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
