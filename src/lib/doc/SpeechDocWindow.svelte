<script lang="ts">
  // Standalone pop-out window: the full CardMirror speech-doc editor on its own.
  import { onMount } from "svelte";
  import SpeechDoc from "./SpeechDoc.svelte";
  import DocSearch from "$lib/search/DocSearch.svelte";
  import { docBridge } from "./docBridge.svelte";
  import type { DocNode } from "$lib/docx/parse";

  let docRef = $state<{
    appendNode(n: DocNode): void;
    getDocJSON(): unknown;
    setDocJSON(j: unknown): void;
    appendCMNodes(nodes: unknown[]): void;
  } | null>(null);
  let initial = $state<unknown>(null);
  let ready = $state(false);
  let showSearch = $state(false);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    initial = await docBridge.loadDoc();
    ready = true;
    // Receive cards inserted from the main window (⌘K / drag).
    await docBridge.listenForAppends((node) => docRef?.appendNode(node));
    await docBridge.listenForCMAppends((nodes) => docRef?.appendCMNodes(nodes));
  });

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      showSearch = !showSearch;
    }
  }

  function onDocChange(json: unknown) {
    // Persist to the shared blob so dock-back restores the latest content.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void docBridge.saveDoc(json), 200);
  }

  async function dockBack() {
    if (docRef) await docBridge.saveDoc(docRef.getDocJSON());
    await docBridge.dockBack();
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
      <SpeechDoc bind:this={docRef} initialDoc={initial} onchange={onDocChange} poppedOut onpopout={dockBack} />
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
