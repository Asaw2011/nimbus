// Bridge for the pop-out speech-doc window. The doc lives in exactly one place
// at a time (docked panel OR separate window); we hand the content off through a
// config blob and route ⌘K/drag inserts to whichever window is showing it.

import { saveBlob, loadBlob } from "$lib/model/blobs";
import type { DocNode } from "$lib/docx/parse";

const DOC_BLOB = "speech-doc-json";
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

class DocBridge {
  /** True in the main window while the doc is showing in the pop-out window. */
  poppedOut = $state(false);
  /** Pending appends handed to the popped-out window. */
  private appendListeners = new Set<(node: DocNode) => void>();

  async saveDoc(json: unknown) {
    saveBlob(DOC_BLOB, json ?? null);
  }
  async loadDoc(): Promise<unknown> {
    return (await loadBlob<unknown>(DOC_BLOB)) ?? null;
  }

  /** Called by the main window to append into the popped-out doc. */
  async appendRemote(node: DocNode) {
    if (!inTauri) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("speech-doc-append", node);
  }

  /** The popped-out window subscribes to appends coming from the main window. */
  async listenForAppends(fn: (node: DocNode) => void): Promise<() => void> {
    this.appendListeners.add(fn);
    if (!inTauri) return () => this.appendListeners.delete(fn);
    const { listen } = await import("@tauri-apps/api/event");
    const un = await listen<DocNode>("speech-doc-append", (e) => {
      if (e.payload) fn(e.payload);
    });
    return () => {
      this.appendListeners.delete(fn);
      un();
    };
  }

  /** Open the doc in its own OS window (seeded from the current doc JSON). */
  async popOut(currentJSON: unknown) {
    if (!inTauri) return;
    await this.saveDoc(currentJSON);
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel("speech-doc");
    if (existing) {
      await existing.setFocus();
      this.poppedOut = true;
      return;
    }
    const win = new WebviewWindow("speech-doc", {
      url: "/?docwin=1",
      title: "Nimbus — Speech Doc",
      width: 820,
      height: 1000,
      minWidth: 480,
      minHeight: 400,
    });
    win.once("tauri://created", () => {
      this.poppedOut = true;
    });
    win.once("tauri://error", (e) => {
      console.error("pop-out window failed", e);
      this.poppedOut = false;
    });
    // When the pop-out window closes, dock back automatically.
    await win.once("tauri://destroyed", () => {
      this.poppedOut = false;
      void emitDockBack();
    });
  }

  /** Close the pop-out window and dock the doc back into the app. */
  async dockBack() {
    if (!inTauri) {
      this.poppedOut = false;
      return;
    }
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel("speech-doc");
    if (win) await win.close();
    this.poppedOut = false;
  }

  /** Popped window tells the main window its latest content on close. */
  async listenForDockBack(fn: (json: unknown) => void): Promise<() => void> {
    if (!inTauri) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    const un = await listen<unknown>("speech-doc-dockback", (e) => fn(e.payload));
    return un;
  }
}

async function emitDockBack() {
  if (!inTauri) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit("speech-doc-dockback", await docBridge.loadDoc());
}

export const docBridge = new DocBridge();
