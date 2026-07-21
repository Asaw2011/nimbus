<script lang="ts">
  import type { Sheet } from "../model/types";
  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import { matchesAny } from "../model/keymap";
  import GridCell from "./GridCell.svelte";

  let { sheet, spread = false }: { sheet: Sheet; spread?: boolean } = $props();

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
  }

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="grid-scroll"
  class:dragging={drag !== null && drag.moved}
  bind:this={scroller}
  {onscroll}
  {onmousedown}
  {onmousemove}
  {onmouseup}
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
          />
        {/if}
      {/each}
    </div>
  {/each}
</div>

<style>
  .grid-scroll {
    flex: 1;
    overflow: auto;
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
