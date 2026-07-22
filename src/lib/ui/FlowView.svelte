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
  import DocSearch from "$lib/search/DocSearch.svelte";
  import SpeechDoc from "$lib/doc/SpeechDoc.svelte";

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
  let showDocSearch = $state(false);
  let docOpen = $state(false);
  let docWidth = $state(480);
  interface DocAPI { appendCard(h: string, c: string): void; appendBlocks(l: string[]): void; insertAtCursor(h: string, c: string): void; appendNode(n: unknown): void; }
  let docRef = $state<DocAPI | null>(null);
  let resizingDoc = $state(false);

  function startDocResize(e: PointerEvent) {
    resizingDoc = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDocResizeMove(e: PointerEvent) {
    if (!resizingDoc) return;
    const newWidth = window.innerWidth - e.clientX;
    docWidth = Math.min(window.innerWidth * 0.65, Math.max(320, newWidth));
  }
  function stopDocResize() { resizingDoc = false; }

  function sendCellToDoc() {
    if (!store.cursor || !store.activeSheetId || !docRef) return;
    const { row, col } = store.cursor;
    const sheet = store.round?.sheets.find(s => s.id === store.activeSheetId);
    const text = sheet?.rows[row]?.cells[col]?.text.trim();
    if (text) docRef.appendCard(text, text);
  }
  let addingSheet = $state(false);
  let newSheetTitle = $state("");
  // Tab right-click menu + inline rename.
  let tabMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let menuEl = $state<HTMLElement>();
  let menuReady = $state(false);
  let renamingTab = $state<string | null>(null);
  let renameValue = $state("");

  // Clamp the context menu into the viewport (tabs sit at the bottom, so it
  // must open upward/inward instead of falling off the edge).
  $effect(() => {
    if (tabMenu && menuEl) {
      const r = menuEl.getBoundingClientRect();
      const m = 8;
      let x = tabMenu.x;
      let y = tabMenu.y;
      if (x + r.width + m > window.innerWidth) x = window.innerWidth - r.width - m;
      if (y + r.height + m > window.innerHeight) y = tabMenu.y - r.height;
      if (y < m) y = m;
      if (x < m) x = m;
      menuEl.style.left = `${x}px`;
      menuEl.style.top = `${y}px`;
      menuReady = true;
    } else {
      menuReady = false;
    }
  });

  function openTabMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    tabMenu = { id, x: e.clientX, y: e.clientY };
  }
  function startRenameTab(id: string) {
    const s = store.round?.sheets.find((s) => s.id === id);
    renamingTab = id;
    renameValue = s?.title ?? "";
    tabMenu = null;
  }
  function commitRenameTab() {
    if (renamingTab && renameValue.trim()) {
      store.renameSheet(renamingTab, renameValue.trim());
    }
    renamingTab = null;
  }
  function deleteTab(id: string) {
    tabMenu = null;
    store.deleteSheet(id);
  }

  const round = $derived(store.round);
  const sheet = $derived(store.activeSheet);
  const km = $derived(settings.keymap);
  const mac = settings.isMac;
  function openSheet(sheetId: string) {
    hoveredIdx = null;
    // Save the current cursor row before leaving the active sheet.
    if (store.activeSheetId && !atHome && store.cursor) {
      sheetLastRow.set(store.activeSheetId, store.cursor.row);
    }
    store.activeSheetId = sheetId;
    const target = round?.sheets.find((s) => s.id === sheetId);
    const startCol = target?.startCol ?? 0;
    // Preserve the current speech column across sheets; clamp to the target's
    // startCol so you never land in a dead (hatched) column.
    const col = Math.max(store.cursor?.col ?? startCol, startCol);
    // Restore the last cursor row for this sheet, defaulting to row 1 (row 0
    // is the LABEL cell, so row 1 is the first real content row).
    const maxRow = Math.max(0, (target?.rows.length ?? 1) - 1);
    const row = Math.min(sheetLastRow.get(sheetId) ?? 1, maxRow);
    store.cursor = { row, col };
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

  // Keyboard hover: a highlighted tab you can move without switching to it.
  let hoveredIdx = $state<number | null>(null);
  // Remember the last cursor row for each sheet so keybind navigation restores
  // position instead of always jumping to row 0.
  const sheetLastRow = new Map<string, number>();

  /** Move to the sheet left (-1) or right (+1) of the current one; wraps.
   *  Works in normal view and in spread (moves the focused flow). */
  function moveToSheet(delta: number) {
    hoveredIdx = null;
    const sheets = round?.sheets ?? [];
    if (sheets.length === 0) return;
    if (spread) {
      // Cycle the active flow through the ones on the desk.
      const visible = sheets.filter((s) => !hiddenInSpread.includes(s.id));
      if (visible.length === 0) return;
      let vi = visible.findIndex((s) => s.id === store.activeSheetId);
      if (vi < 0) vi = 0;
      const nv = visible.length;
      const target = visible[(((vi + delta) % nv) + nv) % nv];
      if (store.activeSheetId && store.cursor) sheetLastRow.set(store.activeSheetId, store.cursor.row);
      store.activeSheetId = target.id;
      const sCol = Math.max(store.cursor?.col ?? target.startCol, target.startCol);
      const sRow = Math.min(sheetLastRow.get(target.id) ?? 1, Math.max(0, target.rows.length - 1));
      store.cursor = { row: sRow, col: sCol };
      return;
    }
    let idx = sheets.findIndex((s) => s.id === store.activeSheetId);
    if (atHome || idx < 0) idx = delta > 0 ? -1 : 0;
    const n = sheets.length;
    openSheet(sheets[(((idx + delta) % n) + n) % n].id);
  }

  /** Reorder the current sheet one position left/right (keyboard, no drag). */
  function reorderCurrent(delta: number) {
    if (!round || !store.activeSheetId) return;
    const idx = round.sheets.findIndex((s) => s.id === store.activeSheetId);
    if (idx < 0) return;
    store.reorderSheet(store.activeSheetId, idx + delta);
  }

  /** Move the keyboard hover-highlight without switching sheets. */
  function moveHover(delta: number) {
    const sheets = round?.sheets ?? [];
    if (sheets.length === 0) return;
    let base = hoveredIdx ?? sheets.findIndex((s) => s.id === store.activeSheetId);
    if (base < 0) base = 0;
    const n = sheets.length;
    hoveredIdx = (((base + delta) % n) + n) % n;
    // Blur the cell so Enter opens the hovered sheet instead of typing.
    (document.activeElement as HTMLElement | null)?.blur?.();
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
    } else if (hoveredIdx !== null && e.key === "Enter") {
      e.preventDefault();
      const s = round?.sheets[hoveredIdx];
      if (s) openSheet(s.id);
      hoveredIdx = null;
    } else if (hoveredIdx !== null && e.key === "Escape") {
      e.preventDefault();
      hoveredIdx = null;
    } else if (matchesAny(e, km.prevSheet)) {
      e.preventDefault();
      moveToSheet(-1);
    } else if (matchesAny(e, km.nextSheet)) {
      e.preventDefault();
      moveToSheet(1);
    } else if (matchesAny(e, km.moveSheetLeft)) {
      e.preventDefault();
      reorderCurrent(-1);
    } else if (matchesAny(e, km.moveSheetRight)) {
      e.preventDefault();
      reorderCurrent(1);
    } else if (matchesAny(e, km.hoverPrevSheet)) {
      e.preventDefault();
      moveHover(-1);
    } else if (matchesAny(e, km.hoverNextSheet)) {
      e.preventDefault();
      moveHover(1);
    } else if (matchesAny(e, km.toggleSpread)) {
      e.preventDefault();
      setSpread(lastSpread);
    } else if (matchesAny(e, km.goHome)) {
      e.preventDefault();
      // Save position so returning to this sheet restores it.
      if (store.activeSheetId && store.cursor) {
        sheetLastRow.set(store.activeSheetId, store.cursor.row);
      }
      atHome = true;
    } else if (matchesAny(e, km.toggleHelp)) {
      e.preventDefault();
      showHelp = !showHelp;
    } else if (matchesAny(e, km.openSettings)) {
      e.preventDefault();
      showSettings = !showSettings;
    } else if (matchesAny(e, km.openDocSearch)) {
      e.preventDefault();
      showDocSearch = !showDocSearch;
    } else if (mod && e.key === "d" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      docOpen = !docOpen;
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
        class:kbd-hover={hoveredIdx === i}
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
        oncontextmenu={(e) => openTabMenu(e, s.id)}
      >
        {#if renamingTab === s.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="tab-rename"
            bind:value={renameValue}
            autofocus
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRenameTab();
              if (e.key === "Escape") renamingTab = null;
            }}
            onblur={commitRenameTab}
          />
        {:else}
          <span class="tab-num">{i + 1}</span>
          {s.title || "(untitled)"}
        {/if}
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
      <button class="icon-btn" class:active={docOpen} onclick={() => (docOpen = !docOpen)} title="Speech doc (⌘D)">📄</button>
      <button class="icon-btn" onclick={() => (showSettings = true)} title="Settings ({combosLabel(km.openSettings, mac)})">⚙</button>
      <button class="icon-btn" onclick={() => (showHelp = !showHelp)} title="Keybinds ({combosLabel(km.toggleHelp, mac)})">?</button>
    </div>

    {#if !atHome}
      <Ribbon {spreadMode} onspread={setSpread} onsendtodoc={docOpen ? sendCellToDoc : null} />
    {/if}

    {#if settings.tabsPosition === "top"}{@render tabs()}{/if}

    <!-- Split workspace: flow on left, speech doc on right -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="workspace"
      onpointermove={onDocResizeMove}
      onpointerup={stopDocResize}
    >
      <div class="flow-pane">
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
          <Grid {sheet} onblockdrop={(h, c) => docRef?.appendCard(h, c)} />
        {/if}
      </div>

      {#if docOpen && !spread}
        <div class="doc-divider" onpointerdown={startDocResize} role="separator" aria-orientation="vertical"></div>
        <div class="doc-pane" style="width: {docWidth}px">
          <SpeechDoc bind:this={docRef} />
        </div>
      {/if}
    </div>

    {#if settings.tabsPosition === "bottom"}{@render tabs()}{/if}

    {#if tabMenu}
      <div class="ctx-backdrop" role="presentation"
        onclick={() => (tabMenu = null)} oncontextmenu={(e) => { e.preventDefault(); tabMenu = null; }}></div>
      {@const menuId = tabMenu.id}
      <div class="ctx-menu" class:ready={menuReady} bind:this={menuEl}>
        <button onclick={() => startRenameTab(menuId)}>Rename</button>
        <button class="danger" onclick={() => deleteTab(menuId)}>Delete flow</button>
      </div>
    {/if}

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

    {#if showDocSearch}
      <DocSearch onclose={() => (showDocSearch = false)} {docRef} />
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
            <tr><td><kbd>{mac ? "⌘" : "Ctrl"}1–9</kbd></td><td>Jump to sheet</td></tr>
            <tr><td><kbd>{combosLabel(km.prevSheet, mac)}</kbd> / <kbd>{combosLabel(km.nextSheet, mac)}</kbd></td><td>Previous / next sheet</td></tr>
            <tr><td><kbd>{combosLabel(km.moveSheetLeft, mac)}</kbd> / <kbd>{combosLabel(km.moveSheetRight, mac)}</kbd></td><td>Move sheet left / right</td></tr>
            <tr><td><kbd>{combosLabel(km.hoverPrevSheet, mac)}</kbd> / <kbd>{combosLabel(km.hoverNextSheet, mac)}</kbd></td><td>Hover sheets (Enter opens)</td></tr>
            <tr><td><kbd>{mac ? "⌘" : "Ctrl"}C</kbd> / <kbd>{mac ? "⌘" : "Ctrl"}V</kbd></td><td>Copy / paste cells (Excel-style)</td></tr>
            <tr><td><kbd>{combosLabel(km.openDocSearch, mac)}</kbd></td><td>Doc Search (search prep files)</td></tr>
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
  .icon-btn.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent);
    color: var(--accent);
  }
  /* Split workspace */
  .workspace {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }
  .flow-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .doc-divider {
    width: 5px;
    background: var(--border);
    cursor: col-resize;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .doc-divider:hover { background: var(--accent); }
  .doc-pane {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 320px;
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
  .tab.kbd-hover {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    opacity: 1;
  }
  .tab-rename {
    background: var(--bg);
    border: 1px solid var(--accent);
    color: var(--text);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 12px;
    width: 110px;
  }
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .ctx-menu {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 31;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    min-width: 130px;
    opacity: 0; /* hidden until clamped into the viewport */
  }
  .ctx-menu.ready {
    opacity: 1;
  }
  .ctx-menu button {
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 6px 10px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
  }
  .ctx-menu button:hover {
    background: color-mix(in srgb, var(--accent) 15%, var(--panel));
  }
  .ctx-menu .danger {
    color: var(--mark-dropped);
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
    max-height: calc(100vh - 24px);
    overflow-y: auto;
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
