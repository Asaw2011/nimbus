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

import type { Side, Speech, SpeechTemplate } from "./types";

export type Format = "policy" | "ld" | "pf";

/**
 * Which event a template is, for the few things that genuinely differ (prep
 * length, timer presets, page names, PF's crossfires). By the built-in name
 * first, then by its speeches, so a renamed copy still counts. Anything
 * unrecognised is treated as policy - the app's original behaviour.
 */
export function formatOf(template: SpeechTemplate | null | undefined): Format {
  if (!template) return "policy";
  const name = template.name.toLowerCase();
  if (/public forum|\bpf\b/.test(name)) return "pf";
  if (/lincoln|\bld\b/.test(name)) return "ld";
  const abbrs = template.speeches.map((s) => baseAbbr(s).toUpperCase());
  if (abbrs.some((a) => /^(PRO|CON)\b/.test(a))) return "pf";
  if (abbrs.includes("AC") && abbrs.includes("NC") && !abbrs.includes("1AC")) return "ld";
  return "policy";
}

export interface Turn {
  side: Side;
  /** This side's turn number, from 0 (its constructive). */
  index: number;
  /** The columns in it, in order. */
  cols: number[];
}

/**
 * What each event calls the two kinds of page, and the name a new one gets.
 * Display only - the stored kinds stay "case" (the aff's) and "offcase" (the
 * neg's), so nothing that reads them changes.
 */
export function pageNames(format: Format): {
  caseLabel: string;
  offLabel: string;
  caseTitle: (n: number) => string;
  offTitle: (n: number) => string;
} {
  if (format === "ld")
    return { caseLabel: "Contention", offLabel: "Off-case", caseTitle: (n) => `Contention ${n}`, offTitle: (n) => `Off ${n}` };
  if (format === "pf")
    return { caseLabel: "Pro contention", offLabel: "Con contention", caseTitle: (n) => `Pro C${n}`, offTitle: (n) => `Con C${n}` };
  return { caseLabel: "Advantage", offLabel: "Off-case", caseTitle: (n) => `Adv ${n}`, offTitle: (n) => `Off ${n}` };
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
