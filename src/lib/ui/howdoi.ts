// "How do I…?" - the answers behind the search panel (HowDoI.svelte).
//
// Written from the Manual and the code, not from memory: every step here is
// something the app does today. When a feature changes, change its entry too -
// a confident wrong answer is worse than none.
//
// `keys` are shown live from the user's own keymap, so a rebound shortcut
// shows correctly. `run` names something FlowView can open for you ("Do it");
// actions that work on a cell (marks, extend, answer) deliberately have none -
// they need your cursor in the cell, so the answer tells you the key instead.

import type { ActionId } from "../model/keymap";

/** What "Do it" can open. FlowView maps each one to the same function its
 *  button or shortcut already calls. */
export type HowRun =
  | "doc" | "spread" | "timer" | "search" | "home" | "newSheet"
  | "settings" | "partner" | "quick" | "bank";

export interface HowTo {
  id: string;
  title: string;
  /** Extra words people might search with - synonyms, debate slang. */
  words: string;
  /** What it is / why, in a sentence or two. */
  body: string;
  steps?: string[];
  keys?: ActionId[];
  /** A fixed key that isn't in the rebindable keymap, shown as-is. */
  fixedKey?: string;
  run?: HowRun;
  runLabel?: string;
  /** Manual section id (Manual.svelte `sec-<id>`). */
  manual?: string;
  /** Shown when the search box is empty. */
  popular?: boolean;
}

export const HOWTOS: HowTo[] = [
  // ---- the grid ------------------------------------------------------------
  {
    id: "type", popular: true,
    title: "Flow an argument",
    words: "type write cell start begin enter text column speech row",
    body: "The grid works like paper or Excel: columns are speeches, rows are arguments. Click any cell and type - there's nothing to create first.",
    steps: [
      "Enter or ↓ moves to the next row; Tab moves to the next speech.",
      "Shift+Enter starts a new line inside the same cell.",
      "Arguments that answer each other go on the same row.",
    ],
    manual: "grid",
  },
  {
    id: "rows", popular: true,
    title: "Add or delete a row",
    words: "insert row new line space gap remove delete row clear cell",
    body: "Make room for an argument you missed, or take a row out. Rows go across every speech, so the flow stays lined up.",
    keys: ["insertRowBelow", "insertRowAbove", "insertRow3Below", "deleteRow", "clearCell"],
    manual: "grid",
  },
  {
    id: "undo",
    title: "Undo a mistake",
    words: "undo redo oops back revert",
    body: "Undo and redo work across the whole flow, many steps deep.",
    keys: ["undo", "redo"],
    manual: "grid",
  },
  {
    id: "select",
    title: "Select, copy and paste cells",
    words: "select range copy paste move drag shift arrows multiple cells excel tsv",
    body: "Hold Shift and use the arrow keys (or drag across cells) to select a block. Copy and paste it like a spreadsheet, drag it to move it, or mark the whole selection at once.",
    fixedKey: "Shift + arrows, Ctrl/⌘ C / V",
    manual: "grid",
  },
  {
    id: "extend",
    title: "Extend an argument to the next speech",
    words: "extend arrow carry over next speech cross apply pull through",
    body: "Draws an arrow carrying your argument to your side's next speech, the way you'd draw it on paper.",
    steps: ["Click the argument.", "Press the key, or ➜ Extend on the toolbar."],
    keys: ["extendArg"],
    manual: "marks",
  },
  {
    id: "answer", popular: true,
    title: "Answer an argument (and link it)",
    words: "answer respond reply at: link which argument respond to their header",
    body: "Jumps from their argument to your reply cell in your next speech and links the two - so when you send it to the speech doc it's headed \"AT: their argument\", not a guess. If an AT: header in your speech doc names the wrong argument, this is the fix: link the answer to the right argument, then send it again.",
    steps: ["Click the argument you're answering.", "Press the key, or ↩ Answer on the toolbar.", "Type your answer in the cell it jumps to."],
    keys: ["replyToArg"],
    manual: "answer",
  },
  {
    id: "dropped",
    title: "Mark an argument dropped",
    words: "drop dropped conceded concede ignored no answer",
    body: "Marks a cell as dropped - an argument the other side never answered - so it stands out when you're writing your next speech.",
    steps: ["Click the cell.", "Press the key, or Dropped on the toolbar."],
    keys: ["markDropped"],
    manual: "marks",
  },
  {
    id: "star",
    title: "Star an argument you must answer",
    words: "star important must answer flag remember priority",
    body: "A star flags an argument you can't forget to answer.",
    keys: ["markStarred"],
    manual: "marks",
  },
  {
    id: "evidence",
    title: "Mark a card or an analytic",
    words: "card evidence analytic analysis color ink green purple",
    body: "Tells cards (evidence) and analytics (your own reasoning) apart at a glance - analytics get green ink, cards purple. It also decides how the cell is sent to the speech doc.",
    keys: ["markAnalytic", "markCard"],
    manual: "marks",
  },
  {
    id: "colors",
    title: "What do the colors mean?",
    words: "color colours blue red aff neg ink why",
    body: "Ink follows the speech, not the page: aff speeches are blue, neg speeches red, on every sheet - like flowing with two pens. Green ink is an analytic, purple a card. All of it can be changed in Settings → Appearance.",
    run: "settings", runLabel: "Open Settings",
    manual: "marks",
  },
  {
    id: "blockparts",
    title: "Answer a block card by card",
    words: "block expand parts tiles cards each card answer every card chain",
    body: "Expand a block you inserted, and every speech after it gets its own cell for each card in the block, lined up with it - so you answer their third card, they answer that, and so on to the last speech.",
    steps: ["Click ▸ N items on the block to expand it.", "Type answers in the tiles beside each card.", "Ctrl+Enter inside the block adds a row to it."],
    manual: "cells",
  },
  {
    id: "abbrev",
    title: "Type faster with abbreviations",
    words: "abbreviation shortcut autocomplete expand type faster t/ turn macro",
    body: "Short triggers expand as you type (t/ → Turn:). Set your own, and JavaScript macros for one-key argument blocks, in Settings → Editing.",
    run: "settings", runLabel: "Open Settings",
    manual: "macros",
  },

  // ---- sheets & views ------------------------------------------------------
  {
    id: "newsheet", popular: true,
    title: "Add a new page (advantage, off-case, CX)",
    words: "new sheet page tab flow position da cp k off case advantage overview cross ex add",
    body: "Each position gets its own page - a tab at the bottom. New pages ask what they are (Advantage, Off-case, Overview or CX), then a name.",
    steps: ["Press the key or click the + tab.", "Pick the kind (or press 1-4).", "Type a name, or just press Enter."],
    keys: ["newSheet"],
    run: "newSheet", runLabel: "New page",
    manual: "sheets",
  },
  {
    id: "rename",
    title: "Rename or delete a page",
    words: "rename page name title delete remove sheet tab flow position",
    body: "Type in a page's top cell (it says \"Page name\" while empty) and the tab renames itself. Or right-click the tab to rename or delete it.",
    manual: "sheets",
  },
  {
    id: "switch",
    title: "Switch between pages",
    words: "switch page next previous tab move reorder jump",
    body: "Move between pages without the mouse, or drag tabs to reorder them.",
    keys: ["prevSheet", "nextSheet", "moveSheetLeft", "moveSheetRight"],
    fixedKey: "Ctrl/⌘ 1-9 jumps to a page",
    manual: "sheets",
  },
  {
    id: "spread", popular: true,
    title: "See several flows at once",
    words: "spread stack split side by side multiple several many flows pages once desk paper view all both",
    body: "Lays several pages out together - stacked with the speech columns lined up, or side by side - like spreading paper flows across a desk.",
    steps: ["Press the key, or ▤ Stack / ◫ Split on the toolbar.", "Click tabs to put pages on or off the desk."],
    keys: ["toggleSpread"],
    run: "spread", runLabel: "Show spread view",
    manual: "spread",
  },
  {
    id: "cx",
    title: "Flow cross-ex",
    words: "cross ex cx cross examination questions answers",
    body: "A cross-ex page has questions on the left and answers on the right; Enter moves question → answer → next question. A bar at the top says whose cross-ex it is - in PF, which crossfire (Case CF, Reb CF, Grand CF).",
    steps: ["Add a new page and pick CX.", "Pick the speech being cross-examined in the bar at the top."],
    keys: ["newSheet"],
    run: "newSheet", runLabel: "New page",
    manual: "sheets",
  },
  {
    id: "zoom",
    title: "Make the flow bigger or smaller",
    words: "zoom bigger smaller text size font size scale",
    body: "Zoom the flow, or pinch on a trackpad. Text size and font are in Settings → Appearance.",
    keys: ["zoomIn", "zoomOut", "zoomReset"],
    manual: "fonts",
  },
  {
    id: "home",
    title: "Round details and judge feedback",
    words: "home round details judge feedback rfd ballot decision teams opponent",
    body: "The round's home page holds the teams, the judges, every ballot and your notes on the decision - plus importing speech docs and exporting the flow.",
    keys: ["goHome"],
    run: "home", runLabel: "Go to round home",
  },

  // ---- docs ----------------------------------------------------------------
  {
    id: "import1nc", popular: true,
    title: "Import their 1NC (or any speech doc)",
    words: "import docx speech doc 1nc their doc word file load off case sheets",
    body: "Drop in their .docx and each position becomes its own page, with every card tag as a row in the right column. Answer docs (AT: …) fill in the pages you already have. Cards are also saved for argument lookup.",
    steps: ["Go to the round's home page.", "Under Import speech doc, choose the file."],
    run: "home", runLabel: "Go to round home",
    manual: "import",
  },
  {
    id: "speechdoc", popular: true,
    title: "Open the speech doc",
    words: "speech doc document write speech cardmirror word cards highlight",
    body: "A full CardMirror speech doc lives beside your flow - highlight, underline, emphasis, read mode, and .docx in and out. You build your speech in it straight from the flow.",
    keys: ["toggleDoc"],
    run: "doc", runLabel: "Open the speech doc",
    manual: "doc",
  },
  {
    id: "send", popular: true,
    title: "Send cells to the speech doc",
    words: "send doc speech tilde backtick ` export cards to doc build speech",
    body: "Sends what you've selected to your speech doc, in flow order: typed cells as analytics, cards as cards, headed \"AT: the argument it answers\". Nothing goes to the doc unless you send it.",
    steps: ["Select a cell or a range of cells.", "Press the key (the one left of 1), or ⌖ Send Cell(s) on the toolbar.", "Ctrl+the same key sends your whole speech in that column."],
    keys: ["sendCellsToDoc", "sendRowToDoc", "removeFromDoc"],
    manual: "senddoc",
  },
  {
    id: "cardmirror",
    title: "Send cards to CardMirror",
    words: "cardmirror card mirror send desktop app external doc",
    body: "Switch Send to (top bar) from Doc to CardMirror, and sends go straight into CardMirror Desktop (1.5.0 or newer) with all the formatting - no plugin needed. If CardMirror isn't open, the card is copied to your clipboard instead.",
    manual: "senddoc",
  },
  {
    id: "docsearch", popular: true,
    title: "Search my prep files",
    words: "search prep files library find block card doc search folder dropbox",
    body: "Search every .docx and .cmir in your prep folders by name or by what's inside, browse a file's pockets/hats/blocks, and drop a block straight into the flow.",
    steps: ["Add your prep folders in Settings → Library (once).", "Press the key and search.", "Click a result to insert it, or drag it onto a cell."],
    keys: ["openDocSearch"],
    run: "search", runLabel: "Open Doc Search",
    manual: "search",
  },
  {
    id: "lookup",
    title: "Autocomplete a card I've seen before",
    words: "author lookup bank autocomplete card author argument bank remember",
    body: "In a cell, the lookup key lets you type an author or tag and complete the whole argument. It learns from the docs you import. The Arguments button edits what it offers.",
    keys: ["authorLookup"],
    run: "bank", runLabel: "Open Arguments",
    manual: "bank",
  },
  {
    id: "quick",
    title: "Save and reuse quick cards",
    words: "quick cards snippets save reuse favorite go to blocks",
    body: "Save bits of the speech doc you use again and again, then drag them onto the flow or drop them into the doc.",
    keys: ["docQuickCards"],
    run: "quick", runLabel: "Open Quick cards",
    manual: "quick",
  },
  {
    id: "smart", popular: true,
    title: "Get block suggestions (Smart blocks)",
    words: "smart blocks suggestions suggest auto block answer kit 2ac file beta",
    body: "Load your files for the round, and when the other team makes an argument Nimbus suggests the block from YOUR files that answers it - one click puts it in your next speech. It matches block headings; it doesn't read cards. Beta.",
    steps: [
      "Turn it on in Settings → Experimental.",
      "Click ✦ Smart blocks in the bottom-right corner of the flow.",
      "Under Kit, add the files for this round.",
      "Click Insert on a suggestion.",
    ],
    run: "settings", runLabel: "Open Settings",
    manual: "smart",
  },
  {
    id: "your2ac",
    title: "Send my whole 2AC off-case to the doc at once",
    words: "2ac off-case offcase send all whole speech doc blocks at once every page your 2ac",
    body: "With 2AC off-case ticked in the Smart blocks tray, a \"Your 2AC\" box at the top lists each off-case page and how much of your 2AC is on it. Send all to doc puts every page's 2AC in the speech doc in one go, each under its page name - T first, then your tabs; drag a page by its ⋮⋮ to change the order. In LD it's your 1AR, in PF your rebuttal.",
    steps: [
      "Open ✦ Smart blocks (bottom-right of the flow) and tick 2AC off-case.",
      "Insert your 2AC blocks as usual - they go on the flow.",
      "Click Send all to doc in the Your 2AC box (or Send on one page).",
    ],
    manual: "smart",
  },
  {
    id: "answernumbers",
    title: "Number my answers (1NC1, 2AC 2-3)",
    words: "number answers line up 1nc1 2ac1 2nc order group grouped 2-3 numbering label which argument",
    body: "Turn on Answer numbers (Settings → Experimental) and your 2AC answers on case pages get the number of the 1NC argument they answer (1NC1, 1NC2…), your 2NC/1NR answers the 2AC's (2AC1, 2AC 2-3…). In LD it's the 1AR (by the NC) and the NR (by the 1AR); in PF the rebuttals. Each new answer takes the next number by itself. Sending the column puts the answers in number order, each under its number and a [xxx] line with what they said - even if you answered 2AC 2 before 2AC 1. Not for later speeches (1AR, 2NR, 2AR) or off-case 2ACs.",
    steps: [
      "Settings → Experimental → tick Answer numbers.",
      "Answer in order - each answer gets the next number (shown on the cell; click it to change).",
      "Out of order or grouped? Use ‹ › or + on the column's header before you answer.",
      "Ctrl+` (left of 1) sends the column in number order.",
    ],
    keys: ["answerNext", "answerPrev", "answerGroup", "answerUngroup"],
    run: "settings", runLabel: "Open Settings",
    manual: "senddoc",
  },

  // ---- partner -------------------------------------------------------------
  {
    id: "partner", popular: true,
    title: "Flow with my partner",
    words: "partner flow together share live code join connect teammate sync",
    body: "Pairs your Nimbus with your partner's over the internet, so you see each other's flow live. Share one flow, or keep a flow each and still edit each other's.",
    steps: [
      "One of you clicks Partner (top bar) → Start & get a code, and reads out the 6-character code.",
      "The other clicks Partner, types the code and clicks Join.",
      "The first clicks Let them in - the joiner's email is shown.",
    ],
    run: "partner", runLabel: "Open Partner",
    manual: "partner",
  },
  {
    id: "lanes",
    title: "Stop typing over each other (two columns for one speech)",
    words: "lanes two columns you partner split speech side aff neg typing over overwrite same cell conflict collapse",
    body: "To flow the same speech without typing over each other, start the flow with your side picked - With a partner · Aff or With a partner · Neg on the home screen. Then each opponent speech you flow while your partner preps gets two columns, one for you and one for your partner, both answering the same speech. While you're connected, cells your partner has written are read-only to you, so a stray keystroke can't replace their work. (The side is chosen when the flow is made and can't be changed later. ⇤ on a column header only hides that column on your own screen.)",
    manual: "partner",
  },
  {
    id: "partnercolor",
    title: "What does the partner button's color mean?",
    words: "partner button color green grey gray amber yellow red minimized away lagging offline disconnected",
    body: "Green: connected, everything is reaching your partner. Grey (minimized / away): your partner's Nimbus is minimized or quiet - you're still connected and nothing is lost. Blinking amber: YOUR connection is struggling; keep flowing, it catches up. Red: not connected to your partner.",
    run: "partner", runLabel: "Open Partner",
    manual: "partner",
  },
  {
    id: "rejoin",
    title: "Get back into a partner session",
    words: "rejoin reconnect session lost dropped came back reopen",
    body: "Reopen the flow you were sharing and the Partner panel offers the room back. Hosting resumes the same code; joining needs your partner's approval again. It never reconnects on its own, because joining replaces your flow with theirs.",
    run: "partner", runLabel: "Open Partner",
    manual: "partner",
  },

  // ---- clocks --------------------------------------------------------------
  {
    id: "timer", popular: true,
    title: "Time a speech",
    words: "timer speech time clock countdown stopwatch alarm pop out",
    body: "The speech timer counts down with presets - your event's speech times (policy, LD or PF, by the round you have open; edit them in Settings → Appearance) - and can pop out into its own small window that stays on top of CardMirror. Its alarm rings until you stop it.",
    steps: ["Open the timer.", "The pop-out button moves it into its own always-on-top window."],
    keys: ["toggleTimer"],
    run: "timer", runLabel: "Open the timer",
    manual: "prep",
  },
  {
    id: "prep",
    title: "Track prep time",
    words: "prep time clock remaining minutes team",
    body: "Both teams' prep clocks sit at the right of the toolbar. Press ▶ to run one - starting one stops the other. Click the time to fix it by hand, right-click to reset. The length is in Settings → Appearance, per event (8 min policy, 4 LD, 3 PF by default).",
    manual: "prep",
  },

  // ---- files & setup -------------------------------------------------------
  {
    id: "save",
    title: "Save or export a flow",
    words: "save export excel xlsx nimbus file report html backup",
    body: "Flows save automatically. Ctrl/⌘+S writes the flow to its file; the round's home page can export it to Excel (.xlsx), a .nimbus file, or an HTML report.",
    fixedKey: "Ctrl/⌘ S",
    run: "home", runLabel: "Go to round home",
    manual: "files",
  },
  {
    id: "excel",
    title: "Open my Excel flows",
    words: "excel xlsx spreadsheet verbatim open old flows convert import flow",
    body: "Nimbus opens .xlsx flows, Verbatim's included. On the home screen, Open a flow picks the file; Convert turns a flow into the other format. You can keep saving to Excel if you like.",
    manual: "files",
  },
  {
    id: "tournaments",
    title: "Organize flows into tournaments",
    words: "tournament folder organize dropbox link folder home dashboard",
    body: "On the home screen a tournament is a real folder. Make one, or link an existing folder (Dropbox is fine) and every flow inside it shows up - including per-round subfolders.",
    manual: "tournaments",
  },
  {
    id: "sample",
    title: "Practice on a sample round",
    words: "sample practice demo example try learn tutorial",
    body: "The home screen's \"Try a sample round\" opens a filled-in practice flow. Try anything - it's only saved if you change something.",
  },
  {
    id: "keys",
    title: "Change a keyboard shortcut",
    words: "keybind shortcut hotkey change rebind keyboard keys",
    body: "Every shortcut except the basic motions can be rebound in Settings → Keyboard, with more than one key per action.",
    keys: ["openSettings"],
    run: "settings", runLabel: "Open Settings",
    manual: "keys",
  },
  {
    id: "theme",
    title: "Change the theme or font",
    words: "theme dark light mode color font appearance look",
    body: "Settings → Appearance has the themes (dark, light and several tinted ones), fonts, sizes and every ink color.",
    keys: ["openSettings"],
    run: "settings", runLabel: "Open Settings",
    manual: "settings",
  },
  {
    id: "offline",
    title: "Use Nimbus without internet",
    words: "offline wifi internet no connection tournament wifi works without",
    body: "Nimbus works fully offline once you've signed in once: flowing, the speech doc, Doc Search, importing and saving all run on your computer. Only partner flowing, AI help and update checks need the internet - everything else keeps working when tournament wifi doesn't.",
    manual: "start",
  },
  {
    id: "update",
    title: "Update Nimbus",
    words: "update version new version upgrade install latest",
    body: "Nimbus checks for updates by itself shortly after it starts and offers to install them. To check now: Settings → Backup.",
    run: "settings", runLabel: "Open Settings",
    manual: "settings",
  },
];

/**
 * Lowercase, punctuation to spaces. "AT:" is a debate word (an answer header),
 * not the preposition, so it survives as its own token before the colon goes.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/\bat:/g, " atcolon ").replace(/[^a-z0-9`]+/g, " ").trim();
}

/** Filler that says nothing about what someone wants ("how do I see two flows"). */
const STOP = new Set([
  "a", "an", "the", "i", "my", "me", "how", "do", "does", "to", "in", "on", "of",
  "for", "with", "can", "what", "is", "it", "at", "and", "or", "this", "that", "two",
  "get", "make", "want", "where",
]);

/**
 * Entries matching most words of the query (a word may match the start of any
 * word in the entry), best first: more words matched beats fewer, then a title
 * hit outweighs a synonym, which outweighs the explanation.
 */
export function searchHowTos(query: string): HowTo[] {
  const all = norm(query).split(" ").filter(Boolean);
  const meaningful = all.filter((t) => !STOP.has(t));
  const terms = meaningful.length ? meaningful : all;
  if (!terms.length) return [];
  const need = Math.max(1, Math.ceil(terms.length * 0.6));
  const scored: Array<{ h: HowTo; score: number }> = [];
  for (const h of HOWTOS) {
    const fields: Array<[string[], number]> = [
      [norm(h.title).split(" "), 3],
      [norm(h.words).split(" "), 2],
      [norm(h.body).split(" "), 1],
    ];
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      let best = 0;
      for (const [words, w] of fields) {
        if (words.some((x) => x === t)) best = Math.max(best, w + 0.5);
        else if (t.length >= 2 && words.some((x) => x.startsWith(t))) best = Math.max(best, w);
      }
      if (best) { matched++; score += best; }
    }
    if (matched >= need) scored.push({ h, score: matched * 10 + score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.h);
}
