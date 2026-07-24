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
  | "moveDownRows"
  | "deleteRow"
  | "extendArg"
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
  | "goHome"
  | "toggleHelp"
  | "openSettings"
  | "openDocSearch"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "authorLookup"
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
  | "docQuickCards";

export const ACTION_LABELS: Record<ActionId, string> = {
  insertRowBelow: "Insert row below",
  insertRowAbove: "Insert row above",
  insertRow3Below: "Insert several rows below",
  insertRow3Above: "Insert several rows above",
  moveDownRows: "Move cursor down several rows",
  deleteRow: "Delete row",
  extendArg: "Extend argument (arrow to next speech)",
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
  goHome: "Round home",
  toggleHelp: "Show keybinds",
  openSettings: "Open settings",
  openDocSearch: "Doc Search (search prep files)",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Reset zoom to 100%",
  authorLookup: "Argument lookup (autocomplete banked cards + analytics)",
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
};

/** Each action can have any number of bindings (including none). */
export const DEFAULT_KEYMAP: Record<ActionId, Combo[]> = {
  insertRowBelow: [{ key: "enter", mod: true }],
  insertRowAbove: [{ key: "enter", mod: true, shift: true }],
  insertRow3Below: [{ key: "enter", mod: true, alt: true }],
  insertRow3Above: [{ key: "enter", mod: true, alt: true, shift: true }],
  moveDownRows: [{ key: "\\", mod: true }],
  deleteRow: [{ key: "backspace", mod: true, shift: true }],
  extendArg: [{ key: "g", mod: true }],
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
  goHome: [{ key: "0", mod: true }],
  toggleHelp: [{ key: "/", mod: true }],
  openSettings: [{ key: ",", mod: true }],
  openDocSearch: [{ key: "k", mod: true }],
  zoomIn: [{ key: "=", mod: true }],
  zoomOut: [{ key: "-", mod: true }],
  zoomReset: [{ key: "0", mod: true, shift: true }],
  // NOT ⌘Space — macOS Spotlight eats that before the app sees it. ⌘J is free.
  authorLookup: [{ key: "j", mod: true }],
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
};

/** Keybind actions grouped into sections for the Settings UI. Every ActionId
 *  must appear in exactly one group. */
export interface ActionGroup { title: string; actions: ActionId[]; }
export const ACTION_GROUPS: ActionGroup[] = [
  {
    title: "Rows",
    actions: ["insertRowBelow", "insertRowAbove", "insertRow3Below", "insertRow3Above", "moveDownRows", "deleteRow"],
  },
  {
    title: "Flowing & marks",
    actions: ["extendArg", "markDropped", "markStarred", "markAnalytic", "markCard", "authorLookup"],
  },
  {
    title: "Sheets",
    actions: ["newSheet", "prevSheet", "nextSheet", "moveSheetLeft", "moveSheetRight"],
  },
  {
    title: "View & zoom",
    actions: ["toggleSpread", "goHome", "openDocSearch", "zoomIn", "zoomOut", "zoomReset"],
  },
  {
    title: "App",
    actions: ["toggleHelp", "openSettings"],
  },
  {
    title: "Speech doc",
    actions: [
      "docPocket", "docHat", "docBlock", "docTag", "docAnalytic", "docUndertag", "docBody",
      "docCite", "docEmphasis", "docUnderline", "docClearFormat", "docBold", "docItalic", "docFind", "docQuickCards",
    ],
  },
];

/** Default count for the two bulk row-insert actions. User-editable in Settings. */
export const DEFAULT_BULK_ROWS = 3;
export const DEFAULT_MOVE_ROWS = 4;

/** Action label, with the live bulk-row count folded into the two bulk actions. */
export function actionLabel(action: ActionId, bulkRows: number, moveRows = bulkRows): string {
  if (action === "insertRow3Below") return `Insert ${bulkRows} rows below`;
  if (action === "insertRow3Above") return `Insert ${bulkRows} rows above`;
  if (action === "moveDownRows") return `Move cursor down ${moveRows} rows`;
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

const KEY_GLYPHS: Record<string, string> = {
  enter: "↵",
  backspace: "⌫",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  " ": "Space",
};

// Spelled-out key names for Windows/Linux labels (Mac uses the compact glyphs).
const KEY_NAMES: Record<string, string> = {
  enter: "Enter",
  backspace: "Backspace",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  escape: "Esc",
  " ": "Space",
};

export function comboLabel(combo: Combo, isMac: boolean): string {
  if (isMac) {
    // Compact glyphs, no separators — the Mac convention (⌘⇧↵).
    const parts: string[] = [];
    if (combo.mod) parts.push("⌘");
    if (combo.shift) parts.push("⇧");
    if (combo.alt) parts.push("⌥");
    parts.push(KEY_GLYPHS[combo.key] ?? combo.key.toUpperCase());
    return parts.join("");
  }
  // Windows/Linux: word modifiers, "+" separators, spelled-out keys.
  const parts: string[] = [];
  if (combo.mod) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  parts.push(KEY_NAMES[combo.key] ?? combo.key.toUpperCase());
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
