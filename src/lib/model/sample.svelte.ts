// "Try a sample round" - a filled-in Policy flow for new users to poke at.
//
// Built fresh every time, as a brand-new round with its own id and a unique
// name, so it can never overwrite anyone's flow. It is only written to disk if
// the user actually edits it (same lazy save as "Start flowing").
//
// The evidence is invented for the demo: authors are placeholders, not real
// cites, and nothing here should be read as a real argument.

import { makeRow, makeSheet, INITIAL_ROWS, type Cell, type Sheet, type SheetKind } from "./types";

/** One line of the sample: which column, the text, and how it's marked. */
interface Line {
  col: number;
  text: string;
  /** "Smith 24" - must appear at the start of `text`, rendered bold. */
  author?: string;
  ev?: "card" | "analytic";
  dropped?: boolean;
  starred?: boolean;
  ext?: boolean;
}

/** Columns of the Policy template, by position. */
const C = { AC: 0, NC: 1, AC2: 2, BLOCK: 3, AR1: 4, NR2: 5, AR2: 6 } as const;

const card = (col: number, author: string, tag: string, extra: Partial<Line> = {}): Line => ({
  col, text: `${author}  ${tag}`, author, ev: "card", ...extra,
});
const anl = (col: number, text: string, extra: Partial<Line> = {}): Line => ({
  col, text, ev: "analytic", ...extra,
});

/** Each sheet: title, kind, first column, then its rows (each row = lines). */
const SHEETS: Array<{ title: string; kind: SheetKind; startCol: number; rows: Line[][] }> = [
  {
    title: "Bioterror Adv",
    kind: "case",
    startCol: C.AC,
    rows: [
      [card(C.AC, "Sample 25", "Bioterror risk is high and rising"),
        card(C.NC, "Example 24", "No bioterror - building a weapon is too hard"),
        card(C.AC2, "Demo 23", "Gene synthesis makes it easy now"),
        anl(C.BLOCK, "Extend tech barriers - their card is about states, not terrorists", { ext: true }),
        anl(C.AR1, "Cross-apply Demo - synthesis is cheap for anyone")],
      [card(C.AC, "Placeholder 24", "Single-payer surveillance catches outbreaks early", { starred: true }),
        card(C.NC, "Model 25", "Surveillance fails - data stays siloed"),
        // Dropped is marked on the argument they never answered, not on the
        // speech that points it out.
        anl(C.AC2, "One national system IS the fix for silos", { dropped: true }),
        anl(C.AR1, "Extend - the block dropped it: one system solves silos", { ext: true })],
      [anl(C.AC, "Pandemics cause extinction"),
        anl(C.NC, "No extinction - humanity always recovers"),
        card(C.AC2, "Sample 26", "Engineered pathogens break that pattern")],
    ],
  },
  {
    title: "Midterms DA",
    kind: "offcase",
    startCol: C.NC,
    rows: [
      [card(C.NC, "Example 26", "Uniqueness: Dems win the House now"),
        anl(C.AC2, "Non-unique: polls are already shifting"),
        card(C.BLOCK, "Model 26", "AT: N/U - Dem lead holds in every forecast"),
        anl(C.AR1, "Their forecasts predate the latest polls")],
      [card(C.NC, "Demo 25", "Link: the plan's unpopular in swing districts", { starred: true }),
        anl(C.AC2, "No link - health care is popular"),
        anl(C.BLOCK, "Extend the link - specific to swing seats", { ext: true })],
      // The block stacking several answers under ONE 2AC argument: rows made
      // with Ctrl+Enter, empty on the left, so they still line up with it.
      [card(C.BLOCK, "Sample 26", "Popular in polls, not with swing voters - the plan's tax hike polls 20 points under")],
      [card(C.BLOCK, "Example 25", "GOP attack ads frame it as a takeover - that's what moves the midterms")],
      [anl(C.BLOCK, "Their card is about the Dem base - the DA is about swing districts"),
        anl(C.AR1, "Group the link answers - our turn outweighs any swing-seat risk")],
      [anl(C.NC, "Internal link: a Dem House passes climate policy"),
        card(C.AC2, "Placeholder 26", "Link turn: the plan wins Dems seats", { dropped: true }),
        anl(C.AR1, "Extend the link turn - they dropped it, so it turns the DA", { ext: true })],
      [card(C.NC, "Sample 24", "Impact: warming causes extinction"),
        anl(C.AC2, "No impact - one House can't solve warming")],
    ],
  },
  {
    title: "States CP",
    kind: "offcase",
    startCol: C.NC,
    rows: [
      [anl(C.NC, "CP: The fifty states should establish single-payer health care"),
        anl(C.AC2, "Perm: do both"),
        anl(C.BLOCK, "Perm links to the DA - it's still federal action")],
      [anl(C.BLOCK, "Perm severs the federal government - severance is a voting issue")],
      [card(C.BLOCK, "Demo 26", "No solvency deficit - states already run their own health systems"),
        anl(C.AR1, "Perm shields the link - federal backstop, state implementation")],
      [card(C.NC, "Demo 24", "Solvency: states solve - they run Medicaid already"),
        card(C.AC2, "Example 25", "States can't fund it - they have to balance budgets"),
        card(C.BLOCK, "Model 24", "Federal grants solve the funding gap"),
        anl(C.AR1, "Grants ARE federal action - perm solves")],
      [anl(C.AC2, "50-state fiat is a voting issue - no single actor")],
    ],
  },
  {
    title: "Cap K",
    kind: "offcase",
    startCol: C.NC,
    rows: [
      [card(C.NC, "Sample 23", "Link: reforming health care props up capitalism"),
        anl(C.AC2, "Perm: do the plan and the alt")],
      [card(C.NC, "Placeholder 22", "Impact: capitalism makes violence inevitable"),
        card(C.AC2, "Demo 22", "Capitalism is sustainable and reduces poverty")],
      [anl(C.NC, "Alt: reject the aff and think outside capital"),
        anl(C.AC2, "Framework: weigh the plan against a competitive policy option")],
    ],
  },
];

function toCell(line: Line): Cell {
  const cell: Cell = { text: line.text };
  if (line.author) cell.author = line.author;
  if (line.ext) cell.ext = true;
  if (line.ev || line.dropped || line.starred) {
    cell.marks = {};
    if (line.text && line.ev) cell.marks.evidence = line.ev;
    if (line.dropped) cell.marks.dropped = true;
    if (line.starred) cell.marks.starred = true;
  }
  return cell;
}

/**
 * The sample's sheets for a template with `nCols` columns. Built for Policy's
 * 7; a cell whose column doesn't exist is skipped rather than written past the
 * end of the row.
 */
export function buildSampleSheets(nCols: number): Sheet[] {
  return SHEETS.map(({ title, kind, startCol, rows }) => {
    const sheet = makeSheet(title, nCols, kind, startCol, Math.max(INITIAL_ROWS, rows.length + 6));
    // Row 0 is the sheet's LABEL cell, in its first column.
    sheet.rows[0].cells[startCol].text = title;
    rows.forEach((lines, i) => {
      while (sheet.rows.length <= i + 1) sheet.rows.push(makeRow(nCols));
      for (const line of lines) {
        if (line.col >= nCols || !line.text) continue;
        sheet.rows[i + 1].cells[line.col] = toCell(line);
      }
    });
    return sheet;
  });
}

/**
 * The id of the sample round currently open, if any - so the flow can show its
 * "this is a sample" banner. Session-only: never saved into the round, so an
 * edited sample saved to disk is an ordinary flow from then on.
 */
export const sample = $state({ roundId: "" });
