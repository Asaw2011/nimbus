// Pop-out speech-doc windows. Each doc can pop out into its OWN OS window
// (multiple at once); the window edits that doc's content blob directly, so no
// cross-window content handoff is needed. The DOCKED (main) doc is always the
// one linked to the flow — a popped-out doc is never also the docked one.

import { saveBlob, loadBlob, dropBlobCache } from "$lib/model/blobs";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Blob key for a doc's content (shared with docs.svelte.ts). Uses only
 *  filename-safe chars so it actually persists to DISK, not just localStorage. */
export const docContentBlob = (id: string) => `doc_${id}`;
/** The original key used a colon — an invalid filename char on Windows — so the
 *  Rust blob store rejected it and doc content only ever lived in localStorage
 *  (and got quota-evicted once several large/uploaded docs were open). Read this
 *  once to migrate any such docs onto disk under the safe name above. */
const legacyContentBlob = (id: string) => `doc:${id}`;

/** Load a doc's content, migrating it off the old colon key onto disk on first
 *  read. All doc-content reads go through here so the migration is universal. */
export async function loadDocContent(id: string): Promise<unknown> {
  if (!id) return null;
  let v = await loadBlob<unknown>(docContentBlob(id));
  if (v == null) {
    const legacy = await loadBlob<unknown>(legacyContentBlob(id));
    if (legacy != null) {
      saveDocContent(id, legacy); // re-home onto disk under the safe name
      dropBlobCache(legacyContentBlob(id)); // free the localStorage quota
      v = legacy;
    }
  }
  return v ?? null;
}

/** Persist a doc's content (disk + localStorage cache) under the safe name.
 *  Returns the disk write so a shutdown flush can await it. */
export function saveDocContent(id: string, json: unknown): Promise<void> {
  if (!id) return Promise.resolve();
  return saveBlob(docContentBlob(id), json ?? null);
}

const winLabel = (id: string) => `speech-doc-${id}`;

class DocBridge {
  /** Doc ids currently open in their own window (in THIS window's view). */
  poppedOutIds = $state<string[]>([]);

  isPoppedOut(id: string): boolean {
    return this.poppedOutIds.includes(id);
  }
  private add(id: string) {
    if (!this.poppedOutIds.includes(id)) this.poppedOutIds = [...this.poppedOutIds, id];
  }
  private remove(id: string) {
    this.poppedOutIds = this.poppedOutIds.filter((x) => x !== id);
  }

  /** Pop a doc out into its own window (or focus it if already open). */
  async popOut(id: string, name: string): Promise<void> {
    if (!inTauri) { this.add(id); return; }
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = winLabel(id);
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      this.add(id);
      return;
    }
    const win = new WebviewWindow(label, {
      url: `/?docwin=1&docid=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`,
      title: `Nimbus — ${name}`,
      width: 820,
      height: 1000,
      minWidth: 480,
      minHeight: 400,
    });
    win.once("tauri://created", () => this.add(id));
    win.once("tauri://error", (e) => { console.error("pop-out window failed", e); this.remove(id); });
    // Fires in THIS (main) window whenever that window is destroyed.
    void win.once("tauri://destroyed", () => this.remove(id));
  }

  /** Dock a doc back in: close its window (content is already in its blob). */
  async dock(id: string): Promise<void> {
    this.remove(id);
    if (!inTauri) return;
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel(winLabel(id));
    if (win) await win.close();
  }
}

export const docBridge = new DocBridge();
