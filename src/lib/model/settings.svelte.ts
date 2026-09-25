// App-wide settings (Svelte 5 runes), persisted to localStorage.

import type { ActionId, Combo } from "./keymap";
import { actionLabel, DEFAULT_BULK_ROWS, DEFAULT_KEYMAP, reservedBinding, sameCombo } from "./keymap";
import type { Macro } from "./macros";
import { defaultMacros, migrateLegacyMacro } from "./macros";
import { loadBlob, loadBlobCached, saveBlob } from "./blobs";
import { INITIAL_ROWS, uid, type Side, type SpeechTemplate } from "./types";
import { blankCustomTemplate, builtinTemplates, cloneTemplate, defaultAbbrFor, makeSpeech } from "./templates";

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
  | "midnight"
  | "slate"
  | "light"
  | "snow"
  | "paper"
  | "cream"
  | "sky"
  | "mist";
export type TabsPosition = "top" | "bottom";
export type TabSize = "compact" | "regular" | "large";
export type LaneSide = "left" | "right";

/**
 * Sheet-tab sizes, as the padding and text size the tab bar uses.
 *
 * `compact` is the bar as it was before the 1.3.0 look - the smallest that
 * still reads. `large` is what 1.3.0 shipped. `regular` sits between them and
 * is the default, so the bar is no longer as tall as 1.3.0 made it but is not
 * squeezed to the old minimum either; anyone who wants either end has it.
 */
export const TAB_SIZES: { id: TabSize; label: string; pad: string; font: string }[] = [
  { id: "compact", label: "Compact", pad: "7px 18px", font: "12px" },
  { id: "regular", label: "Regular", pad: "9px 20px", font: "13px" },
  { id: "large", label: "Large", pad: "12px 24px", font: "14px" },
];

/**
 * Theme picker options: id, label, and the swatch bg to preview.
 *
 * ⚠ `light` is the WHITE one and `paper` is the legal-pad tint. They were the
 * same id once: the two-theme pass reused `light` for white, while before it
 * `light` WAS the paper tint and was labelled "Paper". Keeping white on `light`
 * means nobody who had picked it gets moved, and the tint comes back under its
 * own id rather than silently changing what an existing saved value means.
 */
export const THEMES: { id: Theme; label: string; bg: string }[] = [
  { id: "light", label: "Light", bg: "#ffffff" },
  { id: "snow", label: "Snow", bg: "#fbfcfd" },
  { id: "paper", label: "Paper", bg: "#f6f5f1" },
  { id: "cream", label: "Cream", bg: "#f7f2e9" },
  { id: "sky", label: "Sky", bg: "#eef4fb" },
  { id: "mist", label: "Mist", bg: "#f4f5f6" },
  { id: "slate", label: "Slate", bg: "#2b3038" },
  { id: "dark", label: "Dark", bg: "#0e0e10" },
  // Dark app, white speech doc - the swatch is split to say so at a glance. The
  // doc stays light because the doc's dark CSS keys only on "dark"/"slate", so
  // this id never picks it up (see theme.css).
  { id: "midnight", label: "Dark · White Doc", bg: "linear-gradient(135deg, #0e0e10 55%, #ffffff 55%)" },
];

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

/**
 * Coerce a saved value onto a theme that actually exists.
 *
 * ⚠ It no longer collapses the tinted themes onto Light - that is what removed
 * somebody's grey out from under them. It only guards against a value with no
 * palette at all (a future rename, or a hand-edited settings file), which would
 * otherwise leave `data-theme` pointing at a block that does not exist and the
 * app rendering with the bare `:root` dark palette.
 */
export function normalizeTheme(t: string | undefined): Theme {
  return t && THEME_IDS.has(t) ? (t as Theme) : "light";
}

/** Themes that are dark enough to need light doc text / dark-mode treatment. */
export const DARK_THEMES: Theme[] = ["dark", "slate"];

export interface Persisted {
  /** Bumped when a default change should override stale saved values. */
  version?: number;
  theme: Theme;
  tabsPosition: TabsPosition;
  tabSize: TabSize;
  myLaneSide: LaneSide;
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
  /** First-run setup prompt (theme / format / save format) has been completed. */
  setupDone?: boolean;
  /** One-time migration of loose app-data flows into the home folder has run. */
  homeMigrated?: boolean;
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
  /** Last app version whose patch notes were shown. "" = never shown. */
  lastSeenVersion: string;
  /** Default file format when you Save (⌘S / on close). */
  defaultSaveFormat: "nimbus" | "xlsx";
  /** Default speech-format template index for New flow. */
  defaultTemplate: number;
  /** Per-format custom speech labels, keyed by format index. */
  templateAbbrs: Record<number, string[]>;
  /**
   * The user's own saved formats, each a full speech template (columns +
   * names + sides). Additive: an install with none behaves exactly as before,
   * and new flows keep using a built-in until you pick one of these.
   */
  customTemplates: SpeechTemplate[];
  /**
   * Which custom template new flows use, by id. "" (the default) means "use the
   * built-in named by {@link defaultTemplate}", so the two selectors never
   * disagree - picking a built-in clears this, picking a custom sets it.
   */
  defaultCustomId: string;
  /** Rows a fresh sheet starts with. Paper still grows on demand; this only sets
   *  the initial height. Clamped to a sane 4–80. */
  startRows: number;
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
   *  CardMirror Desktop over the bridge. Defaults to "builtin" - the bridge is
   *  an ADDITIONAL option, never a replacement, so an install that has never
   *  touched this setting keeps sending exactly where it always did. */
  docTarget?: "cardmirror" | "builtin";
  /** Experimental: show the Smart blocks (beta) tray in the corner of the flow.
   *  Off by default so the app stays clean until you opt in. */
  smartBlocksEnabled?: boolean;
  /** What a typed answer's "AT: ...---<speech>" header ends with when it is
   *  sent from the NEG BLOCK column. Nobody's blocks end in "Neg Block", so it
   *  names the speech the block is actually given in - or nothing at all.
   *  Every other speech keeps its own name. */
  blockAtSuffix?: "2NC" | "1NR" | "none";
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
  // Heading font sizes (pt) - Verbatim defaults.
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

/** A new sheet's starting row count, clamped to 4–80 (paper grows past it). */
export function clampStartRows(n: number): number {
  if (!Number.isFinite(n)) return INITIAL_ROWS;
  return Math.min(80, Math.max(4, Math.round(n)));
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
 * fits a splitscreen half. Both are icon-only and the SAME HEIGHT - the only
 * difference is scale and spacing, so switching never moves the grid.
 */
export type RibbonMode = "full" | "compact";

/** Anything that isn't "full" - including the retired "icons"/"slim" - is
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
  theme = $state<Theme>("light");
  showTutorial = $state(true);
  /** Whether the one-time first-run setup prompt has been completed. */
  setupDone = $state(false);
  /** Whether loose app-data flows have been migrated into the home folder. */
  homeMigrated = $state(false);
  compactTopBar = $state(false);
  /** Denser speech-doc chrome (toolbar + outline) so the document reads bigger
   *  in the side panel. On by default. */
  compactDoc = $state(true);
  ribbonMode = $state<RibbonMode>("full");
  /** Prep each team gets, in minutes. Policy is 8; LD/PF are shorter, so it is
   *  a setting rather than a constant. Editable per round from the ribbon. */
  prepMinutes = $state(8);
  /** Drives the "what's new" panel: when this doesn't match the running build,
   *  the notes for everything in between are shown once, then this is updated.
   *  Disk-backed, so it survives the installer replacing the app. */
  lastSeenVersion = $state("");
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
  /** The user's own saved formats (columns + names + sides). Editable in
   *  Settings → Formats; usable by any new flow. */
  customTemplates = $state<SpeechTemplate[]>([]);
  /** Selected custom format id, or "" to use the built-in {@link defaultTemplate}. */
  defaultCustomId = $state("");
  /** Rows a fresh sheet starts with (paper still grows on demand). */
  startRows = $state(INITIAL_ROWS);
  /** Bottom by default - the Excel sheet-tab muscle memory. */
  tabsPosition = $state<TabsPosition>("bottom");
  /**
   * How much room the sheet tabs take.
   *
   * ⚠ Every pixel here comes out of the FLOW. The tab bar spans the bottom of
   * the grid, so a taller tab is a row of argument you cannot see - which is
   * why this is a setting rather than a constant. The roomier bar reads better
   * on a big screen and costs real space on a laptop in a round.
   */
  tabSize = $state<TabSize>("regular");
  /**
   * Which side of a split speech your own column is drawn on.
   *
   * ⚠ PURELY VISUAL, like the lane collapse. It reorders the two columns ON
   * SCREEN and changes nothing stored: not the template, not `sheet.startCol`,
   * not which column answers which. Session 9's rule stands - a view toggle
   * must never change what the speech doc exports, or the same flow would emit
   * different "AT:" headers depending on a setting.
   *
   * Worth having because without it the side depends on who HOSTED: lanes are
   * stored creator-first, so the host's column is on the left and the joiner's
   * on the right, and the two partners see mirror images of the same flow.
   * "Left" makes your own column first for both of you.
   */
  myLaneSide = $state<LaneSide>("left");
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
  /** Experimental: the Smart blocks (beta) tray. Off by default - it is opt-in
   *  from Settings → Experimental, so the flow stays uncluttered until asked. */
  smartBlocksEnabled = $state(false);
  /** See Persisted.blockAtSuffix. */
  blockAtSuffix = $state<"2NC" | "1NR" | "none">("2NC");

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
      // corrupted settings - fall back to defaults
    }
    void this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    const disk = await loadBlob<Partial<Persisted>>(BLOB);
    if (disk) {
      this.applyPersisted(disk);
    } else {
      // First run on this install - put current state on disk immediately so
      // macros/keybinds can never be lost to a webview storage wipe.
      this.save();
    }
  }

  applyPersisted(p: Partial<Persisted>): void {
    if (p.theme) this.theme = normalizeTheme(p.theme);
    // v3: re-assert bottom tabs (Excel-style) as the default - only saves made
    // at v3+ (i.e. a deliberate later toggle) keep a persisted position.
    if (p.tabsPosition && (p.version ?? 1) >= 3) {
      this.tabsPosition = p.tabsPosition;
    }
    if (p.tabSize && TAB_SIZES.some((t) => t.id === p.tabSize)) this.tabSize = p.tabSize;
    if (p.myLaneSide === "left" || p.myLaneSide === "right") this.myLaneSide = p.myLaneSide;
    if (p.colMinWidth) this.colMinWidth = p.colMinWidth;
    if (p.affColor !== undefined) this.affColor = p.affColor;
    if (p.negColor !== undefined) this.negColor = p.negColor;
    if (p.analyticColor !== undefined) this.analyticColor = p.analyticColor;
    if (p.cardColor !== undefined) this.cardColor = p.cardColor;
    if (p.fontFamily !== undefined) this.fontFamily = p.fontFamily;
    if (p.fontSize) this.fontSize = p.fontSize;
    if (p.rowHeight) this.rowHeight = p.rowHeight;
    if (p.showTutorial !== undefined) this.showTutorial = p.showTutorial;
    if (p.setupDone !== undefined) this.setupDone = p.setupDone;
    if (p.homeMigrated !== undefined) this.homeMigrated = p.homeMigrated;
    if (p.compactTopBar !== undefined) this.compactTopBar = p.compactTopBar;
    if (p.compactDoc !== undefined) this.compactDoc = p.compactDoc;
    // The ribbon used to have three densities (full / icons / slim) cycled with
    // one button. It is two now - full width, and a condensed half-width one for
    // splitscreen - so both retired names load as "compact" rather than falling
    // back to "full" and silently undoing someone's choice.
    if (p.ribbonMode) this.ribbonMode = normalizeRibbonMode(p.ribbonMode);
    // Back-compat: an older save had a boolean compactRibbon (= icons-only).
    else if ((p as { compactRibbon?: boolean }).compactRibbon) this.ribbonMode = "compact";
    if (typeof p.prepMinutes === "number") this.prepMinutes = clampPrepMinutes(p.prepMinutes);
    if (typeof p.lastSeenVersion === "string") this.lastSeenVersion = p.lastSeenVersion;
    if (p.defaultSaveFormat) this.defaultSaveFormat = p.defaultSaveFormat;
    if (typeof p.defaultTemplate === "number") this.defaultTemplate = p.defaultTemplate;
    if (p.templateAbbrs && typeof p.templateAbbrs === "object") this.templateAbbrs = p.templateAbbrs;
    if (Array.isArray(p.customTemplates)) {
      // Sanitize each saved format: it must have an id, a name, and at least one
      // column, or a hand-edited/corrupt file could leave a template that makes
      // a zero-column flow. Drop anything that can't be repaired.
      this.customTemplates = p.customTemplates
        .filter((t): t is SpeechTemplate => !!t && Array.isArray(t.speeches) && t.speeches.length > 0)
        .map((t) => ({
          id: t.id || uid(),
          name: typeof t.name === "string" && t.name.trim() ? t.name : "My Format",
          speeches: t.speeches.map((s) => ({
            ...s,
            id: s.id || uid(),
            abbr: s.abbr ?? defaultAbbrFor(s.side ?? "neutral"),
            label: s.label ?? "",
            side: s.side === "aff" || s.side === "neg" ? s.side : "neutral",
          })),
        }));
    }
    if (typeof p.defaultCustomId === "string") this.defaultCustomId = p.defaultCustomId;
    if (p.startRows !== undefined) this.startRows = clampStartRows(p.startRows);
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
    if (p.smartBlocksEnabled !== undefined) this.smartBlocksEnabled = p.smartBlocksEnabled;
    if (p.blockAtSuffix === "2NC" || p.blockAtSuffix === "1NR" || p.blockAtSuffix === "none") {
      this.blockAtSuffix = p.blockAtSuffix;
    }
    if (Array.isArray(p.timerPresets) && p.timerPresets.length) {
      // Always land exactly five slots, each sanitized against the default in
      // that position - a truncated or corrupted save can't leave the timer with
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
    // Build a new array rather than mutating in place - a captured $state array
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
      tabSize: this.tabSize,
      myLaneSide: this.myLaneSide,
      readers: $state.snapshot(this.readers) as Reader[],
      timerPresets: $state.snapshot(this.timerPresets) as TimerPreset[],
      docTarget: this.docTarget,
      smartBlocksEnabled: this.smartBlocksEnabled,
      blockAtSuffix: this.blockAtSuffix,
      colMinWidth: this.colMinWidth,
      affColor: this.affColor,
      negColor: this.negColor,
      analyticColor: this.analyticColor,
      cardColor: this.cardColor,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      rowHeight: this.rowHeight,
      showTutorial: this.showTutorial,
      setupDone: this.setupDone,
      homeMigrated: this.homeMigrated,
      compactTopBar: this.compactTopBar,
      compactDoc: this.compactDoc,
      ribbonMode: this.ribbonMode,
      prepMinutes: this.prepMinutes,
      lastSeenVersion: this.lastSeenVersion,
      defaultSaveFormat: this.defaultSaveFormat,
      defaultTemplate: this.defaultTemplate,
      templateAbbrs: this.templateAbbrs,
      customTemplates: $state.snapshot(this.customTemplates) as SpeechTemplate[],
      defaultCustomId: this.defaultCustomId,
      startRows: this.startRows,
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

  // ---- format selection (built-ins + custom templates) --------------------

  /** A built-in with its per-format abbr renames applied - a fresh, isolated
   *  copy so nothing edits the shared preset object. */
  private builtinWithAbbrs(i: number): SpeechTemplate {
    const list = builtinTemplates();
    const base = list[i] ?? list[0];
    const overrides = this.templateAbbrs[i] ?? [];
    const tpl = structuredClone(base) as SpeechTemplate;
    tpl.speeches.forEach((sp, j) => {
      const o = overrides[j]?.trim();
      if (o) sp.abbr = o;
    });
    return tpl;
  }

  /**
   * Every format a new flow can start from: the built-ins (renames applied)
   * followed by the user's custom templates. Each carries a stable choice `id`
   * ("builtin:N" / "custom:<id>") for the picker, and a ready-to-use `template`.
   */
  templateChoices(): { id: string; name: string; custom: boolean; template: SpeechTemplate }[] {
    const builtins = builtinTemplates().map((t, i) => ({
      id: `builtin:${i}`,
      name: t.name,
      custom: false,
      template: this.builtinWithAbbrs(i),
    }));
    const customs = (this.customTemplates ?? []).map((t) => ({
      id: `custom:${t.id}`,
      name: t.name,
      custom: true,
      template: structuredClone($state.snapshot(t)) as SpeechTemplate,
    }));
    return [...builtins, ...customs];
  }

  /** The currently selected choice id (drives the format dropdowns). */
  get selectedTemplateId(): string {
    if (this.defaultCustomId && this.customTemplates.some((t) => t.id === this.defaultCustomId)) {
      return `custom:${this.defaultCustomId}`;
    }
    return `builtin:${this.defaultTemplate}`;
  }

  /** Choose the format new flows start from, by choice id. */
  selectTemplate(id: string): void {
    if (id.startsWith("custom:")) {
      this.defaultCustomId = id.slice("custom:".length);
    } else {
      this.defaultCustomId = "";
      this.defaultTemplate = Number(id.slice("builtin:".length)) || 0;
    }
    this.save();
  }

  /** The template a new flow should start from, per the current selection. A
   *  fresh copy every call - the caller (store.newRound) owns it. */
  newFlowTemplate(): SpeechTemplate {
    if (this.defaultCustomId) {
      const t = this.customTemplates.find((c) => c.id === this.defaultCustomId);
      if (t) return structuredClone($state.snapshot(t)) as SpeechTemplate;
    }
    return this.builtinWithAbbrs(this.defaultTemplate);
  }

  // ---- custom template CRUD -----------------------------------------------

  /** Reassign one custom template immutably (so the $state array re-notifies)
   *  and persist. No-op if the id is unknown. */
  private mutateTemplate(id: string, fn: (t: SpeechTemplate) => void): void {
    let touched = false;
    this.customTemplates = this.customTemplates.map((t) => {
      if (t.id !== id) return t;
      touched = true;
      const next = structuredClone($state.snapshot(t)) as SpeechTemplate;
      fn(next);
      return next;
    });
    if (touched) this.save();
  }

  /** Create a blank custom format and select it. Returns its id. */
  addCustomTemplate(name = "My Format"): string {
    const t = blankCustomTemplate(name);
    this.customTemplates = [...this.customTemplates, t];
    this.defaultCustomId = t.id;
    this.save();
    return t.id;
  }

  /** Create a custom format seeded from a built-in (index) or another custom
   *  (id), so you can tweak a real format instead of starting from scratch. */
  duplicateAsCustom(choiceId: string): string {
    const src = this.templateChoices().find((c) => c.id === choiceId);
    const base = src?.template ?? this.newFlowTemplate();
    const copy = cloneTemplate(base, `${base.name} copy`);
    this.customTemplates = [...this.customTemplates, copy];
    this.defaultCustomId = copy.id;
    this.save();
    return copy.id;
  }

  renameCustomTemplate(id: string, name: string): void {
    const n = name.trim();
    if (!n) return;
    this.mutateTemplate(id, (t) => { t.name = n; });
  }

  deleteCustomTemplate(id: string): void {
    this.customTemplates = this.customTemplates.filter((t) => t.id !== id);
    if (this.defaultCustomId === id) this.defaultCustomId = "";
    this.save();
  }

  /** Append a column of the given side to a custom template. */
  addTemplateColumn(id: string, side: Side = "aff"): void {
    this.mutateTemplate(id, (t) => {
      t.speeches.push(makeSpeech(defaultAbbrFor(side), "New column", side));
    });
  }

  updateTemplateColumn(
    id: string,
    speechId: string,
    patch: { abbr?: string; label?: string; side?: Side },
  ): void {
    this.mutateTemplate(id, (t) => {
      const sp = t.speeches.find((s) => s.id === speechId);
      if (!sp) return;
      if (patch.abbr !== undefined) sp.abbr = patch.abbr;
      if (patch.label !== undefined) sp.label = patch.label;
      if (patch.side !== undefined) sp.side = patch.side;
    });
  }

  /** Remove a column, keeping at least one (a zero-column format is unusable). */
  removeTemplateColumn(id: string, speechId: string): void {
    this.mutateTemplate(id, (t) => {
      if (t.speeches.length <= 1) return;
      t.speeches = t.speeches.filter((s) => s.id !== speechId);
    });
  }

  /** Move a column left (-1) or right (+1). */
  moveTemplateColumn(id: string, speechId: string, dir: -1 | 1): void {
    this.mutateTemplate(id, (t) => {
      const i = t.speeches.findIndex((s) => s.id === speechId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= t.speeches.length) return;
      [t.speeches[i], t.speeches[j]] = [t.speeches[j], t.speeches[i]];
    });
  }

  setStartRows(n: number): void {
    this.startRows = clampStartRows(n);
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
   *  surface you're in, so the doc needs its own - and they're the keyboard
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
