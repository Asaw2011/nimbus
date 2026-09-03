// Partner flowing: two people, one flow, over a Supabase Realtime broadcast
// channel. See `realtime.ts` for the transport.
//
// ── The rules this file exists to keep ──────────────────────────────────────
//
// 1. SOLO FLOWING IS UNTOUCHED. Nothing here runs until you start or join a
//    session. With no session there is no diff loop, no socket, no listener.
//
// 2. EACH PARTNER WRITES THEIR OWN FILE, ALWAYS. Two clients autosaving one
//    Dropbox file is the exact shape of the 2026-08-24 data loss. A session
//    syncs CONTENT between two local copies; it never shares a path.
//
// 3. DELTAS ARE KEYED ON ROW ID, NEVER ROW INDEX. The moment either side
//    inserts a row every index below it shifts, and an index-addressed edit
//    would land on the wrong argument.
//
// 4. THE FLOW IS NEVER STORED SERVER-SIDE. A channel is a relay. Nothing about
//    a round is persisted by Supabase.
//
// ── Known limitation, deliberate ───────────────────────────────────────────
//
// Undo is snapshot-based (`pushHistory` stringifies the WHOLE round), so an
// undo taken after your partner typed would restore a snapshot that predates
// their work and silently delete it. Until undo is rewritten to inverse
// patches, receiving a remote change CLEARS THE UNDO STACK. Undo is therefore
// short-lived during a live session. That is a real cost, chosen over the
// alternative, which is destroying your partner's flow.

import { store } from "./round.svelte";
import { auth } from "./auth.svelte";
import { openChannel, makeRoomCode, normalizeCode, type Channel, type PresencePeer } from "./realtime";
import type { Cell, Round, Sheet, SheetKind } from "./types";

/** Diff cadence. Fast enough to feel live, slow enough that a burst of typing
 *  is one message rather than one per keystroke. */
const DIFF_MS = 250;
/** Snapshot chunk size. Comfortably under any realtime payload limit, so a big
 *  flow transfers without us having to know what that limit is. */
const CHUNK_CHARS = 48_000;
/** A peer that hasn't been heard from in this long is treated as gone. Presence
 *  leave events proved slow to arrive, so this is the authority, not presence. */
const PEER_TIMEOUT_MS = 20_000;
const PING_MS = 5_000;
/** How often a guest re-asks to be let in while it waits. */
const JOIN_RETRY_MS = 3_000;

// ---- delta protocol --------------------------------------------------------

export type Delta =
  | { t: "cell"; s: string; r: string; c: number; v: Cell }
  | { t: "rowins"; s: string; id: string; at: number }
  | { t: "rowdel"; s: string; r: string }
  | { t: "sheetadd"; at: number; sheet: Sheet }
  | { t: "sheetdel"; s: string }
  | { t: "sheetmeta"; s: string; title: string; kind: SheetKind; startCol: number; color?: string }
  | { t: "meta"; k: "name" | "tournament" | "opponent" | "judges" | "affTeam" | "negTeam"; v: string };

/** Shadow of the last state we published, as `sheet|row|col -> JSON`, plus the
 *  structure we compared against. Rebuilt on every diff pass. */
interface Shadow {
  cells: Map<string, string>;
  rows: Map<string, string[]>;
  sheetMeta: Map<string, string>;
  sheetOrder: string[];
}

function emptyShadow(): Shadow {
  return { cells: new Map(), rows: new Map(), sheetMeta: new Map(), sheetOrder: [] };
}

function metaKey(s: Sheet): string {
  return JSON.stringify({ t: s.title, k: s.kind, c: s.startCol, col: s.color });
}

/** Everything that changed between `prev` and the round as it is now. */
function diffRound(round: Round, prev: Shadow): { deltas: Delta[]; next: Shadow } {
  const next = emptyShadow();
  const deltas: Delta[] = [];

  next.sheetOrder = round.sheets.map((s) => s.id);
  const seen = new Set<string>();

  round.sheets.forEach((sheet, si) => {
    seen.add(sheet.id);
    const rowIds = sheet.rows.map((r) => r.id);
    next.rows.set(sheet.id, rowIds);
    const mk = metaKey(sheet);
    next.sheetMeta.set(sheet.id, mk);

    const hadSheet = prev.sheetMeta.has(sheet.id);
    if (!hadSheet) {
      // A brand-new sheet ships whole — it is small at creation, and this is
      // far simpler than synthesising row-inserts for an empty grid.
      deltas.push({ t: "sheetadd", at: si, sheet: structuredClone(sheet) as Sheet });
      for (const r of sheet.rows)
        r.cells.forEach((c, ci) => next.cells.set(`${sheet.id}|${r.id}|${ci}`, JSON.stringify(c)));
      return;
    }
    if (prev.sheetMeta.get(sheet.id) !== mk) {
      deltas.push({
        t: "sheetmeta", s: sheet.id, title: sheet.title, kind: sheet.kind,
        startCol: sheet.startCol, color: sheet.color,
      });
    }

    // Rows, by id. Removals first so insert indices refer to the new shape.
    const before = prev.rows.get(sheet.id) ?? [];
    const beforeSet = new Set(before);
    const nowSet = new Set(rowIds);
    for (const id of before) if (!nowSet.has(id)) deltas.push({ t: "rowdel", s: sheet.id, r: id });
    rowIds.forEach((id, i) => {
      if (!beforeSet.has(id)) deltas.push({ t: "rowins", s: sheet.id, id, at: i });
    });

    // Cells, by (row id, column).
    for (const row of sheet.rows) {
      row.cells.forEach((cell, ci) => {
        const key = `${sheet.id}|${row.id}|${ci}`;
        const json = JSON.stringify(cell);
        next.cells.set(key, json);
        // A row that was just inserted arrives empty on the far side, so only
        // emit a cell for it when it actually has something in it.
        if (prev.cells.get(key) !== json && (beforeSet.has(row.id) || json !== "{}")) {
          deltas.push({ t: "cell", s: sheet.id, r: row.id, c: ci, v: structuredClone(cell) as Cell });
        }
      });
    }
  });

  for (const id of prev.sheetOrder) if (!seen.has(id)) deltas.push({ t: "sheetdel", s: id });

  const metaKeys = ["name", "tournament", "opponent", "judges", "affTeam", "negTeam"] as const;
  for (const k of metaKeys) {
    const cur = String(round[k] ?? "");
    if (prev.sheetMeta.get(`@${k}`) !== cur) deltas.push({ t: "meta", k, v: cur });
    next.sheetMeta.set(`@${k}`, cur);
  }

  return { deltas, next };
}

/**
 * Apply a delta from the other side.
 *
 * Deliberately TOLERANT: anything that refers to a sheet or row we don't have
 * is skipped rather than throwing. The two sides can briefly disagree during a
 * reconnect, and a thrown error inside the apply loop would strand the rest of
 * the batch — losing edits that were perfectly applicable.
 */
function applyDelta(round: Round, d: Delta): void {
  const sheetOf = (id: string) => round.sheets.find((s) => s.id === id);
  switch (d.t) {
    case "cell": {
      const sheet = sheetOf(d.s);
      const row = sheet?.rows.find((r) => r.id === d.r);
      if (!row || d.c < 0 || d.c >= row.cells.length) return;
      row.cells[d.c] = d.v;
      return;
    }
    case "rowins": {
      const sheet = sheetOf(d.s);
      if (!sheet || sheet.rows.some((r) => r.id === d.id)) return;
      const nCols = round.template.speeches.length;
      const at = Math.max(0, Math.min(d.at, sheet.rows.length));
      sheet.rows.splice(at, 0, {
        id: d.id,
        cells: Array.from({ length: nCols }, () => ({ text: "" })),
      });
      return;
    }
    case "rowdel": {
      const sheet = sheetOf(d.s);
      if (!sheet) return;
      const i = sheet.rows.findIndex((r) => r.id === d.r);
      if (i >= 0) sheet.rows.splice(i, 1);
      return;
    }
    case "sheetadd": {
      if (sheetOf(d.sheet.id)) return;
      round.sheets.splice(Math.max(0, Math.min(d.at, round.sheets.length)), 0, d.sheet);
      return;
    }
    case "sheetdel": {
      const i = round.sheets.findIndex((s) => s.id === d.s);
      if (i >= 0) round.sheets.splice(i, 1);
      return;
    }
    case "sheetmeta": {
      const sheet = sheetOf(d.s);
      if (!sheet) return;
      sheet.title = d.title;
      sheet.kind = d.kind;
      sheet.startCol = d.startCol;
      if (d.color === undefined) delete sheet.color;
      else sheet.color = d.color;
      return;
    }
    case "meta":
      round[d.k] = d.v;
      return;
  }
}

// ---- session ---------------------------------------------------------------

export type SessionStatus =
  | "off"
  | "hosting"      // waiting for a partner
  | "joining"      // sent hello, waiting to be let in
  | "connected"
  | "reconnecting"
  | "error";

export interface JoinRequest {
  clientId: string;
  email: string;
}

/**
 * How the two flows relate.
 *
 * - `shared`   — ONE flow, both of you on it, split into partner lanes.
 * - `separate` — TWO flows, one each, both open and both EDITABLE. You can drop
 *                a block onto your partner's page while they're flowing it.
 */
export type SessionMode = "shared" | "separate";

/**
 * Where your partner is working, as broadcast.
 *
 * Position only. This is a presence hint, not part of the flow — it is never
 * persisted, never enters a delta, and never touches undo.
 */
export interface PeerCursor {
  doc: string;
  sheet: string;
  row: number;
  col: number;
  /** True while they are actively typing, so a marker can read differently
   *  from a cursor merely parked somewhere. */
  typing: boolean;
  at: number;
}

class SessionStore {
  status = $state<SessionStatus>("off");
  code = $state("");
  mode = $state<SessionMode>("shared");
  role = $state<"host" | "guest" | null>(null);
  /** In a separate-flows session, the round id your partner owns. */
  peerDocId = $state("");
  /** The partner's email once connected. */
  peerEmail = $state("");
  peerOnline = $state(false);
  error = $state("");
  /** A partner asking to be let in. The host approves explicitly — the code
   *  alone is not enough to get into someone's flow. */
  pending = $state<JoinRequest | null>(null);
  /** Edits waiting on the socket. Surfaced so a stalled sync is visible. */
  queued = $state(0);
  /** True once we know edits were dropped rather than queued. The flows may
   *  differ from here on, and the only honest fix is a fresh session. */
  desynced = $state(false);
  /** Where your partner is right now. Null when they're gone or idle. */
  peerCursor = $state<PeerCursor | null>(null);

  private ch: Channel | null = null;
  private clientId = crypto.randomUUID();
  /** One shadow per open document — a separate-flows session diffs both. */
  private shadows = new Map<string, Shadow>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  /** True while we are writing a remote change, so the diff loop doesn't
   *  immediately echo it back as if it were ours. */
  private applying = false;
  private inbound = new Map<string, string[]>();
  /** The round id YOU own in this session. */
  private myDocId = "";
  /** Re-asks to be let in while we sit in "joining". */
  private joinRetry: ReturnType<typeof setInterval> | null = null;
  /** Clients the host has already admitted. A repeat hello from one of these
   *  means they never got the flow, so we resend rather than re-prompting. */
  private admitted = new Set<string>();
  /** Guard so the guest answers the host's mirror with its own flow exactly
   *  once, even if the snapshot is re-sent after a reconnect. */
  private sentMine = false;

  get active(): boolean {
    return this.status !== "off";
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Start a session and become lane 0. Returns the code to read out. */
  host(mode: SessionMode = "shared"): string {
    if (!store.round) return "";
    this.reset();
    this.mode = mode;
    this.code = makeRoomCode();
    this.role = "host";
    this.status = "hosting";
    store.myLane = 0;
    this.open();
    return this.code;
  }

  /** Join a partner's session as lane 1. */
  join(raw: string): void {
    const code = normalizeCode(raw);
    if (code.length !== 6) {
      this.error = "A room code is 6 characters.";
      return;
    }
    this.reset();
    this.code = code;
    this.role = "guest";
    this.status = "joining";
    this.open();
    this.sayHello();
    // Ask again on a timer. Covers a hello lost before the channel finished
    // joining AND, more importantly, a snapshot that was sent while this
    // window was in the background and never arrived — without this the guest
    // sat on "Waiting for your partner to let you in" forever with no way out.
    this.joinRetry = setInterval(() => {
      if (this.status !== "joining") return this.stopJoinRetry();
      this.ch?.ensureFresh();
      this.sayHello();
    }, JOIN_RETRY_MS);
  }

  private sayHello(): void {
    this.ch?.broadcast("hello", {
      clientId: this.clientId,
      email: auth.email,
      // Still waiting to be admitted, so we definitely have not got the flow.
      needSnapshot: true,
    });
  }

  private stopJoinRetry(): void {
    if (this.joinRetry) clearInterval(this.joinRetry);
    this.joinRetry = null;
  }

  /**
   * The host lets a waiting partner in.
   *
   * SHARED: hand over the flow; they adopt it as theirs.
   * SEPARATE: hand over a COPY to sit beside their own, and ask for theirs
   * back. Neither side gives up the flow it already had.
   */
  accept(): void {
    const req = this.pending;
    if (!req || this.role !== "host" || !store.round) return;
    this.pending = null;
    this.admitted.add(req.clientId);
    this.peerEmail = req.email;
    this.myDocId = store.round.id;
    this.sendSnapshot(req.clientId, this.mode === "separate" ? "mirror" : "adopt");
    this.goLive();
  }

  decline(): void {
    const req = this.pending;
    this.pending = null;
    if (req) this.ch?.broadcast("declined", { to: req.clientId });
  }

  /** End the session. The flow stays exactly as it is, on both sides. */
  leave(): void {
    this.ch?.broadcast("bye", { clientId: this.clientId });
    this.reset();
  }

  private reset(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.ping) clearInterval(this.ping);
    this.timer = this.ping = null;
    this.stopJoinRetry();
    this.admitted.clear();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.flush);
      window.removeEventListener("blur", this.flush);
      window.removeEventListener("pagehide", this.flush);
    }
    this.ch?.close();
    this.ch = null;
    this.shadows.clear();
    this.inbound.clear();
    // Close the partner's flow. It is still saved in app data under its own
    // id, so it stays reachable from the dashboard — this just stops rendering
    // a document whose owner is no longer connected.
    store.clearMirrors();
    this.mode = "shared";
    this.peerDocId = "";
    this.myDocId = "";
    this.sentMine = false;
    this.status = "off";
    this.code = "";
    this.role = null;
    this.peerEmail = "";
    this.peerOnline = false;
    this.pending = null;
    this.queued = 0;
    this.desynced = false;
    this.peerCursor = null;
    this.sentCursor = "";
    this.error = "";
    store.myLane = 0;
  }

  private open(): void {
    // ⚠ These go on HERE, not in goLive(). A guest waiting to be let in is the
    // most fragile moment in the whole flow: its window is behind the host's
    // while they click approve, so its timers are throttled and its socket can
    // go stale — and with no listener attached it had no way back. That is the
    // "stuck on Waiting for your partner to let you in" hang.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.flush);
      window.addEventListener("blur", this.flush);
      window.addEventListener("pagehide", this.flush);
    }
    this.ch = openChannel(
      `nimbus-flow-${this.code}`,
      this.clientId,
      { email: auth.email, role: this.role },
      {
        onStatus: (s) => {
          if (s === "reconnecting" && this.status === "connected") this.status = "reconnecting";
          if (s === "joined" && this.status === "reconnecting") {
            this.status = "connected";
            // Announce we're back. `needSnapshot` is only true if we genuinely
            // lost the flow (app restart) — otherwise a snapshot would land on
            // top of whatever we typed while offline and delete it.
            this.ch?.broadcast("hello", {
              clientId: this.clientId,
              email: auth.email,
              rejoin: true,
              needSnapshot: !store.round,
            });
            // Edits queued during the outage go out now; if the queue
            // overflowed we can no longer promise the two sides agree.
            if (this.ch?.overflowed) this.desynced = true;
          }
        },
        onMessage: (event, payload) => this.onMessage(event, payload),
        onPresence: (peers: PresencePeer[]) => {
          const others = peers.filter((p) => p.key !== this.clientId);
          if (others.length && !this.peerEmail) {
            this.peerEmail = String(others[0].meta.email ?? "your partner");
          }
        },
      },
    );
  }

  /**
   * Push pending edits out NOW, regardless of where the diff timer is.
   *
   * ⚠ Browsers throttle `setInterval` to about once a minute in a hidden tab,
   * and a minimised Tauri window is a hidden tab. Without this the moment you
   * alt-tab away your edits stop reaching your partner until you come back —
   * reproduced exactly that way while building this. Receiving is unaffected,
   * since incoming websocket frames are event-driven and never throttled.
   *
   * Bound once so it can be removed again; `autosaveToFile` hooks the same
   * events for the same reason.
   */
  private flush = (): void => {
    // Coming back from hidden is the moment to find out whether the connection
    // survived being backgrounded — while hidden, our own timers were throttled
    // and the server may have dropped us without the socket noticing.
    this.ch?.ensureFresh();
    this.publish();
  };

  private goLive(): void {
    this.stopJoinRetry();
    this.status = "connected";
    this.peerOnline = true;
    this.lastHeard = Date.now();
    // Seed a shadow per open document so going live doesn't immediately
    // republish everything as "changes".
    this.reseed();
    this.timer = setInterval(() => this.publish(), DIFF_MS);
    this.ping = setInterval(() => {
      this.ch?.ensureFresh();
      this.ch?.broadcast("ping", { clientId: this.clientId });
      this.queued = this.ch?.pending ?? 0;
      if (this.peerOnline && Date.now() - this.lastHeard > PEER_TIMEOUT_MS) {
        // A marker for someone who has gone quiet is worse than none — it
        // says they are somewhere they may have left minutes ago.
        this.peerOnline = false;
        this.peerCursor = null;
      }
    }, PING_MS);
  }

  // ---- publishing ---------------------------------------------------------

  /** Every document this session is responsible for syncing. In a shared
   *  session that is just the one flow; in a separate session it is yours AND
   *  the mirror of your partner's, because you can both edit both. */
  private syncedDocs(): Round[] {
    if (this.mode === "shared") return store.round ? [store.round] : [];
    return store.docs.filter((d) => d.id === this.myDocId || d.id === this.peerDocId);
  }

  /** Re-seed shadows so nothing already in hand is diffed out as a change. */
  private reseed(): void {
    this.shadows.clear();
    for (const d of this.syncedDocs()) {
      this.shadows.set(d.id, diffRound($state.snapshot(d) as Round, emptyShadow()).next);
    }
  }

  private publish(): void {
    if (this.applying || this.status === "off") return;
    for (const doc of this.syncedDocs()) {
      const snap = $state.snapshot(doc) as Round;
      const { deltas, next } = diffRound(snap, this.shadows.get(doc.id) ?? emptyShadow());
      this.shadows.set(doc.id, next);
      if (!deltas.length) continue;
      // One message per document per batch — a burst of typing is one frame.
      // `doc` is what lets the far side put these on the right flow; without it
      // an edit to your partner's page would land on your own.
      this.ch?.broadcast("delta", { from: this.clientId, doc: doc.id, deltas });
    }
    this.queued = this.ch?.pending ?? 0;
    this.publishCursor();
  }

  /** Last position we announced, so a parked cursor costs no messages. */
  private sentCursor = "";

  /**
   * Tell your partner where you are, on the same 250ms tick as the diff.
   *
   * Deliberately not its own timer and not per-keystroke: a cursor is worth a
   * few bytes four times a second at most, and only when it actually moved.
   */
  private publishCursor(): void {
    const c = store.cursor;
    const doc = store.round?.id ?? "";
    const sheet = store.activeSheetId ?? "";
    if (!doc || !sheet || !c) return;
    // "Typing" is inferred from the round having changed a moment ago — enough
    // to tell writing from parking, with no extra plumbing through the editor.
    const typing = Date.now() - (store.round?.updatedAt ?? 0) < 1200;
    const key = doc + "|" + sheet + "|" + c.row + "|" + c.col + "|" + typing;
    if (key === this.sentCursor) return;
    this.sentCursor = key;
    this.ch?.broadcast("cursor", {
      from: this.clientId, doc, sheet, row: c.row, col: c.col, typing,
    });
  }

  // ---- receiving ----------------------------------------------------------

  private onMessage(event: string, payload: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (p.clientId === this.clientId || p.from === this.clientId) return;
    this.lastHeard = Date.now();
    this.peerOnline = true;

    switch (event) {
      case "hello": {
        if (this.role !== "host") return;
        const req = { clientId: String(p.clientId ?? ""), email: String(p.email ?? "a partner") };
        if (!req.clientId) return;
        // Already let in? Then this hello means they never got the flow —
        // resend it instead of asking us to approve them a second time.
        if (this.admitted.has(req.clientId)) {
          if (p.needSnapshot) {
            this.sendSnapshot(req.clientId, this.mode === "separate" ? "mirror" : "adopt");
          }
          return;
        }
        if (p.rejoin && this.status !== "hosting") {
          // ⚠ A reconnect must NOT be answered with a snapshot unless they
          // actually lost the flow. Re-sending it unconditionally made the
          // rejoining side call loadRound() over the top of everything they
          // typed while the wifi was down — verified destroying an offline
          // edit. Their queued deltas replay on their own; only somebody who
          // restarted the app and has no round needs the flow again.
          if (p.needSnapshot) this.sendSnapshot(req.clientId);
          return;
        }
        this.pending = req;
        return;
      }
      case "declined":
        if (p.to === this.clientId) {
          this.error = "Your partner declined the request.";
          this.reset();
          this.status = "error";
        }
        return;
      case "snap":
        this.onSnapshotChunk(p);
        return;
      case "delta": {
        const deltas = p.deltas as Delta[] | undefined;
        if (!Array.isArray(deltas)) return;
        // Which flow is this about? A shared session has only one, so an older
        // peer that sends no `doc` still works.
        const docId = String(p.doc ?? store.round?.id ?? "");
        if (!docId) return;
        this.applying = true;
        try {
          const landed = store.applyRemoteToDoc(docId, (r) => {
            for (const d of deltas) applyDelta(r, d);
          });
          // ⚠ See the file header. Snapshot undo would restore a whole round
          // from before their edit and delete it. Until undo is patch-based,
          // a remote change ends your undo history — but ONLY for the document
          // that actually changed. An edit to their page must not cost you the
          // undo history of your own.
          if (landed && docId === store.round?.id) store.dropHistory();
        } finally {
          this.applying = false;
          // Re-seed so their change isn't diffed back out as ours next tick.
          const doc = store.docById(docId);
          if (doc) {
            this.shadows.set(docId, diffRound($state.snapshot(doc) as Round, emptyShadow()).next);
          }
        }
        return;
      }
      case "cursor": {
        const doc = String(p.doc ?? "");
        const sheet = String(p.sheet ?? "");
        if (!doc || !sheet) return;
        this.peerCursor = {
          doc, sheet,
          row: Number(p.row ?? 0),
          col: Number(p.col ?? 0),
          typing: !!p.typing,
          at: Date.now(),
        };
        return;
      }
      case "bye":
        this.peerOnline = false;
        this.peerCursor = null;
        return;
      case "ping":
        return;
    }
  }

  // ---- snapshot transfer --------------------------------------------------

  /**
   * Ship a whole round in chunks. A real flow can be megabytes, and chunking
   * means we never have to know the server's payload ceiling.
   *
   * `kind` says what the far side should DO with it:
   *  - `adopt`  — this becomes your flow (shared session; replaces your screen)
   *  - `mirror` — open it alongside your own, editable, owned by me
   */
  private sendSnapshot(to: string, kind: "adopt" | "mirror" = "adopt", round?: Round): void {
    const src = round ?? store.round;
    if (!src) return;
    const json = JSON.stringify($state.snapshot(src));
    const total = Math.max(1, Math.ceil(json.length / CHUNK_CHARS));
    const id = crypto.randomUUID();
    for (let i = 0; i < total; i++) {
      this.ch?.broadcast("snap", {
        from: this.clientId, email: auth.email, to, id, i, total, kind,
        mode: this.mode,
        docId: src.id,
        part: json.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
      });
    }
  }

  private onSnapshotChunk(p: Record<string, unknown>): void {
    if (p.to !== this.clientId) return;
    const id = String(p.id ?? "");
    const total = Number(p.total ?? 0);
    const i = Number(p.i ?? -1);
    if (!id || total <= 0 || i < 0) return;
    let parts = this.inbound.get(id);
    if (!parts) {
      parts = new Array(total).fill("");
      this.inbound.set(id, parts);
    }
    parts[i] = String(p.part ?? "");
    if (parts.some((x) => x === "")) return;

    const json = parts.join("");
    this.inbound.delete(id);
    let round: Round;
    try {
      round = JSON.parse(json) as Round;
    } catch {
      this.error = "The flow your partner sent didn't arrive intact. Ask them to re-invite you.";
      return;
    }
    // ⚠ Their file path is THEIRS. Clearing it is what stops two clients
    // autosaving one file — the shape of the 2026-08-24 data loss. `addMirror`
    // strips it too; both paths do it because it is the one rule here that
    // cannot be allowed to slip.
    delete round.filePath;
    this.peerEmail = String(p.email ?? "") || this.peerEmail || "your partner";

    if (p.kind === "mirror") {
      // SEPARATE flows. Their page opens beside ours; ours is untouched. Send
      // ours back so they get the same pairing from their side.
      this.mode = "separate";
      this.peerDocId = round.id;
      this.myDocId = store.round?.id ?? "";
      store.addMirror(round);
      const alreadyLive = this.status === "connected";
      if (!alreadyLive) this.goLive();
      else this.reseed();
      // The guest answers the host's mirror with its own flow, once.
      if (this.role === "guest" && store.round && !this.sentMine) {
        this.sentMine = true;
        this.sendSnapshot(String(p.from ?? ""), "mirror", store.round);
      }
      return;
    }

    // SHARED flow: their round becomes ours, and we take lane 1.
    this.mode = "shared";
    this.myDocId = round.id;
    store.loadRound(round);
    store.myLane = 1;
    this.goLive();
  }
}

export const session = new SessionStore();
