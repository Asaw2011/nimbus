// App-wide settings (Svelte 5 runes), persisted to localStorage.

import type { ActionId, Combo } from "./keymap";
import { actionLabel, DEFAULT_BULK_ROWS, DEFAULT_MOVE_ROWS, DEFAULT_KEYMAP, sameCombo } from "./keymap";
import type { Macro } from "./macros";
import { defaultMacros, migrateLegacyMacro } from "./macros";
import { loadBlob, loadBlobCached, saveBlob } from "./blobs";
import { uid } from "./types";

export interface LibraryRoot {
  id: string;
  path: string;
  label: string;
  enabled: boolean;
}

const LS_KEY = "debate-flow:settings"; // legacy pre-disk location
const BLOB = "settings";

export type Theme =
  | "dark"
  | "slate"
  | "light"
  | "snow"
  | "cream"
  | "sky"
  | "mist";
export type TabsPosition = "top" | "bottom";
export type RibbonMode = "full" | "icons" | "slim";

/** Theme picker options: id, label, and the swatch bg to preview. */
export const THEMES: { id: Theme; label: string; bg: string }[] = [
  { id: "snow", label: "Snow", bg: "#fbfcfd" },
  { id: "light", label: "Paper", bg: "#f6f5f1" },
  { id: "cream", label: "Cream", bg: "#f7f2e9" },
  { id: "sky", label: "Sky", bg: "#eef4fb" },
  { id: "mist", label: "Mist", bg: "#f4f5f6" },
  { id: "slate", label: "Slate", bg: "#33383e" },
  { id: "dark", label: "Dark", bg: "#141414" },
];

export interface Persisted {
  /** Bumped when a default change should override stale saved values. */
  version?: number;
  theme: Theme;
  tabsPosition: TabsPosition;
  ribbonMode?: RibbonMode;
  /** Legacy: replaced by ribbonMode ("icons"). */
  compactRibbon?: boolean;
  colMinWidth: number;
  /** Overrides for the aff/neg accent colors; "" = theme default. */
  affColor: string;
  negColor: string;
  /** Ink colors for analytic / card marked cells; "" = theme default. */
  analyticColor: string;
  cardColor: string;
  /** Grid text + geometry defaults. */
  fontFamily: string;
  fontSize: number;
  rowHeight: number;
  /** Show the welcome tutorial on app open until dismissed. */
  showTutorial: boolean;
  /** Default file format when you Save (⌘S / on close). */
  defaultSaveFormat: "nimbus" | "xlsx";
  /** Combo[] per action; old saves may hold a single Combo (normalized on load). */
  keymap: Partial<Record<ActionId, Combo | Combo[]>>;
  macros: Macro[];
  /** How many rows the bulk insert actions add (default 3, clamped 2–50). */
  bulkRows: number;
  moveRows?: number;
  /** Grid zoom factor (default 1, clamped 0.5–2.5). */
  zoom: number;
  docZoom: number;
  sendAtCursor: boolean;
  /** Folders to index for Doc Search (⌘K). */
  libraryRoots: LibraryRoot[];
  /** Speech-doc display typography (matches CardMirror's per-user settings). */
  docTypography: DocTypography;
}

export interface DocTypography {
  // Heading font sizes (pt) — Verbatim defaults.
  sizePocket: number;
  sizeHat: number;
  sizeBlock: number;
  sizeTag: number;
  sizeCite: number;
  // Ink colors (hex).
  colorAnalytic: string;
  colorUndertag: string;
  // Emphasis (the boxed power word).
  emphasisBox: boolean;
  emphasisBold: boolean;
  emphasisItalic: boolean;
  /** Emphasis box thickness in pt. */
  emphasisBoxSize: number;
  // Pocket heading box.
  pocketBox: boolean;
  /** Pocket box thickness in pt. */
  pocketBoxSize: number;
  // The cut (underline) + undertag marks.
  underlineBold: boolean;
  undertagItalic: boolean;
  undertagBold: boolean;
}

/** Bulk-row count is clamped to a sane 2–50 range. */
export function clampBulkRows(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BULK_ROWS;
  return Math.min(50, Math.max(2, Math.round(n)));
}

/** Zoom is clamped to 0.5×–2.5×. */
export function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(2.5, Math.max(0.5, Math.round(n * 100) / 100));
}

export const DEFAULT_DOC_TYPOGRAPHY: DocTypography = {
  sizePocket: 26,
  sizeHat: 22,
  sizeBlock: 16,
  sizeTag: 13,
  sizeCite: 13,
  colorAnalytic: "#1F3864",
  colorUndertag: "#385623",
  emphasisBox: true,
  emphasisBold: true,
  emphasisItalic: false,
  emphasisBoxSize: 1,
  pocketBox: true,
  pocketBoxSize: 2.25,
  underlineBold: false,
  undertagItalic: true,
  undertagBold: false,
};

class Settings {
  theme = $state<Theme>("snow");
  showTutorial = $state(true);
  defaultSaveFormat = $state<"nimbus" | "xlsx">("nimbus");
  /** Bottom by default — the Excel sheet-tab muscle memory. */
  tabsPosition = $state<TabsPosition>("bottom");
  ribbonMode = $state<RibbonMode>("full");
  /** Columns stretch to fill the window but never shrink below this.
   * Default ≈ the ~30.7-char columns of a standard Verbatim flow template. */
  colMinWidth = $state(200);
  affColor = $state("");
  negColor = $state("");
  analyticColor = $state("");
  cardColor = $state("");
  /** "" = system font. */
  fontFamily = $state("");
  fontSize = $state(13);
  rowHeight = $state(26);
  bulkRows = $state(DEFAULT_BULK_ROWS);
  /** How many rows the "Move cursor down several rows" keybind jumps. */
  moveRows = $state(DEFAULT_MOVE_ROWS);
  zoom = $state(1);
  /** Speech-doc view zoom (pinch-to-zoom), default 1, clamped 0.5–2.5. */
  docZoom = $state(1);
  /** Send to Doc / Cell → Doc insert at the doc's cursor (true) instead of in
   *  flow order (false, the default). */
  sendAtCursor = $state(false);
  keymap = $state<Record<ActionId, Combo[]>>(structuredClone(DEFAULT_KEYMAP));
  macros = $state<Macro[]>(defaultMacros());
  libraryRoots = $state<LibraryRoot[]>([]);
  docTypography = $state<DocTypography>({ ...DEFAULT_DOC_TYPOGRAPHY });

  readonly isMac =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac");

  constructor() {
    if (typeof localStorage === "undefined") return;
    // Synchronous first paint from the local cache (blob cache, else legacy
    // key), then load the authoritative on-disk copy in the background.
    try {
      const cached =
        loadBlobCached<Partial<Persisted>>(BLOB) ??
        (JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as Partial<Persisted> | null);
      if (cached) this.applyPersisted(cached);
    } catch {
      // corrupted settings — fall back to defaults
    }
    void this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    const disk = await loadBlob<Partial<Persisted>>(BLOB);
    if (disk) {
      this.applyPersisted(disk);
    } else {
      // First run on this install — put current state on disk immediately so
      // macros/keybinds can never be lost to a webview storage wipe.
      this.save();
    }
  }

  applyPersisted(p: Partial<Persisted>): void {
    if (p.theme) this.theme = p.theme;
    // v3: re-assert the bottom (Excel-style) tabs default — override pre-v3
    // saves; a deliberate top choice made after v3 is still honored.
    if (p.tabsPosition && (p.version ?? 1) >= 3) {
      this.tabsPosition = p.tabsPosition;
    }
    // ribbonMode replaced the old compactRibbon boolean.
    if (p.ribbonMode) this.ribbonMode = p.ribbonMode;
    else if (p.compactRibbon) this.ribbonMode = "icons";
    if (p.colMinWidth) this.colMinWidth = p.colMinWidth;
    if (p.affColor !== undefined) this.affColor = p.affColor;
    if (p.negColor !== undefined) this.negColor = p.negColor;
    if (p.analyticColor !== undefined) this.analyticColor = p.analyticColor;
    if (p.cardColor !== undefined) this.cardColor = p.cardColor;
    if (p.fontFamily !== undefined) this.fontFamily = p.fontFamily;
    if (p.fontSize) this.fontSize = p.fontSize;
    if (p.rowHeight) this.rowHeight = p.rowHeight;
    if (p.showTutorial !== undefined) this.showTutorial = p.showTutorial;
    if (p.defaultSaveFormat) this.defaultSaveFormat = p.defaultSaveFormat;
    if (p.bulkRows !== undefined) this.bulkRows = clampBulkRows(p.bulkRows);
    if (p.moveRows !== undefined) this.moveRows = clampBulkRows(p.moveRows);
    if (p.zoom !== undefined) this.zoom = clampZoom(p.zoom);
    if (p.docZoom !== undefined) this.docZoom = clampZoom(p.docZoom);
    if (p.sendAtCursor !== undefined) this.sendAtCursor = p.sendAtCursor;
    if (p.keymap) {
      // Missing action = old save → default binds. Empty array = user cleared.
      const merged = structuredClone(DEFAULT_KEYMAP);
      for (const [action, v] of Object.entries(p.keymap)) {
        if (action in merged && v) {
          merged[action as ActionId] = Array.isArray(v) ? v : [v];
        }
      }
      this.keymap = merged;
    }
    if (p.macros) {
      this.macros = p.macros
        .map(migrateLegacyMacro)
        .filter((m): m is Macro => m !== null);
    }
    if (p.libraryRoots) this.libraryRoots = p.libraryRoots;
    if (p.docTypography) this.docTypography = { ...DEFAULT_DOC_TYPOGRAPHY, ...p.docTypography };
  }

  buildPersisted(): Persisted {
    return {
      version: 3,
      theme: this.theme,
      tabsPosition: this.tabsPosition,
      ribbonMode: this.ribbonMode,
      colMinWidth: this.colMinWidth,
      affColor: this.affColor,
      negColor: this.negColor,
      analyticColor: this.analyticColor,
      cardColor: this.cardColor,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      rowHeight: this.rowHeight,
      showTutorial: this.showTutorial,
      defaultSaveFormat: this.defaultSaveFormat,
      bulkRows: this.bulkRows,
      moveRows: this.moveRows,
      zoom: this.zoom,
      docZoom: this.docZoom,
      sendAtCursor: this.sendAtCursor,
      keymap: $state.snapshot(this.keymap) as Record<ActionId, Combo[]>,
      macros: $state.snapshot(this.macros) as Macro[],
      libraryRoots: $state.snapshot(this.libraryRoots) as LibraryRoot[],
      docTypography: $state.snapshot(this.docTypography) as DocTypography,
    };
  }

  /** Persist to the localStorage cache and through to disk. */
  save(): void {
    saveBlob(BLOB, this.buildPersisted());
  }

  addMacro(macro: Macro): void {
    this.macros = [...this.macros, macro];
    this.save();
  }

  updateMacro(id: string, patch: Partial<Macro>): void {
    this.macros = this.macros.map((m) => (m.id === id ? { ...m, ...patch } : m));
    this.save();
  }

  deleteMacro(id: string): void {
    this.macros = this.macros.filter((m) => m.id !== id);
    this.save();
  }

  rebindMacro(id: string, combo: Combo | null): void {
    this.macros = this.macros.map((m) => (m.id === id ? { ...m, combo } : m));
    this.save();
  }

  addLibraryRoot(path: string, label: string): boolean {
    if (this.libraryRoots.some((r) => r.path === path)) return false; // duplicate
    this.libraryRoots = [
      ...this.libraryRoots,
      { id: uid(), path, label, enabled: true },
    ];
    this.save();
    return true;
  }

  removeLibraryRoot(id: string): void {
    this.libraryRoots = this.libraryRoots.filter((r) => r.id !== id);
    this.save();
  }

  updateLibraryRoot(id: string, patch: Partial<Pick<LibraryRoot, "label" | "enabled">>): void {
    this.libraryRoots = this.libraryRoots.map((r) =>
      r.id === id ? { ...r, ...patch } : r,
    );
    this.save();
  }

  addBind(action: ActionId, combo: Combo): void {
    this.keymap = {
      ...this.keymap,
      [action]: [...(this.keymap[action] ?? []), combo],
    };
    this.save();
  }

  removeBind(action: ActionId, index: number): void {
    this.keymap = {
      ...this.keymap,
      [action]: (this.keymap[action] ?? []).filter((_, i) => i !== index),
    };
    this.save();
  }

  resetKeymap(): void {
    this.keymap = structuredClone(DEFAULT_KEYMAP);
    this.save();
  }

  /** Wipe every binding (actions stay, all unbound). */
  clearAllBinds(): void {
    const empty = {} as Record<ActionId, Combo[]>;
    for (const action of Object.keys(this.keymap) as ActionId[]) {
      empty[action] = [];
    }
    this.keymap = empty;
    this.save();
  }

  setBulkRows(n: number): void {
    this.bulkRows = clampBulkRows(n);
    this.save();
  }

  setMoveRows(n: number): void {
    this.moveRows = clampBulkRows(n);
    this.save();
  }

  setZoom(n: number): void {
    this.zoom = clampZoom(n);
    this.save();
  }
  zoomIn(): void { this.setZoom(this.zoom + 0.1); }
  zoomOut(): void { this.setZoom(this.zoom - 0.1); }
  zoomReset(): void { this.setZoom(1); }

  /** Live-set the flow zoom WITHOUT persisting (pinch); commit with save(). */
  setZoomLive(n: number): void { this.zoom = clampZoom(n); }
  setDocZoomLive(n: number): void { this.docZoom = clampZoom(n); }

  /** Human label of whatever a combo is currently bound to, or null. */
  findBinding(combo: Combo): string | null {
    for (const [action, combos] of Object.entries(this.keymap)) {
      if (combos.some((c) => sameCombo(c, combo))) {
        return actionLabel(action as ActionId, this.bulkRows, this.moveRows);
      }
    }
    for (const m of this.macros) {
      if (m.combo && sameCombo(m.combo, combo)) return `macro "${m.name}"`;
    }
    return null;
  }
}

export const settings = new Settings();
