// CardMirror bridge client (frontend). Talks to CardMirror Desktop through the
// Rust `cm_*` commands (src-tauri/src/cmbridge.rs). All shapes mirror
// reference-docs/cardmirror-plugin-api.md. Outside Tauri (plain web build) it's
// inert so the app still runs — the built-in SpeechDoc stays the fallback there.

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export type CmRole =
  | "tag"
  | "analytic"
  | "card"
  | "body"
  | "cite"
  | "inline"
  | "pocket"
  | "hat"
  | "block";

export interface CmInsertItem {
  text: string;
  role: CmRole;
  newParagraph?: boolean;
}

export interface CmDoc {
  target: string;
  title: string | null;
  focusedWindow: boolean;
  isSpeech: boolean;
}

interface PingResp {
  ok: boolean;
  appVersion?: string;
  schema?: number;
  hasActiveDoc?: boolean;
  error?: string;
}
interface DocsResp {
  ok: boolean;
  docs?: CmDoc[] | null;
  pending?: string;
  error?: string;
}
export interface CmInsertResp {
  ok: boolean;
  inserted?: boolean;
  docTitle?: string;
  pending?: string;
  error?: string;
}

class CardMirror {
  /** CardMirror Desktop is reachable (session file present + ping ok). */
  running = $state(false);
  appVersion = $state<string | null>(null);
  /** Last request came back `pending:"consent"` — user must approve "nimbus" in
   *  CardMirror → Settings → Plugins → External apps. Drives the consent banner. */
  needsConsent = $state(false);
  docs = $state<CmDoc[]>([]);
  lastError = $state<string | null>(null);

  /** Whether the bridge path is even possible here (Tauri desktop build). */
  get available(): boolean {
    return inTauri();
  }

  /** Where sends should land: the designated speech doc, else the focused doc,
   *  else the first open doc. `null` when nothing is open. */
  get speechTarget(): string | null {
    return this.speechDoc?.target ?? null;
  }

  /** A doc the user pinned as the send target in Nimbus, overriding the
   *  automatic choice. Set when CardMirror has no speech doc designated (or
   *  when you simply want a different one). Cleared by setting it to null. */
  pinnedTarget = $state<string | null>(null);

  /** The doc a send should go to, honouring a manual pin first, then
   *  CardMirror's own "speech doc" designation, then focus, then whatever's
   *  open. `null` when no docs are open at all. */
  get speechDoc(): CmDoc | null {
    const d = this.docs;
    if (this.pinnedTarget) {
      const pinned = d.find((x) => x.target === this.pinnedTarget);
      if (pinned) return pinned;
    }
    return d.find((x) => x.isSpeech) ?? d.find((x) => x.focusedWindow) ?? d[0] ?? null;
  }

  /** The FILENAME of the doc a send should go to. This — not the uid — is what
   *  the queue addresses by, because the plugin identifies its window with
   *  `document.title`, which CardMirror builds from the filename. */
  get speechTitle(): string | null {
    return this.speechDoc?.title ?? null;
  }

  async ping(): Promise<boolean> {
    if (!inTauri()) {
      this.running = false;
      return false;
    }
    try {
      const r = await invoke<PingResp>("cm_ping");
      this.running = !!r.ok;
      this.appVersion = r.appVersion ?? null;
      if (!r.ok) this.lastError = r.error ?? null;
      return this.running;
    } catch {
      // No session file → CardMirror isn't running (Rust returns "not-running").
      this.running = false;
      return false;
    }
  }

  async refreshDocs(): Promise<void> {
    if (!inTauri()) return;
    try {
      const r = await invoke<DocsResp>("cm_list_docs");
      if (r.pending === "consent") {
        this.needsConsent = true;
        this.docs = [];
        return;
      }
      this.needsConsent = false;
      this.docs = r.docs ?? [];
    } catch {
      this.docs = [];
    }
  }

  /** Push ONE card into `target` as CardMirror-native HTML (CardMirror >= 1.5.0).
   *  This is the lossless route: highlights, cites and structure survive, the
   *  insert lands in the named doc, and it does not steal focus.
   *
   *  `target` must come from a `refreshDocs()` in the SAME send — targets are
   *  session-scoped and a stale one is refused as `target-not-found` rather
   *  than silently landing somewhere else. There is deliberately no
   *  "unaddressed" form; with no doc to name, the caller falls back to the
   *  clipboard instead of guessing. */
  async insertHtml(
    html: string,
    text: string,
    target: string,
  ): Promise<CmInsertResp> {
    if (!inTauri()) return { ok: false, error: "not-tauri" };
    if (!html) return { ok: true, inserted: false };
    if (!target) return { ok: false, error: "no-target" };
    try {
      const r = await invoke<CmInsertResp>("cm_insert_html", { target, html, text });
      this.needsConsent = r.pending === "consent";
      if (r.ok === false) this.lastError = r.error ?? null;
      return r;
    } catch (e) {
      // A throw here is transport-level: no session file, so CardMirror is gone.
      this.running = false;
      return { ok: false, error: String(e) };
    }
  }

  /** Send a sequence of items. Sets `needsConsent` when CardMirror prompts.
   *  ⚠ Superseded by `insertHtml` for card sends — this drops formatting. */
  async insert(
    items: CmInsertItem[],
    target?: string | null,
  ): Promise<CmInsertResp> {
    if (!inTauri()) return { ok: false, error: "not-tauri" };
    if (!items.length) return { ok: true, inserted: false };
    try {
      const r = await invoke<CmInsertResp>("cm_insert", {
        items,
        target: target ?? null,
      });
      this.needsConsent = r.pending === "consent";
      if (r.ok === false) this.lastError = r.error ?? null;
      return r;
    } catch (e) {
      this.running = false;
      return { ok: false, error: String(e) };
    }
  }

  /** Scroll CardMirror to the card a provenance `source` token came from. */
  async jump(source: string): Promise<boolean> {
    if (!inTauri() || !source) return false;
    try {
      const r = await invoke<{ ok: boolean }>("cm_jump", { source });
      return !!r.ok;
    } catch {
      return false;
    }
  }

  /** Call before a send: confirm CardMirror is up and refresh the doc list so
   *  `speechTarget` is current. Returns whether CardMirror is reachable. */
  async prepare(): Promise<boolean> {
    const up = await this.ping();
    if (up) await this.refreshDocs();
    return up;
  }
}

export const cardmirror = new CardMirror();
