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
    const d = this.docs;
    return (
      (d.find((x) => x.isSpeech) ?? d.find((x) => x.focusedWindow) ?? d[0])
        ?.target ?? null
    );
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

  /** Send a sequence of items. Sets `needsConsent` when CardMirror prompts. */
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
