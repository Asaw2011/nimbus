// Answer numbers (Settings → Experimental → "Answer numbers", off by default).
//
// The 2AC answers the 1NC's arguments in order (1NC1, 1NC2...), the 2NC/1NR
// the 2AC's (2AC1, 2AC 2-3...). Partners flow the opponent in two lanes, in
// different shapes - one splits an argument into two cells, the other skips
// one - so NOTHING here counts the opponent's cells. Instead each of YOUR
// answers carries the number it answers (`Cell.answerNo`), stamped from a
// "Now answering" counter the moment the cell is filled. The doc send then
// sorts by that number, so answering 2AC 2 before 2AC 1 still comes out in
// order.
//
// ⚠ Only ever writes `answerNo`, only on your own answering column, and only
// inside a LOCAL edit (store.localEditHook) - never on a partner's change,
// never on undo/redo. With the setting off it does nothing at all.

import { store } from "./round.svelte";
import { settings } from "./settings.svelte";
import type { Cell, Round, Sheet } from "./types";
import { answeredTurn, turnName, turnOfCol } from "./turns";
import { smartKit } from "$lib/smart/kit.svelte";

type Side = "aff" | "neg";
export interface Span {
  a: number;
  b: number;
}
/** What your column is answering: the opponent speech's name, your side, and
 *  whether that speech is the opponent's constructive. */
interface Answering {
  prefix: string;
  side: Side;
  vsConstructive: boolean;
}

const SIDE_KEY = "nimbus.answerSide.";

/** Anything in it at all - text, a block, a card. */
export function cellFilled(cell: Cell | undefined): boolean {
  return !!(cell && (cell.text?.trim() || cell.items?.length || cell.card || cell.cmNode));
}

export function parseNo(no: string | undefined): Span | null {
  const m = /^\s*(\d{1,3})\s*(?:-\s*(\d{1,3}))?\s*$/.exec(no ?? "");
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (a < 1 || b < a) return null;
  return { a, b };
}

export function spanNo(s: Span): string {
  return s.a === s.b ? String(s.a) : `${s.a}-${s.b}`;
}

/** The doc heading: "2AC3", or "2AC 2-3" for a group (Adam's format). A
 *  name with a space in it keeps one before the number ("Con Case 2"). */
export function spanHeading(prefix: string, s: Span): string {
  const sep = /\s/.test(prefix) ? " " : "";
  return s.a === s.b ? `${prefix}${sep}${s.a}` : `${prefix} ${s.a}-${s.b}`;
}

/** One numbered answer as it goes to the doc: its number (null = the cells
 *  above your first numbered answer, e.g. an overview) and its rows. */
export interface AnswerGroup {
  span: Span | null;
  rows: number[];
}

class AnswerNumbers {
  /** "Now answering", per round | sheet | column. Session only. */
  counters = $state<Record<string, Span>>({});
  /** Side picked on the column chip, for rounds that don't say which side. */
  picked = $state<Record<string, Side>>({});

  /** Which side you're on: the round's, else the Smart kit's, else picked. */
  side(round: Round): Side | undefined {
    if (round.mySide === "aff" || round.mySide === "neg") return round.mySide;
    if (smartKit.roundId === round.id && (smartKit.side === "aff" || smartKit.side === "neg")) return smartKit.side;
    const p = this.picked[round.id];
    if (p) return p;
    try {
      const v = localStorage.getItem(SIDE_KEY + round.id);
      if (v === "aff" || v === "neg") return v;
    } catch {
      /* storage blocked - ask on the chip */
    }
    return undefined;
  }

  pickSide(round: Round, side: Side): void {
    this.picked = { ...this.picked, [round.id]: side };
    try {
      localStorage.setItem(SIDE_KEY + round.id, side);
    } catch {
      /* session-only then */
    }
  }

  /**
   * Is `col` a side's FIRST ANSWERING speech (its second turn - see turns.ts)?
   * Policy: the 2AC (answering the 1NC) and the neg block (answering the 2AC);
   * LD: the 1AR (NC) and the NR (1AR); PF: each rebuttal. Later speeches
   * (1AR, 2NR, 2AR, summaries) never are. Lanes are the OPPONENT'S columns,
   * never an answering one. Found by position, so it works in every format
   * and survives renamed columns.
   */
  private answering(round: Round, col: number): Answering | null {
    const speeches = round.template.speeches;
    const sp = speeches[col];
    if (!sp || sp.laneGroup || (sp.side !== "aff" && sp.side !== "neg")) return null;
    if (turnOfCol(speeches, col)?.index !== 1) return null;
    const them = answeredTurn(speeches, col);
    if (!them) return null;
    const prefix = turnName(speeches, them);
    // PF's constructive is literally "Pro Case" / "Con Case": all of it is
    // case, however its pages were made, so the case-pages-only rule (meant
    // for a policy/LD off-case answered with prepared blocks) doesn't apply.
    const vsConstructive = them.index === 0 && !/\bcase\b/i.test(prefix);
    return { prefix, side: sp.side, vsConstructive };
  }

  /** The prefix ("1NC", "2AC", "NC"...) when `col` is numbered on this sheet, else null. */
  prefix(round: Round | null | undefined, col: number, sheet?: Sheet): string | null {
    if (!settings.answerNumbers || !round) return null;
    if (sheet && (sheet.kind === "cx" || sheet.kind === "overview" || col < sheet.startCol)) return null;
    const ans = this.answering(round, col);
    if (!ans || !this.onPage(ans, sheet)) return null;
    return this.side(round) === ans.side ? ans.prefix : null;
  }

  /** Answering the opponent's CONSTRUCTIVE (the 2AC vs the 1NC, the LD 1AR vs
   *  the NC) is numbered on CASE pages only - on an off-case page it's just
   *  your prepared blocks, nothing to line up (Adam). The block answers the
   *  2AC everywhere. */
  private onPage(ans: Answering, sheet?: Sheet): boolean {
    return !ans.vsConstructive || !sheet || sheet.kind === "case";
  }

  /** The setting is on and this column could be numbered, but we don't know
   *  your side yet - the column chip asks. */
  needsSide(round: Round | null | undefined, col: number, sheet?: Sheet): boolean {
    if (!round || !settings.answerNumbers || this.side(round)) return false;
    const ans = this.answering(round, col);
    return !!ans && this.onPage(ans, sheet);
  }

  /** Numbered columns on this sheet (usually one). */
  numberedCols(round: Round, sheet: Sheet): number[] {
    const out: number[] = [];
    round.template.speeches.forEach((_, c) => {
      if (this.prefix(round, c, sheet)) out.push(c);
    });
    return out;
  }

  private key(round: Round, sheet: Sheet, col: number): string {
    return `${round.id}|${sheet.id}|${col}`;
  }

  /** The number the next answer gets: what you set with ‹ › +, else the one
   *  after your highest answer. Derived, not remembered - so undoing or
   *  deleting your last answer gives its number back (a remembered counter
   *  had already moved on, and "2AC 2" went missing in Adam's test). */
  current(round: Round, sheet: Sheet, col: number): Span {
    const set = this.counters[this.key(round, sheet, col)];
    if (set) return set;
    let max = 0;
    for (const r of sheet.rows) max = Math.max(max, parseNo(r.cells[col]?.answerNo)?.b ?? 0);
    const n = this.firstFree(sheet, col, max);
    return { a: n, b: n };
  }

  /** The lowest number above `after` that no answer in the column covers. */
  private firstFree(sheet: Sheet, col: number, after: number): number {
    const used = new Set<number>();
    for (const r of sheet.rows) {
      const s = parseNo(r.cells[col]?.answerNo);
      if (s) for (let n = s.a; n <= s.b; n++) used.add(n);
    }
    let n = after + 1;
    while (used.has(n)) n++;
    return n;
  }

  setCurrent(round: Round, sheet: Sheet, col: number, s: Span): void {
    this.counters = { ...this.counters, [this.key(round, sheet, col)]: s };
  }

  private clearCurrent(round: Round, sheet: Sheet, col: number): void {
    const k = this.key(round, sheet, col);
    if (!(k in this.counters)) return;
    const next = { ...this.counters };
    delete next[k];
    this.counters = next;
  }

  /** The counter keys: next / previous argument, widen / narrow a group. */
  step(round: Round, sheet: Sheet, col: number, how: "next" | "prev" | "group" | "ungroup"): Span {
    const c = this.current(round, sheet, col);
    const s =
      how === "next" ? { a: c.b + 1, b: c.b + 1 }
      : how === "prev" ? { a: Math.max(1, c.a - 1), b: Math.max(1, c.a - 1) }
      : how === "group" ? { a: c.a, b: c.b + 1 }
      : { a: c.a, b: Math.max(c.a, c.b - 1) };
    this.setCurrent(round, sheet, col, s);
    return s;
  }

  /** Numbers between 1 and the highest used that no answer covers - "did
   *  you skip one?" Shown on the chip, never enforced. */
  missing(sheet: Sheet, col: number): number[] {
    const have = new Set<number>();
    let max = 0;
    for (const r of sheet.rows) {
      const s = parseNo(r.cells[col]?.answerNo);
      if (!s) continue;
      for (let n = s.a; n <= s.b; n++) have.add(n);
      max = Math.max(max, s.b);
    }
    const out: number[] = [];
    for (let n = 1; n <= max; n++) if (!have.has(n)) out.push(n);
    return out;
  }

  /** Re-number one answer by hand (the badge). "" removes the number. */
  setCellNo(sheetId: string, row: number, col: number, text: string): boolean {
    const t = text.trim();
    const s = t ? parseNo(t) : null;
    if (t && !s) return false;
    store.mutate((round) => {
      const cell = round.sheets.find((x) => x.id === sheetId)?.rows[row]?.cells[col];
      if (!cell) return;
      if (s) cell.answerNo = spanNo(s);
      else delete cell.answerNo;
    });
    return true;
  }

  /**
   * The column as answers, in send order. A cell without a number belongs to
   * the numbered answer above it (an extra card under your block); cells above
   * the first number go first, unnumbered. The same number twice, anywhere in
   * the column, is one answer. Sorted by number, so the order you inserted in
   * - or where on the page it landed - doesn't matter.
   */
  groups(sheet: Sheet, col: number): AnswerGroup[] {
    const lead: number[] = [];
    const byNo = new Map<string, AnswerGroup>();
    let cur: AnswerGroup | null = null;
    sheet.rows.forEach((row, r) => {
      const cell = row.cells[col];
      if (!cellFilled(cell)) return;
      const s = parseNo(cell.answerNo);
      if (s) {
        const k = spanNo(s);
        cur = byNo.get(k) ?? { span: s, rows: [] };
        byNo.set(k, cur);
      }
      (cur ? cur.rows : lead).push(r);
    });
    const numbered = [...byNo.values()].sort((x, y) => x.span!.a - y.span!.a || x.span!.b - y.span!.b);
    return lead.length ? [{ span: null, rows: lead }, ...numbered] : numbered;
  }

  // ---- stamping --------------------------------------------------------------

  /** Before a local edit: which answer cells were already filled. */
  private before(round: Round): unknown {
    if (!settings.answerNumbers) return undefined;
    const filled = new Set<string>();
    let any = false;
    for (const sheet of round.sheets) {
      for (const c of this.numberedCols(round, sheet)) {
        any = true;
        for (const row of sheet.rows) if (cellFilled(row.cells[c])) filled.add(`${sheet.id}|${row.id}|${c}`);
      }
    }
    return any ? filled : undefined;
  }

  /** After it: stamp what just got filled, un-stamp what got emptied. Each
   *  new answer moves the counter on to the next free number by itself, so
   *  answering in order needs no keys at all (Adam: switching had to be
   *  simpler). */
  private after(round: Round, before: unknown): void {
    const filled = before as Set<string>;
    for (const sheet of round.sheets) {
      for (const c of this.numberedCols(round, sheet)) {
        let stamped: Span | null = null;
        for (const row of sheet.rows) {
          const cell = row.cells[c];
          if (!cell) continue;
          if (cellFilled(cell)) {
            if (!cell.answerNo && !filled.has(`${sheet.id}|${row.id}|${c}`)) {
              stamped = this.current(round, sheet, c);
              cell.answerNo = spanNo(stamped);
            }
          } else if (cell.answerNo) {
            delete cell.answerNo;
          }
        }
        // A ‹ › + choice is used up by the answer it was for; after that the
        // counter is derived again (see `current`).
        if (stamped) this.clearCurrent(round, sheet, c);
      }
    }
  }

  install(): void {
    store.localEditHook = {
      before: (round) => this.before(round),
      after: (round, b) => this.after(round, b),
    };
  }
}

export const answerNumbers = new AnswerNumbers();
answerNumbers.install();
