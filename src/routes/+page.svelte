<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "$lib/ui/Dashboard.svelte";
  import FlowView from "$lib/ui/FlowView.svelte";
  import Tutorial from "$lib/ui/Tutorial.svelte";
  import { store } from "$lib/model/round.svelte";
  import { settings } from "$lib/model/settings.svelte";
  import { isDirty, markOpened, saveToFile, saveAs } from "$lib/model/filedoc.svelte";

  let view: "dashboard" | "flow" = $state("dashboard");
  let showTutorial = $state(false);
  // Close-prompt state.
  let closePrompt = $state(false);
  let closing = false;

  onMount(() => {
    // First-open (or re-enabled) welcome tutorial.
    if (settings.showTutorial) showTutorial = true;
    setupCloseGuard();
  });

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
      if (store.round && isDirty(store.round)) {
        event.preventDefault();
        closePrompt = true;
      }
    });
  }

  async function forceClose() {
    closing = true;
    closePrompt = false;
    if ("__TAURI_INTERNALS__" in window) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().destroy();
    }
  }

  async function onSave() {
    if (store.round && (await saveToFile(store.round))) forceClose();
  }
  async function onSaveAs() {
    if (store.round && (await saveAs(store.round))) forceClose();
  }
</script>

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
        <button class="ghost" onclick={() => (closePrompt = false)}>Cancel</button>
      </div>
      <p class="note">Your work is always auto-kept in Nimbus either way — this saves a copy to your Mac.</p>
    </div>
  </div>
{/if}

<style>
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
