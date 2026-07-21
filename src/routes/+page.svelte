<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "$lib/ui/Dashboard.svelte";
  import FlowView from "$lib/ui/FlowView.svelte";
  import Tutorial from "$lib/ui/Tutorial.svelte";
  import { store } from "$lib/model/round.svelte";
  import { settings } from "$lib/model/settings.svelte";
  import {
    isDirty,
    markOpened,
    saveToFile,
    saveAs,
    openPath,
  } from "$lib/model/filedoc.svelte";

  let view: "dashboard" | "flow" = $state("dashboard");
  let showTutorial = $state(false);
  // Close-prompt state.
  let closePrompt = $state(false);
  let closeError = $state("");
  let closing = false;
  // Brief "Saved ✓" / error toast.
  let toast = $state("");
  function flashToast(msg: string) {
    toast = msg;
    setTimeout(() => (toast = ""), 2200);
  }

  onMount(() => {
    // First-open (or re-enabled) welcome tutorial.
    if (settings.showTutorial) showTutorial = true;
    setupCloseGuard();
    setupFileOpen();
  });

  async function openFileIntoApp(path: string) {
    const round = await openPath(path);
    if (round) {
      store.loadRound(round);
      view = "flow";
    }
  }

  async function setupFileOpen() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    // A file the app was launched with (double-clicked in Finder/Explorer).
    const pending = await invoke<string | null>("take_pending_file");
    if (pending) await openFileIntoApp(pending);
    // A file opened while the app is already running.
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("open-file", (e) => {
      if (e.payload) void openFileIntoApp(e.payload);
    });
  }

  async function onGlobalKey(e: KeyboardEvent) {
    // ⌘S / Ctrl+S — save the open flow to its file (prompts if none yet).
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !e.shiftKey) {
      if (store.round) {
        e.preventDefault();
        try {
          const ok = await saveToFile(store.round);
          if (ok) flashToast("Saved ✓");
        } catch (err) {
          flashToast("Save failed: " + (err instanceof Error ? err.message : err));
        }
      }
    }
  }

  // Reset file dirty-tracking whenever the open round changes.
  let lastRoundId = "";
  $effect(() => {
    const id = store.round?.id ?? "";
    if (id !== lastRoundId) {
      lastRoundId = id;
      markOpened(store.round);
    }
  });

  async function setupCloseGuard() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.onCloseRequested((event) => {
      if (closing) return;
      // Only prompt when actively in a flow with unsaved file changes.
      // On the dashboard, just close normally.
      if (view === "flow" && store.round && isDirty(store.round)) {
        event.preventDefault();
        closePrompt = true;
      }
    });
  }

  async function forceClose() {
    closing = true;
    closePrompt = false;
    if (!("__TAURI_INTERNALS__" in window)) return;
    // Flush the round to disk, then quit the process directly — this can't be
    // blocked by the window close-request guard.
    try {
      await store.saveNow();
    } catch {
      /* app-data save failed; quitting anyway */
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("force_quit");
  }

  async function onSave() {
    if (!store.round) return forceClose();
    try {
      if (await saveToFile(store.round)) forceClose();
      else closeError = "Couldn't save (no location chosen). Try Save As, or Don't Save.";
    } catch (err) {
      closeError = "Save failed: " + (err instanceof Error ? err.message : err);
    }
  }
  async function onSaveAs() {
    if (!store.round) return forceClose();
    try {
      if (await saveAs(store.round)) forceClose();
      else closeError = "Save cancelled.";
    } catch (err) {
      closeError = "Save failed: " + (err instanceof Error ? err.message : err);
    }
  }
</script>

<svelte:window onkeydown={onGlobalKey} />

{#if view === "flow" && store.round}
  <FlowView onexit={() => (view = "dashboard")} />
{:else}
  <Dashboard onopen={() => (view = "flow")} />
{/if}

{#if showTutorial}
  <Tutorial onclose={() => (showTutorial = false)} />
{/if}

{#if closePrompt}
  <div class="close-backdrop" role="presentation">
    <div class="close-card" role="dialog" aria-modal="true">
      <h2>Save this flow before closing?</h2>
      <p>“{store.round?.name}” has changes that aren't saved to a file yet.</p>
      <div class="close-actions">
        <button class="primary" onclick={onSave}>Save</button>
        <button onclick={onSaveAs}>Save As…</button>
        <button class="danger" onclick={forceClose}>Don't Save</button>
        <button class="ghost" onclick={() => { closePrompt = false; closeError = ''; }}>Cancel</button>
      </div>
      {#if closeError}
        <p class="close-err">{closeError}</p>
      {/if}
      <p class="note">Your work is always auto-kept in Nimbus either way — this saves a copy to your Mac.</p>
    </div>
  </div>
{/if}

{#if toast}
  <div class="toast">{toast}</div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    z-index: 70;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  }
  .close-err {
    color: var(--mark-dropped) !important;
    font-size: 12px !important;
    margin: 10px 0 0 !important;
  }
  .close-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }
  .close-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px 26px;
    max-width: 420px;
    max-height: 90vh;
    overflow-y: auto;
  }
  .close-card h2 {
    margin: 0 0 6px;
    font-size: 16px;
  }
  .close-card p {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .close-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .close-actions button {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 7px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .close-actions .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .close-actions .danger {
    color: var(--mark-dropped);
    border-color: var(--mark-dropped);
  }
  .close-actions .ghost {
    color: var(--text-dim);
  }
  .note {
    margin: 14px 0 0 !important;
    font-size: 11px !important;
  }
</style>
