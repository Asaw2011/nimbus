// "What's new" — the patch notes shown once after the app updates itself, and
// on first launch of a freshly downloaded build.
//
// ⚠ The notes are BUNDLED, not fetched. Nimbus is used in rounds on tournament
// wifi and is designed to work offline forever after one sign-in; a patch-notes
// panel that needs the network would be blank exactly when someone opens the app
// in a competition room. It also means the notes always match the binary they
// shipped with, which a fetched "latest release" body does not.

import { APP_VERSION } from "./minversion";

export interface ReleaseNote {
  version: string;
  /** One line under the heading — what this release is about. */
  headline: string;
  items: string[];
}

/**
 * Newest first. Add an entry when you cut a release; nothing else needs editing.
 *
 * Keep entries user-facing: what changed for someone flowing a round, not which
 * files moved.
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.2.0",
    headline: "Flow with your partner, prep clocks in the toolbar, and cards straight into CardMirror.",
    items: [
      "**Flow with a partner, live.** Pair with a 6-character code and either share one flow or keep one each — you can see and edit your partner's page mid-round. You always save to your own file.",
      "**Partner lanes.** Pick your side when you make a flow and the opponent's second speech splits into a column each, so you and your partner aren't typing over one another.",
      "**Answer this argument** (Ctrl+Shift+G). Jumps to your reply in the next opposing speech and links it, so the doc gets \"AT: the argument you meant\".",
      "**Prep clocks for both teams** in the toolbar. Counts down from 8 minutes (change it in Settings), starting one stops the other, and you can click the time to fix it when nobody stopped the clock.",
      "**Cards go straight into CardMirror** — no plugin to install any more. Needs CardMirror 1.5.0 or newer. Highlighting, cites and structure all survive, and it doesn't steal your focus.",
      "**One toolbar, two sizes.** Full width or a condensed one for splitscreen, both the same height. It resizes itself to fit — including when the speech doc is open beside it — instead of scrolling.",
      "**Editable speech formats.** Rename any speech for a format in Settings, or double-click a column header to rename it in the round you're in.",
      "**Speech-doc fixes.** Body text binds into its card instead of clumping loose, and literal `---` survives instead of turning into a dash.",
      "**`.nimbus` files are back.** 1.1.0 retired the native format in favour of Excel; both work again, and you can still convert either way.",
    ],
  },
];

/** Numeric semver compare; missing parts count as 0. */
function cmp(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Everything released since `lastSeen`, newest first.
 *
 * An empty `lastSeen` is a machine that has never run Nimbus, so it gets only
 * the current version's notes — someone installing for the first time does not
 * want a changelog stretching back through releases they never ran.
 */
export function notesSince(lastSeen: string): ReleaseNote[] {
  if (!lastSeen) {
    const current = RELEASE_NOTES.find((n) => cmp(n.version, APP_VERSION) === 0);
    return current ? [current] : [];
  }
  return RELEASE_NOTES.filter(
    (n) => cmp(n.version, lastSeen) > 0 && cmp(n.version, APP_VERSION) <= 0,
  ).sort((a, b) => cmp(b.version, a.version));
}

/** Whether this launch should show the panel at all. */
export function hasUnseenNotes(lastSeen: string): boolean {
  return cmp(APP_VERSION, lastSeen || "0.0.0") > 0 && notesSince(lastSeen).length > 0;
}
