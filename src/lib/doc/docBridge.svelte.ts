// Pop-out speech-doc windows. Each doc can pop out into its OWN OS window
// (multiple at once); the window edits that doc's content blob directly, so no
// cross-window content handoff is needed. The DOCKED (main) doc is always the
// one linked to the flow — a popped-out doc is never also the docked one.

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Blob key for a doc's content (shared with docs.svelte.ts). */
export const docContentBlob = (id: string) => `doc:${id}`;
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
      url: `/?docwin=1&docid=${encodeURIComponent(id)}`,
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
