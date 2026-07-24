<script lang="ts">
  import type { Cell, CellItem } from "../model/types";
  import { store } from "../model/round.svelte";
  import { expand, loadSnippets } from "../model/snippets";
  import { matches, matchesAny } from "../model/keymap";
  import { settings } from "../model/settings.svelte";
  import { runMacro } from "../model/macros";
  import { guard } from "../model/crash";

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

  // Focus + caret-to-end whenever the cursor lands on this cell.
  $effect(() => {
    if (active && editor && document.activeElement !== editor)
      guard("GridCell.focus", () => { editor!.focus(); placeCaretAtEnd(); });
  });

  // ---- argument lookup dropdown (⌘J): banked cards + analytics ----
  let lookupOpen = $state(false);
  let lookupQuery = $state("");
  let lookupSel = $state(0);
  const lookupMatches = $derived(lookupOpen ? store.argMatches(lookupQuery) : []);

  function openLookup() {
    lookupQuery = (editor?.textContent ?? "").trim();
    lookupSel = 0;
    lookupOpen = true;
  }
  function closeLookup() {
    lookupOpen = false;
  }
  /** full = Enter (card → author + tag); !full = Tab (card → author only).
   *  Analytics ignore `full` and insert their text either way. */
  function chooseLookup(full: boolean) {
    const m = lookupMatches[lookupSel];
    lookupOpen = false;
    if (!m) return;
    store.setCellFromArg(row, col, m, full);
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
    void cell.text;
    guard("GridCell.paint", () => {
      if (!editor || (editor.textContent === cell.text && !authorNeedsPaint())) return;
      const focused = document.activeElement === editor;
      if (!focused || editor.textContent === "") {
        paint();
        if (focused) placeCaretAtEnd();
      }
    });
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
    const raw = editor.textContent ?? "";
    const expanded = expand(raw, loadSnippets());
    // Collapse "---" to a single em dash (—), like the speech doc.
    let text = (expanded ?? raw).replace(/---/g, "—");
    if (text !== raw) {
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
      // Enter = insert author only; Tab = insert author + tag.
      if (e.key === "Enter") { e.preventDefault(); chooseLookup(false); return; }
      if (e.key === "Tab") { e.preventDefault(); chooseLookup(true); return; }
      if (e.key === "Escape") { e.preventDefault(); closeLookup(); return; }
    }
    if (matchesAny(e, km.authorLookup)) {
      e.preventDefault();
      openLookup();
      return;
    }
    // Backspace on an already-empty header drops the whole card block, so a
    // cleared cell doesn't stay "stuck" with items you can't reach.
    if (
      e.key === "Backspace" &&
      !e.metaKey &&
      !e.ctrlKey &&
      (editor?.textContent ?? "") === "" &&
      cell.items?.length
    ) {
      e.preventDefault();
      store.clearCell(row, col);
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
    } else if (matchesAny(e, km.moveDownRows)) {
      // Jump the cursor down N rows (leave space for answers) — does NOT insert
      // rows, just moves over the existing blank paper. Count is configurable.
      e.preventDefault();
      store.moveCursor(settings.moveRows, 0);
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
    store.activeSurface = "flow";
  }

  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // Multi-cell clipboard (tabs = columns, newlines = rows) → spread like Excel.
    if (text.includes("\t") || text.includes("\n")) {
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
      return;
    }
    // Single value: force PLAIN TEXT. The browser's default paste keeps
    // CardMirror's bold / underline / highlight and inline colors, which stops
    // the cell from taking its side color (aff blue / neg red). Stripping to
    // plain text standardizes it and lets the normal cell styling apply.
    e.preventDefault();
    const ok = document.execCommand("insertText", false, text);
    if (!ok && editor) {
      editor.textContent = (editor.textContent ?? "") + text;
      placeCaretAtEnd();
      store.setCell(row, col, editor.textContent);
    }
  }

  // ---- multi-item cells (inserted cards + your own responses) --------------
  // A cell with `items` shows an expandable list beneath its header. Card
  // sub-items are read-only (they mirror the source doc); response sub-items
  // are editable and removable.
  let pendingFocusItem = $state<string | null>(null);

  /** Set an item editor's text once, and repaint on external change while it's
   *  not focused (same caret-safe rule as the main editor). */
  function itemText(node: HTMLElement, it: CellItem) {
    node.textContent = it.text;
    if (pendingFocusItem === it.id) {
      pendingFocusItem = null;
      queueMicrotask(() => {
        node.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
    }
    return {
      update(next: CellItem) {
        if (document.activeElement !== node && node.textContent !== next.text) {
          node.textContent = next.text;
        }
      },
    };
  }

  function onItemInput(id: string, e: Event) {
    store.updateCellItem(row, col, id, (e.currentTarget as HTMLElement).textContent ?? "");
  }

  /** Add a response. `at` = index to insert before; omit to append at the end. */
  function addResponse(at?: number) {
    pendingFocusItem = store.addCellItem(row, col, "response", "", at);
  }

  /** Enter (no shift) inside a response adds a sibling right below it. */
  function onItemKeydown(index: number, e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      addResponse(index + 1);
    }
  }

  // In a multi-item cell the editable header is only the top line, so clicking
  // the item area / dead space wouldn't enter the cell. Route those clicks to
  // the header editor so you can start typing from anywhere in the cell.
  // (Clicks on a response, a button, or the lookup keep their own behavior.)
  function onCellClick(e: MouseEvent) {
    if (!editor) return;
    const t = e.target as HTMLElement;
    if (t.closest(".editor, .item-text.editable, .item-del, .item-add, .items-toggle, .items-clear, .item-gap, .author-lookup")) return;
    editor.focus();
    placeCaretAtEnd();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cell"
  onclick={onCellClick}
  class:active
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
  {#if cell.items?.length}
    <div class="items-bar">
      <button
        class="items-toggle"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => store.toggleCellExpanded(row, col)}
      >
        <span class="tw">{cell.expanded ? "▾" : "▸"}</span>
        {cell.items.length}
        {cell.items.length === 1 ? "item" : "items"}
      </button>
      <button
        class="items-clear"
        title="Clear the whole cell — header, chip, and all cards/responses"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => store.clearCell(row, col)}
      >clear</button>
    </div>
    {#if cell.expanded}
      <div class="items">
        {#each cell.items as it, i (it.id)}
          <button
            class="item-gap"
            title="Insert response here"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => addResponse(i)}
            aria-label="Insert response here"
          ><span class="gap-plus">+</span></button>
          <div class="item" class:response={it.kind === "response"}>
            {#if it.chip}
              <span class="item-chip chip-{it.chip}">{it.chip}</span>
            {/if}
            <div
              class="item-text"
              class:editable={it.kind === "response"}
              contenteditable={it.kind === "response"}
              role="textbox"
              tabindex={it.kind === "response" ? 0 : -1}
              spellcheck="false"
              data-ph={it.kind === "response" ? "your response…" : ""}
              use:itemText={it}
              oninput={(e) => onItemInput(it.id, e)}
              onkeydown={(e) => onItemKeydown(i, e)}
              onfocus={onfocus}
              onblur={() => store.endTextSession()}
            ></div>
            <button
              class="item-del"
              title={it.kind === "response" ? "Remove response" : "Remove card"}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => store.removeCellItem(row, col, it.id)}
            >×</button>
          </div>
        {/each}
        <button
          class="item-add"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => addResponse()}
        >+ response</button>
      </div>
    {/if}
  {/if}
  {#if lookupOpen}
    <div class="author-lookup" role="listbox">
      <div class="al-hint">↵ full · ⇥ author only · esc</div>
      {#if lookupMatches.length === 0}
        <div class="al-empty">
          {store.round?.cards?.length
            ? "No matches — keep typing"
            : "No banked arguments yet — import a doc to bank them"}
        </div>
      {/if}
      {#each lookupMatches as m, mi ((m.author ?? "") + m.tag)}
        <button
          class="al-item"
          class:sel={mi === lookupSel}
          role="option"
          aria-selected={mi === lookupSel}
          onmousedown={(e) => { e.preventDefault(); lookupSel = mi; chooseLookup(true); }}
        >
          {#if m.analytic}
            <span class="al-kind anl">ANL</span><span class="al-tag">{m.tag}</span>
          {:else}
            {#if m.author}<b>{m.author}</b>{/if}<span class="al-tag">{m.tag}</span>
          {/if}
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
  .al-kind {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 1px 4px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .al-kind.anl {
    color: var(--analytic, #2e7d32);
    background: color-mix(in srgb, var(--analytic, #2e7d32) 16%, transparent);
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
  .chip-CARD { background: #2e8b57; }
  .chip-TAG { background: #2e8b57; } /* legacy saved cells */
  .chip-ANL { background: #b8860b; }
  /* ---- multi-item cells (cards + responses) ---- */
  .items-bar {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .items-bar .items-clear {
    margin-right: 6px;
    padding: 1px 5px;
    background: transparent;
    border: none;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dim);
    cursor: pointer;
    opacity: 0;
  }
  .cell:hover .items-bar .items-clear {
    opacity: 1;
  }
  .items-bar .items-clear:hover {
    color: var(--mark-dropped, #c0392b);
    background: color-mix(in srgb, var(--mark-dropped, #c0392b) 12%, transparent);
  }
  .items-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 0 2px 7px;
    padding: 1px 5px;
    background: transparent;
    border: none;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-dim);
    cursor: pointer;
  }
  .items-toggle:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
  }
  .items-toggle .tw {
    font-size: 8px;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0 6px 5px 10px;
  }
  /* Thin hover strip between items — click to insert a response at that spot. */
  .item-gap {
    position: relative;
    height: 4px;
    margin: 0;
    padding: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .item-gap .gap-plus {
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    color: #fff;
    background: var(--accent);
    border-radius: 50%;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.6);
    transition: opacity 0.08s, transform 0.08s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    z-index: 3;
  }
  .item-gap::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
    opacity: 0;
    transition: opacity 0.08s;
  }
  .item-gap:hover .gap-plus {
    opacity: 1;
    transform: scale(1);
  }
  .item-gap:hover::before {
    opacity: 0.5;
  }
  .item {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    padding: 2px 4px;
    border-radius: 4px;
    border-left: 2px solid color-mix(in srgb, var(--card) 55%, transparent);
    background: color-mix(in srgb, var(--card) 7%, transparent);
  }
  .item.response {
    border-left-color: color-mix(in srgb, var(--accent) 60%, transparent);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }
  .item-chip {
    flex-shrink: 0;
    margin-top: 1px;
    font-size: 7px;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: #fff;
    border-radius: 3px;
    padding: 0 3px;
    line-height: 1.6;
    user-select: none;
    -webkit-user-select: none;
  }
  .item-text {
    flex: 1;
    outline: none;
    font-size: calc(var(--cell-size, 13px) - 1px);
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
    min-width: 0;
  }
  .item-text.editable:empty::before {
    content: attr(data-ph);
    color: var(--text-dim);
    opacity: 0.6;
    font-style: italic;
  }
  .item-del {
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
    opacity: 0;
  }
  .item:hover .item-del {
    opacity: 1;
  }
  .item-del:hover {
    color: var(--mark-dropped, #c0392b);
  }
  .item-add {
    align-self: flex-start;
    margin-top: 1px;
    padding: 1px 6px;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 4px;
    font-size: 10px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .item-add:hover {
    color: var(--text);
    border-color: var(--accent);
  }
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
  /* Analytic / card cells get a colored LEFT bar (like the dropped/starred
     markers) instead of recoloring the tag text, so the side ink stays. */
  .cell.analytic {
    box-shadow: inset 3px 0 0 var(--analytic);
  }
  .cell.card {
    box-shadow: inset 3px 0 0 var(--card);
  }
  /* Also starred → evidence bar stays left, star bar moves right so both show. */
  .cell.analytic.starred {
    box-shadow: inset 3px 0 0 var(--analytic), inset -3px 0 0 var(--mark-star);
  }
  .cell.card.starred {
    box-shadow: inset 3px 0 0 var(--card), inset -3px 0 0 var(--mark-star);
  }
</style>
