<script lang="ts">
  import { answerOf, isAnswered, type Cell, type CellItem } from "../model/types";
  import { nodeAuthor, type DocNode } from "../docx/parse";
  import { store, type AnswerRef } from "../model/round.svelte";
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
    blockCell = undefined,
    blockCol = -1,
    firstAnswerCol = false,
    speechId = "",
    isLastCol = false,
    dropTarget = false,
  }: {
    cell: Cell;
    row: number;
    col: number;
    sheetId: string;
    side?: "aff" | "neg" | "neutral";
    isLabel?: boolean;
    /** The open block somewhere to the left whose parts this column carries —
     *  the nearest one, not necessarily the neighbour. Every speech after a
     *  block gets a tile per part, because an answer gets answered too. */
    blockCell?: Cell;
    /** Which column `blockCell` came from. Answers are stored on THAT cell's
     *  items, so every write has to name it. -1 when there is no open block. */
    blockCol?: number;
    /** True on the first column that answers the block — the only one allowed
     *  to absorb a pre-tiles `responses` list, so old text appears once rather
     *  than repeating in every later speech. */
    firstAnswerCol?: boolean;
    /** This column's speech id — the key an answer is stored under, so each
     *  speech (and each partner lane) keeps its own. */
    speechId?: string;
    /** No column to the right — a block here shows its answers inline. */
    isLastCol?: boolean;
    dropTarget?: boolean;
  } = $props();

  /** The open block this column carries the parts of, if any. */
  const leftBlock = $derived(
    blockCell && blockCell.items?.length && blockCell.expanded ? blockCell : null,
  );
  /** A block renders its own answers inline (under its parts) only when there
   *  is no next column to push them into. */
  const ownResponsesInline = $derived(isLastCol);
  /** This cell is an open block, so IT owns the row's tracks — one per part. */
  const ownBlock = $derived(!!cell.items?.length && !!cell.expanded);
  /**
   * Whether to draw answer tiles here.
   *
   * ⚠ Not when this cell is an open block itself. Both sides place their
   * children into the same tracks, so a cell that is simultaneously a block and
   * an answering column would want the same track for its own part 1 and for
   * its tile answering someone else's part 1. Two open blocks in one row is
   * rare; showing no tiles on the second is the graceful version of that
   * collision, and expanding either one alone still works.
   */
  const showTiles = $derived(!!leftBlock && !ownBlock);

  /** Where one part's cell in THIS speech lives, for the store. */
  function refFor(itemId: string, atCol = blockCol, primary = firstAnswerCol) {
    return { row, col: atCol, item: itemId, speech: speechId, primary };
  }

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

  /** A part's answers in SPEAKING order, skipping speeches nobody typed into —
   *  the read-only cue shown under a collapsed block. */
  function answerChain(item: CellItem): { speech: string; text: string }[] {
    const speeches = store.round?.template.speeches ?? [];
    const out: { speech: string; text: string }[] = [];
    for (const sp of speeches) {
      const t = item.answers?.[sp.id]?.text?.trim();
      if (t) out.push({ speech: sp.id, text: t });
    }
    if (out.length) return out;
    // Answers typed before tiles existed belong to no speech in particular.
    return (item.responses ?? [])
      .map((r) => r.trim())
      .filter(Boolean)
      .map((text, i) => ({ speech: `legacy-${i}`, text }));
  }

  /** Enter in an answer tile drops to the next part's tile, so you flow straight
   *  down a block the way you would down a column. Every part has a tile now,
   *  so there is never one to create first. */
  function mirrorEnter(currentItemId: string) {
    // Every part has a tile now, typed ones included, so Enter walks the parts
    // in order rather than skipping the ones you wrote yourself.
    const parts = leftBlock?.items ?? [];
    const next = parts[parts.findIndex((i) => i.id === currentItemId) + 1];
    if (!next) return;
    const key = `tile:${next.id}`;
    queueMicrotask(() => {
      const el = document.querySelector(
        `.cell[data-r="${row}"][data-c="${col}"] .at-text[data-resp="${CSS.escape(key)}"]`,
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

  /**
   * A tile took the caret. The grid cursor still moves to this cell — the tile
   * lives in this column and arrow keys should behave — but `focusedAnswer`
   * records WHICH tile, so the card/analytic actions can act on the tile rather
   * than on the cell around it without touching cell key routing.
   */
  function onTileFocus(itemId: string) {
    store.focusedAnswer = refFor(itemId);
    onfocus();
  }

  /** Same, for a block's own inline tiles in the last column, where the parts
   *  and the tiles live in the SAME cell — so the block column is this one, and
   *  it is the only place the part gets answered. */
  function onOwnTileFocus(itemId: string) {
    store.focusedAnswer = refFor(itemId, col, true);
    onfocus();
  }

  function onTileBlur(itemId: string) {
    store.endTextSession();
    if (
      store.focusedAnswer?.item === itemId &&
      store.focusedAnswer?.speech === speechId
    ) {
      store.focusedAnswer = null;
    }
  }

  /**
   * Keys inside a tile. Enter drops to the next part; the card/analytic and
   * dropped/starred binds mark the TILE, because that is what the caret is in.
   *
   * ⚠ Deliberately no `stopPropagation` — the response boxes this replaces
   * didn't have one either, and the global handler in FlowView doesn't bind any
   * of these, so there is nothing to double-fire. Adding one on a hunch is on
   * the do-not list for exactly this kind of handler.
   */
  /**
   * Insert a blank part into the block, above or below the one this tile
   * answers, and put the caret in the new part's tile IN THIS COLUMN.
   *
   * ⚠ This is the in-block reading of "insert a row", and it is the right one:
   * a part of a block already behaves like a row of its own — every speech
   * carries a cell for it — so the analogue of Ctrl+Enter is another part, not
   * another grid row. Inserting a grid row from here would push a blank line
   * under the entire block instead of under the argument you were answering.
   */
  function insertPart(ref: AnswerRef, below: boolean) {
    const items = leftBlock?.items ?? cell.items ?? [];
    const at = items.findIndex((i) => i.id === ref.item);
    if (at < 0) return;
    const id = store.addCellItem(row, ref.col, "response", "", at + (below ? 1 : 0));
    if (id) pendingResp = `tile:${id}`; // respBox focuses the new tile when it mounts
  }

  function onTileKeydown(ref: AnswerRef, e: KeyboardEvent) {
    const km = settings.keymap;
    if (matchesAny(e, km.insertRowAbove)) {
      e.preventDefault();
      insertPart(ref, false);
    } else if (matchesAny(e, km.insertRowBelow)) {
      e.preventDefault();
      insertPart(ref, true);
    } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      mirrorEnter(ref.item);
    } else if (matchesAny(e, km.markAnalytic)) {
      e.preventDefault();
      store.toggleAnswerEvidence(ref, "analytic");
    } else if (matchesAny(e, km.markCard)) {
      e.preventDefault();
      store.toggleAnswerEvidence(ref, "card");
    } else if (matchesAny(e, km.markDropped)) {
      e.preventDefault();
      store.toggleAnswerMark(ref, "dropped");
    } else if (matchesAny(e, km.markStarred)) {
      e.preventDefault();
      store.toggleAnswerMark(ref, "starred");
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
  /**
   * A part reads like a card in an ordinary cell: author first, in bold, then
   * the tag.
   *
   * ⚠ Only for CARD parts, which are read-only — the author is drawn from the
   * node the part carries and never written into `it.text`, so nothing has to
   * be migrated and nothing can be typed over. A response part is editable, so
   * it stays plain `textContent`; painting markup into a box someone types in
   * is how you lose a caret.
   */
  function paintItem(node: HTMLElement, it: CellItem) {
    const author = it.kind === "card" ? nodeAuthor(it.card as DocNode | undefined) : "";
    if (!author) {
      node.textContent = it.text;
      return;
    }
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    node.innerHTML = `<b class="author">${esc(author)}</b>  ${esc(it.text)}`;
  }

  function itemText(node: HTMLElement, it: CellItem) {
    paintItem(node, it);
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
        if (document.activeElement === node) return;
        // Compare against what the box SHOULD read, author included — comparing
        // to `next.text` alone would repaint on every update once an author is
        // prepended, since the two can never match.
        const author = next.kind === "card" ? nodeAuthor(next.card as DocNode | undefined) : "";
        const want = author ? `${author}  ${next.text}` : next.text;
        if (node.textContent !== want) paintItem(node, next);
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

  // ---- per-part answer tiles (answer each part of a block individually) -----
  /** How many parts of this block have been answered — the badge, and the cue
   *  that there is something to come back to when the block is collapsed.
   *  Counts pre-tiles `responses` too, via `answerOf`. */
  const respCount = $derived(
    cell.items?.reduce((n, it) => n + (isAnswered(it) ? 1 : 0), 0) ?? 0,
  );

  let pendingResp = $state<string | null>(null); // `tile:${itemId}` to auto-focus

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
    const km = settings.keymap;
    // The same row binds a cell has, meaning a part of this block — so the
    // keystroke does the same thing whether you are in the part or in one of
    // the tiles answering it.
    if (matchesAny(e, km.insertRowAbove)) {
      e.preventDefault();
      addResponse(index);
    } else if (matchesAny(e, km.insertRowBelow)) {
      e.preventDefault();
      addResponse(index + 1);
    } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
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
    if (t.closest(".editor, .item-text.editable, .item-del, .item-add, .items-toggle, .items-clear, .item-gap, .author-lookup, .answer-tile")) return;
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
  class:paired={ownBlock || showTiles}
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
  <!-- Everything that isn't a part of a block lives in ONE box, because when a
       block is open the cell lays itself out against the row's tracks and every
       in-flow child takes a track of its own. This is track 1; the parts follow
       it, one per track, so the answering column's tiles can sit level with
       them. The decorations (chip, reply tag, peer tag, ext arrow) are all
       absolutely positioned and so take no track at all. -->
  <div class="cell-head">
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
    {#if !cell.expanded && respCount > 0}
      <!-- Collapsed: the whole chain of answers folds away with the block. This
           is only a cue that there is something there — every speech's answer to
           a part, in order, read-only. Expand to edit them. -->
      <div class="collapsed-responses" title="Answers to this block, by speech (expand to edit)">
        {#each cell.items as it (it.id)}
          {#if isAnswered(it)}
            <div class="cr-group">
              <span class="cr-part">{shortPart(it.text)}</span>
              {#each answerChain(it) as ans (ans.speech)}
                <span class="cr-text">↳ {ans.text}</span>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
  </div>
  {#if cell.items?.length && cell.expanded}
      <div class="items">
        {#each cell.items as it, i (it.id)}
        <!-- One part = one slot = one grid track. The insert strip lives INSIDE
             the slot, pinned to its top edge, rather than sitting between slots
             as its own element: a sibling would claim a track of its own and
             every answer tile would come out one part low. -->
        <div class="item-slot">
          <button
            class="item-gap"
            title="Insert response here"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => addResponse(i)}
            aria-label="Insert response here"
          ><span class="gap-plus">+</span></button>
          <div
            class="item"
            class:response={it.kind === "response"}
            class:analytic={it.chip === "ANL"}
            class:card={it.chip === "CARD"}
          >
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
            <!-- Last column: there is no next column to put the tile in, so it
                 sits under the part instead. Same tile, same storage — only the
                 place it is drawn differs. -->
            {@const ownRef = refFor(it.id, col, true)}
            {@const own = answerOf(it, speechId, true)}
            <div
              class="answer-tile inline"
              class:analytic={own.marks?.evidence === "analytic"}
              class:card={own.marks?.evidence === "card"}
              class:dropped={own.marks?.dropped}
              class:starred={own.marks?.starred}
            >
              <div
                class="at-text"
                class:bold={own.marks?.bold}
                class:italic={own.marks?.italic}
                contenteditable="true"
                role="textbox"
                tabindex="0"
                spellcheck="false"
                data-resp={`tile:${it.id}`}
                style={own.marks?.color ? `color: ${own.marks.color}` : ""}
                use:respBox={{ text: own.text, key: `tile:${it.id}` }}
                oninput={(e) => store.setAnswerText(ownRef, (e.currentTarget as HTMLElement).textContent ?? "")}
                onkeydown={(e) => onTileKeydown(ownRef, e)}
                onfocus={() => onOwnTileFocus(it.id)}
                onblur={() => onTileBlur(it.id)}
              ></div>
            </div>
          {/if}
          </div>
        {/each}
        <button
          class="item-add"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => addResponse()}
        >+ response</button>
      </div>
  {/if}
  {#if showTiles}
    <!-- One tile per part of the block, in that part's own grid track so it
         starts exactly level with it. EVERY speech after the block gets these,
         not just the one that answers it first — an answer gets answered, and
         that gets answered, out to the last speech. A part you have not answered
         still takes its track: the empty tile IS the invitation to answer, and
         dropping it would slide every tile below out of line. -->
    <div class="answers">
      {#each leftBlock?.items ?? [] as lit (lit.id)}
        <!-- ⚠ EVERY part gets a tile, not just the cards. A part you typed
             yourself is still an argument on the flow, and a blank row inserted
             with Ctrl+Enter would otherwise come out unanswerable — a dead row
             nobody could reply to, which is the opposite of what inserting it
             was for. -->
        {@const ref = refFor(lit.id)}
        {@const ans = answerOf(lit, speechId, firstAnswerCol)}
        <div class="answer-slot">
            <div
              class="answer-tile"
              class:analytic={ans.marks?.evidence === "analytic"}
              class:card={ans.marks?.evidence === "card"}
              class:dropped={ans.marks?.dropped}
              class:starred={ans.marks?.starred}
              title={firstAnswerCol ? `Answers “${lit.text}”` : `On “${shortPart(lit.text)}”`}
            >
              <div
                class="at-text"
                class:bold={ans.marks?.bold}
                class:italic={ans.marks?.italic}
                contenteditable="true"
                role="textbox"
                tabindex="0"
                spellcheck="false"
                data-resp={`tile:${lit.id}`}
                style={ans.marks?.color ? `color: ${ans.marks.color}` : ""}
                use:respBox={{ text: ans.text, key: `tile:${lit.id}` }}
                oninput={(e) => store.setAnswerText(ref, (e.currentTarget as HTMLElement).textContent ?? "")}
                onkeydown={(e) => onTileKeydown(ref, e)}
                onfocus={() => onTileFocus(lit.id)}
                onblur={() => onTileBlur(lit.id)}
              ></div>
            </div>
        </div>
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
    /* A row carries one track per part of the widest open block in it (see
       Grid's rowTracks). A cell that isn't laying itself out against those
       tracks spans all of them, which is exactly how it looked when every row
       had a single track. */
    grid-row: 1 / -1;
  }
  /* An open block and the column answering it BOTH map their children onto the
     row's tracks, which is what makes a tile start level with the part it
     answers — no measuring, no height syncing between two sibling components.
     `subgrid` adds no tracks of its own; it borrows the row's. */
  .cell.paired {
    display: grid;
    grid-template-rows: subgrid;
  }
  /* Track 1 on both sides of a pair: the cell's own text and its block bar. */
  .cell-head {
    grid-row: 1;
    min-width: 0;
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
    /* Parts occupy the row's tracks from 2 onward — one each, in order — so the
       answering column can place its tiles into the same ones. The last track
       holds the "+ response" button. */
    display: grid;
    grid-row: 2 / -1;
    grid-template-rows: subgrid;
    gap: 0;
    padding: 0 6px 5px 10px;
  }
  /* One part, one track. The insert strip is pinned inside it rather than
     sitting between slots, where it would take a track of its own. */
  .item-slot {
    position: relative;
    min-width: 0;
  }
  /* Thin hover strip at the top of an item — click to insert a response there. */
  .item-gap {
    position: absolute;
    top: -2px;
    left: 0;
    right: 0;
    z-index: 2;
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
  /* A part of a block, and an answer to one, are ordinary flow cells. Same
     ground, same ink, same card/analytic bar down the left edge, same corner
     chip — the ONLY thing marking them out is a faint halo saying they belong
     to the block above them, and the fact that the block can be folded shut.
     They used to be tinted boxes with their own colour language, which read as
     a different kind of object living inside a cell. */
  .item,
  .answer-tile {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 5px;
    padding: 2px 5px;
    border-radius: 3px;
    background: var(--cell-bg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent);
  }
  /* Evidence reads exactly as it does on a cell: a 3px bar down the left, not
     recoloured text. `.item` takes its kind from the chip the block came in
     with; a tile takes it from its own marks. */
  .item.analytic::after,
  .item.card::after,
  .answer-tile.analytic::after,
  .answer-tile.card::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    border-radius: 3px 0 0 3px;
    z-index: 2;
    pointer-events: none;
  }
  .item.analytic::after,
  .answer-tile.analytic::after { background: var(--analytic); }
  .item.card::after,
  .answer-tile.card::after { background: var(--card); }
  /* In the corner, exactly like a cell's own chip — not inline, where it pushed
     the text in and made a part look like a list entry rather than a cell. */
  .item-chip {
    position: absolute;
    top: 1px;
    right: 2px;
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
  .item-text {
    flex: 1;
    outline: none;
    font-size: var(--cell-size, 13px);
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
    min-width: 0;
  }
  /* The cite author leads a part, bold, the way it does in a cell. */
  .item-text :global(b.author) {
    font-weight: 700;
  }
  /* No placeholder on an empty part — an empty row inside a block reads like any
     other empty cell, which is the whole point of the halo. The rule is gone
     rather than blanked so nothing re-grows a hint here by setting `data-ph`. */
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
  /* ---- per-part answer tiles (answer each part of a block) ---- */
  .resp-badge { color: var(--accent); font-weight: 600; margin-left: 3px; }
  /* The answering column's tiles, one per track of the block beside them. */
  .answers {
    display: grid;
    grid-row: 2 / -1;
    grid-template-rows: subgrid;
    padding: 0 4px 5px;
  }
  /* Present even for an unanswered part: an empty track here is what keeps the
     tile below it level with the part IT answers. */
  .answer-slot {
    min-width: 0;
    display: flex;
    align-items: stretch;
  }
  .answer-tile {
    flex: 1;
    min-width: 0;
    /* Bottom margin ONLY. Consecutive tiles would otherwise sit edge to edge and
       three answers would read as one box; this gutters them. It has to be on
       the bottom — a top margin would push the tile off the top edge of the part
       it answers, which is the one thing the whole layout is for. */
    margin-bottom: 3px;
  }
  /* Last column: no next column to hold the tile, so it sits under its part. */
  .answer-tile.inline {
    margin: 2px 0 0 16px;
  }
  /* Same type as a cell's own editor, so a tile and the cell above it read as
     one surface rather than two sizes of text. */
  .at-text {
    flex: 1;
    min-width: 0;
    outline: none;
    min-height: calc(var(--cell-size, 13px) + 3px);
    font-size: var(--cell-size, 13px);
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
  }
  .at-text.bold { font-weight: 700; }
  .at-text.italic { font-style: italic; }
  /* Dropped / starred keep the cell's own left-and-right split, layered over the
     halo rather than replacing it. */
  .answer-tile.dropped {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent),
      inset 3px 0 0 var(--mark-dropped, #c0392b);
  }
  .answer-tile.starred {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent),
      inset -3px 0 0 var(--mark-star);
  }
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
  /* Parts and answer tiles take the column's ink too — a 2AC tile is 2AC text,
     the same as anything else typed in that column. */
  .cell.aff .editor,
  .cell.aff .item-text,
  .cell.aff .at-text {
    color: color-mix(in srgb, var(--aff) 80%, var(--text));
  }
  .cell.neg .editor,
  .cell.neg .item-text,
  .cell.neg .at-text {
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
