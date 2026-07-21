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
  | "extendArg"
  | "markDropped"
  | "markStarred"
  | "markAnalytic"
  | "markCard"
  | "newSheet"
  | "toggleSpread"
  | "goHome"
  | "toggleHelp"
  | "openSettings";

export const ACTION_LABELS: Record<ActionId, string> = {
  insertRowBelow: "Insert row below",
  insertRowAbove: "Insert row above",
  insertRow3Below: "Insert 3 rows below",
  insertRow3Above: "Insert 3 rows above",
  deleteRow: "Delete row",
  extendArg: "Extend argument (arrow to next speech)",
  markDropped: "Mark dropped",
  markStarred: "Star (must answer)",
  markAnalytic: "Mark as analytic (colors ink)",
  markCard: "Mark as card (colors ink)",
  newSheet: "New sheet",
  toggleSpread: "Spread view (multiple sheets at once)",
  goHome: "Round home",
  toggleHelp: "Show keybinds",
  openSettings: "Open settings",
};

/** Each action can have any number of bindings (including none). */
export const DEFAULT_KEYMAP: Record<ActionId, Combo[]> = {
  insertRowBelow: [{ key: "enter", mod: true }],
  insertRowAbove: [{ key: "enter", mod: true, shift: true }],
  insertRow3Below: [{ key: "enter", mod: true, alt: true }],
  insertRow3Above: [{ key: "enter", mod: true, alt: true, shift: true }],
  deleteRow: [{ key: "backspace", mod: true, shift: true }],
  extendArg: [{ key: "g", mod: true }],
  markDropped: [{ key: "d", mod: true }],
  markStarred: [{ key: "s", mod: true, shift: true }],
  markAnalytic: [{ key: "a", mod: true, shift: true }],
  markCard: [{ key: "c", mod: true, shift: true }],
  newSheet: [{ key: "t", mod: true }],
  toggleSpread: [{ key: "b", mod: true }],
  goHome: [{ key: "0", mod: true }],
  toggleHelp: [{ key: "/", mod: true }],
  openSettings: [{ key: ",", mod: true }],
};

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

export function comboLabel(combo: Combo, isMac: boolean): string {
  const parts: string[] = [];
  if (combo.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (combo.shift) parts.push("⇧");
  if (combo.alt) parts.push(isMac ? "⌥" : "Alt");
  parts.push(KEY_GLYPHS[combo.key] ?? combo.key.toUpperCase());
  return parts.join("");
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
