// Core data model for the flow.
//
// A Round holds many Sheets (one per position: each off-case, each advantage).
// Speech columns are defined by the round's SpeechTemplate — never hardcoded,
// so side order is fully configurable (e.g. neg-speaks-first PF).
//
// A Sheet is a plain grid, like Excel or a sheet of paper: rows already exist
// and every cell is directly editable. Each Row has one Cell per speech
// column. Extras (extension arrows, cross-flow links) layer on top of this
// base without changing the mental model.

export type Side = "aff" | "neg" | "neutral";

export interface Speech {
  id: string;
  /** Short label shown as column header, e.g. "1NC", "AC", "Summary" */
  abbr: string;
  label: string;
  side: Side;
}

export interface SpeechTemplate {
  id: string;
  name: string;
  /** Ordered list of speeches = ordered columns. User-editable. */
  speeches: Speech[];
}

export interface CellMarks {
  /** Flag: opponent dropped this */
  dropped?: boolean;
  /** Flag: must address in next speech */
  starred?: boolean;
  /** What kind of argument this is — colors the ink (settings-configurable). */
  evidence?: "analytic" | "card";
  /** Custom ink color for this cell (overrides side/evidence ink). */
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

/**
 * A sub-entry inside a cell — a block expands into several of these (its cards),
 * and you can add your own typed responses alongside them. "Multiple cells
 * inside one cell."
 */
export interface CellItem {
  id: string;
  text: string;
  /** "card" = came from an inserted card; "response" = you typed it. */
  kind: "card" | "response";
  /** Source-type chip (CARD/BLK/…) for inserted cards. */
  chip?: string;
  /** Full source node (for "Send to Doc"). */
  card?: unknown;
  /** The exact CardMirror node JSON (with images/formatting) — sent to the doc
   *  verbatim so images survive, unlike the text-only `card` adapter path. */
  cmNode?: unknown;
}

export interface Cell {
  text: string;
  /** Sub-entries (cards + your responses). When present, the cell is expandable. */
  items?: CellItem[];
  /** UI: whether the sub-entries are shown (persisted so it stays put). */
  expanded?: boolean;
  marks?: CellMarks;
  /** Extension arrow: this cell continues an argument from an earlier speech. */
  ext?: boolean;
  /** Source type chip (POC/HAT/BLK/TAG/ANL) when dragged in from Doc Search. */
  chip?: string;
  /** The full card (DocNode) this cell was filled from, so "Send to Doc"
   *  can re-send the real substance — not just the block name. */
  card?: unknown;
  /** The exact CardMirror node JSON (with images) for a single-card cell —
   *  sent to the doc verbatim so images survive. */
  cmNode?: unknown;
  /** The card's author, stored as the exact substring that lives inside `text`
   *  (not offsets — self-heals when you edit around it) so it renders bold. */
  author?: string;
}

export interface Row {
  id: string;
  /** One cell per speech column; length always equals template.speeches.length. */
  cells: Cell[];
}

export type SheetKind = "case" | "offcase" | "overview" | "cx" | "custom";

export interface Sheet {
  id: string;
  title: string;
  kind: SheetKind;
  /**
   * First visible speech column. Mirrors paper practice: off-case pages start
   * at the speech that introduced them (no wasted 1AC column), overview pages
   * start at the block.
   */
  startCol: number;
  /** Custom accent color; when unset, the kind default applies (aff blue / neg red). */
  color?: string;
  rows: Row[];
}

/** A sheet's accent: custom color if set, else the side default by kind. */
export function sheetAccent(sheet: Sheet): string {
  if (sheet.color) return sheet.color;
  if (sheet.kind === "case") return "var(--aff)";
  if (sheet.kind === "offcase" || sheet.kind === "overview") return "var(--neg)";
  return "var(--text-dim)";
}

/**
 * A banked argument — either a carded tag (has an author) or an analytic (no
 * card behind it). Both are arguments someone made; the argument bank holds
 * both so you can pull either while flowing.
 */
export interface ArgRef {
  /** The argument text — a card's tag, or the analytic's text. */
  tag: string;
  /** Author (carded evidence only); absent for analytics. */
  author?: string;
  cite?: string;
  /** True when this is an analytic (no card / author). */
  analytic?: boolean;
  /** The full card/analytic node (DocNode) behind this argument, so inserting
   *  it carries the real substance — not just tag + author — and it can be
   *  sent to the speech doc. */
  card?: unknown;
}
/** @deprecated old name — kept so existing imports still type-check. */
export type CardRef = ArgRef;

export interface Round {
  id: string;
  name: string;
  tournament: string;
  opponent: string;
  judges: string;
  affTeam: string;
  negTeam: string;
  template: SpeechTemplate;
  sheets: Sheet[];
  createdAt: number;
  updatedAt: number;
  /** Where this flow is saved on disk, if the user chose a location (Save As). */
  filePath?: string;
  /** Arguments (cards + analytics) banked from imported docs, for the argument
   *  lookup (⌘J). Field name kept as `cards` for save-file compatibility. */
  cards?: ArgRef[];
}

/** Lightweight listing for the dashboard (no sheet contents). */
export interface RoundMeta {
  id: string;
  name: string;
  tournament: string;
  opponent: string;
  templateName: string;
  /** Position chips shown on the dashboard card. */
  sheets: Array<{ title: string; kind: SheetKind; color?: string }>;
  updatedAt: number;
}

/** Rows a fresh sheet starts with — like a blank sheet of paper. */
export const INITIAL_ROWS = 16;

let counter = 0;
export function uid(): string {
  // Time-ordered, collision-safe within a session; fine for local-first data.
  return `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`;
}

export function makeCell(text = ""): Cell {
  return { text };
}

export function makeRow(nCols: number): Row {
  return { id: uid(), cells: Array.from({ length: nCols }, () => makeCell()) };
}

export function makeSheet(
  title: string,
  nCols: number,
  kind: SheetKind = "custom",
  startCol = 0,
  nRows = INITIAL_ROWS,
): Sheet {
  return {
    id: uid(),
    title,
    kind,
    startCol,
    rows: Array.from({ length: nRows }, () => makeRow(nCols)),
  };
}

/**
 * Where a sheet kind starts, per debate practice (mirrors the user's Verbatim
 * flow template): off-case pages at the first neg speech, overviews at the
 * block, everything else at the first speech.
 */
export function defaultStartCol(
  template: SpeechTemplate,
  kind: SheetKind,
): number {
  if (kind === "offcase") {
    const i = template.speeches.findIndex((s) => s.side === "neg");
    return Math.max(0, i);
  }
  if (kind === "overview") {
    const block = template.speeches.findIndex((s) => /block/i.test(s.abbr));
    if (block >= 0) return block;
    const neg = template.speeches.findIndex((s) => s.side === "neg");
    return Math.max(0, neg);
  }
  return 0;
}
