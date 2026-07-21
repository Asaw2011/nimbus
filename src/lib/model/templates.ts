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
