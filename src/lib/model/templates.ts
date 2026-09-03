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
 * Which speech gets split when you flow a round from `side` with a partner.
 *
 * You split the OPPONENT'S SECOND speech — the long one you have to flow while
 * your partner is prepping. Flowing neg that's the 2AC (while the 2N builds the
 * block); flowing aff it's the neg block. Deriving it from speaking order
 * rather than matching on "2AC" keeps it working for edited templates and for
 * PF either way round, instead of only for the built-in Policy preset.
 *
 * Returns -1 when the opponent doesn't have a second speech to split.
 */
export function splitTargetFor(template: SpeechTemplate, side: Side): number {
  const opponent: Side = side === "aff" ? "neg" : "aff";
  let seen = 0;
  for (let i = 0; i < template.speeches.length; i++) {
    if (template.speeches[i].side === opponent && ++seen === 2) return i;
  }
  return -1;
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
export function splitForSide(template: SpeechTemplate, side: Side): SpeechTemplate {
  if (side === "neutral") return template;
  const at = splitTargetFor(template, side);
  if (at < 0) return template;

  const target = template.speeches[at];
  // Both lanes answer whatever sat before the GROUP — so partner B answers the
  // same speech partner A does, instead of answering partner A's lane.
  const before = template.speeches[at - 1]?.id;
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

  const rest = template.speeches.slice(at + 1);
  // The column AFTER the group would otherwise mirror the lane physically to
  // its left — your partner's. Point it at your own lane instead. Replace the
  // object rather than assigning to it: these are the built-in preset's own
  // Speech objects, and writing through them would corrupt the preset for
  // every round created afterwards in this session.
  if (rest[0] && !rest[0].answersId) {
    rest[0] = { ...rest[0], answersId: lanes[0].id };
  }

  return {
    ...template,
    speeches: [...template.speeches.slice(0, at), ...lanes, ...rest],
  };
}
