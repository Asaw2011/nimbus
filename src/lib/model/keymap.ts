// Remappable keybindings. Core grid motions (Enter, Tab, arrows) are fixed —
// they're the Excel/paper muscle memory the app is built around. Everything
// else can be rebound in Settings.

export interface Combo {
  key: string; // KeyboardEvent.key, lowercase for letters
  mod?: boolean; // ⌘ on Mac / Ctrl elsewhere
  shift?: boolean;
  alt?: boolean;
}

export type ActionId =
  | "insertRowBelow"
  | "insertRowAbove"
  | "insertRow3Below"
  | "insertRow3Above"
  | "deleteRow"
  | "clearCell"
  | "jumpFilledUp"
  | "jumpFilledDown"
  | "extendArg"
  | "replyToArg"
  | "markDropped"
  | "markStarred"
  | "markAnalytic"
  | "markCard"
  | "newSheet"
  | "prevSheet"
  | "nextSheet"
  | "moveSheetLeft"
  | "moveSheetRight"
  | "toggleSpread"
  | "toggleDoc"
  | "toggleTimer"
  | "goHome"
  | "toggleHelp"
  | "openSettings"
  | "openDocSearch"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "authorLookup"
  | "sendCellsToDoc"
  | "sendRowToDoc"
  | "removeFromDoc"
  | "undo"
  | "redo"
  // Speech-doc editor actions (only fire while the doc has focus).
  | "docBody"
  | "docPocket"
  | "docHat"
  | "docBlock"
  | "docTag"
  | "docAnalytic"
  | "docUndertag"
  | "docCite"
  | "docEmphasis"
  | "docUnderline"
  | "docClearFormat"
  | "docBold"
  | "docItalic"
  | "docFind"
  | "docQuickCards"
  | "sendToSpeechCursor";

export const ACTION_LABELS: Record<ActionId, string> = {
  insertRowBelow: "Insert row below",
  insertRowAbove: "Insert row above",
  insertRow3Below: "Insert several rows below",
  insertRow3Above: "Insert several rows above",
  deleteRow: "Delete row",
  clearCell: "Delete cell (this cell only — the row stays)",
  jumpFilledUp: "Jump to filled cell above (in column)",
  jumpFilledDown: "Jump to filled cell below (in column)",
  extendArg: "Extend argument (arrow to next speech)",
  replyToArg: "Answer this argument (jump to your reply, linked)",
  markDropped: "Mark dropped",
  markStarred: "Star (must answer)",
  markAnalytic: "Mark as analytic (colors ink)",
  markCard: "Mark as card (colors ink)",
  newSheet: "New sheet",
  prevSheet: "Previous sheet (left)",
  nextSheet: "Next sheet (right)",
  moveSheetLeft: "Move sheet left (reorder)",
  moveSheetRight: "Move sheet right (reorder)",
  toggleSpread: "Spread view (multiple sheets at once)",
  toggleDoc: "Open / close the speech doc",
  toggleTimer: "Open / close the timer",
  goHome: "Round home",
  toggleHelp: "Show keybinds",
  openSettings: "Open settings",
  openDocSearch: "Doc Search (search prep files)",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Reset zoom to 100%",
  authorLookup: "Argument lookup (autocomplete banked cards + analytics)",
  sendCellsToDoc: "Send selected cell(s) to the speech doc",
  sendRowToDoc: "Send the whole row to the speech doc (flow order)",
  removeFromDoc: "Clear cell & remove its card from the speech doc",
  undo: "Undo",
  redo: "Redo",
  docBody: "Body text",
  docPocket: "Pocket heading",
  docHat: "Hat heading",
  docBlock: "Block heading",
  docTag: "Tag (card)",
  docAnalytic: "Analytic",
  docUndertag: "Undertag",
  docCite: "Cite mark",
  docEmphasis: "Emphasis mark",
  docUnderline: "Underline mark",
  docClearFormat: "Clear formatting",
  docBold: "Bold",
  docItalic: "Italic",
  docFind: "Find in document",
  docQuickCards: "Quick cards (save / insert snippets)",
  sendToSpeechCursor: "Send card to ★ speech doc at cursor (vs ` = end)",
};

/** Each action can have any number of bindings (including none). */
export const DEFAULT_KEYMAP: Record<ActionId, Combo[]> = {
  insertRowBelow: [{ key: "enter", mod: true }],
  insertRowAbove: [{ key: "enter", mod: true, shift: true }],
  insertRow3Below: [{ key: "enter", mod: true, alt: true }],
  insertRow3Above: [{ key: "enter", mod: true, alt: true, shift: true }],
  deleteRow: [{ key: "backspace", mod: true, shift: true }],
  // Ctrl/⌘+Alt+Backspace — sits beside Delete row (Ctrl+Shift+Backspace): same
  // key, different modifier, so the pair reads as "cell vs row".
  //
  // This was Ctrl+Shift+Delete and that DID NOT WORK in the packaged build.
  // WebView2 handles Ctrl+Shift+Delete itself (the browser "clear browsing
  // data" accelerator) and never forwards it to the page, so the keybind was
  // silently dead while every other bind on the same handler worked. Note this
  // is NOT true of browser accelerators generally — Ctrl+Shift+C (devtools
  // inspect) and Ctrl+D (bookmark) both reach the page fine and are already
  // bound here; only the few Edge handles at browser level get eaten. Don't
  // reintroduce a binding on those.
  //
  // Also deliberately NOT plain Ctrl+Delete (taken by removeFromDoc) and NOT
  // Ctrl+Backspace, which would shadow delete-previous-word while typing.
  clearCell: [{ key: "backspace", mod: true, alt: true }],
  // Excel's "jump to the data". Shares Ctrl/⌘+↑/↓ with docUnderline/docEmphasis
  // — a FOURTH deliberate cross-surface collision (see the note above): these
  // fire from GridCell's editor, those from the speech doc's, so neither can
  // reach the other. Rebindable in Settings → Keyboard if the overlap grates.
  jumpFilledUp: [{ key: "arrowup", mod: true }],
  jumpFilledDown: [{ key: "arrowdown", mod: true }],
  extendArg: [{ key: "g", mod: true }],
  // Pairs with extendArg on Ctrl/⌘+G: same key, shifted, opposite direction
  // (extend goes to your NEXT speech, reply goes to the opponent’s). Checked
  // free against every other Ctrl+Shift binding here.
  replyToArg: [{ key: "g", mod: true, shift: true }],
  markDropped: [{ key: "d", mod: true }],
  markStarred: [{ key: "s", mod: true, shift: true }],
  markAnalytic: [{ key: "a", mod: true, shift: true }],
  markCard: [{ key: "c", mod: true, shift: true }],
  newSheet: [{ key: "t", mod: true }],
  prevSheet: [{ key: "[", mod: true }],
  nextSheet: [{ key: "]", mod: true }],
  moveSheetLeft: [{ key: "arrowleft", mod: true, shift: true }],
  moveSheetRight: [{ key: "arrowright", mod: true, shift: true }],
  toggleSpread: [{ key: "b", mod: true }],
  // Was hard-wired to ⌘D, which collided with Mark dropped. Its own rebindable
  // action now, on a free key.
  toggleDoc: [{ key: "e", mod: true }],
  // NOT Ctrl/⌘+T — that is newSheet, and both handlers are window-level on the
  // flow, so sharing it would genuinely double-fire (not a cross-surface
  // overlap like the ⌘↑/↓ pair). Ctrl+Shift+T was the other candidate and was
  // passed over deliberately: it's the browser "reopen closed tab" accelerator,
  // the same class as Ctrl+Shift+Delete, which WebView2 ate silently in the
  // packaged build. Ctrl/⌘+Alt+T has no browser or menu meaning at all.
  toggleTimer: [{ key: "t", mod: true, alt: true }],
  goHome: [{ key: "0", mod: true }],
  toggleHelp: [{ key: "/", mod: true }],
  openSettings: [{ key: ",", mod: true }],
  openDocSearch: [{ key: "k", mod: true }],
  zoomIn: [{ key: "=", mod: true }],
  zoomOut: [{ key: "-", mod: true }],
  zoomReset: [{ key: "0", mod: true, shift: true }],
  // NOT ⌘Space — macOS Spotlight eats that before the app sees it. ⌘J is free.
  authorLookup: [{ key: "j", mod: true }],
  // Flow → speech doc sends. Bare ` (the tilde key) sends the cell/selection;
  // Ctrl+` the whole row; Ctrl+Delete clears the cell and pulls its card back
  // out of the doc. (` / Ctrl+` mirror the doc-side send binds by design.)
  sendCellsToDoc: [{ key: "`" }],
  sendRowToDoc: [{ key: "`", mod: true }],
  removeFromDoc: [{ key: "delete", mod: true }],
  undo: [{ key: "z", mod: true }],
  redo: [{ key: "z", mod: true, shift: true }, { key: "y", mod: true }],
  // Speech-doc styles/marks (match the CardMirror personal binds shown on the
  // toolbar). These only fire while the doc editor has focus.
  docBody: [{ key: "0", mod: true }],
  docPocket: [{ key: "1", mod: true }],
  docHat: [{ key: "2", mod: true }],
  docBlock: [{ key: "3", mod: true }],
  docTag: [{ key: "4", mod: true }],
  docAnalytic: [{ key: "5", mod: true }],
  docUndertag: [{ key: "6", mod: true }],
  docCite: [{ key: "9", mod: true }],
  docEmphasis: [{ key: "arrowdown", mod: true }],
  docUnderline: [{ key: "arrowup", mod: true }],
  docClearFormat: [{ key: "arrowleft", mod: true }],
  docBold: [{ key: "b", mod: true }],
  docItalic: [{ key: "i", mod: true }],
  docFind: [{ key: "f", mod: true }],
  docQuickCards: [{ key: "'", mod: true }],
  sendToSpeechCursor: [{ key: "`", mod: true }],
};

/** Keybind actions grouped into sections for the Settings UI. Every ActionId
 *  must appear in exactly one group. */
export interface ActionGroup { title: string; actions: ActionId[]; }
export const ACTION_GROUPS: ActionGroup[] = [
  {
    title: "Rows & cells",
    actions: ["insertRowBelow", "insertRowAbove", "insertRow3Below", "insertRow3Above", "deleteRow", "clearCell", "jumpFilledUp", "jumpFilledDown"],
  },
  {
    title: "Flowing & marks",
    actions: ["extendArg", "replyToArg", "markDropped", "markStarred", "markAnalytic", "markCard", "authorLookup"],
  },
  {
    title: "Send to speech doc",
    actions: ["sendCellsToDoc", "sendRowToDoc", "removeFromDoc"],
  },
  {
    title: "Sheets",
    actions: ["newSheet", "prevSheet", "nextSheet", "moveSheetLeft", "moveSheetRight"],
  },
  {
    title: "View & zoom",
    actions: ["toggleSpread", "toggleDoc", "toggleTimer", "goHome", "openDocSearch", "zoomIn", "zoomOut", "zoomReset"],
  },
  {
    title: "App",
    actions: ["undo", "redo", "toggleHelp", "openSettings"],
  },
  {
    title: "Speech doc",
    actions: [
      "docPocket", "docHat", "docBlock", "docTag", "docAnalytic", "docUndertag", "docBody",
      "docCite", "docEmphasis", "docUnderline", "docClearFormat", "docBold", "docItalic", "docFind", "docQuickCards",
      "sendToSpeechCursor",
    ],
  },
];

/** Fixed behaviors that live OUTSIDE the remappable keymap — the sheet-number
 *  jumps, clipboard, Save, and the core grid motions. They can't be rebound,
 *  but the rebinder warns before letting a new binding shadow one of them, so
 *  "silent" overlaps like the old ⌘D one can't creep back in. */
export const RESERVED_COMBOS: { combo: Combo; label: string }[] = [
  { combo: { key: "c", mod: true }, label: "Copy cells" },
  { combo: { key: "v", mod: true }, label: "Paste cells" },
  { combo: { key: "s", mod: true }, label: "Save flow" },
  ...Array.from({ length: 9 }, (_, i) => ({
    combo: { key: String(i + 1), mod: true } as Combo,
    label: `Jump to sheet ${i + 1}`,
  })),
  { combo: { key: "enter" }, label: "Next row (grid motion)" },
  { combo: { key: "enter", shift: true }, label: "New line in cell (grid motion)" },
  { combo: { key: "tab" }, label: "Next speech (grid motion)" },
  { combo: { key: "tab", shift: true }, label: "Previous speech (grid motion)" },
  { combo: { key: "arrowup" }, label: "Move up (grid motion)" },
  { combo: { key: "arrowdown" }, label: "Move down (grid motion)" },
  { combo: { key: "arrowleft" }, label: "Move left (grid motion)" },
  { combo: { key: "arrowright" }, label: "Move right (grid motion)" },
];

/** Default count for the two bulk row-insert actions. User-editable in Settings. */
export const DEFAULT_BULK_ROWS = 3;

/** Action label, with the live bulk-row count folded into the two bulk actions. */
export function actionLabel(action: ActionId, bulkRows: number): string {
  if (action === "insertRow3Below") return `Insert ${bulkRows} rows below`;
  if (action === "insertRow3Above") return `Insert ${bulkRows} rows above`;
  return ACTION_LABELS[action];
}

export function matches(e: KeyboardEvent, combo: Combo): boolean {
  return (
    e.key.toLowerCase() === combo.key &&
    (e.metaKey || e.ctrlKey) === !!combo.mod &&
    e.shiftKey === !!combo.shift &&
    e.altKey === !!combo.alt
  );
}

export function matchesAny(e: KeyboardEvent, combos: Combo[] | undefined): boolean {
  return !!combos?.some((c) => matches(e, c));
}

export function sameCombo(a: Combo, b: Combo): boolean {
  return (
    a.key === b.key &&
    !!a.mod === !!b.mod &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  );
}

/** Label of the reserved (fixed) behavior `combo` would shadow, or null. */
export function reservedBinding(combo: Combo): string | null {
  return RESERVED_COMBOS.find((r) => sameCombo(r.combo, combo))?.label ?? null;
}

// Mac uses compact symbols with no separator (⌘⇧↵); Windows/Linux use word
// modifiers joined with "+" (Ctrl+Shift+Enter) — the native, readable style,
// and no cramped ⇧ arrow.
const KEY_LABELS_MAC: Record<string, string> = {
  enter: "↵",
  backspace: "⌫",
  delete: "⌦",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  " ": "Space",
};
const KEY_LABELS_WIN: Record<string, string> = {
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  " ": "Space",
};

export function comboLabel(combo: Combo, isMac: boolean): string {
  const parts: string[] = [];
  if (isMac) {
    if (combo.mod) parts.push("⌘");
    if (combo.alt) parts.push("⌥");
    if (combo.shift) parts.push("⇧");
    parts.push(KEY_LABELS_MAC[combo.key] ?? combo.key.toUpperCase());
    return parts.join("");
  }
  if (combo.mod) parts.push("Ctrl");
  if (combo.shift) parts.push("Shift");
  if (combo.alt) parts.push("Alt");
  parts.push(KEY_LABELS_WIN[combo.key] ?? combo.key.toUpperCase());
  return parts.join("+");
}

export function combosLabel(combos: Combo[] | undefined, isMac: boolean): string {
  if (!combos || combos.length === 0) return "—";
  return combos.map((c) => comboLabel(c, isMac)).join(" / ");
}

/** Build a Combo from a keydown event during rebinding; null for bare modifiers. */
export function comboFromEvent(e: KeyboardEvent): Combo | null {
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;
  return {
    key: e.key.toLowerCase(),
    mod: e.metaKey || e.ctrlKey || undefined,
    shift: e.shiftKey || undefined,
    alt: e.altKey || undefined,
  };
}
