<script lang="ts">
  // The paper spread: multiple sheets on screen at once, stacked vertically
  // (columns align across flows) or laid side-by-side. Each flow scrolls
  // independently — they're different papers. The picker bar chooses which
  // flows are on the desk.

  import type { Sheet } from "../model/types";
  import { sheetAccent } from "../model/types";
  import { store } from "../model/round.svelte";
  import Grid from "./Grid.svelte";

  let {
    sheets,
    hidden,
    direction,
    ontoggle,
    onset,
  }: {
    sheets: Sheet[];
    hidden: string[];
    direction: "vertical" | "horizontal";
    ontoggle: (sheetId: string) => void;
    /** Replace the hidden list wholesale (solo / all / none). */
    onset: (hidden: string[]) => void;
  } = $props();

  const visible = $derived(sheets.filter((s) => !hidden.includes(s.id)));

  // Drag a panel by its header to reorder flows — same as dragging tabs.
  let draggingPanel = $state<string | null>(null);
  let dragOverIdx = $state<number | null>(null);
  let dragBefore = $state(true);
  let container = $state<HTMLDivElement>();

  // The picker chips reorder by drag too (they show ALL sheets in order).
  let draggingChip = $state<string | null>(null);
  let chipOverIdx = $state<number | null>(null);
  let chipBefore = $state(true);
  let pickerEl = $state<HTMLDivElement>();

  function trackChipDrag(e: DragEvent) {
    e.preventDefault();
    if (!pickerEl) return;
    const chips = [...pickerEl.querySelectorAll<HTMLElement>("[data-chipidx]")];
    chipOverIdx = sheets.length - 1;
    chipBefore = false;
    for (const c of chips) {
      const rect = c.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        chipOverIdx = Number(c.dataset.chipidx);
        chipBefore = true;
        break;
      }
    }
  }

  function dropChip(e: DragEvent) {
    e.preventDefault();
    if (draggingChip && chipOverIdx !== null) {
      const from = sheets.findIndex((s) => s.id === draggingChip);
      let to = chipBefore ? chipOverIdx : chipOverIdx + 1;
      if (from >= 0 && from < to) to--;
      store.reorderSheet(draggingChip, to);
    }
    draggingChip = null;
    chipOverIdx = null;
  }

  function trackPanelDrag(e: DragEvent) {
    e.preventDefault();
    if (!container) return;
    const panels = [...container.querySelectorAll<HTMLElement>("[data-panelidx]")];
    dragOverIdx = visible.length - 1;
    dragBefore = false;
    for (const p of panels) {
      const rect = p.getBoundingClientRect();
      const pos = direction === "horizontal" ? e.clientX : e.clientY;
      const mid =
        direction === "horizontal"
          ? rect.left + rect.width / 2
          : rect.top + rect.height / 2;
      if (pos < mid) {
        dragOverIdx = Number(p.dataset.panelidx);
        dragBefore = true;
        break;
      }
    }
  }

  function dropPanel(e: DragEvent) {
    e.preventDefault();
    if (draggingPanel && dragOverIdx !== null && visible[dragOverIdx]) {
      const from = sheets.findIndex((s) => s.id === draggingPanel);
      const targetFull = sheets.findIndex((s) => s.id === visible[dragOverIdx!].id);
      let to = dragBefore ? targetFull : targetFull + 1;
      if (from >= 0 && from < to) to--;
      store.reorderSheet(draggingPanel, to);
    }
    draggingPanel = null;
    dragOverIdx = null;
  }

  // Resizable panels: drag the divider between two flows to change their
  // share of the screen (heights when stacked, widths side-by-side).
  let weights = $state<Record<string, number>>({});
  const w = (id: string) => weights[id] ?? 1;

  function startResize(e: PointerEvent, k: number) {
    e.preventDefault();
    const a = visible[k];
    const b = visible[k + 1];
    if (!a || !b || !container) return;
    const elA = container.querySelector<HTMLElement>(`[data-panelidx="${k}"]`);
    const elB = container.querySelector<HTMLElement>(`[data-panelidx="${k + 1}"]`);
    if (!elA || !elB) return;
    const horiz = direction === "horizontal";
    const sizeA = horiz ? elA.offsetWidth : elA.offsetHeight;
    const sizeB = horiz ? elB.offsetWidth : elB.offsetHeight;
    const total = sizeA + sizeB;
    const wTotal = w(a.id) + w(b.id);
    const start = horiz ? e.clientX : e.clientY;
    const divider = e.currentTarget as HTMLElement;
    divider.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const delta = (horiz ? ev.clientX : ev.clientY) - start;
      const newA = Math.min(total - 80, Math.max(80, sizeA + delta));
      const ratio = newA / total;
      weights = {
        ...weights,
        [a.id]: wTotal * ratio,
        [b.id]: wTotal * (1 - ratio),
      };
    };
    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  }

  function chipClick(e: MouseEvent, sheetId: string) {
    if (e.shiftKey) {
      // Solo: show only this flow (shift-click again to bring all back).
      const alreadySolo =
        hidden.length === sheets.length - 1 && !hidden.includes(sheetId);
      onset(alreadySolo ? [] : sheets.filter((s) => s.id !== sheetId).map((s) => s.id));
    } else {
      ontoggle(sheetId);
    }
  }
</script>

<!-- While any drag is live the whole view is the drop zone: chips snap by
     horizontal position only, panels by their axis — drops can't miss. -->
<div
  class="spread-wrap"
  role="application"
  ondragover={draggingPanel ? trackPanelDrag : draggingChip ? trackChipDrag : undefined}
  ondrop={draggingPanel ? dropPanel : draggingChip ? dropChip : undefined}
>
  <div class="picker" bind:this={pickerEl} role="list">
    <span class="picker-label">On the desk:</span>
    {#each sheets as s, i (s.id)}
      <!-- div, not button: WebKit won't start HTML5 drags from buttons -->
      <div
        class="pick"
        class:on={!hidden.includes(s.id)}
        class:dragging={draggingChip === s.id}
        class:drag-before={chipOverIdx === i && chipBefore && draggingChip !== s.id}
        class:drag-after={chipOverIdx === i && !chipBefore && draggingChip !== s.id}
        style="--stripe: {sheetAccent(s)}"
        title="Click: toggle · Shift-click: solo · Drag: reorder · ⌘{i + 1}"
        role="button"
        tabindex="0"
        draggable="true"
        data-chipidx={i}
        ondragstart={(e) => {
          draggingChip = s.id;
          e.dataTransfer?.setData("text/plain", s.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        ondragend={() => {
          draggingChip = null;
          chipOverIdx = null;
        }}
        onclick={(e) => chipClick(e, s.id)}
        onkeydown={(e) => e.key === "Enter" && ontoggle(s.id)}
      >
        <span class="num">{i + 1}</span>
        {s.title || "(untitled)"}
      </div>
    {/each}
    <span class="bulk">
      <button class="bulk-btn" onclick={() => onset([])}>All</button>
      <button class="bulk-btn" onclick={() => onset(sheets.map((s) => s.id))}>None</button>
    </span>
    <span class="picker-hint">shift-click = solo · ⌘1–9 toggle</span>
  </div>

  <div
    class="spread"
    class:horizontal={direction === "horizontal"}
    bind:this={container}
    role="list"
  >
    {#each visible as s, k (s.id)}
      <section
        class="panel"
        class:focused={s.id === store.activeSheetId}
        class:dragging={draggingPanel === s.id}
        class:drag-before={dragOverIdx === k && dragBefore && draggingPanel !== s.id}
        class:drag-after={dragOverIdx === k && !dragBefore && draggingPanel !== s.id}
        style="--stripe: {sheetAccent(s)}; flex-grow: {w(s.id)}"
        data-panelidx={k}
      >
        <header
          draggable="true"
          role="button"
          tabindex="-1"
          title="Drag to reorder flows"
          ondragstart={(e) => {
            draggingPanel = s.id;
            e.dataTransfer?.setData("text/plain", s.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          }}
          ondragend={() => {
            draggingPanel = null;
            dragOverIdx = null;
          }}
        >
          <span class="grip">⠿</span>
          <span class="stripe"></span>
          {s.title || "(untitled)"}
        </header>
        <!-- Vertical stack pads columns so speeches align across flows;
             side-by-side keeps each sheet trimmed to its own columns. -->
        <Grid sheet={s} spread={direction === "vertical"} />
      </section>
      {#if k < visible.length - 1}
        <div
          class="divider"
          role="separator"
          aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
          title="Drag to resize"
          onpointerdown={(e) => startResize(e, k)}
        ></div>
      {/if}
    {:else}
      <p class="none">Nothing on the desk — pick flows above.</p>
    {/each}
  </div>
</div>

<style>
  .spread-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .picker {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .picker-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    white-space: nowrap;
    margin-right: 4px;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--stripe);
    border-radius: 14px;
    padding: 3px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    opacity: 0.4;
  }
  .pick.on {
    opacity: 1;
    border-color: color-mix(in srgb, var(--stripe) 60%, var(--border));
    background: color-mix(in srgb, var(--stripe) 12%, var(--bg));
  }
  .pick .num {
    font-size: 10px;
    opacity: 0.7;
  }
  .pick.dragging {
    opacity: 0.25;
  }
  .pick.drag-before {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .pick.drag-after {
    box-shadow: inset -3px 0 0 var(--accent);
  }
  .pick {
    user-select: none;
    -webkit-user-select: none;
  }
  .bulk {
    display: inline-flex;
    gap: 4px;
    margin-left: 6px;
  }
  .bulk-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  .bulk-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .picker-hint {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-dim);
    white-space: nowrap;
    opacity: 0.7;
  }
  .spread {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: auto;
    min-height: 0;
  }
  .spread.horizontal {
    flex-direction: row;
  }
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 120px;
    min-width: 0;
  }
  .spread.horizontal .panel {
    min-width: 260px;
    min-height: 0;
  }
  .divider {
    flex-shrink: 0;
    height: 5px;
    background: var(--border);
    cursor: row-resize;
    touch-action: none;
  }
  .divider:hover,
  .divider:active {
    background: var(--accent);
  }
  .spread.horizontal .divider {
    height: auto;
    width: 5px;
    cursor: col-resize;
  }
  .panel.focused header {
    filter: brightness(1.25);
    background: color-mix(in srgb, var(--stripe) 10%, var(--panel));
  }
  .panel.dragging {
    opacity: 0.4;
  }
  /* Insertion line: top/bottom when stacked, left/right side-by-side */
  .panel.drag-before {
    box-shadow: inset 0 3px 0 var(--accent);
  }
  .panel.drag-after {
    box-shadow: inset 0 -3px 0 var(--accent);
  }
  .spread.horizontal .panel.drag-before {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .spread.horizontal .panel.drag-after {
    box-shadow: inset -3px 0 0 var(--accent);
  }
  header .grip {
    cursor: grab;
    color: var(--text-dim);
    font-size: 11px;
    user-select: none;
    -webkit-user-select: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    /* Each flow's title in its own color — instant recognition on the desk */
    color: var(--stripe);
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .stripe {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--stripe);
  }
  .none {
    color: var(--text-dim);
    text-align: center;
    margin: 15vh auto 0;
  }
</style>
