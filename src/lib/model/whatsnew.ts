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
    version: "1.2.5",
    headline: "Two fixes from real rounds.",
    items: [
      "**You see everything your partner types, not just the first letter.** If your cursor was parked on a cell while your partner typed into it, only their first character ever appeared — a whole sentence would arrive and you would see one letter, with nothing on screen to tell you anything was missing. The cell now keeps up live. Typing in a cell yourself still protects what you are writing: a partner's edit won't yank the text out from under you mid-word.",
      "**Doc Search opens when your library folders overlap.** If you had added a folder *and* a folder inside it, the same file was indexed twice and Doc Search refused to open at all. It now ignores the repeat. If this was happening to you, it fixes itself on first launch — you don't need to change your folders.",
    ],
  },
  {
    version: "1.2.4",
    headline: "The 2NR gets partner lanes too.",
    items: [
      "**Two 2NR columns when you flow aff.** 1.2.3 left the 2NR out, which was wrong: flowing aff you are taking the 2NR down while your partner writes the 2AR, which is exactly what lanes are for. Flowing aff now splits the **1NC**, the **Neg Block** *and* the **2NR**.",
      "**The 2AR still doesn't split, on purpose.** The only speeches left single are a 1AC — read off a prepared document — and whichever speech closes the round, because there is nothing left to prep behind it. Both new columns collapse from their own header like every other lane.",
    ],
  },
  {
    version: "1.2.3",
    headline: "A lane for every speech you have to flow, and either one collapses.",
    items: [
      "**Two columns for every opponent speech you flow.** Flowing neg you now get two **2AC** columns *and* two **1AR** columns; flowing aff, two **1NC** and two **Neg Block**. Their first speech and their last rebuttal are left alone — a 1AC is read off a prepared document, and nobody is prepping through a 2NR.",
      "**Collapse either lane, from the lane itself.** **⇤** on any lane header folds *that* column away — your own as readily as your partner's — and **⇥** on the one still showing brings it back. The toolbar's Hide partner button is gone: with two split speeches on a flow it could no longer say which lane it meant. A group always keeps one lane on screen, so there is always a header to click. Collapsing stays purely visual and never changes what you send to the speech doc.",
      "**Importing a speech doc fills your lane, not your partner's.** You can both import the same 1NC without landing on top of each other. Matching a doc to its column by filename works on split speeches again too.",
      "**Quick cards keep their formatting.** Dragging or clicking one onto the flow dropped the underlining, the highlighting, emphasis and cite — everything arrived as flat text, and sending that cell on to the speech doc gave you an unmarked card. All of it survives now.",
      "**The what's-new panel only appears once.** It came back on every launch until you explicitly closed it, so quitting Nimbus while it was still open meant seeing it again the next time you opened the app.",
    ],
  },
  {
    version: "1.2.1",
    headline: "Answer a block part by part, all the way down the flow.",
    items: [
      "**Automatic updates are switched on.** This is the last build you have to install by hand — from here on Nimbus checks for a new version on its own and can install it for you.",
      "**Every part of a block gets its own row.** Expand an inserted block and each part gets a proper flow tile in *every* speech after it, lined up exactly with the part it answers — so you answer their third card, they answer that, you answer that, out to the last speech. The tiles mark as cards or analytics like any other cell, each partner lane keeps its own, and the whole chain folds away when you collapse the block and comes back untouched when you open it.",
      "**Ctrl+Enter works inside a block.** It inserts a blank row into the block — below the argument you're on, or above it with Ctrl+Shift+Enter — and puts your cursor straight in it, the same way it makes a row on the rest of the flow. Every speech gets a tile for the new row, including rows you type yourself, so nothing you add is a dead end.",
      "**A block's parts read like flow cells now.** Same ink as the column they sit in, the card/analytic bar down the left edge, the chip in the corner, and the cite author leading in bold the way an inserted card does. The only thing marking a part or an answer out is a faint halo saying it belongs to the block.",
      "**Quick cards keep everything you highlighted.** Capturing a selection that spanned more than one block kept the first heading and quietly demoted the second to plain text, losing its type.",
      "**Dragging a quick card onto the flow works.** It never did — the panel's click-outside-to-close layer covered the whole grid, so the flow never saw the drop.",
      "**The toolbar says what its buttons do.** Speech doc, Quick cards, Timer, Arguments, Partner flow, Manual, Settings and Keys now carry their names instead of being unlabelled icons. The condensed bar and narrow windows still get the compact icons.",
      "**Analytic / Card from the toolbar works inside a block tile.** It was marking the whole cell around the tile; only the keyboard shortcuts did the right thing.",
      "**Hiding your partner's lane hides THEIRS.** When you were looking at your partner's flow in an \"a flow each\" session, ⇤ and the Hide partner button hid your own column instead of theirs, and your partner's lane was the one highlighted as yours.",
      "**Your own lane says \"You\" on both computers.** On a split speech you both saw \"You\" on the *same* column — whoever created the flow — so the person who joined had their own lane labelled \"Partner\". Each of you now sees your own column as \"You\" and your partner's as \"Partner\".",
      "**Leaving a session leaves you on your own flow.** Clicking Leave while you were reading your partner's page used to close your flow and leave you sitting on theirs.",
      "**The manual covers the rest of the app now** — partner flowing and lanes, prep clocks, the argument bank, the answer link, tournaments, and the toolbar.",
    ],
  },
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
