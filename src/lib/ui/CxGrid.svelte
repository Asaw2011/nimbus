<script lang="ts">
  // Cross-examination flow. A CX period is just questions and answers, so this
  // sheet is a plain two-column table: "Question asked" on the left, "Answer" on
  // the right - nothing to do with the speech columns the rest of the flow uses.
  //
  // A CX sheet is an ORDINARY sheet underneath: every row still carries a full
  // width of cells, so inserts, undo, autosave and partner sync all work exactly
  // as they do everywhere else. This view only ever shows and edits the first
  // two cells of each row - cell 0 the question, cell 1 the answer.
  import type { Sheet } from "../model/types";
  import { makeRow } from "../model/types";
  import { store } from "../model/round.svelte";

  let { sheet, spread = false }: { sheet: Sheet; spread?: boolean } = $props();

  /** Question lives in cell 0, answer in cell 1. */
  const Q = 0;
  const A = 1;

  let scroller = $state<HTMLDivElement>();

  const rowText = (r: number, c: number) => sheet.rows[r]?.cells[c]?.text ?? "";
  const rowHasText = (r: number) => !!(rowText(r, Q).trim() || rowText(r, A).trim());

  // Keep a few blank rows under the last used one, and at least a viewport's
  // worth to start - the same "unlimited paper" feel as the main grid.
  $effect(() => {
    void sheet.rows.length;
    const rows = sheet.rows;
    let lastUsed = -1;
    for (let i = 0; i < rows.length; i++) if (rowHasText(i)) lastUsed = i;
    const viewportRows = scroller ? Math.ceil(scroller.clientHeight / 34) : 16;
    store.ensureRows(Math.max(lastUsed + 3, viewportRows), sheet);
  });

  function write(r: number, c: number, text: string) {
    store.mutate(
      (round) => {
        const s = round.sheets.find((x) => x.id === sheet.id);
        if (!s) return;
        while (s.rows.length <= r) s.rows.push(makeRow(store.nCols));
        s.rows[r].cells[c].text = text;
      },
      { coalesceText: true },
    );
  }

  function autosize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function oninput(e: Event, r: number, c: number) {
    const el = e.currentTarget as HTMLTextAreaElement;
    autosize(el);
    write(r, c, el.value);
  }

  // Enter moves along: from a question to its answer, from an answer to the next
  // question. Shift+Enter still inserts a real newline inside the box.
  function onkeydown(e: KeyboardEvent, r: number, c: number) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const target = c === Q ? `[data-cx="${r}-${A}"]` : `[data-cx="${r + 1}-${Q}"]`;
      if (c === A) store.ensureRows(r + 1, sheet);
      requestAnimationFrame(() =>
        scroller?.querySelector<HTMLTextAreaElement>(target)?.focus(),
      );
    }
  }

  // Keep the box in sync with the stored text WITHOUT stealing the caret: only
  // rewrite a box the user isn't currently typing in, so a partner's edit lands
  // but your own typing is never disturbed.
  function cxcell(el: HTMLTextAreaElement, text: string) {
    el.value = text;
    autosize(el);
    return {
      update(next: string) {
        if (document.activeElement !== el && el.value !== next) {
          el.value = next;
          autosize(el);
        }
      },
    };
  }
</script>

<div class="cx-wrap" class:spread>
  <div class="cx-scroll" bind:this={scroller}>
    <div class="cx-head">
      <div class="cx-h q">Question asked</div>
      <div class="cx-h a">Answer</div>
    </div>
    {#each sheet.rows as row, r (row.id)}
      <div class="cx-row">
        <span class="cx-num">{r + 1}</span>
        <textarea
          class="cx-cell q"
          rows="1"
          data-cx="{r}-{Q}"
          placeholder={r === 0 ? "Question…" : ""}
          use:cxcell={row.cells[Q]?.text ?? ""}
          oninput={(e) => oninput(e, r, Q)}
          onkeydown={(e) => onkeydown(e, r, Q)}
        ></textarea>
        <textarea
          class="cx-cell a"
          rows="1"
          data-cx="{r}-{A}"
          placeholder={r === 0 ? "Answer…" : ""}
          use:cxcell={row.cells[A]?.text ?? ""}
          oninput={(e) => oninput(e, r, A)}
          onkeydown={(e) => onkeydown(e, r, A)}
        ></textarea>
      </div>
    {/each}
  </div>
</div>

<style>
  .cx-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .cx-scroll {
    flex: 1;
    overflow: auto;
  }
  /* The number gutter has no header cell, so the labels start at column 2. */
  .cx-head {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) minmax(0, 1.25fr);
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .cx-h {
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    text-align: center;
    border-right: 1px solid var(--grid-line);
  }
  .cx-h.q {
    grid-column: 2;
  }
  .cx-h.a {
    grid-column: 3;
  }
  .cx-row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) minmax(0, 1.25fr);
    align-items: stretch;
    border-bottom: 1px solid var(--grid-line);
  }
  .cx-num {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8px;
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0.55;
    border-right: 1px solid var(--grid-line);
    user-select: none;
  }
  .cx-cell {
    box-sizing: border-box;
    width: 100%;
    min-height: 30px;
    resize: none;
    overflow: hidden;
    padding: 6px 10px;
    border: none;
    border-right: 1px solid var(--grid-line);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
  }
  .cx-cell::placeholder {
    color: var(--text-dim);
    opacity: 0.6;
  }
  .cx-cell:focus {
    outline: none;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .cx-cell.q {
    color: var(--neg, #c0392b);
  }
</style>
