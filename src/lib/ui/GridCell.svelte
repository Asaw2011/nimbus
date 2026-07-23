<script lang="ts">
  import type { Cell } from "../model/types";
  import { store } from "../model/round.svelte";
  import { expand, loadSnippets } from "../model/snippets";
  import { matches, matchesAny } from "../model/keymap";
  import { settings } from "../model/settings.svelte";
  import { runMacro } from "../model/macros";

  let {
    cell,
    row,
    col,
    sheetId,
    side = "neutral",
    isLabel = false,
    dropTarget = false,
  }: {
    cell: Cell;
    row: number;
    col: number;
    sheetId: string;
    side?: "aff" | "neg" | "neutral";
    isLabel?: boolean;
    dropTarget?: boolean;
  } = $props();

  // In spread view several sheets are visible at once — a cell is only active
  // when its sheet is the active one too.
  const active = $derived(
    store.activeSheetId === sheetId &&
      store.cursor?.row === row &&
      store.cursor?.col === col,
  );
  const inRange = $derived(
    store.activeSheetId === sheetId &&
      store.hasMultiSelection &&
      store.inSelection(row, col),
  );

  let editor: HTMLDivElement | undefined = $state();

  // Focus whenever the cursor lands on this cell. First mouse click selects the
  // whole cell (store.selectAll); keyboard nav lands with a caret at the end.
  $effect(() => {
    if (active && editor && document.activeElement !== editor) {
      editor.focus();
      if (store.selectAll) selectAllText();
      else placeCaretAtEnd();
    }
  });

  function selectAllText() {
    if (!editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // ---- author lookup dropdown (⌘Space) ----
  let lookupOpen = $state(false);
  let lookupQuery = $state("");
  let lookupSel = $state(0);
  const lookupMatches = $derived(lookupOpen ? store.authorMatches(lookupQuery) : []);

  function openLookup() {
    lookupQuery = (editor?.textContent ?? "").trim();
    lookupSel = 0;
    lookupOpen = true;
  }
  function closeLookup() {
    lookupOpen = false;
  }
  function chooseLookup(withTag: boolean) {
    const m = lookupMatches[lookupSel];
    lookupOpen = false;
    if (!m) return;
    store.setCellWithAuthor(row, col, m.author, withTag ? m.tag : "");
    setTimeout(() => {
      if (editor) {
        editor.focus();
        placeCaretAtEnd();
      }
    }, 0);
  }

  // Set text imperatively. We skip re-painting a focused, non-empty editor to
  // avoid caret jumps mid-typing — BUT a focused-yet-empty editor means the
  // cursor just landed here on load (e.g. the LABEL cell), so we must paint it
  // or the value shows blank even though the data has it.
  $effect(() => {
    if (!editor) return;
    // Reference cell.author so the effect repaints when the banked author changes.
    void cell.author;
    if (editor.textContent === cell.text && !authorNeedsPaint()) return;
    const focused = document.activeElement === editor;
    if (!focused || editor.textContent === "") {
      paint();
      if (focused) placeCaretAtEnd();
    }
  });

  /** True when the DOM isn't yet showing the bold-author markup it should. */
  function authorNeedsPaint(): boolean {
    if (!editor) return false;
    const wantBold = !!cell.author && cell.text.includes(cell.author);
    const hasBold = !!editor.querySelector("b.author");
    return wantBold !== hasBold;
  }

  /** Render the cell text, bolding the banked author substring if present. The
   *  editor's `.textContent` stays the plain text, so input/copy/export are
   *  unaffected — only the visual gets a <b class="author"> wrapper. */
  function paint() {
    if (!editor) return;
    const text = cell.text;
    const author = cell.author;
    const at = author ? text.indexOf(author) : -1;
    if (at < 0) {
      editor.textContent = text;
      return;
    }
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    editor.innerHTML =
      esc(text.slice(0, at)) +
      `<b class="author">${esc(author!)}</b>` +
      esc(text.slice(at + author!.length));
  }

  function placeCaretAtEnd() {
    if (!editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function caretAt(edge: "start" | "end"): boolean {
    if (!editor) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0).cloneRange();
    const probe = document.createRange();
    probe.selectNodeContents(editor);
    probe.setEnd(range.startContainer, range.startOffset);
    const before = probe.toString();
    return edge === "start"
      ? before.length === 0
      : before.length === (editor.textContent ?? "").length;
  }

  function oninput() {
    if (!editor) return;
    let text = editor.textContent ?? "";
    const expanded = expand(text, loadSnippets());
    if (expanded !== null) {
      text = expanded;
      editor.textContent = text;
      placeCaretAtEnd();
    }
    store.setCell(row, col, text);
    if (lookupOpen) { lookupQuery = text.trim(); lookupSel = 0; }
  }

  function onkeydown(e: KeyboardEvent) {
    const km = settings.keymap;
    // User macros take highest priority.
    for (const m of settings.macros) {
      if (m.combo && matches(e, m.combo)) {
        e.preventDefault();
        runMacro(m);
        // A macro may have typed into this focused cell; the reactive sync
        // skips focused editors, so sync manually.
        setTimeout(() => {
          if (editor && document.activeElement === editor && editor.textContent !== cell.text) {
            editor.textContent = cell.text;
            placeCaretAtEnd();
          }
        }, 0);
        return;
      }
    }
    // Author lookup dropdown swallows navigation keys while open.
    if (lookupOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); lookupSel = Math.min(lookupSel + 1, Math.max(0, lookupMatches.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); lookupSel = Math.max(0, lookupSel - 1); return; }
      if (e.key === "Enter") { e.preventDefault(); chooseLookup(false); return; }
      if (e.key === "Tab") { e.preventDefault(); chooseLookup(true); return; }
      if (e.key === "Escape") { e.preventDefault(); closeLookup(); return; }
    }
    if (matchesAny(e, km.authorLookup)) {
      e.preventDefault();
      openLookup();
      return;
    }
    // Remappable actions first, so rebinding e.g. Enter-based combos wins.
    if (matchesAny(e, km.insertRowAbove)) {
      e.preventDefault();
      store.insertRow(row);
      store.cursor = { row, col };
    } else if (matchesAny(e, km.insertRowBelow)) {
      e.preventDefault();
      store.insertRow(row + 1);
      store.cursor = { row: row + 1, col };
    } else if (matchesAny(e, km.insertRow3Above)) {
      e.preventDefault();
      const n = settings.bulkRows;
      store.runBatch(() => {
        for (let i = 0; i < n; i++) store.insertRow(row);
      });
      // Cursor stays on the original text, now pushed down by n rows.
      store.cursor = { row: row + n, col };
    } else if (matchesAny(e, km.insertRow3Below)) {
      e.preventDefault();
      const n = settings.bulkRows;
      store.runBatch(() => {
        for (let i = 0; i < n; i++) store.insertRow(row + 1);
      });
      // Land on the first new row directly beneath (not the last one).
      store.cursor = { row: row + 1, col };
    } else if (matchesAny(e, km.deleteRow)) {
      e.preventDefault();
      store.deleteRow(row);
    } else if (matchesAny(e, km.extendArg)) {
      e.preventDefault();
      store.extendCell(row, col);
    } else if (matchesAny(e, km.markDropped)) {
      e.preventDefault();
      store.toggleMark(row, col, "dropped");
    } else if (matchesAny(e, km.markStarred)) {
      e.preventDefault();
      store.toggleMark(row, col, "starred");
    } else if (matchesAny(e, km.markAnalytic)) {
      e.preventDefault();
      store.toggleEvidence(row, col, "analytic");
    } else if (matchesAny(e, km.markCard)) {
      e.preventDefault();
      store.toggleEvidence(row, col, "card");
    }
    // Shift+arrows extend an existing range selection (Excel muscle memory);
    // without a range they keep selecting text inside the cell as normal.
    else if (
      e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      e.key.startsWith("Arrow") &&
      store.selection
    ) {
      e.preventDefault();
      const delta: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const [dr, dc] = delta[e.key];
      store.extendSelection(dr, dc);
    }
    // Fixed grid motions — the Excel/paper muscle memory.
    else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      store.moveCursor(1, 0);
    } else if (e.key === "Tab") {
      e.preventDefault();
      store.moveCursor(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "ArrowDown" && !e.shiftKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      store.moveCursor(1, 0);
    } else if (e.key === "ArrowUp" && !e.shiftKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      store.moveCursor(-1, 0);
    } else if (e.key === "ArrowLeft" && !e.shiftKey && !e.metaKey && !e.altKey && caretAt("start")) {
      e.preventDefault();
      store.moveCursor(0, -1);
    } else if (e.key === "ArrowRight" && !e.shiftKey && !e.metaKey && !e.altKey && caretAt("end")) {
      e.preventDefault();
      store.moveCursor(0, 1);
    } else if (e.key === "Escape") {
      editor?.blur();
      store.endTextSession();
      store.selection = null;
    }
  }

  function onfocus() {
    // Focusing a cell claims its sheet as active, so all keybound ops
    // (insert row, extend, marks) target the sheet you're actually in.
    store.activeSheetId = sheetId;
    store.cursor = { row, col };
  }

  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // Multi-cell clipboard (tabs = columns, newlines = rows) → spread like Excel.
    if (!text.includes("\t") && !text.includes("\n")) return; // single value: normal paste
    e.preventDefault();
    const grid = text
      .replace(/\r\n/g, "\n")
      .replace(/\n+$/, "")
      .split("\n")
      .map((line) => line.split("\t"));
    store.pasteBlock(row, col, grid);
    // Paint this (top-left) cell now; the rest sync as they're unfocused.
    if (editor) {
      editor.textContent = grid[0]?.[0] ?? "";
      editor.blur();
    }
  }
</script>

<div
  class="cell"
  class:active
  class:select-all={active && store.selectAll}
  class:in-range={inRange}
  class:dropped={cell.marks?.dropped}
  class:starred={cell.marks?.starred}
  class:label={isLabel}
  class:aff={side === "aff"}
  class:neg={side === "neg"}
  class:analytic={cell.marks?.evidence === "analytic"}
  class:card={cell.marks?.evidence === "card"}
  class:drop-target={dropTarget}
  data-r={row}
  data-c={col}
>
  {#if cell.ext}
    <span class="ext-arrow" title="Extended from an earlier speech">➜</span>
  {/if}
  {#if cell.chip}
    <span class="cell-chip chip-{cell.chip}">{cell.chip}</span>
  {/if}
  <div
    bind:this={editor}
    class="editor"
    class:bold={cell.marks?.bold}
    class:italic={cell.marks?.italic}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    spellcheck="false"
    data-ph={isLabel ? "LABEL" : ""}
    style={cell.marks?.color ? `color: ${cell.marks.color}` : ""}
    {oninput}
    {onkeydown}
    {onfocus}
    {onpaste}
    onblur={() => { store.endTextSession(); closeLookup(); }}
  ></div>
  {#if lookupOpen}
    <div class="author-lookup" role="listbox">
      <div class="al-hint">↵ author · ⇥ author + tag · esc</div>
      {#if lookupMatches.length === 0}
        <div class="al-empty">
          {store.round?.cards?.length
            ? "No author matches — keep typing"
            : "No banked cards yet — import a doc to bank authors"}
        </div>
      {/if}
      {#each lookupMatches as m, mi (m.author + m.tag)}
        <button
          class="al-item"
          class:sel={mi === lookupSel}
          role="option"
          aria-selected={mi === lookupSel}
          onmousedown={(e) => { e.preventDefault(); lookupSel = mi; chooseLookup(false); }}
        >
          <b>{m.author}</b><span class="al-tag">{m.tag}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cell {
    box-sizing: border-box;
    position: relative;
    border-right: 1px solid var(--grid-line);
    border-bottom: 1px solid var(--grid-line);
    background: var(--cell-bg);
    min-height: var(--row-h, 26px);
  }
  .cell.label .editor {
    font-weight: 700;
  }
  .editor :global(b.author) {
    font-weight: 700;
  }
  .author-lookup {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 30;
    min-width: 220px;
    max-width: 340px;
    max-height: 240px;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    padding: 3px;
  }
  .al-hint {
    font-size: 10px;
    color: var(--text-dim);
    padding: 3px 6px;
  }
  .al-empty {
    font-size: 11px;
    color: var(--text-dim);
    padding: 6px 8px;
    font-style: italic;
  }
  .al-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
  }
  .al-item.sel {
    background: color-mix(in srgb, var(--accent) 22%, var(--panel));
  }
  .al-tag {
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell.label {
    border-bottom: 2px solid var(--border);
  }
  .ext-arrow {
    position: absolute;
    left: -24px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 24px;
    font-weight: 900;
    line-height: 1;
    color: var(--accent);
    z-index: 2;
    pointer-events: none;
    /* halo so the arrow pops over gridlines and neighboring text */
    filter: drop-shadow(0 0 3px var(--bg)) drop-shadow(0 0 1px var(--bg));
  }
  /* accent edge on the receiving cell so the extension reads at a glance */
  .cell:has(.ext-arrow) {
    border-left: 3px solid var(--accent);
  }
  .cell-chip {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 7px;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: #fff;
    border-radius: 3px;
    padding: 0 3px;
    line-height: 1.5;
    z-index: 2;
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
  }
  .chip-POC { background: #6b52d1; }
  .chip-HAT { background: #8a63d2; }
  .chip-BLK { background: #c0392b; }
  .chip-TAG { background: #2e8b57; }
  .chip-ANL { background: #b8860b; }
  .editor[data-ph]:not([data-ph=""]):empty::before {
    content: attr(data-ph);
    color: var(--text-dim);
    opacity: 0.5;
    letter-spacing: 0.06em;
    font-size: 11px;
  }
  .cell.active {
    outline: 1.5px solid var(--accent);
    outline-offset: -1.5px;
    background: var(--active-cell-bg);
  }
  /* Whole-cell select (first click): a heavier ring than the caret-edit outline. */
  .cell.select-all {
    outline: 2.5px solid var(--accent);
    outline-offset: -2.5px;
    background: color-mix(in srgb, var(--accent) 10%, var(--active-cell-bg));
  }
  .cell.drop-target {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    background: color-mix(in srgb, var(--accent) 12%, var(--cell-bg));
  }
  .cell.in-range {
    background: color-mix(in srgb, var(--accent) 16%, var(--cell-bg));
    outline: none;
  }
  .cell.dropped {
    background: var(--dropped-bg);
    box-shadow: inset 3px 0 0 var(--mark-dropped);
  }
  .cell.starred {
    box-shadow: inset 3px 0 0 var(--mark-star);
  }
  .cell.dropped.starred {
    box-shadow:
      inset 3px 0 0 var(--mark-dropped),
      inset -3px 0 0 var(--mark-star);
  }
  .editor {
    outline: none;
    padding: 4px 7px;
    min-height: 18px;
    font-family: var(--cell-font, inherit);
    font-size: var(--cell-size, 13px);
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .editor.bold {
    font-weight: 700;
  }
  .editor.italic {
    font-style: italic;
  }
  /* Ink color follows the speech side — like flowing with two pens */
  .cell.aff .editor {
    color: color-mix(in srgb, var(--aff) 80%, var(--text));
  }
  .cell.neg .editor {
    color: color-mix(in srgb, var(--neg) 80%, var(--text));
  }
  /* Analytic / card tags override the side ink (declared after, so they win) */
  .cell.analytic .editor {
    color: var(--analytic);
  }
  .cell.card .editor {
    color: var(--card);
  }
</style>
