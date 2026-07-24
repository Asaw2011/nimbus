// Reactive round store (Svelte 5 runes) with snapshot-based undo/redo and
// debounced persistence. All mutations go through `mutate()` so history and
// autosave can never be bypassed.

import type { ArgRef, Cell, CellItem, Round, Sheet, SpeechTemplate } from "./types";
import { INITIAL_ROWS, defaultStartCol, makeRow, makeSheet, uid } from "./types";
import { saveRound } from "./persist";

const HISTORY_LIMIT = 300;
const SAVE_DEBOUNCE_MS = 400;

/** Grid cursor within the active sheet. */
export interface Cursor {
  row: number;
  col: number;
}

class RoundStore {
  round = $state<Round | null>(null);
  activeSheetId = $state<string | null>(null);
  cursor = $state<Cursor | null>(null);
  /** Which surface was focused last — so the ribbon's text controls act on the
   *  flow grid or the speech doc, whichever you were just editing. */
  activeSurface = $state<"flow" | "doc">("flow");
  /** Font size (pt) of the doc's current selection — shown in the ribbon while
   *  the doc is the active surface. Updated by SpeechDoc. */
  docSelSize = $state(11);
  /** Excel-style range selection on the active sheet (anchor→focus corners). */
  selection = $state<{ anchor: Cursor; focus: Cursor } | null>(null);

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a text-edit session is coalescing keystrokes into one undo step. */
  private textSessionOpen = false;
  /** True while a batch (macro) runs — inner mutations skip history pushes. */
  private suppressHistory = false;

  // ---- lifecycle ----------------------------------------------------------

  newRound(template: SpeechTemplate, name = "Untitled Round"): void {
    // Rounds start with no sheets: the round home page is the landing view,
    // and pages are created from its buttons (advantages, off-case, etc.).
    const round: Round = {
      id: uid(),
      name,
      tournament: "",
      opponent: "",
      judges: "",
      affTeam: "",
      negTeam: "",
      template,
      sheets: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.round = round;
    this.activeSheetId = null;
    this.cursor = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  loadRound(round: Round): void {
    this.round = round;
    this.activeSheetId = round.sheets[0]?.id ?? null;
    this.cursor = { row: 0, col: 0 };
    this.undoStack = [];
    this.redoStack = [];
  }

  // ---- mutation core ------------------------------------------------------

  /**
   * Run a mutation with history + autosave. `coalesceText` keeps consecutive
   * typing in one undo step instead of one per keystroke.
   */
  mutate(fn: (round: Round) => void, opts?: { coalesceText?: boolean }): void {
    if (!this.round) return;
    const coalesce = opts?.coalesceText ?? false;
    if (!this.suppressHistory && (!coalesce || !this.textSessionOpen)) {
      this.pushHistory();
    }
    if (!this.suppressHistory) this.textSessionOpen = coalesce;
    fn(this.round);
    this.round.updatedAt = Date.now();
    this.scheduleSave();
  }

  /** Call when focus leaves a cell so the next keystroke starts a new undo step. */
  endTextSession(): void {
    this.textSessionOpen = false;
  }

  /**
   * Apply a remote partner's change: no history push (their edits shouldn't
   * enter your undo stack as separate steps), still autosaves.
   */
  applyRemote(fn: (round: Round) => void): void {
    if (!this.round) return;
    this.suppressHistory = true;
    try {
      fn(this.round);
    } finally {
      this.suppressHistory = false;
    }
    this.round.updatedAt = Date.now();
    this.scheduleSave();
  }

  /** Run several mutations (e.g. a macro) as one undo step. */
  runBatch(fn: () => void): void {
    if (!this.round) return;
    this.textSessionOpen = false;
    this.pushHistory();
    this.suppressHistory = true;
    try {
      fn();
    } finally {
      this.suppressHistory = false;
      this.textSessionOpen = false;
    }
    // A batch used to rely on its inner mutations to schedule the save; some
    // callers mutate the round directly inside fn(), so schedule here too.
    this.scheduleSave();
  }

  private pushHistory(): void {
    if (!this.round) return;
    this.undoStack.push(JSON.stringify(this.round));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    if (!this.round || this.undoStack.length === 0) return;
    this.redoStack.push(JSON.stringify(this.round));
    this.round = JSON.parse(this.undoStack.pop()!);
    this.textSessionOpen = false;
    this.scheduleSave();
  }

  redo(): void {
    if (!this.round || this.redoStack.length === 0) return;
    this.undoStack.push(JSON.stringify(this.round));
    this.round = JSON.parse(this.redoStack.pop()!);
    this.textSessionOpen = false;
    this.scheduleSave();
  }

  /** True whenever there are edits not yet flushed to disk. */
  private dirty = false;

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Write the current round to app-data immediately (e.g. before quitting). */
  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = false;
    if (this.round) await saveRound($state.snapshot(this.round) as Round);
  }

  /** Flush only if there are unsaved edits — cheap to call from a heartbeat
   *  or on window blur / hide / pagehide, so a crash or sleep can't lose work. */
  async autosaveIfDirty(): Promise<void> {
    if (this.dirty && this.round) await this.saveNow();
  }

  // ---- lookup -------------------------------------------------------------

  get activeSheet(): Sheet | null {
    return this.round?.sheets.find((s) => s.id === this.activeSheetId) ?? null;
  }

  get nCols(): number {
    return this.round?.template.speeches.length ?? 0;
  }

  // ---- sheet ops ----------------------------------------------------------

  addSheet(title: string, kind: Sheet["kind"] = "custom"): string {
    const startCol = this.round
      ? defaultStartCol(this.round.template, kind)
      : 0;
    const sheet = makeSheet(title, this.nCols, kind, startCol);
    this.mutate((r) => r.sheets.push(sheet));
    this.activeSheetId = sheet.id;
    this.cursor = { row: 0, col: startCol };
    return sheet.id;
  }

  deleteSheet(sheetId: string): void {
    this.mutate((r) => {
      r.sheets = r.sheets.filter((s) => s.id !== sheetId);
    });
    if (this.activeSheetId === sheetId) {
      this.activeSheetId = this.round?.sheets[0]?.id ?? null;
    }
  }

  renameSheet(sheetId: string, title: string): void {
    this.mutate((r) => {
      const s = r.sheets.find((s) => s.id === sheetId);
      if (s) s.title = title;
    });
  }

  /** Reorder sheets (drag & drop) — the 2AC often answers in a different order than the 1NC read. */
  reorderSheet(sheetId: string, targetIndex: number): void {
    if (!this.round) return;
    const i = this.round.sheets.findIndex((s) => s.id === sheetId);
    const j = Math.max(0, Math.min(this.round.sheets.length - 1, targetIndex));
    if (i < 0 || i === j) return;
    this.mutate((r) => {
      const [s] = r.sheets.splice(i, 1);
      r.sheets.splice(j, 0, s);
    });
  }

  setSheetColor(sheetId: string, color: string | null): void {
    this.mutate((r) => {
      const s = r.sheets.find((s) => s.id === sheetId);
      if (!s) return;
      if (color) s.color = color;
      else delete s.color;
    });
  }

  // ---- grid ops -----------------------------------------------------------

  setCell(row: number, col: number, text: string): void {
    const sheet = this.activeSheet;
    if (!sheet?.rows[row]?.cells[col]) return;
    this.mutate(
      () => {
        const cell = sheet.rows[row].cells[col];
        cell.text = text;
        // A banked author only stays bold while its exact substring survives in
        // the text — edit it away and the bold signal drops with it.
        if (cell.author && !text.includes(cell.author)) delete cell.author;
        // Typing over an inserted card drops its source-type chip + stored card.
        if (!text.trim()) {
          delete cell.chip;
          delete cell.card;
        }
        // LABEL cell: the first cell of the sheet's start column names the
        // sheet, so offs auto-label as you flow the 1NC. The title tracks the
        // cell exactly — clearing the cell clears the name too.
        if (row === 0 && col === sheet.startCol) {
          sheet.title = text.trim();
        }
      },
      { coalesceText: true },
    );
  }

  // ---- argument bank (cards + analytics) ----------------------------------

  /** Bank arguments from an imported doc; dedupe by author+tag. Tags AND
   *  analytics are both banked — each is an argument someone made. */
  addCards(args: ArgRef[]): void {
    if (!this.round || args.length === 0) return;
    const bank = this.round.cards ?? [];
    const key = (c: ArgRef) => (c.author ?? "") + "::" + c.tag;
    const seen = new Set(bank.map(key));
    // Build the new array and assign it back in one go. Pushing onto the
    // captured array reference doesn't update the $state length signal, so the
    // ⌘J bank looked empty after an import even though the flow had the cards.
    const next = [...bank];
    for (const c of args) {
      if (!c.tag?.trim()) continue; // an argument needs text; author is optional
      if (seen.has(key(c))) continue;
      seen.add(key(c));
      next.push(c);
    }
    this.round.cards = next;
    this.scheduleSave();
  }

  /** Banked arguments matching the query by author OR argument text. Empty
   *  query returns the whole bank (so the lookup shows something immediately).
   *  Arguments whose text is already on the active sheet rank first. */
  argMatches(query: string): ArgRef[] {
    const bank = this.round?.cards ?? [];
    const q = query.trim().toLowerCase();
    const hits = q
      ? bank.filter(
          (c) =>
            (c.author ? c.author.toLowerCase().includes(q) : false) ||
            c.tag.toLowerCase().includes(q),
        )
      : bank.slice();
    const sheetText = (this.activeSheet?.rows ?? [])
      .flatMap((r) => r.cells.map((c) => c.text.toLowerCase()))
      .join("   ");
    const onSheet = (c: ArgRef) =>
      sheetText.includes(c.tag.toLowerCase().slice(0, 20));
    return hits
      .sort((a, b) => Number(onSheet(b)) - Number(onSheet(a)))
      .slice(0, 12);
  }

  /**
   * Insert a banked argument into a cell.
   * - Analytic -> its text, marked as an analytic (green ink).
   * - Card, full -> "Author tag"; the author is recorded so it renders bold.
   * - Card, not full -> just the author (bold). Card ink is NOT forced; the
   *   bold author is the "this is a card" signal (keeps the speech side color).
   */
  setCellFromArg(row: number, col: number, arg: ArgRef, full: boolean): void {
    const sheet = this.activeSheet;
    const cell = sheet?.rows[row]?.cells[col];
    if (!cell) return;
    this.mutate(() => {
      if (arg.analytic || !arg.author) {
        cell.text = arg.tag;
        delete cell.author;
        if (arg.analytic) (cell.marks ??= {}).evidence = "analytic";
      } else {
        cell.text = full ? arg.author + " " + arg.tag : arg.author;
        cell.author = arg.author;
      }
      // Carry the full card behind the cell so "Send to Doc" / "Cell → Doc" can
      // send the real substance later. This does NOT auto-add it to the doc.
      if (arg.card) cell.card = arg.card;
      else delete cell.card;
    });
  }

  /** Fill a cell from a quick-card's flow form (a dragged/clicked quick card),
   *  building the SAME structured cell — chip + expandable items — a real card
   *  produces, rather than flat text. */
  setCellFromFlow(
    row: number,
    col: number,
    flow: { header: string; chip?: string; card?: unknown; items?: { text: string; kind: "card" | "response"; chip?: string; card?: unknown }[] },
  ): void {
    const cell = this.cellAt(row, col);
    if (!cell) return;
    this.mutate(() => {
      cell.text = flow.header ?? "";
      if (flow.chip) cell.chip = flow.chip; else delete cell.chip;
      if (flow.card) cell.card = flow.card; else delete cell.card;
      if (flow.items?.length) {
        cell.items = flow.items.map((i) => ({ id: uid(), text: i.text, kind: i.kind, chip: i.chip, card: i.card }));
        cell.expanded = false; // collapsed on insert
      } else {
        delete cell.items;
        delete cell.expanded;
      }
    });
  }

  // ---- multi-item cells (a block's cards + your own responses) -------------

  private cellAt(row: number, col: number): Cell | null {
    return this.activeSheet?.rows[row]?.cells[col] ?? null;
  }

  /** Put a set of sub-items into a cell (from a block insert) and expand it. */
  setCellItems(row: number, col: number, header: string, items: CellItem[]): void {
    const cell = this.cellAt(row, col);
    if (!cell) return;
    this.mutate(() => {
      cell.text = header;
      cell.items = items;
      cell.expanded = false; // drops in collapsed — click ▸ to expand its cards
    });
  }

  /** Insert one sub-item (e.g. a typed response); returns its id. `at` is the
   *  index to insert before — omit (or pass past the end) to append. */
  addCellItem(row: number, col: number, kind: CellItem["kind"], text = "", at?: number): string {
    const cell = this.cellAt(row, col);
    if (!cell) return "";
    const id = uid();
    this.mutate(() => {
      const items = (cell.items ??= []);
      const i = at == null ? items.length : Math.max(0, Math.min(at, items.length));
      items.splice(i, 0, { id, text, kind });
      cell.expanded = true;
    });
    return id;
  }

  updateCellItem(row: number, col: number, id: string, text: string): void {
    const cell = this.cellAt(row, col);
    const item = cell?.items?.find((i) => i.id === id);
    if (!item) return;
    this.mutate(() => { item.text = text; }, { coalesceText: true });
  }

  removeCellItem(row: number, col: number, id: string): void {
    const cell = this.cellAt(row, col);
    if (!cell?.items) return;
    this.mutate(() => {
      cell.items = cell.items!.filter((i) => i.id !== id);
      // Last sub-item gone → this is no longer a card block; shed the block
      // scaffolding (chip/source) so the cell reads as a plain cell again.
      if (cell.items.length === 0) {
        delete cell.items;
        delete cell.expanded;
        delete cell.chip;
        delete cell.card;
      }
    });
  }

  /** Drop the whole card block: sub-items, expand state, chip and source. The
   *  header text stays (clear it separately if you want a fully empty cell). */
  clearCellItems(row: number, col: number): void {
    const cell = this.cellAt(row, col);
    if (!cell?.items) return;
    this.mutate(() => {
      delete cell.items;
      delete cell.expanded;
      delete cell.chip;
      delete cell.card;
    });
  }

  /** Wipe an ENTIRE cell — header text, chip, card, marks, items, everything —
   *  back to a blank cell. */
  clearCell(row: number, col: number): void {
    const cell = this.cellAt(row, col);
    if (!cell) return;
    this.mutate(() => {
      cell.text = "";
      delete cell.items;
      delete cell.expanded;
      delete cell.marks;
      delete cell.ext;
      delete cell.chip;
      delete cell.card;
      delete cell.cmNode;
      delete cell.author;
    });
  }

  toggleCellExpanded(row: number, col: number): void {
    const cell = this.cellAt(row, col);
    if (!cell?.items?.length) return;
    this.mutate(() => { cell.expanded = !cell.expanded; });
  }

  /**
   * Extend argument: arrow from the current cell to the same row in the next
   * speech of the same side (2AC → 1AR, 1NC → Block), cursor follows.
   */
  extendCell(row: number, col: number): void {
    const sheet = this.activeSheet;
    if (!sheet || !this.round) return;
    const speeches = this.round.template.speeches;
    const side = speeches[col]?.side;
    let target = -1;
    for (let j = col + 1; j < speeches.length; j++) {
      if (side === "neutral" || speeches[j].side === side) {
        target = j;
        break;
      }
    }
    if (target < 0) return;
    this.mutate(() => {
      const cell = sheet.rows[row]?.cells[target];
      if (cell) cell.ext = true;
    });
    this.cursor = { row, col: target };
  }

  toggleMark(row: number, col: number, mark: "dropped" | "starred"): void {
    const sheet = this.activeSheet;
    const cell = sheet?.rows[row]?.cells[col];
    if (!cell) return;
    this.mutate(() => {
      const marks = (cell.marks ??= {});
      marks[mark] = !marks[mark];
    });
  }

  /** Tag a cell as analytic or card; same tag again clears it. */
  toggleEvidence(row: number, col: number, kind: "analytic" | "card"): void {
    const sheet = this.activeSheet;
    const cell = sheet?.rows[row]?.cells[col];
    if (!cell) return;
    this.mutate(() => {
      const marks = (cell.marks ??= {});
      marks.evidence = marks.evidence === kind ? undefined : kind;
    });
  }

  /** Insert a blank row; `at` is the new row's index. Shifts rows below down. */
  insertRow(at: number): void {
    const sheet = this.activeSheet;
    if (!sheet) return;
    const row = makeRow(this.nCols);
    this.mutate(() => sheet.rows.splice(at, 0, row));
  }

  deleteRow(at: number): void {
    const sheet = this.activeSheet;
    if (!sheet || sheet.rows.length <= 1) return;
    this.mutate(() => sheet.rows.splice(at, 1));
    if (this.cursor && this.cursor.row >= sheet.rows.length) {
      this.cursor = { row: sheet.rows.length - 1, col: this.cursor.col };
    }
  }

  /** Grow a sheet so `row` exists — paper never runs out. */
  ensureRows(row: number, sheet = this.activeSheet): void {
    if (!sheet || row < sheet.rows.length) return;
    const missing = row - sheet.rows.length + 1;
    const nCols = this.nCols;
    // Not undoable on purpose: growing blank paper isn't an edit.
    sheet.rows.push(...Array.from({ length: missing }, () => makeRow(nCols)));
    this.scheduleSave();
  }

  // ---- range selection ----------------------------------------------------

  /** Normalized selection rectangle, or null. */
  get selRect(): { r0: number; r1: number; c0: number; c1: number } | null {
    const s = this.selection;
    if (!s) return null;
    return {
      r0: Math.min(s.anchor.row, s.focus.row),
      r1: Math.max(s.anchor.row, s.focus.row),
      c0: Math.min(s.anchor.col, s.focus.col),
      c1: Math.max(s.anchor.col, s.focus.col),
    };
  }

  get hasMultiSelection(): boolean {
    const r = this.selRect;
    return r !== null && (r.r0 !== r.r1 || r.c0 !== r.c1);
  }

  inSelection(row: number, col: number): boolean {
    const r = this.selRect;
    return r !== null && row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
  }

  /** Extend the selection focus (shift+arrow / drag). */
  extendSelection(dRow: number, dCol: number): void {
    const sheet = this.activeSheet;
    if (!sheet) return;
    const base = this.selection ?? {
      anchor: this.cursor ?? { row: 0, col: sheet.startCol },
      focus: this.cursor ?? { row: 0, col: sheet.startCol },
    };
    const row = Math.max(0, base.focus.row + dRow);
    const col = Math.max(
      sheet.startCol,
      Math.min(this.nCols - 1, base.focus.col + dCol),
    );
    this.ensureRows(row, sheet);
    this.selection = { anchor: base.anchor, focus: { row, col } };
  }

  /** Run a callback on every selected cell, as one undo step. */
  applyToSelection(fn: (cell: Round["sheets"][number]["rows"][number]["cells"][number]) => void): void {
    const sheet = this.activeSheet;
    const rect = this.selRect;
    if (!sheet || !rect) return;
    this.mutate(() => {
      for (let r = rect.r0; r <= Math.min(rect.r1, sheet.rows.length - 1); r++) {
        for (let c = rect.c0; c <= rect.c1; c++) {
          const cell = sheet.rows[r]?.cells[c];
          if (cell) fn(cell);
        }
      }
    });
  }

  /** Apply to the multi-selection if there is one, else the cursor cell. */
  applyToTargets(
    fn: (cell: Round["sheets"][number]["rows"][number]["cells"][number]) => void,
  ): void {
    if (this.hasMultiSelection) {
      this.applyToSelection(fn);
      return;
    }
    const sheet = this.activeSheet;
    const cur = this.cursor;
    const cell = cur && sheet?.rows[cur.row]?.cells[cur.col];
    if (cell) this.mutate(() => fn(cell));
  }

  /** Clear text + marks of all selected cells (Excel Delete). */
  clearSelectedCells(): void {
    this.applyToSelection((cell) => {
      cell.text = "";
      delete cell.marks;
      delete cell.ext;
      delete cell.chip;
      delete cell.card;
      // Also wipe imported block contents (cards/responses), not just the header.
      delete cell.items;
      delete cell.expanded;
      delete cell.cmNode;
      delete cell.author;
    });
  }

  /**
   * Paste a 2D block of text starting at (startRow, startCol), spreading into
   * cells to the right and down like Excel. Grows rows as needed; never spills
   * past the last speech column. One undo step. Returns the block's extent.
   */
  pasteBlock(startRow: number, startCol: number, rows: string[][]): void {
    const sheet = this.activeSheet;
    if (!sheet || rows.length === 0) return;
    const nCols = this.nCols;
    this.runBatch(() => {
      rows.forEach((cols, r) => {
        const tr = startRow + r;
        this.ensureRows(tr, sheet);
        cols.forEach((text, c) => {
          const tc = startCol + c;
          if (tc >= nCols) return; // don't overflow past the last speech column
          const cell = sheet.rows[tr]?.cells[tc];
          if (cell) cell.text = text;
        });
      });
    });
    // Select the pasted block so it reads like Excel.
    const lastRow = startRow + rows.length - 1;
    const lastCol = Math.min(
      nCols - 1,
      startCol + Math.max(...rows.map((r) => r.length)) - 1,
    );
    this.selection = {
      anchor: { row: startRow, col: startCol },
      focus: { row: lastRow, col: lastCol },
    };
    this.cursor = { row: startRow, col: startCol };
  }

  /** Selected block as TSV for the clipboard. */
  selectionTsv(): string {
    const sheet = this.activeSheet;
    const rect = this.selRect;
    if (!sheet || !rect) return "";
    const lines: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const cols: string[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) {
        cols.push(sheet.rows[r]?.cells[c]?.text ?? "");
      }
      lines.push(cols.join("\t"));
    }
    return lines.join("\n");
  }

  /** Drag-move the selected block by a row/col offset (Excel drag). */
  moveSelection(dRow: number, dCol: number): void {
    const sheet = this.activeSheet;
    const rect = this.selRect;
    if (!sheet || !rect) return;
    const minCol = sheet.startCol;
    dCol = Math.max(minCol - rect.c0, Math.min(this.nCols - 1 - rect.c1, dCol));
    dRow = Math.max(-rect.r0, dRow);
    if (dRow === 0 && dCol === 0) return;
    this.runBatch(() => {
      this.ensureRows(rect.r1 + dRow, sheet);
      // Lift the block, clear the source, drop at the offset.
      const block = new Map<string, Round["sheets"][number]["rows"][number]["cells"][number]>();
      for (let r = rect.r0; r <= rect.r1; r++) {
        for (let c = rect.c0; c <= rect.c1; c++) {
          const cell = sheet.rows[r]?.cells[c];
          if (cell) {
            block.set(`${r - rect.r0}:${c - rect.c0}`, structuredClone($state.snapshot(cell)));
            cell.text = "";
            delete cell.marks;
            delete cell.ext;
          }
        }
      }
      for (const [key, cell] of block) {
        const [dr, dc] = key.split(":").map(Number);
        const target = sheet.rows[rect.r0 + dRow + dr]?.cells[rect.c0 + dCol + dc];
        if (target) {
          target.text = cell.text;
          if (cell.marks) {
            // Drop the custom per-cell ink so the cell takes the destination
            // column's aff/neg color. Card/analytic + dropped/star marks carry.
            delete cell.marks.color;
            target.marks = cell.marks;
          } else delete target.marks;
          if (cell.ext) target.ext = cell.ext;
          else delete target.ext;
        }
      }
    });
    this.selection = {
      anchor: { row: rect.r0 + dRow, col: rect.c0 + dCol },
      focus: { row: rect.r1 + dRow, col: rect.c1 + dCol },
    };
    this.cursor = { row: rect.r0 + dRow, col: rect.c0 + dCol };
  }

  /** Move the cursor, clamped to the sheet's visible columns; grows rows on demand. */
  moveCursor(dRow: number, dCol: number): void {
    const sheet = this.activeSheet;
    if (!sheet || !this.cursor) return;
    const minCol = sheet.startCol;
    const col = Math.max(
      minCol,
      Math.min(this.nCols - 1, this.cursor.col + dCol),
    );
    const row = Math.max(0, this.cursor.row + dRow);
    this.ensureRows(row);
    this.cursor = { row, col };
  }
}

/** Normalize saves from older app versions (missing fields, tree model). */
export function migrateLegacyRound(raw: Record<string, unknown>): Round {
  const round = raw as unknown as Round;
  round.judges ??= "";
  round.affTeam ??= "";
  round.negTeam ??= "";
  for (const s of round.sheets) s.startCol ??= 0;
  const legacySheets = round.sheets as unknown as Array<
    Sheet & { roots?: LegacyCell[] }
  >;
  if (!legacySheets.some((s) => s.roots)) return round;
  const nCols = round.template.speeches.length;
  round.sheets = legacySheets.map((s) => {
    if (!s.roots) return s;
    const sheet = makeSheet(s.title, nCols, s.kind, 0);
    sheet.id = s.id;
    let next = 0;
    for (const root of s.roots) {
      next = placeLegacy(sheet, root, next, nCols) + 1;
    }
    while (sheet.rows.length < INITIAL_ROWS) sheet.rows.push(makeRow(nCols));
    return sheet;
  });
  return round;
}

interface LegacyCell {
  text: string;
  column: number;
  children: LegacyCell[];
  marks?: Round["sheets"][number]["rows"][number]["cells"][number]["marks"];
}

function placeLegacy(
  sheet: Sheet,
  cell: LegacyCell,
  rowIdx: number,
  nCols: number,
): number {
  while (sheet.rows.length <= rowIdx) sheet.rows.push(makeRow(nCols));
  const col = Math.min(cell.column, nCols - 1);
  sheet.rows[rowIdx].cells[col] = { text: cell.text, marks: cell.marks };
  let last = rowIdx;
  cell.children.forEach((child, i) => {
    last = placeLegacy(sheet, child, i === 0 ? rowIdx : last + 1, nCols);
  });
  return last;
}

export const store = new RoundStore();
