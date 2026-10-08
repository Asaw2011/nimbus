// Speaking TURNS - what a speech IS in the round, from its position, not its
// name. Lets "the 2AC" mean the same thing in every format:
//
//              turn 0        turn 1 (first answer)   turn 2 (second answer)
//   Policy aff 1AC           2AC                     1AR
//   Policy neg 1NC           Neg Block (2NC + 1NR)   2NR
//   LD aff     AC            1AR                     2AR
//   LD neg     NC            NR                      -
//   PF (each)  Case          Rebuttal                Summary
//
// A turn is a run of one side's columns with no opponent speech between them,
// so a split partner-lane pair is one turn, and so are separate 2NC and 1NR
// columns. Neutral columns are skipped.

import type { Side, Speech } from "./types";

export interface Turn {
  side: Side;
  /** This side's turn number, from 0 (its constructive). */
  index: number;
  /** The columns in it, in order. */
  cols: number[];
}

/** Every turn of the round, in speaking order. */
export function turnsOf(speeches: Speech[]): Turn[] {
  const out: Turn[] = [];
  const count = { aff: 0, neg: 0 } as Record<string, number>;
  speeches.forEach((sp, c) => {
    if (sp.side !== "aff" && sp.side !== "neg") return;
    const last = out[out.length - 1];
    if (last && last.side === sp.side) {
      last.cols.push(c);
      return;
    }
    out.push({ side: sp.side, index: count[sp.side]++, cols: [c] });
  });
  return out;
}

/** The turn column `c` belongs to, or null (a neutral column). */
export function turnOfCol(speeches: Speech[], c: number): Turn | null {
  return turnsOf(speeches).find((t) => t.cols.includes(c)) ?? null;
}

/** `side`'s turn number `index`, or null when the format doesn't have one. */
export function sideTurn(speeches: Speech[], side: Side, index: number): Turn | null {
  return turnsOf(speeches).find((t) => t.side === side && t.index === index) ?? null;
}

/** The opponent turn right before column `c`'s turn - what it answers. */
export function answeredTurn(speeches: Speech[], c: number): Turn | null {
  const turns = turnsOf(speeches);
  const at = turns.findIndex((t) => t.cols.includes(c));
  return at > 0 ? turns[at - 1] : null;
}

/** A speech's name without a partner-lane suffix: "2AC · You" → "2AC". */
export function baseAbbr(sp: Speech | undefined): string {
  return (sp?.abbr ?? "").split(" · ")[0].trim();
}

/** A turn's name: its first column's ("Neg Block", "1AR", "Pro Reb"). */
export function turnName(speeches: Speech[], t: Turn | null): string {
  return t ? baseAbbr(speeches[t.cols[0]]) : "";
}
