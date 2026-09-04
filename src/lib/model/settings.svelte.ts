// App-wide settings (Svelte 5 runes), persisted to localStorage.

import type { ActionId, Combo } from "./keymap";
import { actionLabel, DEFAULT_BULK_ROWS, DEFAULT_KEYMAP, reservedBinding, sameCombo } from "./keymap";
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

/** Theme picker options: id, label, and the swatch bg to preview. */
export const THEMES: { id: Theme; label: string; bg: string }[] = [
  { id: "snow", label: "Snow", bg: "#fbfcfd" },
  { id: "light", label: "Paper", bg: "#f6f5f1" },
  { id: "cream", label: "Cream", bg: "#f7f2e9" },
  { id: "sky", label: "Sky", bg: "#eef4fb" },
  { id: "mist", label: "Mist", bg: "#f4f5f6" },
  { id: "slate", label: "Slate", bg: "#2b3038" },
  { id: "dark", label: "Dark", bg: "#141414" },
];

/** Themes that are dark enough to need light doc text / dark-mode treatment. */
export const DARK_THEMES: Theme[] = ["dark", "slate"];

export interface Persisted {
  /** Bumped when a default change should override stale saved values. */
  version?: number;
  theme: Theme;
  tabsPosition: TabsPosition;
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
  /** Hide the round name/meta text in the top bar to shrink it. */
  compactTopBar: boolean;
  /** Tighten the speech-doc toolbar + outline so the document gets more room
   *  (especially in the split-screen side panel). */
  compactDoc: boolean;
  /** Ribbon toolbar density: full labels, icons-only, or slim (labels kept but
   *  spread evenly at minimum height). */
  ribbonMode: RibbonMode;
  /** Minutes of prep each team starts a round with. */
  prepMinutes: number;
  /** Default file format when you Save (⌘S / on close). */
  defaultSaveFormat: "nimbus" | "xlsx";
  /** Default speech-format template index for New flow. */
  defaultTemplate: number;
  /** Per-format custom speech labels, keyed by format index. */
  templateAbbrs: Record<number, string[]>;
  /** Combo[] per action; old saves may hold a single Combo (normalized on load). */
  keymap: Partial<Record<ActionId, Combo | Combo[]>>;
  macros: Macro[];
  /** How many rows the bulk insert actions add (default 3, clamped 2–50). */
  bulkRows: number;
  /** Grid zoom factor (default 1, clamped 0.5–2.5). */
  zoom: number;
  docZoom: number;
  sendAtCursor: boolean;
  /** Folders to index for Doc Search (⌘K). */
  libraryRoots: LibraryRoot[];
  /** Speech-doc display typography (matches CardMirror's per-user settings). */
  docTypography: DocTypography;
  /** Named readers + their words-per-minute, for the speech-doc read-time estimate. */
  readers: Reader[];
  /** Countdown presets shown on the floating timer. */
  timerPresets?: TimerPreset[];
  /** Where flow cells "send to": the built-in offline speech doc, or the real
   *  CardMirror Desktop over the bridge. Defaults to "builtin" — the bridge is
   *  an ADDITIONAL option, never a replacement, so an install that has never
   *  touched this setting keeps sending exactly where it always did. */
  docTarget?: "cardmirror" | "builtin";
}

/** One countdown button on the timer. */
export interface TimerPreset {
  label: string;
  seconds: number;
}

/** Five countdown presets shown on the timer; fully user-editable in Settings. */
export const DEFAULT_TIMER_PRESETS: TimerPreset[] = [
  { label: "Constructive", seconds: 8 * 60 },
  { label: "Rebuttal", seconds: 5 * 60 },
  { label: "CX", seconds: 3 * 60 },
  { label: "Prep", seconds: 8 * 60 },
  { label: "1 min", seconds: 60 },
];

/** A reader whose speaking pace drives the doc's estimated read time. */
export interface Reader {
  name: string;
  /** Words per minute (of spoken content: tags + analytics + highlights). */
  wpm: number;
}

/** Default readers when none are saved. */
export const DEFAULT_READERS: Reader[] = [
  { name: "Reader 1", wpm: 200 },
  { name: "Reader 2", wpm: 250 },
];

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

/** Prep is clamped to 0–60 minutes; 0 is legitimate (some formats have none). */
export function clampPrepMinutes(n: number): number {
  if (!Number.isFinite(n)) return 8;
  return Math.min(60, Math.max(0, Math.round(n)));
}

/**
 * Ribbon density. Two options, on purpose: `full` fills the window, `compact`
 * fits a splitscreen half. Both are icon-only and the SAME HEIGHT — the only
 * difference is scale and spacing, so switching never moves the grid.
 */
export type RibbonMode = "full" | "compact";

/** Anything that isn't "full" — including the retired "icons"/"slim" — is
 *  compact. Keeps an old save's intent instead of resetting it to full. */
export function normalizeRibbonMode(m: string): RibbonMode {
  return m === "full" ? "full" : "compact";
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
  compactTopBar = $state(false);
  /** Denser speech-doc chrome (toolbar + outline) so the document reads bigger
   *  in the side panel. On by default. */
  compactDoc = $state(true);
  ribbonMode = $state<RibbonMode>("full");
  /** Prep each team gets, in minutes. Policy is 8; LD/PF are shorter, so it is
   *  a setting rather than a constant. Editable per round from the ribbon. */
  prepMinutes = $state(8);
  defaultSaveFormat = $state<"nimbus" | "xlsx">("nimbus");
  /** Default speech format for New flow, as an index into builtinTemplates()
   *  (0 Policy, 1 LD, 2 PF, 3 PF Con-first). Set it once and every new flow
   *  starts there. Disk-backed, so it survives a localStorage wipe. */
  defaultTemplate = $state(0);
  /** Per-format custom speech column labels, keyed by format index. Each entry
   *  overrides the built-in abbr by position (e.g. LD position 3 "NR" -> "2NR");
   *  a missing entry falls back to the built-in label. Applied to every NEW
   *  round of that format, so you rename a speech once for all rounds. */
  templateAbbrs = $state<Record<number, string[]>>({});
  /** Bottom by default — the Excel sheet-tab muscle memory. */
  tabsPosition = $state<TabsPosition>("bottom");
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
  readers = $state<Reader[]>(DEFAULT_READERS.map((r) => ({ ...r })));
  /** Five adjustable countdown presets for the floating timer (label + seconds). */
  timerPresets = $state<TimerPreset[]>(structuredClone(DEFAULT_TIMER_PRESETS));
  /** Send target for flow cells; see Persisted.docTarget. Built-in by default. */
  docTarget = $state<"cardmirror" | "builtin">("builtin");

  readonly isMac =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac");

  constructor() {
    if (typeof localStorage === "undefined") return;
    // A dragged slider / color picker fires save() on every input event; flush
    // whatever the last one asked for if the window goes away mid-drag.
    if (typeof window !== "undefined") {
      const flush = () => this.flushSave();
      window.addEventListener("pagehide", flush);
      window.addEventListener("beforeunload", flush);
      window.addEventListener("blur", flush);
    }
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
    // v3: re-assert bottom tabs (Excel-style) as the default — only saves made
    // at v3+ (i.e. a deliberate later toggle) keep a persisted position.
    if (p.tabsPosition && (p.version ?? 1) >= 3) {
      this.tabsPosition = p.tabsPosition;
    }
    if (p.colMinWidth) this.colMinWidth = p.colMinWidth;
    if (p.affColor !== undefined) this.affColor = p.affColor;
    if (p.negColor !== undefined) this.negColor = p.negColor;
    if (p.analyticColor !== undefined) this.analyticColor = p.analyticColor;
    if (p.cardColor !== undefined) this.cardColor = p.cardColor;
    if (p.fontFamily !== undefined) this.fontFamily = p.fontFamily;
    if (p.fontSize) this.fontSize = p.fontSize;
    if (p.rowHeight) this.rowHeight = p.rowHeight;
    if (p.showTutorial !== undefined) this.showTutorial = p.showTutorial;
    if (p.compactTopBar !== undefined) this.compactTopBar = p.compactTopBar;
    if (p.compactDoc !== undefined) this.compactDoc = p.compactDoc;
    // The ribbon used to have three densities (full / icons / slim) cycled with
    // one button. It is two now — full width, and a condensed half-width one for
    // splitscreen — so both retired names load as "compact" rather than falling
    // back to "full" and silently undoing someone's choice.
    if (p.ribbonMode) this.ribbonMode = normalizeRibbonMode(p.ribbonMode);
    // Back-compat: an older save had a boolean compactRibbon (= icons-only).
    else if ((p as { compactRibbon?: boolean }).compactRibbon) this.ribbonMode = "compact";
    if (typeof p.prepMinutes === "number") this.prepMinutes = clampPrepMinutes(p.prepMinutes);
    if (p.defaultSaveFormat) this.defaultSaveFormat = p.defaultSaveFormat;
    if (typeof p.defaultTemplate === "number") this.defaultTemplate = p.defaultTemplate;
    if (p.templateAbbrs && typeof p.templateAbbrs === "object") this.templateAbbrs = p.templateAbbrs;
    if (p.bulkRows !== undefined) this.bulkRows = clampBulkRows(p.bulkRows);
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
    if (p.readers && Array.isArray(p.readers) && p.readers.length)
      this.readers = p.readers
        .filter((r) => r && typeof r.name === "string")
        .map((r) => ({ name: r.name, wpm: Math.max(1, Math.round(r.wpm) || 200) }));
    if (p.docTarget !== undefined) this.docTarget = p.docTarget;
    if (Array.isArray(p.timerPresets) && p.timerPresets.length) {
      // Always land exactly five slots, each sanitized against the default in
      // that position — a truncated or corrupted save can't leave the timer with
      // a missing preset or a zero-second countdown that can never be started.
      this.timerPresets = DEFAULT_TIMER_PRESETS.map((d, i) => {
        const s = p.timerPresets![i];
        return {
          label: typeof s?.label === "string" && s.label.trim() ? s.label : d.label,
          seconds: Number.isFinite(s?.seconds) ? Math.max(1, Math.round(s!.seconds)) : d.seconds,
        };
      });
    }
  }

  setTimerPreset(i: number, patch: Partial<TimerPreset>): void {
    if (!this.timerPresets[i]) return;
    // Build a new array rather than mutating in place — a captured $state array
    // ref doesn't re-notify on element assignment.
    const next = [...this.timerPresets];
    next[i] = {
      label: patch.label !== undefined ? patch.label : next[i].label,
      seconds: patch.seconds !== undefined ? Math.max(1, Math.round(patch.seconds)) : next[i].seconds,
    };
    this.timerPresets = next;
    this.save();
  }

  buildPersisted(): Persisted {
    return {
      version: 3,
      theme: this.theme,
      tabsPosition: this.tabsPosition,
      readers: $state.snapshot(this.readers) as Reader[],
      timerPresets: $state.snapshot(this.timerPresets) as TimerPreset[],
      docTarget: this.docTarget,
      colMinWidth: this.colMinWidth,
      affColor: this.affColor,
      negColor: this.negColor,
      analyticColor: this.analyticColor,
      cardColor: this.cardColor,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      rowHeight: this.rowHeight,
      showTutorial: this.showTutorial,
      compactTopBar: this.compactTopBar,
      compactDoc: this.compactDoc,
      ribbonMode: this.ribbonMode,
      prepMinutes: this.prepMinutes,
      defaultSaveFormat: this.defaultSaveFormat,
      defaultTemplate: this.defaultTemplate,
      templateAbbrs: this.templateAbbrs,
      bulkRows: this.bulkRows,
      zoom: this.zoom,
      docZoom: this.docZoom,
      sendAtCursor: this.sendAtCursor,
      keymap: $state.snapshot(this.keymap) as Record<ActionId, Combo[]>,
      macros: $state.snapshot(this.macros) as Macro[],
      libraryRoots: $state.snapshot(this.libraryRoots) as LibraryRoot[],
      docTypography: $state.snapshot(this.docTypography) as DocTypography,
    };
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Persist to the localStorage cache and through to disk.
   *
   * Coalesced: the color pickers, sliders and zoom controls all call this from
   * `oninput`, so a single drag used to serialize the whole settings blob (keymap
   * + macros included) and fire an IPC write per pointer move.
   */
  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 200);
  }

  /** Write immediately if a coalesced save is pending. */
  flushSave(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    saveBlob(BLOB, this.buildPersisted());
  }

  /** Set the default speech format for New flow and persist it. */
  setDefaultTemplate(i: number): void {
    this.defaultTemplate = i;
    this.save();
  }

  /** Rename a speech in a format's template (applies to every new round of that
   *  format). `format` is the template index, `idx` the speech position. */
  setSpeechAbbr(format: number, idx: number, abbr: string): void {
    const list = [...(this.templateAbbrs[format] ?? [])];
    list[idx] = abbr;
    this.templateAbbrs = { ...this.templateAbbrs, [format]: list };
    this.save();
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

  setZoom(n: number): void {
    this.zoom = clampZoom(n);
    this.save();
  }
  zoomIn(): void { this.setZoom(this.zoom + 0.1); }
  zoomOut(): void { this.setZoom(this.zoom - 0.1); }
  zoomReset(): void { this.setZoom(1); }

  /** Same three steps for the speech doc. The zoom keybinds act on whichever
   *  surface you're in, so the doc needs its own — and they're the keyboard
   *  fallback for a touchpad pinch the webview never forwards to the page. */
  setDocZoom(n: number): void {
    this.docZoom = clampZoom(n);
    this.save();
  }
  docZoomIn(): void { this.setDocZoom(this.docZoom + 0.1); }
  docZoomOut(): void { this.setDocZoom(this.docZoom - 0.1); }
  docZoomReset(): void { this.setDocZoom(1); }

  /** Live-set the flow zoom WITHOUT persisting (pinch); commit with save(). */
  setZoomLive(n: number): void { this.zoom = clampZoom(n); }
  setDocZoomLive(n: number): void { this.docZoom = clampZoom(n); }

  /** Human label of whatever a combo is currently bound to, or null. */
  findBinding(combo: Combo): string | null {
    for (const [action, combos] of Object.entries(this.keymap)) {
      if (combos.some((c) => sameCombo(c, combo))) {
        return actionLabel(action as ActionId, this.bulkRows);
      }
    }
    for (const m of this.macros) {
      if (m.combo && sameCombo(m.combo, combo)) return `macro "${m.name}"`;
    }
    return reservedBinding(combo);
  }
}

export const settings = new Settings();
