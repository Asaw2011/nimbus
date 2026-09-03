// Core data model for the flow.
//
// A Round holds many Sheets (one per position: each off-case, each advantage).
// Speech columns are defined by the round's SpeechTemplate — never hardcoded,
// so side order is fully configurable (e.g. neg-speaks-first PF).
//
// A Sheet is a plain grid, like Excel or a sheet of paper: rows already exist
// and every cell is directly editable. Each Row has one Cell per speech
// column. Smart features (extension arrows, cross-flow links, AI) layer on
// top of this base without changing the mental model.

export type Side = "aff" | "neg" | "neutral";

export interface Speech {
  id: string;
  /** Short label shown as column header, e.g. "1NC", "AC", "Summary" */
  abbr: string;
  label: string;
  side: Side;
  /**
   * Partner lanes. When one speech is split so both partners can flow it side
   * by side, each lane is a real column carrying the same `laneGroup` id and a
   * different `lane` index. Absent on every ordinary column — a template with
   * no lanes behaves exactly as it did before lanes existed.
   */
  laneGroup?: string;
  lane?: number;
  /**
   * Which column this one's block-answer mirror reads from, as a speech id.
   * Unset means "the column immediately to my left", which is the original
   * behaviour. Lanes point past their sibling at the column before the group,
   * so both partners answer the same speech instead of one answering the other.
   */
  answersId?: string;
  /**
   * Lane owner, for live partner sessions. Unset means anyone may type here.
   * Nothing reads this yet — it exists so a shared session can assign lanes
   * without migrating rounds created before that shipped.
   */
  owner?: string;
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
  /** Your responses to THIS part of the block, shown beneath it when the cell
   *  is expanded (and hidden — with a count badge — when collapsed). */
  responses?: string[];
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
  /**
   * "This answers THAT argument" — the id of the speech whose cell on this same
   * row this one is a response to. Set by the reply action.
   *
   * Without it, the doc export guesses by walking left to the nearest non-empty
   * cell, which picks your partner's lane over your own whenever both are
   * filled. This makes the link explicit, so the "AT: …" header names the
   * argument you actually meant. Stored as a SPEECH ID, not a column index, so
   * it survives any future column reordering.
   */
  repliesTo?: string;
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

// ---- partner lanes ---------------------------------------------------------
//
// A split speech is TWO real columns sharing a `laneGroup`. Everything that
// makes the grid work — one row per argument, row inserts spanning every
// column — is untouched by this, so lanes stay lined up with the speech they
// answer for free. These helpers exist so the few places that reason about
// "the column to my left" don't have to know about lanes individually.

/**
 * True when this column is a partner lane that ISN'T yours.
 *
 * Two things key off this and they must agree: hiding your partner's lane, and
 * deciding which argument a response answers. If they disagreed you could
 * collapse a column and silently change what your speech doc says.
 */
export function isOtherLane(sp: Speech | undefined, myLane: number): boolean {
  return !!sp?.laneGroup && sp.lane !== myLane;
}

/** The lane columns of a group, in lane order. Empty when `id` isn't a group. */
export function laneCols(template: SpeechTemplate, laneGroup: string): number[] {
  const out: number[] = [];
  template.speeches.forEach((s, i) => {
    if (s.laneGroup === laneGroup) out.push(i);
  });
  return out;
}

/**
 * The column whose expanded block this column writes responses into — i.e. the
 * source of its block-answer mirror.
 *
 * Ordinary columns read the one to their left, exactly as before. A lane reads
 * whatever its `answersId` names, which `splitForSide` sets to the column
 * before the lane group — so partner B answers the same speech partner A does
 * instead of answering partner A. Returns -1 when there is no source.
 */
export function sourceCol(template: SpeechTemplate, col: number): number {
  const sp = template.speeches[col];
  if (!sp) return -1;
  if (sp.answersId) {
    const i = template.speeches.findIndex((s) => s.id === sp.answersId);
    // A dangling answersId (hand-edited template) falls back to the default
    // rather than silently disabling the mirror.
    if (i >= 0) return i;
  }
  return col - 1;
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
  /**
   * Which side you are flowing this round from. Chosen when the round is
   * created; it decides which speech gets split into partner lanes. Absent on
   * every round made before lanes existed, and on rounds flowed solo.
   */
  mySide?: Side;
  /** Where this flow is saved on disk, if the user chose a location (Save As). */
  filePath?: string;
  /** Arguments (cards + analytics) banked from imported docs, for the argument
   *  lookup (⌘J). Field name kept as `cards` for save-file compatibility. */
  cards?: ArgRef[];
  /** Judge decision(s) for the round — see {@link RFD}. Absent on rounds saved
   *  before the RFD panel existed, and on rounds where nothing was recorded. */
  rfd?: RFD;
}

/** One judge's ballot: who they voted for and why. A panel has several. */
export interface Ballot {
  id: string;
  /** Judge name (seeded from the round's `judges` field when added). */
  judge: string;
  /** Who this judge voted for. "" = not recorded yet. */
  winner: "aff" | "neg" | "";
  /** Reason for decision — why they voted the way they did. */
  reason: string;
  /** Feedback / advice for improvement. */
  feedback: string;
  /** Speaker points, free-form (e.g. "1A 28.5 · 2A 29") — formats vary by
   *  circuit, so this is deliberately not parsed. */
  points: string;
}

/** The round's result: one ballot per judge (panels supported) + notes. */
export interface RFD {
  ballots: Ballot[];
  /** Any extra notes about the round outcome. */
  notes: string;
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
  /** Mirrored from {@link Round.filePath}. The dashboard uses it to recognise
   *  that an app-data round and a file sitting in a tournament folder are the
   *  same flow, so it can show one card instead of two. */
  filePath?: string;
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
