// Reactive round store (Svelte 5 runes) with snapshot-based undo/redo and
// debounced persistence. All mutations go through `mutate()` so history and
// autosave can never be bypassed.

import type { ArgRef, Cell, CellItem, Round, Sheet, Side, SpeechTemplate } from "./types";
import { INITIAL_ROWS, defaultStartCol, makeRow, makeSheet, uid } from "./types";
import { saveRoundJson } from "./persist";

const HISTORY_LIMIT = 300;
const SAVE_DEBOUNCE_MS = 400;

/** Grid cursor within the active sheet. */
export interface Cursor {
  row: number;
  col: number;
}

/** A document's parked view state and history while another is on screen. */
interface DocCtx {
  undo: string[];
  redo: string[];
  cursor: Cursor | null;
  activeSheetId: string | null;
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
  /**
   * Excel-style "the whole cell is selected" state: true right after a single
   * click on a cell, so Delete clears it and typing replaces it. A second click
   * (or typing) drops into caret editing. Cleared by keyboard navigation.
   */
  selectAll = $state(false);
  /** Excel-style range selection on the active sheet (anchor→focus corners). */
  selection = $state<{ anchor: Cursor; focus: Cursor } | null>(null);
  /**
   * Which partner lane is yours on a split speech. Always 0 while flowing
   * solo — you own the flow, so you own the first lane. A live partner session
   * sets it to 1 on the client that joined.
   */
  myLane = $state(0);
  /**
   * Other rounds open at the same time — your partner's flow in a
   * separate-flows session. Only {@link round} is rendered; a mirror becomes
   * the rendered one via {@link switchDoc}, which swaps them over.
   */
  mirrors = $state<Round[]>([]);
  /**
   * Ids of rounds you do NOT own.
   *
   * ⚠ Load-bearing. A foreign round must never be written to a file path on
   * this machine — that is how one client ends up autosaving another's flow
   * over its own file, which is the 2026-08-24 shape. `autosaveToFile` refuses
   * on this, on top of the fact that a mirror carries no `filePath`.
   */
  private foreign = new Set<string>();
  /**
   * Per-round view state and history. Undo stacks are per DOCUMENT: sharing one
   * stack across two open flows would let an undo on your page restore a
   * snapshot of your partner's.
   */
  private ctx = new Map<string, DocCtx>();
  /**
   * Hide your partner's lane to declutter the flow. Session-only and PURELY
   * VISUAL — it must never change what the doc export produces, or the same
   * flow would emit different speech docs depending on a view toggle.
   */
  hidePartnerLane = $state(false);

  /** Memoized normalized selection rectangle. Every visible cell asks whether
   *  it's in range (twice) on every drag frame, so this must not recompute
   *  per-cell — as a plain getter it allocated a rect for each of them. */
  private rect = $derived.by(() => {
    const s = this.selection;
    if (!s) return null;
    return {
      r0: Math.min(s.anchor.row, s.focus.row),
      r1: Math.max(s.anchor.row, s.focus.row),
      c0: Math.min(s.anchor.col, s.focus.col),
      c1: Math.max(s.anchor.col, s.focus.col),
    };
  });

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a text-edit session is coalescing keystrokes into one undo step. */
  private textSessionOpen = false;
  /** True while a batch (macro) runs — inner mutations skip history pushes. */
  private suppressHistory = false;

  // ---- lifecycle ----------------------------------------------------------

  newRound(template: SpeechTemplate, name = "Untitled Round", mySide?: Side): void {
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
      ...(mySide ? { mySide } : {}),
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
    this.selectAll = false;
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

  // ---- multiple open documents --------------------------------------------

  /** Every open round, active first. Drives the document switcher. */
  get docs(): Round[] {
    return this.round ? [this.round, ...this.mirrors] : [...this.mirrors];
  }

  /** True when this round belongs to your partner, not to you. */
  isForeign(id: string | undefined): boolean {
    return !!id && this.foreign.has(id);
  }

  /**
   * Open a round alongside the current one — your partner's flow.
   *
   * ⚠ `filePath` is stripped. A mirror is a copy of a document that lives on
   * SOMEONE ELSE'S disk; keeping their path would point our autosave at a file
   * we have no business writing.
   */
  addMirror(round: Round, foreign = true): void {
    if (!round?.id || round.id === this.round?.id) return;
    delete round.filePath;
    if (foreign) this.foreign.add(round.id);
    const at = this.mirrors.findIndex((m) => m.id === round.id);
    if (at >= 0) this.mirrors[at] = round;
    else this.mirrors.push(round);
  }

  removeMirror(id: string): void {
    this.mirrors = this.mirrors.filter((m) => m.id !== id);
    this.foreign.delete(id);
    this.ctx.delete(id);
  }

  /** Close every mirror — used when a session ends. Your own round is kept. */
  clearMirrors(): void {
    for (const m of this.mirrors) {
      this.foreign.delete(m.id);
      this.ctx.delete(m.id);
    }
    this.mirrors = [];
  }

  /** Any open round by id, whether or not it is the one being rendered. */
  docById(id: string): Round | null {
    if (this.round?.id === id) return this.round;
    return this.mirrors.find((m) => m.id === id) ?? null;
  }

  /**
   * Render a different open document. The one on screen swaps into `mirrors`
   * and the target swaps out, each carrying its own cursor, sheet and history
   * so the two never blend.
   */
  switchDoc(id: string): void {
    if (!this.round || this.round.id === id) return;
    const target = this.mirrors.find((m) => m.id === id);
    if (!target) return;
    // Park the current document's view state and history under its own id.
    this.ctx.set(this.round.id, {
      undo: this.undoStack,
      redo: this.redoStack,
      cursor: this.cursor,
      activeSheetId: this.activeSheetId,
    });
    const outgoing = this.round;
    this.mirrors = this.mirrors.map((m) => (m.id === id ? outgoing : m));
    this.round = target;

    const saved = this.ctx.get(id);
    this.undoStack = saved?.undo ?? [];
    this.redoStack = saved?.redo ?? [];
    this.textSessionOpen = false;
    this.selection = null;
    this.selectAll = false;
    this.activeSheetId =
      saved?.activeSheetId && target.sheets.some((s) => s.id === saved.activeSheetId)
        ? saved.activeSheetId
        : (target.sheets[0]?.id ?? null);
    const sheet = target.sheets.find((s) => s.id === this.activeSheetId);
    this.cursor = saved?.cursor ?? (sheet ? { row: 0, col: sheet.startCol } : null);
  }

  /**
   * Apply a partner's change to one open document, whichever it is.
   *
   * The rendered round goes through {@link applyRemote} so it autosaves and
   * stays out of your undo stack. A mirror isn't reactive state, so it is
   * mutated directly and persisted here — otherwise their flow would only be
   * written to disk on the occasions you happened to be looking at it.
   */
  applyRemoteToDoc(id: string, fn: (round: Round) => void): boolean {
    if (this.round?.id === id) {
      this.applyRemote(fn);
      return true;
    }
    const mirror = this.mirrors.find((m) => m.id === id);
    if (!mirror) return false;
    fn(mirror);
    mirror.updatedAt = Date.now();
    void saveRoundJson(mirror.id, JSON.stringify(trimPadding(mirror)));
    return true;
  }

  /**
   * Forget undo history.
   *
   * Called when a partner's change lands during a live session. Snapshots hold
   * the WHOLE round, so undoing to one taken before their edit would restore a
   * round that never contained their work and silently delete it. Dropping the
   * history costs you undo; keeping it would cost them their flow.
   */
  dropHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
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
    // Blank trailing rows are regenerated on demand, so keeping them in 300
    // history snapshots of a scrolled-around round is pure memory cost.
    this.undoStack.push(JSON.stringify(trimPadding(this.round)));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    if (!this.round || this.undoStack.length === 0) return;
    const paper = this.paperLevel();
    this.redoStack.push(JSON.stringify(trimPadding(this.round)));
    this.round = JSON.parse(this.undoStack.pop()!);
    this.afterTimeTravel(paper);
  }

  redo(): void {
    if (!this.round || this.redoStack.length === 0) return;
    const paper = this.paperLevel();
    this.undoStack.push(JSON.stringify(trimPadding(this.round)));
    this.round = JSON.parse(this.redoStack.pop()!);
    this.afterTimeTravel(paper);
  }

  /** How much blank paper each sheet currently has. History snapshots are
   *  stored trimmed, so this is restored afterwards — otherwise undoing while
   *  scrolled down into empty rows would shrink the sheet under you. */
  private paperLevel(): Map<string, number> {
    return new Map((this.round?.sheets ?? []).map((s) => [s.id, s.rows.length]));
  }

  /** Undo/redo swaps in a whole different round object, so the cursor and the
   *  active sheet can point at things that no longer exist — e.g. undoing an
   *  "add sheet" left activeSheetId dangling and the grid blank with no way back
   *  except clicking a tab. Re-anchor both to something real. */
  private afterTimeTravel(paper?: Map<string, number>): void {
    this.textSessionOpen = false;
    const sheets = this.round?.sheets ?? [];
    // Put back the blank paper the snapshot didn't store.
    if (paper) {
      for (const s of sheets) {
        const want = paper.get(s.id) ?? 0;
        if (want > s.rows.length) this.ensureRows(want - 1, s);
      }
    }
    if (!sheets.some((s) => s.id === this.activeSheetId)) {
      this.activeSheetId = sheets[0]?.id ?? null;
      this.selection = null;
    }
    const sheet = this.activeSheet;
    if (!sheet) {
      this.cursor = null;
    } else if (this.cursor) {
      this.cursor = {
        row: Math.min(this.cursor.row, Math.max(0, sheet.rows.length - 1)),
        col: Math.max(sheet.startCol, Math.min(this.cursor.col, this.nCols - 1)),
      };
    } else {
      // Redoing back into a sheet that undo had removed: without this the grid
      // has no cursor at all and arrow keys / marks silently do nothing.
      this.cursor = { row: 0, col: sheet.startCol };
    }
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
    if (!this.round) return;
    const { id } = this.round;
    // Serialize BEFORE clearing `dirty` and before awaiting, so an edit that
    // lands mid-write re-dirties and gets its own flush.
    const json = JSON.stringify(trimPadding(this.round));
    this.dirty = false;
    await saveRoundJson(id, json);
  }

  /** Flush only if there are unsaved edits — cheap to call from a heartbeat
   *  or on window blur / hide / pagehide, so a crash or sleep can't lose work. */
  async autosaveIfDirty(): Promise<void> {
    if (this.dirty && this.round) await this.saveNow();
  }

  /** Rename a speech's column label (its short header, e.g. "NR" -> "2NR" or
   *  "Negative Rebuttal"). Templates are presets, not constraints, so this edits
   *  the round in place and persists on the normal save debounce. */
  renameSpeech(col: number, abbr: string): void {
    const sp = this.round?.template.speeches[col];
    if (!sp) return;
    const next = abbr.trim();
    if (!next || next === sp.abbr) return;
    sp.abbr = next;
    this.scheduleSave();
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
    // Build a plain array and assign it back once. Pushing onto a captured
    // reference of a $state array doesn't update the proxy's length signal, so
    // the cards silently never landed in the bank — reassign instead.
    const bank = this.round.cards ? [...this.round.cards] : [];
    const key = (c: ArgRef) => (c.author ?? "") + "::" + c.tag;
    const seen = new Set(bank.map(key));
    for (const c of args) {
      if (!c.tag?.trim()) continue; // an argument needs text; author is optional
      if (seen.has(key(c))) continue;
      seen.add(key(c));
      bank.push(c);
    }
    this.round.cards = bank;
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
    if (hits.length === 0) return hits;
    // Rank once per candidate, not inside the comparator: the "already on this
    // sheet" test scans a sheet-sized string, and running it from sort() meant
    // O(n log n) of those scans on every keystroke in the lookup.
    const sheetText = (this.activeSheet?.rows ?? [])
      .flatMap((r) => r.cells.map((c) => c.text.toLowerCase()))
      .join("   ");
    return hits
      .map((c) => ({
        c,
        // 0 sorts first — arguments already on the sheet lead the list.
        rank: sheetText.includes(c.tag.toLowerCase().slice(0, 20)) ? 0 : 1,
      }))
      .sort((a, b) => a.rank - b.rank)
      // No cap. This used to .slice(0, 12), which silently hid all but the first
      // dozen of a real imported bank — an in-round dead end, since the card you
      // wanted was usually past it and no amount of scrolling could reach it.
      // The dropdown scrolls (and keeps the selection in view), so length is its
      // problem, not ours. Sort is stable, so equal-rank items keep bank order.
      .map((h) => h.c);
  }

  /**
   * Insert a banked argument into a cell.
   * - Analytic -> its text, marked as an analytic (green ink).
   * - Card, full -> "Author tag"; the author is recorded so it renders bold.
   * - Card, not full -> just the author (bold). Card ink is NOT forced; the
   *   bold author is the "this is a card" signal (keeps the speech side color).
   */
  setCellFromArg(row: number, col: number, arg: ArgRef, full: boolean, prefix = ""): void {
    const sheet = this.activeSheet;
    const cell = sheet?.rows[row]?.cells[col];
    if (!cell) return;
    this.mutate(() => {
      // Keep any text that was already in the cell when the bank opened; only
      // the transient search query is replaced by the picked card.
      const pre = prefix.trim() ? prefix.replace(/\s+$/, "") + " " : "";
      if (arg.analytic || !arg.author) {
        cell.text = pre + arg.tag;
        delete cell.author;
        if (arg.analytic) (cell.marks ??= {}).evidence = "analytic";
      } else {
        cell.text = pre + (full ? arg.author + " " + arg.tag : arg.author);
        cell.author = arg.author;
        // Symmetric with the analytic branch above: a banked argument WITH an
        // author is by definition a carded one (collectArguments only banks it
        // as a card when it has one), so mark the evidence kind here too and
        // let it show the card ink. Scoped to this cell, like every other mark.
        (cell.marks ??= {}).evidence = "card";
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
        cell.expanded = false; // collapsed by default; expand with the ▸
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

  /** Put a set of sub-items into a cell (from a block insert), collapsed by
   *  default — the cell shows the block header; expand with the ▸ to see cards. */
  setCellItems(row: number, col: number, header: string, items: CellItem[]): void {
    const cell = this.cellAt(row, col);
    if (!cell) return;
    this.mutate(() => {
      cell.text = header;
      cell.items = items;
      cell.expanded = false;
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

  // ---- per-item responses (answer each part of a block individually) -------
  // Stored on the item so they collapse with it. Arrays are reassigned (not
  // pushed onto a captured ref) so the $state length signal updates.

  addItemResponse(row: number, col: number, id: string): number {
    const cell = this.cellAt(row, col);
    const item = cell?.items?.find((i) => i.id === id);
    if (!item) return -1;
    const idx = item.responses?.length ?? 0;
    this.mutate(() => { item.responses = [...(item.responses ?? []), ""]; });
    return idx;
  }

  updateItemResponse(row: number, col: number, id: string, idx: number, text: string): void {
    const cell = this.cellAt(row, col);
    const item = cell?.items?.find((i) => i.id === id);
    if (!item?.responses || idx < 0 || idx >= item.responses.length) return;
    this.mutate(() => {
      item.responses = item.responses!.map((r, j) => (j === idx ? text : r));
    }, { coalesceText: true });
  }

  removeItemResponse(row: number, col: number, id: string, idx: number): void {
    const cell = this.cellAt(row, col);
    const item = cell?.items?.find((i) => i.id === id);
    if (!item?.responses) return;
    this.mutate(() => {
      const next = item.responses!.filter((_, j) => j !== idx);
      if (next.length) item.responses = next;
      else delete item.responses;
    });
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

  /** The whole argument bank, for the manager UI. */
  get bank(): ArgRef[] {
    return this.round?.cards ?? [];
  }

  /** Edit a banked argument's tag/author in place. */
  updateArg(index: number, patch: { tag?: string; author?: string }): void {
    if (!this.round?.cards?.[index]) return;
    this.mutate((round) => {
      const next = [...(round.cards ?? [])];
      const cur = { ...next[index] };
      if (patch.tag !== undefined) cur.tag = patch.tag;
      if (patch.author !== undefined) {
        const a = patch.author.trim();
        if (a) cur.author = a; else delete cur.author;
      }
      next[index] = cur;
      round.cards = next;
    });
  }

  /** Remove one banked argument. */
  removeArg(index: number): void {
    if (!this.round?.cards?.[index]) return;
    this.mutate((round) => {
      round.cards = (round.cards ?? []).filter((_, i) => i !== index);
    });
  }

  /** Manually add a banked argument (bank editing). */
  addArg(tag: string, author?: string): void {
    if (!this.round || !tag.trim()) return;
    const a = author?.trim();
    this.mutate((round) => {
      round.cards = [...(round.cards ?? []), { tag: tag.trim(), author: a || undefined }];
    });
  }

  /** Empty the whole bank. */
  clearBank(): void {
    if (!this.round) return;
    this.mutate((round) => {
      round.cards = [];
    });
  }

  /** Jump the cursor to the nearest cell WITH content above (-1) or below (+1)
   *  in the current column — Excel's ⌘/Ctrl+↑/↓ "jump to the data", for pulling
   *  context off a nearby cell without arrowing through the blank paper between.
   *  Purely a cursor move: no mutation, so it costs no undo step. No-op if there
   *  is nothing filled that way. */
  jumpToFilled(dir: 1 | -1): void {
    const sheet = this.activeSheet;
    if (!sheet || !this.cursor) return;
    const { row, col } = this.cursor;
    const filled = (r: number) => {
      const c = sheet.rows[r]?.cells[col];
      return !!(c && (c.text?.trim() || c.items?.length));
    };
    for (let r = row + dir; r >= 0 && r < sheet.rows.length; r += dir) {
      if (filled(r)) { this.cursor = { row: r, col }; return; }
    }
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
    // Extending INTO a split speech lands in the lane you own rather than
    // whichever lane happens to sit leftmost — an extension is your own note,
    // so it belongs on your side of the split. Extending FROM one lane to the
    // next speech is unaffected: that target isn't a lane.
    const group = speeches[target].laneGroup;
    if (group && speeches[col].laneGroup !== group) {
      const mine = speeches.findIndex(
        (s) => s.laneGroup === group && s.lane === this.myLane,
      );
      if (mine >= 0) target = mine;
    }
    this.mutate(() => {
      const cell = sheet.rows[row]?.cells[target];
      if (cell) cell.ext = true;
    });
    this.cursor = { row, col: target };
  }

  /**
   * Answer this argument: jump to the next OPPOSING speech on the same row and
   * record that the cell you land on is a reply to the one you came from.
   *
   * The mirror image of {@link extendCell}, which walks to your own next
   * speech. The recorded link is what lets the doc export write the right
   * "AT: …" header instead of guessing from whatever sits to the left — which
   * on a split speech is your partner's lane, not yours.
   */
  replyToCell(row: number, col: number): void {
    const sheet = this.activeSheet;
    if (!sheet || !this.round) return;
    const speeches = this.round.template.speeches;
    const from = speeches[col];
    if (!from) return;
    let target = -1;
    for (let j = col + 1; j < speeches.length; j++) {
      if (from.side === "neutral" || speeches[j].side !== from.side) {
        target = j;
        break;
      }
    }
    if (target < 0) return;
    // Landing on a split speech puts you in your own lane, same as extending.
    const group = speeches[target].laneGroup;
    if (group && from.laneGroup !== group) {
      const mine = speeches.findIndex(
        (s) => s.laneGroup === group && s.lane === this.myLane,
      );
      if (mine >= 0) target = mine;
    }
    this.mutate(() => {
      const cell = sheet.rows[row]?.cells[target];
      if (cell) cell.repliesTo = from.id;
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
    return this.rect;
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
      // Also drop imported block contents (cards + responses), not just the
      // flowed header text — a Delete on the selection clears the whole cell.
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
            // Clear the WHOLE source cell. Only text/marks/ext used to be lifted,
            // so dragging a cell that held an imported card block left the block
            // behind as a headerless orphan while the destination got bare text.
            cell.text = "";
            delete cell.marks;
            delete cell.ext;
            delete cell.items;
            delete cell.expanded;
            delete cell.chip;
            delete cell.card;
            delete cell.cmNode;
            delete cell.author;
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
          // Everything else the cell carries moves with it: the sub-items of an
          // imported block, its source-type chip, the stored card/CardMirror
          // node behind "Send to Doc", and the banked author that renders bold.
          if (cell.items) target.items = cell.items;
          else delete target.items;
          if (cell.expanded !== undefined) target.expanded = cell.expanded;
          else delete target.expanded;
          if (cell.chip) target.chip = cell.chip;
          else delete target.chip;
          if (cell.card) target.card = cell.card;
          else delete target.card;
          if (cell.cmNode) target.cmNode = cell.cmNode;
          else delete target.cmNode;
          if (cell.author) target.author = cell.author;
          else delete target.author;
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
    // Keyboard movement is edit-flow, not a fresh whole-cell selection.
    this.selectAll = false;
  }
}

/** True for a cell holding nothing at all — no text and no marks/items/source. */
function cellIsBlank(cell: Cell | undefined): boolean {
  if (!cell) return true;
  if ((cell.text ?? "") !== "") return false;
  return (
    !cell.items?.length &&
    !cell.marks &&
    !cell.ext &&
    !cell.chip &&
    !cell.card &&
    !cell.cmNode &&
    !cell.author
  );
}

/**
 * A shallow copy of the round with each sheet's trailing BLANK rows dropped.
 *
 * "Unlimited paper" grows a sheet every time you scroll to its bottom, and those
 * blank rows used to persist forever — so a long session left thousands of empty
 * rows in the round, in every autosave and every undo snapshot. The padding is
 * regenerated on demand by Grid's ensureRows effect, so it never needs storing.
 * Only spines are copied (no deep clone), so this is cheap enough for the hot path.
 */
function trimPadding(round: Round): Round {
  return {
    ...round,
    sheets: round.sheets.map((sheet) => {
      let n = sheet.rows.length;
      while (n > 1 && sheet.rows[n - 1].cells.every(cellIsBlank)) n--;
      return n === sheet.rows.length ? sheet : { ...sheet, rows: sheet.rows.slice(0, n) };
    }),
  };
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
