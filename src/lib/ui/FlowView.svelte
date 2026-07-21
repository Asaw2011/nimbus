<script lang="ts">
  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import { sheetAccent } from "../model/types";
  import { matchesAny, combosLabel } from "../model/keymap";
  import Grid from "./Grid.svelte";
  import Ribbon from "./Ribbon.svelte";
  import RoundHome from "./RoundHome.svelte";
  import SpreadView from "./SpreadView.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";

  let { onexit }: { onexit: () => void } = $props();

  let atHome = $state(true);
  let showHelp = $state(false);
  // Spread view: several sheets visible at once, stacked or side-by-side.
  let spreadMode = $state<"off" | "vertical" | "horizontal">("off");
  let lastSpread = $state<"vertical" | "horizontal">("vertical");
  let hiddenInSpread = $state<string[]>([]);
  const spread = $derived(spreadMode !== "off");
  // Tab drag & drop reordering (Excel-style: grab a tab, slide it into place)
  let draggingTab = $state<string | null>(null);
  let dragOverIdx = $state<number | null>(null);
  let dragBefore = $state(true);

  /**
   * The whole strip is the drop zone: wherever the pointer is, snap to the
   * nearest slot between tabs (including past either end).
   */
  function trackDrag(e: DragEvent) {
    e.preventDefault();
    const strip = e.currentTarget as HTMLElement;
    const tabs = [...strip.querySelectorAll<HTMLElement>("[data-tabidx]")];
    dragOverIdx = tabs.length - 1;
    dragBefore = false;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        dragOverIdx = Number(t.dataset.tabidx);
        dragBefore = true;
        break;
      }
    }
  }

  function dropTab(e: DragEvent) {
    e.preventDefault();
    if (draggingTab && round && dragOverIdx !== null) {
      const from = round.sheets.findIndex((s) => s.id === draggingTab);
      let to = dragBefore ? dragOverIdx : dragOverIdx + 1;
      if (from >= 0 && from < to) to--;
      store.reorderSheet(draggingTab, to);
    }
    draggingTab = null;
    dragOverIdx = null;
  }
  let showSettings = $state(false);
  let addingSheet = $state(false);
  let newSheetTitle = $state("");

  const round = $derived(store.round);
  const sheet = $derived(store.activeSheet);
  const km = $derived(settings.keymap);
  const mac = settings.isMac;
  function openSheet(sheetId: string) {
    store.activeSheetId = sheetId;
    const target = round?.sheets.find((s) => s.id === sheetId);
    store.cursor = { row: 0, col: target?.startCol ?? 0 };
    atHome = false;
    spreadMode = "off";
  }

  function setSpread(mode: "vertical" | "horizontal") {
    spreadMode = spreadMode === mode ? "off" : mode;
    if (spreadMode !== "off") {
      lastSpread = mode;
      atHome = false;
    }
  }

  function toggleSheetOnDesk(sheetId: string) {
    hiddenInSpread = hiddenInSpread.includes(sheetId)
      ? hiddenInSpread.filter((id) => id !== sheetId)
      : [...hiddenInSpread, sheetId];
  }

  function tabClick(sheetId: string) {
    if (spread) {
      toggleSheetOnDesk(sheetId);
    } else {
      openSheet(sheetId);
    }
  }

  function onkeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if (mod && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
      e.preventDefault();
      store.redo();
    } else if (matchesAny(e, km.newSheet)) {
      e.preventDefault();
      addingSheet = true;
    } else if (matchesAny(e, km.toggleSpread)) {
      e.preventDefault();
      setSpread(lastSpread);
    } else if (matchesAny(e, km.goHome)) {
      e.preventDefault();
      atHome = true;
    } else if (matchesAny(e, km.toggleHelp)) {
      e.preventDefault();
      showHelp = !showHelp;
    } else if (matchesAny(e, km.openSettings)) {
      e.preventDefault();
      showSettings = !showSettings;
    } else if (mod && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const target = round?.sheets[idx];
      if (target) {
        e.preventDefault();
        // In spread mode the number keys toggle sheets on/off the desk.
        if (spread) toggleSheetOnDesk(target.id);
        else openSheet(target.id);
      }
    }
  }

  function createSheet() {
    if (!newSheetTitle.trim()) return;
    const id = store.addSheet(newSheetTitle.trim());
    newSheetTitle = "";
    addingSheet = false;
    openSheet(id);
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#snippet tabs()}
  <div class="tabs" class:bottom={settings.tabsPosition === "bottom"} role="tablist">
    <button class="tab home-tab" class:active={atHome} onclick={() => (atHome = true)}>
      ⌂ Home
    </button>
    {#each round?.sheets ?? [] as s, i (s.id)}
      <!-- div, not button: WebKit won't start HTML5 drags from buttons -->
      <div
        class="tab"
        class:active={spread
          ? !hiddenInSpread.includes(s.id)
          : !atHome && s.id === store.activeSheetId}
        class:spread-hidden={spread && hiddenInSpread.includes(s.id)}
        class:dragging={draggingTab === s.id}
        class:drag-before={dragOverIdx === i && dragBefore && draggingTab !== s.id}
        class:drag-after={dragOverIdx === i && !dragBefore && draggingTab !== s.id}
        style="--stripe: {sheetAccent(s)}"
        role="button"
        tabindex="0"
        draggable="true"
        data-tabidx={i}
        ondragstart={(e) => {
          draggingTab = s.id;
          e.dataTransfer?.setData("text/plain", s.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        ondragend={() => {
          draggingTab = null;
          dragOverIdx = null;
        }}
        onclick={() => tabClick(s.id)}
        onkeydown={(e) => e.key === "Enter" && tabClick(s.id)}
      >
        <span class="tab-num">{i + 1}</span>
        {s.title || "(untitled)"}
      </div>
    {/each}
    <button class="tab new" onclick={() => (addingSheet = true)} title="New sheet ({combosLabel(km.newSheet, mac)})">+</button>
  </div>
{/snippet}

{#if round}
  <!-- While a tab is being dragged, the whole window is the drop zone:
       only horizontal position decides the slot, so drops can't miss. -->
  <div
    class="flow-view"
    role="application"
    ondragover={draggingTab ? trackDrag : undefined}
    ondrop={draggingTab ? dropTab : undefined}
  >
    <div class="topbar">
      <button class="back" onclick={onexit} title="Back to rounds">←</button>
      <span class="round-name">{round.name}</span>
      <span class="meta">
        {round.template.name}{round.tournament ? ` · ${round.tournament}` : ""}
      </span>
      <span class="spacer"></span>
      <button class="icon-btn" onclick={() => (showSettings = true)} title="Settings ({combosLabel(km.openSettings, mac)})">⚙</button>
      <button class="icon-btn" onclick={() => (showHelp = !showHelp)} title="Keybinds ({combosLabel(km.toggleHelp, mac)})">?</button>
    </div>

    {#if !atHome}
      <Ribbon {spreadMode} onspread={setSpread} />
    {/if}

    {#if settings.tabsPosition === "top"}{@render tabs()}{/if}

    {#if spread && round}
      <SpreadView
        sheets={round.sheets}
        hidden={hiddenInSpread}
        direction={spreadMode === "horizontal" ? "horizontal" : "vertical"}
        ontoggle={toggleSheetOnDesk}
        onset={(h) => (hiddenInSpread = h)}
      />
    {:else if atHome || !sheet}
      <RoundHome onopensheet={openSheet} />
    {:else}
      <Grid {sheet} />
    {/if}

    {#if settings.tabsPosition === "bottom"}{@render tabs()}{/if}

    {#if addingSheet}
      <div
        class="modal-backdrop"
        onclick={() => (addingSheet = false)}
        onkeydown={(e) => e.key === "Escape" && (addingSheet = false)}
        role="presentation"
      >
        <div
          class="modal"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          role="dialog"
          tabindex="-1"
        >
          <h3>New sheet</h3>
          <input
            placeholder="Title (e.g. Cap K, Econ DA, T-Subsets)"
            bind:value={newSheetTitle}
            onkeydown={(e) => e.key === "Enter" && createSheet()}
          />
          <button class="primary" onclick={createSheet}>Create</button>
        </div>
      </div>
    {/if}

    {#if showSettings}
      <SettingsPanel onclose={() => (showSettings = false)} />
    {/if}

    {#if showHelp}
      <div class="help">
        <h3>Keybinds</h3>
        <table>
          <tbody>
            <tr><td><kbd>↵</kbd> / <kbd>↑↓</kbd></td><td>Move down / up a row</td></tr>
            <tr><td><kbd>Tab</kbd> / <kbd>⇧Tab</kbd></td><td>Next / previous speech</td></tr>
            <tr><td><kbd>⇧↵</kbd></td><td>New line inside a cell</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRowBelow, mac)}</kbd></td><td>Insert row below</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRowAbove, mac)}</kbd></td><td>Insert row above</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRow3Below, mac)}</kbd></td><td>Insert 3 rows below</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRow3Above, mac)}</kbd></td><td>Insert 3 rows above</td></tr>
            <tr><td><kbd>{combosLabel(km.deleteRow, mac)}</kbd></td><td>Delete row</td></tr>
            <tr><td><kbd>{combosLabel(km.extendArg, mac)}</kbd></td><td>Extend argument → next speech</td></tr>
            <tr><td><kbd>{combosLabel(km.markDropped, mac)}</kbd></td><td>Mark dropped</td></tr>
            <tr><td><kbd>{combosLabel(km.markStarred, mac)}</kbd></td><td>Star (must answer)</td></tr>
            <tr><td><kbd>{combosLabel(km.markAnalytic, mac)}</kbd></td><td>Mark analytic (ink color)</td></tr>
            <tr><td><kbd>{combosLabel(km.markCard, mac)}</kbd></td><td>Mark card (ink color)</td></tr>
            <tr><td><kbd>{mac ? "⌘" : "Ctrl"}1–9</kbd></td><td>Switch sheet</td></tr>
            <tr><td><kbd>{combosLabel(km.toggleSpread, mac)}</kbd></td><td>Spread view (tabs toggle sheets)</td></tr>
            <tr><td><kbd>{combosLabel(km.goHome, mac)}</kbd></td><td>Round home</td></tr>
            <tr><td><kbd>{combosLabel(km.newSheet, mac)}</kbd></td><td>New sheet</td></tr>
            <tr><td><kbd>{combosLabel(km.openSettings, mac)}</kbd></td><td>Settings</td></tr>
            <tr><td><kbd>trigger + space</kbd></td><td>Expand abbreviation (t/ → Turn:)</td></tr>
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/if}

<style>
  .flow-view {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .back {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 16px;
    cursor: pointer;
  }
  .round-name {
    font-weight: 600;
    font-size: 14px;
  }
  .meta {
    color: var(--text-dim);
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .icon-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 50%;
    width: 24px;
    height: 24px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }
  /* Excel-style sheet tab strip: flat joined tabs with dividers */
  .tabs {
    display: flex;
    gap: 0;
    padding: 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .tabs.bottom {
    border-bottom: none;
    border-top: 1px solid var(--border);
  }
  .tab {
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    border-radius: 0;
    /* Tab text takes the sheet's color, like your template's blue/red pages */
    color: var(--stripe, var(--text-dim));
    opacity: 0.65;
    padding: 7px 18px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: inset 0 2px 0 var(--stripe, transparent);
    user-select: none;
    -webkit-user-select: none;
    box-sizing: border-box;
  }
  .tab:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--bg) 50%, var(--panel));
  }
  .tab.active {
    background: var(--bg);
    opacity: 1;
  }
  .tab.dragging {
    opacity: 0.35;
  }
  .tab.spread-hidden {
    opacity: 0.4;
  }
  .tab.drag-before {
    box-shadow:
      inset 3px 0 0 var(--accent),
      inset 0 2px 0 var(--stripe, transparent);
  }
  .tab.drag-after {
    box-shadow:
      inset -3px 0 0 var(--accent),
      inset 0 2px 0 var(--stripe, transparent);
  }
  .tab.home-tab,
  .tab.new {
    font-weight: 400;
  }
  .tab-num {
    color: var(--text-dim);
    font-size: 10px;
    margin-right: 5px;
    opacity: 0.7;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  .modal {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 320px;
  }
  .modal h3 {
    margin: 0;
    font-size: 14px;
  }
  .modal input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 13px;
  }
  .primary {
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: 4px;
    padding: 6px;
    cursor: pointer;
    font-weight: 600;
  }
  .help {
    position: fixed;
    right: 12px;
    bottom: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    z-index: 10;
    font-size: 12px;
  }
  .help h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .help td {
    padding: 2px 8px 2px 0;
    color: var(--text-dim);
  }
  kbd {
    background: var(--kbd-bg);
    border: 1px solid var(--kbd-border);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
  }
</style>
