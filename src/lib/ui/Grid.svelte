<script lang="ts">
  import type { Sheet } from "../model/types";
  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import { matchesAny } from "../model/keymap";
  import GridCell from "./GridCell.svelte";

  let {
    sheet,
    spread = false,
    onblockdrop = null,
  }: {
    sheet: Sheet;
    spread?: boolean;
    onblockdrop?: ((node: unknown, row: number, col: number) => void) | null;
  } = $props();

  const speeches = $derived(store.round?.template.speeches ?? []);
  // Off-case pages start at the 1NC, overviews at the block — like the
  // prototype sheets in a Verbatim flow template. No wasted columns.
  // In spread view every sheet renders the full range so speech columns
  // align vertically across all visible flows; pre-start cells are dead.
  const colStart = $derived(spread ? 0 : sheet.startCol);
  const visibleSpeeches = $derived(speeches.slice(colStart));
  // Color follows the SPEECH, not the page: aff columns blue, neg columns
  // red on every sheet — like flowing with two pens. Template-driven, so it
  // works for Policy, LD, and PF (either speaking order) automatically.
  // Columns stretch to fill the window; scroll horizontally only when the
  // window is narrower than nCols × colMinWidth.
  const colTemplate = $derived(
    `repeat(${visibleSpeeches.length}, minmax(${settings.colMinWidth}px, 1fr))`,
  );

  let scroller: HTMLDivElement | undefined = $state();
  let dropTargetCell = $state<{ r: number; c: number } | null>(null);

  // ---- Doc Search drag bridge ------------------------------------------
  // Blocks dragged from DocSearch carry a 'text/nimbus-block' MIME type.
  // Drop onto any cell: header goes into the cell, full card fires onblockdrop
  // so FlowView can append it to the speech doc simultaneously.

  function isBlockDrag(e: DragEvent): boolean {
    return !!e.dataTransfer?.types.includes("text/nimbus-block");
  }

  function ondragover_grid(e: DragEvent) {
    if (!isBlockDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    const cell = cellAt(e as unknown as MouseEvent);
    dropTargetCell = cell;
  }

  function ondragleave_grid(e: DragEvent) {
    // Only clear if leaving the grid entirely
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      dropTargetCell = null;
    }
  }

  function ondrop_grid(e: DragEvent) {
    if (!isBlockDrag(e)) return;
    e.preventDefault();
    dropTargetCell = null;
    const raw = e.dataTransfer?.getData("text/nimbus-block");
    if (!raw) return;
    let payload: { header: string; fullCard: string; node?: { level: number; isAnalytic?: boolean } };
    try { payload = JSON.parse(raw); } catch { return; }
    const cell = cellAt(e as unknown as MouseEvent);
    if (!cell) return;
    const { r, c } = cell;
    const chip = payload.node
      ? (payload.node.isAnalytic ? "ANL" : ["", "POC", "HAT", "BLK", "TAG"][payload.node.level] ?? "TAG")
      : undefined;
    // Write header into the cell
    store.mutate((round) => {
      const s = round.sheets.find((s) => s.id === sheet.id);
      if (!s) return;
      store.ensureRows(r, s);
      const dc = s.rows[r].cells[c];
      dc.text = payload.header;
      if (chip) dc.chip = chip;
      if (payload.node) dc.card = payload.node;
    });
    store.cursor = { row: r, col: c };
    // Notify FlowView to append the rich card to the speech doc
    if (payload.node) onblockdrop?.(payload.node, r, c);
  }

  // Unlimited paper: keep the sheet at least a viewport tall, keep blank rows
  // below the last used row, and grow further as the user scrolls down.
  $effect(() => {
    const lastUsed = sheet.rows.findLastIndex((r) =>
      r.cells.some((c) => c.text.trim() !== ""),
    );
    const viewportRows = scroller ? Math.ceil(scroller.clientHeight / 27) : 30;
    store.ensureRows(Math.max(lastUsed + 3, viewportRows), sheet);
  });

  function onscroll() {
    if (!scroller) return;
    const nearBottom =
      scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 300;
    if (nearBottom) store.ensureRows(sheet.rows.length + 20, sheet);
    updateCues();
  }

  // ---- off-screen cues (main flow only) ----
  let moreAbove = $state(false);
  let moreBelow = $state(false);
  let starsAbove = $state(0);
  let starsBelow = $state(0);

  function updateCues() {
    if (!scroller || spread) return;
    moreAbove = scroller.scrollTop > 4;
    moreBelow =
      scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 4;
    const srect = scroller.getBoundingClientRect();
    let above = 0;
    let below = 0;
    for (const el of scroller.querySelectorAll(".cell.starred")) {
      const r = el.getBoundingClientRect();
      if (r.bottom < srect.top + 2) above++;
      else if (r.top > srect.bottom - 2) below++;
    }
    starsAbove = above;
    starsBelow = below;
  }

  /** Scroll to the nearest off-screen starred cell in the given direction. */
  function scrollToStar(dir: -1 | 1) {
    if (!scroller) return;
    const srect = scroller.getBoundingClientRect();
    let best: Element | null = null;
    let bestDist = Infinity;
    for (const el of scroller.querySelectorAll(".cell.starred")) {
      const r = el.getBoundingClientRect();
      const off = dir < 0 ? r.bottom < srect.top + 2 : r.top > srect.bottom - 2;
      if (!off) continue;
      const dist = dir < 0 ? srect.top - r.bottom : r.top - srect.bottom;
      if (dist < bestDist) { bestDist = dist; best = el; }
    }
    best?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Recompute cues whenever the sheet content changes or on first paint.
  $effect(() => {
    void sheet.rows.length;
    if (!spread) requestAnimationFrame(updateCues);
  });

  // ---- Excel-style range selection ---------------------------------------
  // Drag across cells to highlight a block; drag from inside a highlighted
  // block to move it. Single click stays a normal text edit.
  let drag = $state<{
    mode: "select" | "move";
    startR: number;
    startC: number;
    moved: boolean;
  } | null>(null);

  function cellAt(e: MouseEvent): { r: number; c: number } | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!el) return null;
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
  }

  function onmousedown(e: MouseEvent) {
    if (e.button !== 0) return;
    const rc = cellAt(e);
    if (!rc) return;
    // Shift+click: extend/create a selection from the cursor.
    if (e.shiftKey && store.cursor && store.activeSheetId === sheet.id) {
      e.preventDefault();
      store.selection = {
        anchor: { ...store.cursor },
        focus: { row: rc.r, col: rc.c },
      };
      return;
    }
    const insideSelection =
      store.activeSheetId === sheet.id &&
      store.hasMultiSelection &&
      store.inSelection(rc.r, rc.c);
    drag = {
      mode: insideSelection ? "move" : "select",
      startR: rc.r,
      startC: rc.c,
      moved: false,
    };
    // Starting a move must not enter text editing.
    if (insideSelection) e.preventDefault();
  }

  function onmousemove(e: MouseEvent) {
    if (!drag || !(e.buttons & 1)) return;
    const rc = cellAt(e);
    if (!rc) return;
    if (rc.r !== drag.startR || rc.c !== drag.startC) drag.moved = true;
    if (drag.mode === "select" && drag.moved) {
      e.preventDefault();
      store.activeSheetId = sheet.id;
      store.selection = {
        anchor: { row: drag.startR, col: drag.startC },
        focus: { row: rc.r, col: rc.c },
      };
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }

  function onmouseup(e: MouseEvent) {
    if (!drag) return;
    const rc = cellAt(e);
    if (drag.mode === "move" && drag.moved && rc) {
      store.moveSelection(rc.r - drag.startR, rc.c - drag.startC);
    } else if (!drag.moved) {
      // Plain click: back to normal editing.
      store.selection = null;
    }
    drag = null;
  }

  /** Keyboard ops on a multi-cell selection (editor is blurred then). */
  function onSelectionKeys(e: KeyboardEvent) {
    if (store.activeSheetId !== sheet.id || !store.hasMultiSelection) return;
    const km = settings.keymap;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      store.clearSelectedCells();
    } else if (e.key === "Escape") {
      store.selection = null;
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && !e.shiftKey) {
      e.preventDefault();
      void navigator.clipboard.writeText(store.selectionTsv());
    } else if (matchesAny(e, km.markDropped)) {
      e.preventDefault();
      store.applyToSelection((c) => {
        const m = (c.marks ??= {});
        m.dropped = !m.dropped;
      });
    } else if (matchesAny(e, km.markStarred)) {
      e.preventDefault();
      store.applyToSelection((c) => {
        const m = (c.marks ??= {});
        m.starred = !m.starred;
      });
    } else if (matchesAny(e, km.markAnalytic)) {
      e.preventDefault();
      store.applyToSelection((c) => {
        const m = (c.marks ??= {});
        m.evidence = m.evidence === "analytic" ? undefined : "analytic";
      });
    } else if (matchesAny(e, km.markCard)) {
      e.preventDefault();
      store.applyToSelection((c) => {
        const m = (c.marks ??= {});
        m.evidence = m.evidence === "card" ? undefined : "card";
      });
    }
  }
</script>

<svelte:window onkeydown={onSelectionKeys} />

<div class="grid-wrap">
{#if !spread}
  <div class="edge-fade top" class:on={moreAbove}></div>
  <div class="edge-fade bottom" class:on={moreBelow}></div>
  {#if starsAbove > 0}
    <button class="star-pill top" onclick={() => scrollToStar(-1)} title="Scroll to the nearest starred argument above">★ {starsAbove} above ↑</button>
  {/if}
  {#if starsBelow > 0}
    <button class="star-pill bottom" onclick={() => scrollToStar(1)} title="Scroll to the nearest starred argument below">★ {starsBelow} below ↓</button>
  {/if}
{/if}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="grid-scroll"
  class:dragging={drag !== null && drag.moved}
  bind:this={scroller}
  {onscroll}
  {onmousedown}
  {onmousemove}
  {onmouseup}
  ondragover={ondragover_grid}
  ondragleave={ondragleave_grid}
  ondrop={ondrop_grid}
>
  <div class="headers" style="grid-template-columns: {colTemplate}">
    {#each visibleSpeeches as speech, i (speech.id)}
      <div
        class="header"
        class:aff={speech.side === "aff"}
        class:neg={speech.side === "neg"}
        class:dead={colStart + i < sheet.startCol}
        title={speech.label}
      >
        {speech.abbr}
      </div>
    {/each}
  </div>
  {#each sheet.rows as row, r (row.id)}
    <div class="row" style="grid-template-columns: {colTemplate}">
      {#each row.cells.slice(colStart) as cell, i (i)}
        {#if colStart + i < sheet.startCol}
          <div class="dead-cell"></div>
        {:else}
          <GridCell
            {cell}
            row={r}
            col={colStart + i}
            sheetId={sheet.id}
            side={speeches[colStart + i]?.side ?? "neutral"}
            isLabel={r === 0 && colStart + i === sheet.startCol}
            dropTarget={dropTargetCell?.r === r && dropTargetCell?.c === colStart + i}
          />
        {/if}
      {/each}
    </div>
  {/each}
</div>
</div>

<style>
  .grid-wrap {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .grid-scroll {
    flex: 1;
    overflow: auto;
  }
  .edge-fade {
    position: absolute;
    left: 0;
    right: 0;
    height: 22px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 3;
  }
  .edge-fade.on { opacity: 1; }
  .edge-fade.top {
    top: 0;
    background: linear-gradient(to bottom, var(--bg), transparent);
  }
  .edge-fade.bottom {
    bottom: 0;
    background: linear-gradient(to top, var(--bg), transparent);
  }
  .star-pill {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    background: var(--star, #d4a017);
    color: #1a1a1a;
    border: none;
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
    animation: star-pulse 1.6s ease-in-out infinite;
  }
  .star-pill.top { top: 6px; }
  .star-pill.bottom { bottom: 6px; }
  @keyframes star-pulse {
    0%, 100% { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28); }
    50% { box-shadow: 0 2px 14px rgba(212, 160, 23, 0.7); }
  }
  .grid-scroll.dragging,
  .grid-scroll.dragging :global(*) {
    user-select: none;
    -webkit-user-select: none;
    cursor: cell;
  }
  .headers {
    display: grid;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .header {
    box-sizing: border-box;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    border-right: 1px solid var(--grid-line);
    text-align: center;
  }
  .header.aff {
    color: var(--aff);
  }
  .header.neg {
    color: var(--neg);
  }
  .header.dead {
    opacity: 0.25;
  }
  .dead-cell {
    box-sizing: border-box;
    border-right: 1px solid var(--grid-line);
    border-bottom: 1px solid var(--grid-line);
    background: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 5px,
      var(--grid-line) 5px,
      var(--grid-line) 6px
    );
    opacity: 0.35;
    min-height: 26px;
  }
  .row {
    display: grid;
    align-items: stretch;
  }
</style>
