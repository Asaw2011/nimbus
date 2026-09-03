<script lang="ts">
  import type { Cell, CellItem } from "../model/types";
  import { store } from "../model/round.svelte";
  import { expand, loadSnippets } from "../model/snippets";
  import { matches, matchesAny } from "../model/keymap";
  import { settings } from "../model/settings.svelte";
  import { runMacro } from "../model/macros";
  import { guard } from "../model/crash";
  import { session } from "../model/session.svelte";

  let {
    cell,
    row,
    col,
    sheetId,
    side = "neutral",
    isLabel = false,
    leftCell = undefined,
    sourceCol = col - 1,
    isLastCol = false,
    dropTarget = false,
  }: {
    cell: Cell;
    row: number;
    col: number;
    sheetId: string;
    side?: "aff" | "neg" | "neutral";
    isLabel?: boolean;
    /** The cell whose expanded block this column answers — so its per-part
     *  responses can render in THIS column, lined up with it. Normally the cell
     *  immediately to the left. */
    leftCell?: Cell;
    /** Which column `leftCell` came from. Responses are stored on that cell's
     *  items, so every write has to name it: on a partner lane it is NOT
     *  `col - 1`, which would write into your partner's lane instead. */
    sourceCol?: number;
    /** No column to the right — a block here shows its responses inline. */
    isLastCol?: boolean;
    dropTarget?: boolean;
  } = $props();

  /** The left neighbor when it's an expanded block — its parts' responses render
   *  here (the opponent's answers sit in the next column, next to the block). */
  const leftBlock = $derived(
    leftCell && leftCell.items?.length && leftCell.expanded ? leftCell : null,
  );
  /** A block renders its own responses inline (under its parts) only when there
   *  is no next column to push them into. */
  const ownResponsesInline = $derived(isLastCol);

  /** True when your partner's cursor is sitting on THIS cell, on the document
   *  and sheet you're actually looking at. */
  const peerHere = $derived.by(() => {
    const pc = session.peerCursor;
    if (!pc || !session.peerOnline) return false;
    return (
      pc.doc === store.round?.id &&
      pc.sheet === sheetId &&
      pc.row === row &&
      pc.col === col
    );
  });

  /** The argument this cell was explicitly linked to answer, if any — shown as
   *  a small tag so you can see what the doc will write "AT:" against without
   *  sending anything. Empty when the source cell is blank. */
  const replyLabel = $derived.by(() => {
    const id = cell.repliesTo;
    if (!id) return "";
    const speeches = store.round?.template.speeches ?? [];
    const c = speeches.findIndex((s) => s.id === id);
    if (c < 0) return "";
    const sheet = store.round?.sheets.find((s) => s.id === sheetId);
    const src = sheet?.rows[row]?.cells[c];
    return src?.text?.trim() || "";
  });

  /** Short label for a part, so a response in the next column shows what it answers. */
  function shortPart(text: string): string {
    const t = (text ?? "").trim();
    const num = t.match(/^\s*(\d+[.)]|[A-Za-z][.)])/);
    if (num) return num[1];
    return t.length > 16 ? t.slice(0, 15) + "…" : t;
  }

  function addLeftResponse(itemId: string) {
    const idx = store.addItemResponse(row, sourceCol, itemId);
    if (idx >= 0) pendingResp = `${itemId}:${idx}`;
  }

  /** Enter in a next-column response box jumps to the next part's response
   *  (creating one if that part has none), so you flow straight down the block. */
  function mirrorEnter(currentItemId: string) {
    const parts = (leftBlock?.items ?? []).filter((i) => i.kind === "card");
    const next = parts[parts.findIndex((i) => i.id === currentItemId) + 1];
    if (!next) return;
    if (!next.responses?.length) {
      addLeftResponse(next.id); // respBox auto-focuses the new box via pendingResp
    } else {
      const key = `${next.id}:0`;
      queueMicrotask(() => {
        const el = document.querySelector(
          `.cell[data-r="${row}"][data-c="${col}"] .ir-text[data-resp="${CSS.escape(key)}"]`,
        ) as HTMLElement | null;
        if (!el) return;
        el.focus();
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      });
    }
  }

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
  /** The cell root, measured to decide which way the ⌘J lookup should open. */
  let cellEl: HTMLDivElement | undefined = $state();

  // Focus whenever the cursor lands on this cell. In "whole-cell selected"
  // state (single click) select all the text so Delete clears it and typing
  // replaces it; otherwise drop the caret at the end (normal editing).
  $effect(() => {
    if (!active || !editor) return;
    // Referenced so the effect re-runs when selection mode flips.
    const whole = store.selectAll;
    guard("GridCell.focus", () => {
      const wasFocused = document.activeElement === editor;
      if (!wasFocused) editor!.focus();
      if (whole) selectAllText();
      else if (!wasFocused) placeCaretAtEnd();
    });
  });

  function selectAllText() {
    if (!editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // ---- argument lookup dropdown (⌘J): banked cards + analytics ----
  /** Must track `.author-lookup { max-height }` in this file's CSS. */
  const LOOKUP_MAX_H = 240;
  let lookupOpen = $state(false);
  let lookupQuery = $state("");
  let lookupSel = $state(0);
  /** Cell text at the moment the bank opened — stripped from the query so the
   *  lookup only matches what you type AFTER opening, not the whole cell. */
  let lookupBase = "";
  const lookupMatches = $derived(lookupOpen ? store.argMatches(lookupQuery) : []);
  /** The dropdown element, for keeping the highlighted row in view. */
  let lookupEl = $state<HTMLElement | null>(null);
  /** True when the list is rendered ABOVE the cell instead of below it. */
  let lookupUp = $state(false);

  // Arrowing through a long bank must drag the list along with the selection —
  // the list is only ~240px tall, so without this the highlight walks off the
  // bottom and everything past the first few matches is unreachable.
  $effect(() => {
    if (!lookupOpen) return;
    void lookupSel;
    lookupEl?.querySelector<HTMLElement>(".al-item.sel")?.scrollIntoView({ block: "nearest" });
  });

  function openLookup() {
    // Only match what you type AFTER opening — not the text already in the cell.
    // No normalization needed: oninput no longer rewrites "---", so the cell
    // text stays byte-identical to this base across the first keystroke. (This
    // used to mirror that conversion, otherwise the first key made the text
    // stop matching the base and the whole cell became the query.)
    lookupBase = editor?.textContent ?? "";
    lookupQuery = "";
    lookupSel = 0;
    // Open upward when the cell sits low in the grid viewport, or the list opens
    // downward past the bottom edge and its lower half is clipped away. Measured
    // against the scroller, not the window, since the grid is the clipping box.
    const cellBox = cellEl?.getBoundingClientRect();
    if (cellBox) {
      const box = (cellEl?.closest(".grid-scroll") as HTMLElement | null)?.getBoundingClientRect();
      const below = (box?.bottom ?? window.innerHeight) - cellBox.bottom;
      const above = cellBox.top - (box?.top ?? 0);
      lookupUp = below < LOOKUP_MAX_H && above > below;
    } else {
      lookupUp = false;
    }
    lookupOpen = true;
  }
  function closeLookup() {
    lookupOpen = false;
  }
  /** full = Tab (card → author + tag); !full = Enter (card → author only).
   *  Analytics ignore `full` and insert their text either way. */
  function chooseLookup(full: boolean) {
    const m = lookupMatches[lookupSel];
    lookupOpen = false;
    if (!m) return;
    store.setCellFromArg(row, col, m, full, lookupBase);
    // The editor is still focused and shows whatever query you typed. The
    // reactive paint deliberately never overwrites a focused, non-empty editor
    // (to avoid caret jumps mid-typing), so without an explicit repaint the
    // inserted card would be invisible — and the next keystroke would write the
    // stale query back over it. Repaint from the just-updated cell directly.
    setTimeout(() => {
      if (!editor) return;
      paint();
      editor.focus();
      placeCaretAtEnd();
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

  /** Caret position as a character offset into the editor's plain text. Same
   *  range-probe technique `caretAt` uses. */
  function caretOffset(): number {
    if (!editor) return 0;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const r = sel.getRangeAt(0);
    const probe = document.createRange();
    probe.selectNodeContents(editor);
    probe.setEnd(r.startContainer, r.startOffset);
    return probe.toString().length;
  }

  /** Put the caret at a character offset. Only ever called right after
   *  `editor.textContent = …`, which leaves exactly one text node (or none). */
  function placeCaretAt(offset: number) {
    if (!editor) return;
    const node = editor.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) { placeCaretAtEnd(); return; }
    const range = document.createRange();
    range.setStart(node, Math.max(0, Math.min(offset, node.nodeValue?.length ?? 0)));
    range.collapse(true);
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
    // Typing means we're editing, not sitting on a whole-cell selection.
    if (store.selectAll) store.selectAll = false;
    const raw = editor.textContent ?? "";
    const at = caretOffset();
    const expanded = expand(raw, loadSnippets());
    // NOTE: "---" is deliberately left alone (it used to collapse to an em
    // dash). It's the Verbatim separator debate tags are written in — 1NC---K,
    // OFF---PTX — and docx/parse.ts keys off it, so converting it broke
    // round-tripping. Snippet expansion is now the only rewrite here.
    let text = expanded ?? raw;
    if (text !== raw) {
      editor.textContent = text;
      // Keep the caret where the rewrite happened, shifted by the length the
      // rewrite added/removed. It used to jump to the end of the cell, which
      // teleported you out of the middle of a tag on every snippet expansion
      // and every "---" — and in a wrapped cell that reads as "it moved me to
      // the next line". Both rewrites land at the caret, so one delta is right.
      placeCaretAt(at - (raw.length - text.length));
    }
    store.setCell(row, col, text);
    if (lookupOpen) {
      // Query = only the text typed since the bank opened (see openLookup).
      lookupQuery = (text.startsWith(lookupBase) ? text.slice(lookupBase.length) : text).trim();
      lookupSel = 0;
    }
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
    } else if (matchesAny(e, km.jumpFilledUp)) {
      e.preventDefault();
      store.jumpToFilled(-1);
    } else if (matchesAny(e, km.jumpFilledDown)) {
      e.preventDefault();
      store.jumpToFilled(1);
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
    } else if (matchesAny(e, km.clearCell)) {
      // Wipe just this cell, leaving the row (and every other speech's cell on
      // it) alone. Only reached with a single cell focused: on a multi-cell
      // selection the editor is blurred and Grid.onSelectionKeys handles it,
      // clearing the whole selection instead — which is what you'd want there.
      e.preventDefault();
      store.clearCell(row, col);
    } else if (matchesAny(e, km.extendArg)) {
      e.preventDefault();
      store.extendCell(row, col);
    } else if (matchesAny(e, km.replyToArg)) {
      e.preventDefault();
      store.replyToCell(row, col);
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

  // ---- per-item responses (answer each part of a block individually) --------
  /** Total responses across all sub-items — shown as a badge, and the "hidden"
   *  cue when the block is collapsed. */
  const respCount = $derived(
    cell.items?.reduce((n, it) => n + (it.responses?.length ?? 0), 0) ?? 0,
  );

  let pendingResp = $state<string | null>(null); // `${itemId}:${idx}` to auto-focus

  function addItemResponse(itemId: string) {
    const idx = store.addItemResponse(row, col, itemId);
    if (idx >= 0) pendingResp = `${itemId}:${idx}`;
  }

  /** Set a response box's text once; repaint on external change while unfocused;
   *  auto-focus a freshly added one. */
  function respBox(node: HTMLElement, arg: { text: string; key: string }) {
    node.textContent = arg.text;
    if (pendingResp === arg.key) {
      pendingResp = null;
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
      update(next: { text: string; key: string }) {
        if (document.activeElement !== node && node.textContent !== next.text) {
          node.textContent = next.text;
        }
      },
    };
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
    if (t.closest(".editor, .item-text.editable, .item-del, .item-add, .items-toggle, .items-clear, .item-gap, .author-lookup, .ir-text, .ir-del, .ir-add")) return;
    // Dead-space click: honor the same select-first rule as a click on the cell.
    editor.focus();
    if (active && store.selectAll) selectAllText();
    else placeCaretAtEnd();
  }

  /**
   * Excel-style click model. First click on a cell selects the whole cell
   * (Delete clears it, typing replaces it); a second click on the already-
   * selected cell drops the caret in to edit. Keyboard navigation is
   * unaffected — it always lands in caret-edit mode.
   */
  function onCellMouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.shiftKey) return; // Grid handles shift / drag-select
    if (active && !store.selectAll) return; // already caret-editing: normal click
    if (active && store.selectAll) {
      // Second click on the selected cell → caret editing; let the browser
      // place the caret where you clicked.
      store.selectAll = false;
      return;
    }
    // First click on a new cell → select the whole cell. preventDefault blocks
    // the native caret; the focus effect focuses + selects all the text.
    e.preventDefault();
    store.activeSheetId = sheetId;
    store.cursor = { row, col };
    store.activeSurface = "flow";
    store.selection = null;
    store.selectAll = true;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={cellEl}
  class="cell"
  onclick={onCellClick}
  onmousedown={onCellMouseDown}
  class:active
  class:selecting={active && store.selectAll}
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
  {#if peerHere}
    <!-- The OUTLINE is the indicator; this is only a label for it.
         Parked, it is a dot — the name isn't what you need to know, the
         position is, and a word sitting in the corner of a cell you're reading
         is just clutter. It grows into "Partner" while they're actually
         typing, when knowing who is writing is worth the corner. Never
         reserves height, never takes pointer events. -->
    <span class="peer-tag" class:typing={session.peerCursor?.typing}>
      {#if session.peerCursor?.typing}Partner{/if}
    </span>
  {/if}
  {#if replyLabel}
    <span class="reply-tag" title="Answers “{replyLabel}” — this is the argument the speech doc will head with “AT: …”">↩ {shortPart(replyLabel)}</span>
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
        {#if respCount > 0}<span class="resp-badge" title="{respCount} response{respCount === 1 ? '' : 's'}{cell.expanded ? '' : ' — expand to see them'}">· {respCount} resp</span>{/if}
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
          {#if it.kind === "card" && ownResponsesInline}
            <div class="item-responses">
              {#each it.responses ?? [] as resp, ri (ri)}
                <div class="item-response">
                  <span class="ir-arrow">↳</span>
                  <div
                    class="ir-text"
                    contenteditable="true"
                    role="textbox"
                    tabindex="0"
                    spellcheck="false"
                    data-ph="response…"
                    use:respBox={{ text: resp, key: `${it.id}:${ri}` }}
                    oninput={(e) => store.updateItemResponse(row, col, it.id, ri, (e.currentTarget as HTMLElement).textContent ?? "")}
                    onfocus={onfocus}
                    onblur={() => store.endTextSession()}
                  ></div>
                  <button
                    class="ir-del"
                    title="Remove response"
                    onmousedown={(e) => e.preventDefault()}
                    onclick={() => store.removeItemResponse(row, col, it.id, ri)}
                  >×</button>
                </div>
              {/each}
              <button
                class="ir-add"
                title="Respond to this part"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => addItemResponse(it.id)}
              >+ respond</button>
            </div>
          {/if}
        {/each}
        <button
          class="item-add"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => addResponse()}
        >+ response</button>
      </div>
    {/if}
    {#if !cell.expanded && respCount > 0}
      <div class="collapsed-responses" title="Responses (expand to edit; they move to the next column)">
        {#each cell.items as it (it.id)}
          {#if it.kind === "card" && it.responses?.length}
            <div class="cr-group">
              <span class="cr-part">{shortPart(it.text)}</span>
              {#each it.responses as resp, ri (ri)}
                <span class="cr-text">↳ {resp || "…"}</span>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
  {#if leftBlock}
    <div class="block-answers">
      {#each leftBlock.items ?? [] as lit (lit.id)}
        {#if lit.kind === "card"}
          <div class="ba-row">
            <span class="ba-part" title={lit.text}>{shortPart(lit.text)}</span>
            <div class="ba-resps">
              {#each lit.responses ?? [] as resp, ri (ri)}
                <div class="item-response">
                  <span class="ir-arrow">↳</span>
                  <div
                    class="ir-text"
                    contenteditable="true"
                    role="textbox"
                    tabindex="0"
                    spellcheck="false"
                    data-ph="response…"
                    data-resp={`${lit.id}:${ri}`}
                    use:respBox={{ text: resp, key: `${lit.id}:${ri}` }}
                    oninput={(e) => store.updateItemResponse(row, sourceCol, lit.id, ri, (e.currentTarget as HTMLElement).textContent ?? "")}
                    onkeydown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); mirrorEnter(lit.id); } }}
                    onfocus={onfocus}
                    onblur={() => store.endTextSession()}
                  ></div>
                  <button
                    class="ir-del"
                    title="Remove response"
                    onmousedown={(e) => e.preventDefault()}
                    onclick={() => store.removeItemResponse(row, sourceCol, lit.id, ri)}
                  >×</button>
                </div>
              {/each}
              <button
                class="ir-add"
                title="Respond to this part"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => addLeftResponse(lit.id)}
              >+ respond</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
  {#if lookupOpen}
    <div
      class="author-lookup"
      class:up={lookupUp}
      role="listbox"
      bind:this={lookupEl}
      onwheel={(e) => e.stopPropagation()}
    >
      <div class="al-hint">↵ author · ⇥ author + tag · esc</div>
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
  /* Cell sits low in the grid — hang the list off the cell's top edge instead
     (see openLookup; the 240px threshold there is this block's max-height). */
  .author-lookup.up {
    top: auto;
    bottom: 100%;
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
  /* The tag needs its own strip: floating it over the cell put it straight on
     top of the text on a single-line row (measured — an 11px tag at y=16 in a
     28px cell whose text ran to y=26). Reserve the height instead. */
  .cell:has(.reply-tag) {
    padding-bottom: 14px;
  }
  /* Partner presence. A distinct hue on purpose: aff is blue, neg is red, the
     accent is the app's own, and a marker that borrowed any of those would
     read as a property of the argument rather than as a person. */
  .cell:has(.peer-tag) {
    box-shadow: inset 0 0 0 2px var(--peer, #8b5cf6);
    border-radius: 2px;
  }
  .peer-tag {
    position: absolute;
    right: 2px;
    bottom: 2px;
    z-index: 3;
    /* Parked: a 7px dot in the corner. Small enough that it cannot obscure a
       cell you are trying to read, which was the whole requirement. */
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--peer, #8b5cf6);
    opacity: 0.7;
    pointer-events: none;
    user-select: none;
  }
  /* Writing: grow into a name. Worth the corner only while it is live. */
  .peer-tag.typing {
    width: auto;
    height: auto;
    border-radius: 3px;
    padding: 1px 3px;
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.02em;
    color: #fff;
    opacity: 0.95;
  }
  .reply-tag {
    position: absolute;
    bottom: 1px;
    left: 4px;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--accent);
    opacity: 0.75;
    pointer-events: none;
    max-width: calc(100% - 10px);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
  /* ---- per-item responses (answer each part of a block) ---- */
  .resp-badge { color: var(--accent); font-weight: 600; margin-left: 3px; }
  .item-responses {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 1px 0 3px 16px;
  }
  .item-response {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 1px 4px;
    border-left: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
    border-radius: 3px;
  }
  .ir-arrow { color: var(--accent); font-size: 11px; line-height: 1.4; flex-shrink: 0; }
  .ir-text {
    flex: 1;
    min-width: 0;
    outline: none;
    font-size: calc(var(--cell-size, 13px) - 1px);
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
  }
  .ir-text:empty::before {
    content: attr(data-ph);
    color: var(--text-dim);
    opacity: 0.6;
    font-style: italic;
  }
  .ir-del {
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
    opacity: 0;
  }
  .item-response:hover .ir-del { opacity: 1; }
  .ir-del:hover { color: var(--mark-dropped, #c0392b); }
  .ir-add {
    align-self: flex-start;
    margin: 0 0 0 16px;
    padding: 0 5px;
    background: transparent;
    border: 1px dashed color-mix(in srgb, var(--accent) 40%, var(--border));
    border-radius: 4px;
    font-size: 9px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .ir-add:hover { color: var(--accent); border-color: var(--accent); }
  /* Collapsed block: responses stay stacked under the header (read-only cue). */
  .collapsed-responses {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 1px 0 3px 16px;
    padding-left: 6px;
    border-left: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .cr-group { display: flex; flex-direction: column; }
  .cr-part { font-size: 9px; font-weight: 700; color: var(--text-dim); letter-spacing: 0.02em; }
  .cr-text {
    font-size: calc(var(--cell-size, 13px) - 2px);
    line-height: 1.25;
    color: color-mix(in srgb, var(--accent) 80%, var(--text));
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Next column: the opponent's per-part answers, lined up next to the block. */
  .block-answers {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 2px 4px 4px;
  }
  .ba-row { display: flex; flex-direction: column; gap: 1px; }
  .ba-part {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: var(--accent);
    text-transform: none;
  }
  .ba-resps { display: flex; flex-direction: column; gap: 1px; padding-left: 4px; }
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
  /* Whole-cell selected (single click): heavier fill + outline so it's clear
     the next Delete/keystroke hits the entire cell, like an Excel selection. */
  .cell.selecting {
    outline: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--cell-bg));
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
  /* Analytic / card evidence shows as a colored bar on the LEFT edge — like the
     starred / dropped markers — instead of recoloring the tag text. Drawn as a
     pseudo-element so it layers cleanly over the dropped/starred box-shadows. */
  .cell.analytic::after,
  .cell.card::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    z-index: 3;
    pointer-events: none;
  }
  .cell.analytic::after {
    background: var(--analytic);
  }
  .cell.card::after {
    background: var(--card);
  }
  /* If an evidence cell is also starred (but not dropped), push the star bar to
     the right edge so the evidence bar (left) and star (right) both stay visible
     — the same left/right split dropped+starred already uses. */
  .cell.analytic.starred:not(.dropped),
  .cell.card.starred:not(.dropped) {
    box-shadow: inset -3px 0 0 var(--mark-star);
  }
</style>
