<script lang="ts">
  // Standalone pop-out window for ONE doc. Reads its doc id from the URL and
  // edits that doc's content blob directly — independent of the main window and
  // of any other popped-out doc.
  import { onMount, onDestroy } from "svelte";
  import SpeechDoc from "./SpeechDoc.svelte";
  import DocSearch from "$lib/search/DocSearch.svelte";
  import { saveBlob, loadBlob } from "$lib/model/blobs";
  import { docContentBlob } from "./docBridge.svelte";

  const docId =
    typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("docid") ?? ""
      : "";

  let docRef = $state<{
    getDocJSON(): unknown;
    appendNode(n: unknown): void;
    appendCMNodes(nodes: unknown[]): void;
    insertCMAtCursor(nodes: unknown[]): void;
  } | null>(null);
  let initial = $state<unknown>(null);
  let ready = $state(false);
  let showSearch = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let unlisten: (() => void) | undefined;

  onMount(async () => {
    initial = await loadBlob(docContentBlob(docId));
    ready = true;
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    // If THIS window holds the ★ speech doc, receive cards routed from the main
    // window (` / ~ pressed in another source doc) at our cursor.
    if ("__TAURI_INTERNALS__" in window) {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ id: string; nodes: unknown[] }>("nimbus:insert-into-speech", (e) => {
        if (e.payload?.id === docId) docRef?.insertCMAtCursor(e.payload.nodes);
      });
    }
  });

  onDestroy(() => unlisten?.());

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (docRef) saveBlob(docContentBlob(docId), docRef.getDocJSON());
  }
  function onDocChange(json: unknown) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveBlob(docContentBlob(docId), json), 250);
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      showSearch = !showSearch;
    }
  }

  async function dockBack() {
    flush();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  // ` / ~ from this (source) doc sends the current card to the MAIN speech doc.
  async function sendToSpeech(nodes: unknown[]) {
    if (!nodes.length) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("nimbus:send-to-speech", nodes);
  }
</script>

<svelte:window onkeydown={onkeydown} />

<div class="doc-window">
  <div class="window-bar">
    <span class="title">Speech Doc</span>
    <div class="bar-actions">
      <button class="search-btn" onclick={() => (showSearch = true)}>🔍 Find cards (⌘K)</button>
      <button class="dock-btn" onclick={dockBack}>⤓ Dock back into Nimbus</button>
    </div>
  </div>
  {#if ready}
    <div class="window-body">
      <SpeechDoc bind:this={docRef} initialDoc={initial} onchange={onDocChange} poppedOut onpopout={dockBack} onTilde={sendToSpeech} />
    </div>
  {/if}

  {#if showSearch}
    <DocSearch
      docOnly
      onclose={() => (showSearch = false)}
      onappenddoc={(node) => docRef?.appendNode(node)}
      onappendcm={(nodes) => docRef?.appendCMNodes(nodes)}
    />
  {/if}
</div>

<style>
  .doc-window {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
  }
  .window-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .title { font-weight: 600; font-size: 13px; }
  .bar-actions { display: flex; gap: 8px; align-items: center; }
  .search-btn {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .search-btn:hover { border-color: var(--accent); }
  .dock-btn {
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
  }
  .window-body { flex: 1; min-height: 0; }
</style>
