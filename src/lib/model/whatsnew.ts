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
    version: "1.3.4",
    headline: "Nothing your partner types can go missing, and your own column stops calling itself \"Partner\".",
    items: [
      "**The home page scrolls all the way down again.** With more than a few tournaments, the bottom of the list was cut off — scrolling toward it pulled the page back up to the top instead of letting you reach it. The scrolling area was sized 40 pixels taller than the window it sits in, so the last of it was unreachable and the page underneath was being dragged instead.",
      "**Your partner's work can no longer be lost while you're on another flow.** If you opened a different flow during a session — flowing into the wrong one and copying it across, say — everything your partner wrote in the meantime arrived with nowhere to go and was dropped, for good. Their end had already counted it as sent, so it was never re-sent and going back to the flow didn't bring it. Nimbus now notices it missed something and asks for it again as soon as the flow is open.",
      "**Your own column says \"You\" again.** If you were the one who joined, your column was labelled **Partner** and your partner's said **You** — every time you left a session or reopened the flow. It was only ever right while the session was live, and it never happened to whoever hosted, which is why it was hard to pin down. Which lane is yours is now remembered with the flow.",
      "**You can't type over your partner's cell by accident.** With a cell of theirs selected, a stray keystroke could replace a line they had just written, and there was no getting it back — their text was never in your undo history. Their cells are now read-only while a session is live. **Empty ones still aren't**, so flowing a speech for them works exactly as before, and you can always select and copy.",
      "**Drag your tournaments into the order you want.** Grab the handle at the left of any folder on the home page and drag, or focus it and use the arrow keys. The order is saved.",
      "**Choose which side your column sits on.** When a speech is split between you and your partner, **Settings → My column** puts yours on the Left or the Right. Before this it depended on who started the session, so the two of you saw mirror images of the same flow. It only changes what you see.",
    ],
  },
  {
    version: "1.3.2",
    headline: "The other themes are back, and the sheet tabs can be made smaller.",
    items: [
      "**All the themes are back.** Snow, Paper, Cream, Sky, Mist and Slate return alongside Dark and Light, with exactly the colours they had — same backgrounds, same aff/neg ink. If you were using one of them and got moved to Light, pick it again in **Settings → Appearance** and it looks the way it did.",
      "**Sheet tabs come in three sizes.** The tab bar along the bottom got taller in 1.3.0, and every pixel of it is a bit of flow you can't see. **Settings → Sheet tabs → Tab size** offers Compact, Regular and Large — Compact is the old bar and gives you about half a row of flow back on a laptop. Regular is the new default, between the two.",
    ],
  },
  {
    version: "1.3.1",
    headline: "Importing a 1NC now gives your partner the off-case pages too.",
    items: [
      "**Off-case pages reach your partner.** Importing a 1NC created the pages on your screen and, often, on nobody else's — your partner had to build them by hand mid-round and the two flows drifted apart. A page made by an import arrives already full of cards, and the whole thing was being sent as one oversized message that the server quietly refused. Worse, nothing noticed: your computer treated it as delivered, so it was never sent again. Pages, rows and cards are now sent in pieces small enough to get through, and a big block of cards is split up rather than dropped. **You don't need to change how you import.**",
      "**Long blocks of cards sync in full.** The same limit was quietly cutting off individual cells holding a large expanded block — the page would look like it had synced with the biggest card in it missing. Those are sent in parts now and arrive complete.",
    ],
  },
  {
    version: "1.3.0",
    headline: "A cleaner, calmer Nimbus — same flow, less clutter.",
    items: [
      "**Two themes instead of five.** The theme picker is now just **Dark** and **Light** — a deep true-dark and a clean white, both on the same blue accent and the same aff/neg/analytic/card ink, so a flow looks the same in either one and nothing shifts color when you switch. The old in-between greys and paper tints are gone; if you were on one of them, Nimbus moves you to the nearest of the two and nothing you set is lost.",
      "**Crisp icons in place of emoji.** The toolbar, dashboard and tabs now use a single matched icon set that stays sharp at any size and takes the theme's color, instead of emoji that rendered differently on every machine. Everything means the same thing it did — it just looks like one app now.",
      "**Prep time lives with the other clocks.** The setting for how much prep each team gets moved out from under Appearance into its own **Prep clocks** section next to Timer presets, with a note that it sets new rounds — to change the round you're in, you still click the time in the ribbon and type over it.",
      "**A tidier dashboard and settings.** The round list and the settings window got a pass for spacing and alignment, so the app feels finished rather than busy. Nothing about where things are or what they do has changed.",
    ],
  },
  {
    version: "1.2.9",
    headline: "Nimbus stops freezing mid-round, and searching by content no longer downloads your whole Dropbox.",
    items: [
      "**The pauses while flowing are fixed.** On a big flow Nimbus could lock up for a second or two at a time, usually just as you were typing. Every undo step was keeping a complete copy of the round in memory, and three hundred of them on a full flow came to well over a gigabyte — so the app spent its time cleaning up memory instead of taking your keystrokes. Undo now keeps as much history as it can fit in a sensible amount of memory rather than a fixed number of steps: on an ordinary flow nothing changes and you still get the full three hundred, and on a very large one you get fewer steps but a responsive app. **Nothing about what a single undo does has changed.**",
      "**Partner flowing costs almost nothing when nobody is typing.** Four times a second, every second of a session, Nimbus was copying the entire flow and re-checking every cell to work out whether anything had changed — including while you were sitting listening to the other team. It now checks in an instant whether the flow has been touched at all and does the real work only when it has.",
      "**Judge feedback is your own.** In a partner session, feedback is no longer shared between the two of you — you each keep your own notes on what the judge said, which is usually not the same thing. Everything else still carries across as before: the judge's name, who you hit, the team names and the flow itself.",
      "**\"By content\" no longer starts reading your whole library the moment you click it.** If your prep is in Dropbox or OneDrive, the files are often stored online rather than on your computer, and reading them to search inside them quietly downloads every one — a mis-click could pull down hundreds of megabytes and tie the app up for several minutes with no way to stop it. Searching by content now works straight away on whatever has already been read, and bringing the rest up to date is a button you press. **You can stop it at any time**, and everything scanned so far is kept. Files that aren't downloaded to your computer are skipped and counted, so you can choose to fetch them rather than having it happen to you.",
    ],
  },
  {
    version: "1.2.8",
    headline: "Judge feedback in one block, and a reconnect that catches you up.",
    items: [
      "**Judge feedback is one box now.** Judge, who won, and everything they said — instead of separate boxes for the decision, the feedback and the speaker points. Nobody takes feedback down in categories; it arrives as bullet points in whatever order the judge says it. The box grows as you write and only starts scrolling once it is already about a screen tall. **Anything you recorded in the old boxes is kept** and appears in the new one.",
      "**Panels get an overall winner.** Three judges can split 2–1 and the round still has one result, so you can record it at the top. It has no feedback box of its own — that belongs to the judges underneath it.",
      "**Reconnecting catches you up on what you missed.** If your connection dropped, anything your partner wrote while you were away never reached you, and nothing re-sent it — their end had already counted it as delivered. Whoever comes back now gets the full current state of the flow. It merges with whatever you typed while you were offline rather than replacing it.",
    ],
  },
  {
    version: "1.2.7",
    headline: "Two partner-flowing fixes. Update if you flow with a partner.",
    items: [
      "**Your typing no longer jumps into the cell above.** When your partner added a row above the one you were in — pressing Enter, usually — the cursor stayed on the old row *number* instead of your row, so mid-word your caret was pulled into their new row and the rest of what you were writing landed there, mixed in with whatever it already said. It now follows your row wherever it moves.",
      "**\"AT:\" headers name the argument you're actually answering.** Sending an answer to the speech doc could head it with one of *your own* earlier arguments — an answer in the 1AR coming out as \"AT: <your own 2AC>\" — whenever the opponent's cell on that row was blank. And when the argument you were answering had been flowed by your partner rather than you, the answer arrived with no header at all. Both fixed: it looks for the other team's argument, prefers the one in your own lane, and falls back to your partner's lane instead of giving up.",
    ],
  },
  {
    version: "1.2.6",
    headline: "Partner flowing survives a dropped connection.",
    items: [
      "**Edits made while your connection is down now arrive when it comes back.** If you lost wifi for a few seconds and kept flowing — importing a 1NC, say — that work could be dropped without ever reaching your partner, and nothing would re-send it. Your partner's edits still reached you, so it looked like a one-way connection rather than lost work. Anything you flow while the connection is down is now sent the moment it returns.",
      "**The partner button tells you when you're not connected.** It only showed \"live\" or nothing, so a session that had *dropped* looked exactly like no session at all. A live session that isn't currently connected now turns amber and says so on the toolbar, and \"live\" means your partner is actually there — not just that the server answered.",
      "**Reopen a flow and you can jump straight back into its session.** Closing Nimbus or stepping out of a flow used to lose the room, so someone had to read the six-character code out again. The partner panel now offers **Rejoin** on the flow you were sharing. Hosting resumes the same code, so your partner reconnects on their own. It never reconnects by itself — joining replaces your flow with your partner's copy, so that stays your decision.",
    ],
  },
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
