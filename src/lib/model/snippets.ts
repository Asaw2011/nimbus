// Abbreviation autocomplete: when the user types a trigger word followed by a
// space, it expands in place. User-editable map, persisted locally.

const DEFAULTS: Record<string, string> = {
  "t/": "Turn: ",
  "nu/": "Non-unique: ",
  "nl/": "No link: ",
  "ni/": "No impact: ",
  "ext/": "Extend ",
  "cx/": "Cross-apply ",
  "perm/": "Perm: do both — ",
  "cond/": "Conditionality",
  "dtd": "drop the debater",
  "dta": "drop the argument",
};

import { loadBlob, loadBlobCached, saveBlob } from "./blobs";

const LS_KEY = "debate-flow:snippets"; // legacy pre-disk location
const BLOB = "snippets";

// Module-level cache so every open cell sees settings edits immediately
// without re-reading storage on each keystroke.
let cache: Record<string, string> | null = null;

export function loadSnippets(): Record<string, string> {
  if (cache) return cache;
  try {
    // Saved maps are complete (including any kept defaults), so no re-merge —
    // deleting a default snippet must stick.
    cache =
      loadBlobCached<Record<string, string>>(BLOB) ??
      JSON.parse(localStorage.getItem(LS_KEY) ?? "null") ?? { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

/** Pull the authoritative on-disk copy; call once at startup. */
export async function initSnippets(): Promise<void> {
  const disk = await loadBlob<Record<string, string>>(BLOB);
  if (disk) cache = disk;
  else saveSnippets(loadSnippets()); // first run: put current set on disk
}

export function saveSnippets(snippets: Record<string, string>): void {
  cache = snippets;
  saveBlob(BLOB, snippets);
}

/**
 * If `text` ends with "<trigger> " (trigger just completed by a space),
 * return the expanded text, else null.
 */
export function expand(
  text: string,
  snippets: Record<string, string>,
): string | null {
  if (!text.endsWith(" ")) return null;
  const body = text.slice(0, -1);
  const lastSpace = body.lastIndexOf(" ");
  const word = body.slice(lastSpace + 1);
  const replacement = snippets[word];
  if (replacement === undefined) return null;
  return body.slice(0, lastSpace + 1) + replacement;
}
