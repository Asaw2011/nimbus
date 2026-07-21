// COLLAB feature (self-contained; delete this folder + the marked block in
// RoundHome.svelte, then `npm uninstall trystero` — store.applyRemote is
// generic and can stay).
//
// Real-time partner flowing over a shared ROOM CODE. Peers find each other
// through Trystero's free public Nostr relays (no server we run, no signup,
// no cost) and then talk directly laptop-to-laptop via encrypted WebRTC.
// Works across the internet for online tournaments.
//
// Sync is sheet-level last-writer-wins: when a sheet changes locally the whole
// sheet (a few KB) is sent. Partners usually flow different sheets, so
// conflicts are rare. The host's round is the source of truth at connect time.

import { joinRoom, type Room, type DataPayload } from "trystero";
import type { Round, Sheet } from "../model/types";
import { store } from "../model/round.svelte";
import { saveRound } from "../model/persist";
import { loadBlobCached, saveBlob } from "../model/blobs";

const APP_ID = "flow-debate-collab-v1";
const SEND_DEBOUNCE_MS = 120;
// Unambiguous alphabet (no 0/O/1/I/L) for typo-proof codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

type RoundMeta = Pick<
  Round,
  "name" | "tournament" | "opponent" | "judges" | "affTeam" | "negTeam"
>;
type SheetsMsg = {
  order: string[];
  changed: Sheet[];
  removed: string[];
  meta: RoundMeta;
};

export type CollabStatus = "off" | "hosting" | "joining" | "connected";

function randomCode(): string {
  let c = "";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) c += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return c;
}

class CollabSession {
  status = $state<CollabStatus>("off");
  role = $state<"host" | "join" | null>(null);
  code = $state("");
  partnerName = $state("");
  myName = $state(loadBlobCached<string>("collab-name") ?? "");
  error = $state("");

  private room: Room | null = null;
  private sendHello: ((d: unknown) => void) | null = null;
  private sendFull: ((d: unknown) => void) | null = null;
  private sendSheets: ((d: unknown) => void) | null = null;
  private lastSheets = new Map<string, string>();
  private lastMeta = "";
  private applyingRemote = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;

  saveName(): void {
    saveBlob("collab-name", this.myName);
  }

  /** Host: make a room code and wait for a partner. */
  host(): string {
    this.leave();
    this.role = "host";
    this.code = randomCode();
    this.status = "hosting";
    this.connect(this.code);
    return this.code;
  }

  /** Join an existing code. */
  join(code: string): void {
    this.leave();
    this.role = "join";
    this.code = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    this.status = "joining";
    this.connect(this.code);
  }

  private connect(code: string): void {
    let room: Room;
    try {
      room = joinRoom({ appId: APP_ID }, code);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = "off";
      return;
    }
    this.room = room;

    // Action names must be ≤ 12 bytes. Trystero's newer API assigns handlers
    // as properties and returns { send, onMessage }.
    const helloAction = room.makeAction("hello");
    const fullAction = room.makeAction("full");
    const sheetsAction = room.makeAction("sheets");
    this.sendHello = (d) => void helloAction.send(d as DataPayload);
    this.sendFull = (d) => void fullAction.send(d as DataPayload);
    this.sendSheets = (d) => void sheetsAction.send(d as DataPayload);

    helloAction.onMessage = (d) => {
      this.partnerName = (d as { name?: string })?.name || "Partner";
    };
    fullAction.onMessage = (d) => this.adoptRound(d as unknown as Round);
    sheetsAction.onMessage = (d) => this.applySheets(d as unknown as SheetsMsg);

    room.onPeerJoin = () => {
      this.status = "connected";
      this.error = "";
      this.sendHello?.({ name: this.myName || "Partner" });
      // Host pushes the authoritative round to the newcomer.
      if (this.role === "host" && store.round) {
        this.sendFull?.($state.snapshot(store.round) as Round);
        this.prime(store.round);
      }
    };

    room.onPeerLeave = () => {
      if (this.room) {
        this.status = this.role === "host" ? "hosting" : "joining";
        this.error = this.partnerName
          ? `${this.partnerName} disconnected.`
          : "Partner disconnected.";
        this.partnerName = "";
      }
    };
  }

  leave(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.room?.leave();
    this.room = null;
    this.sendHello = this.sendFull = this.sendSheets = null;
    this.status = "off";
    this.role = null;
    this.code = "";
    this.partnerName = "";
    this.lastSheets.clear();
    this.lastMeta = "";
  }

  private adoptRound(round: Round): void {
    this.applyingRemote = true;
    try {
      store.loadRound(round);
      void saveRound(round);
      this.prime(round);
    } finally {
      this.applyingRemote = false;
    }
  }

  private applySheets(msg: SheetsMsg): void {
    this.applyingRemote = true;
    try {
      store.applyRemote((r) => {
        Object.assign(r, msg.meta);
        for (const sheet of msg.changed) {
          const i = r.sheets.findIndex((s) => s.id === sheet.id);
          if (i >= 0) r.sheets[i] = sheet;
          else r.sheets.push(sheet);
          this.lastSheets.set(sheet.id, JSON.stringify(sheet));
        }
        if (msg.removed.length) {
          r.sheets = r.sheets.filter((s) => !msg.removed.includes(s.id));
          for (const id of msg.removed) this.lastSheets.delete(id);
        }
        r.sheets.sort(
          (a, b) => msg.order.indexOf(a.id) - msg.order.indexOf(b.id),
        );
        this.lastMeta = JSON.stringify(msg.meta);
      });
    } finally {
      this.applyingRemote = false;
    }
  }

  private prime(round: Round): void {
    this.lastSheets.clear();
    for (const s of round.sheets) this.lastSheets.set(s.id, JSON.stringify(s));
    this.lastMeta = JSON.stringify(this.metaOf(round));
  }

  private metaOf(round: Round): RoundMeta {
    const { name, tournament, opponent, judges, affTeam, negTeam } = round;
    return { name, tournament, opponent, judges, affTeam, negTeam };
  }

  /** Called (debounced) whenever the local round changes. */
  onLocalChange(round: Round | null): void {
    if (this.status !== "connected" || !round || this.applyingRemote) return;
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => this.flush(round), SEND_DEBOUNCE_MS);
  }

  private flush(round: Round): void {
    if (this.status !== "connected" || !this.sendSheets) return;
    const changed: Sheet[] = [];
    const seen = new Set<string>();
    for (const s of round.sheets) {
      seen.add(s.id);
      const json = JSON.stringify(s);
      if (this.lastSheets.get(s.id) !== json) {
        changed.push(s);
        this.lastSheets.set(s.id, json);
      }
    }
    const removed = [...this.lastSheets.keys()].filter((id) => !seen.has(id));
    for (const id of removed) this.lastSheets.delete(id);
    const meta = this.metaOf(round);
    const metaJson = JSON.stringify(meta);
    const metaChanged = metaJson !== this.lastMeta;
    this.lastMeta = metaJson;
    if (!changed.length && !removed.length && !metaChanged) return;
    this.sendSheets({
      order: round.sheets.map((s) => s.id),
      changed,
      removed,
      meta,
    });
  }
}

export const collab = new CollabSession();
