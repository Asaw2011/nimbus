// Built-in speech templates. These are presets, not constraints: the user can
// edit, reorder, rename, or flip sides on any template (e.g. PF where neg
// speaks first — a case most flowing software wrongly locks out).

import type { Speech, SpeechTemplate, Side } from "./types";
import { uid } from "./types";

function sp(abbr: string, label: string, side: Side): Speech {
  return { id: uid(), abbr, label, side };
}

export function policyTemplate(): SpeechTemplate {
  return {
    id: uid(),
    name: "Policy",
    speeches: [
      sp("1AC", "First Affirmative Constructive", "aff"),
      sp("1NC", "First Negative Constructive", "neg"),
      sp("2AC", "Second Affirmative Constructive", "aff"),
      sp("Neg Block", "2NC / 1NR", "neg"),
      sp("1AR", "First Affirmative Rebuttal", "aff"),
      sp("2NR", "Second Negative Rebuttal", "neg"),
      sp("2AR", "Second Affirmative Rebuttal", "aff"),
    ],
  };
}

export function ldTemplate(): SpeechTemplate {
  return {
    id: uid(),
    name: "Lincoln-Douglas",
    speeches: [
      sp("AC", "Affirmative Constructive", "aff"),
      sp("NC", "Negative Constructive", "neg"),
      sp("1AR", "First Affirmative Rebuttal", "aff"),
      sp("NR", "Negative Rebuttal", "neg"),
      sp("2AR", "Second Affirmative Rebuttal", "aff"),
    ],
  };
}

/** `negFirst` flips speaking order — supported natively, unlike most tools. */
export function pfTemplate(negFirst = false): SpeechTemplate {
  const first: Side = negFirst ? "neg" : "aff";
  const second: Side = negFirst ? "aff" : "neg";
  const tag = (s: Side) => (s === "aff" ? "Pro" : "Con");
  return {
    id: uid(),
    name: negFirst ? "Public Forum (Con first)" : "Public Forum",
    speeches: [
      sp(`${tag(first)} Case`, `${tag(first)} Constructive`, first),
      sp(`${tag(second)} Case`, `${tag(second)} Constructive`, second),
      sp(`${tag(first)} Reb`, `${tag(first)} Rebuttal`, first),
      sp(`${tag(second)} Reb`, `${tag(second)} Rebuttal`, second),
      sp(`${tag(first)} Sum`, `${tag(first)} Summary`, first),
      sp(`${tag(second)} Sum`, `${tag(second)} Summary`, second),
      sp(`${tag(first)} FF`, `${tag(first)} Final Focus`, first),
      sp(`${tag(second)} FF`, `${tag(second)} Final Focus`, second),
    ],
  };
}

export function builtinTemplates(): SpeechTemplate[] {
  return [policyTemplate(), ldTemplate(), pfTemplate(false), pfTemplate(true)];
}

// ---- partner lanes ---------------------------------------------------------

/**
 * Which speeches get split into partner lanes when you flow from `side`.
 *
 * Every OPPONENT speech you actually have to flow while your partner preps —
 * flowing neg that is the 2AC and the 1AR, flowing aff the 1NC and the neg
 * block. Derived from speaking order, never by matching on "2AC", so it keeps
 * working for renamed speeches, for LD, and for PF either way round.
 *
 * Two exclusions, both of them the reason this isn't just "all their speeches":
 *  - their LAST speech is the final rebuttal. Nobody is prepping through it.
 *  - their first speech only gets lanes if it is not the very first speech of
 *    the round. A 1AC is read off a prepared document; a 1NC is not, which is
 *    exactly why the 1NC wants two lanes and the 1AC does not.
 *
 * Returns the indices ascending. Empty when there is nothing worth splitting.
 */
export function splitTargetsFor(template: SpeechTemplate, side: Side): number[] {
  if (side === "neutral") return [];
  const opponent: Side = side === "aff" ? "neg" : "aff";
  const idx: number[] = [];
  template.speeches.forEach((s, i) => {
    if (s.side === opponent) idx.push(i);
  });
  if (!idx.length) return [];
  idx.pop(); // their final rebuttal
  if (idx[0] === 0) idx.shift(); // a 1AC, i.e. the round's opening speech
  return idx;
}

/** First split target, or -1. Kept for the dashboard's one-line preview. */
export function splitTargetFor(template: SpeechTemplate, side: Side): number {
  return splitTargetsFor(template, side)[0] ?? -1;
}

/**
 * Split one speech into two partner lanes so both of you can flow it at once.
 *
 * The lanes are ORDINARY COLUMNS — the grid is template-driven, and rows span
 * every column, so a lane lines up with the speech it answers automatically and
 * cannot drift out of alignment. Nothing else in the app has to know they are
 * special.
 *
 * `side` of "neutral" (or a template with nothing to split) returns the
 * template untouched, which is what solo flowing gets.
 */
/** Split ONE speech at `at` into its two partner lanes. Pure. */
function splitOne(speeches: Speech[], at: number): Speech[] {
  const target = speeches[at];
  // Both lanes answer whatever sat before the GROUP — so partner B answers the
  // same speech partner A does, instead of answering partner A's lane.
  const before = speeches[at - 1]?.id;
  const lane = (n: number, suffix: string): Speech => ({
    id: uid(),
    abbr: `${target.abbr} · ${suffix}`,
    label: `${target.label} — ${suffix.toLowerCase()}`,
    side: target.side,
    laneGroup: target.id,
    lane: n,
    ...(before ? { answersId: before } : {}),
  });
  const lanes = [lane(0, "You"), lane(1, "Partner")];

  const rest = speeches.slice(at + 1);
  // The column AFTER the group would otherwise mirror the lane physically to
  // its left — your partner's. Point it at your own lane instead. Replace the
  // object rather than assigning to it: these are the built-in preset's own
  // Speech objects, and writing through them would corrupt the preset for
  // every round created afterwards in this session.
  if (rest[0] && !rest[0].answersId) {
    rest[0] = { ...rest[0], answersId: lanes[0].id };
  }

  return [...speeches.slice(0, at), ...lanes, ...rest];
}

/**
 * Split every speech in {@link splitTargetsFor} into two partner lanes.
 *
 * The lanes are ORDINARY COLUMNS — the grid is template-driven, and rows span
 * every column, so a lane lines up with the speech it answers automatically and
 * cannot drift out of alignment. Nothing else in the app has to know they are
 * special.
 *
 * `side` of "neutral" (or a template with nothing to split) returns the
 * template untouched, which is what solo flowing gets.
 *
 * ⚠ Splits are applied HIGHEST INDEX FIRST. Splicing two lanes in where one
 * speech was shifts every later index by one, so ascending order would make the
 * second target point at the wrong speech.
 */
export function splitForSide(template: SpeechTemplate, side: Side): SpeechTemplate {
  const targets = splitTargetsFor(template, side);
  if (!targets.length) return template;
  let speeches = template.speeches;
  for (const at of [...targets].sort((a, b) => b - a)) speeches = splitOne(speeches, at);
  return { ...template, speeches };
}
