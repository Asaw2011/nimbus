// Smart blocks - the round kit and the suggestions it produces.
//
// The kit is the handful of files you load before a round: YOUR midterms file,
// not the four other copies in Dropbox. Suggestions only ever come from it.
//
// ⚠ The kit is LOCAL to this machine and never enters the Round. Paths are
// per-computer and each partner brings their own files, so it lives in a blob
// keyed by round id. Nothing here touches the sync protocol: an accepted
// suggestion is an ordinary cell edit through `store.mutate`, and reaches a
// partner the way any typed cell does.
//
// ⚠ Nothing here reads a keystroke. Suggestions are recomputed from the round
// itself (see SmartTray), which is also what makes a PARTNER's flowing produce
// suggestions: their cells arrive, the round changes, the tray updates.

import { nodeChip, type DocNode } from "$lib/docx/parse";
import { baseAbbr, sideTurn, turnOfCol, turnsOf, type Turn } from "$lib/model/turns";
import { parseSpeechDoc } from "$lib/docx/cmir";
import { cmDocFromBytes, extractCMNodes, type CMDoc } from "$lib/docx/cmExact";
import { loadBlob, saveBlob } from "$lib/model/blobs";
import { store } from "$lib/model/round.svelte";
import { fileIndex } from "$lib/search/file-index.svelte";
import type { Cell, Round, Sheet, Side, Speech } from "$lib/model/types";
import {
  cardsUnder,
  guessFileForSheet,
  guessSection,
  guessSections,
  tokens,
  indexBlocks,
  matchBlocks,
  type BlockMatch,
  type KitBlock,
} from "./match";

export interface KitFile {
  /** Absolute path, or `mem:<name>` for a file added without one (browser). */
  key: string;
  name: string;
  /** Offered on every sheet (T, theory, framework) instead of one linked sheet. */
  general?: boolean;
  /**
   * For a 2AC / case-neg file: the sections the ADVANTAGE pages use, picked by
   * hand in the Kit tab - "Case", "Turns", or one hat as "Case › Warming";
   * `ALL_SECTIONS` for the whole file. Unset = automatic (a 2AC file's
   * case-named sections; a case neg's whole file). Stored by heading TEXT, so a
   * re-read or edited file keeps its picks as long as the headings stay.
   */
  advSections?: string[];
  /** Keys this file used to have - a saved `copy:` relinked to the real file
   *  (`refreshFromDisk`). Other rounds' page links to the old key follow it. */
  was?: string[];
}

/** `advSections` entry meaning "the whole file". */
export const ALL_SECTIONS = "*";
/** `advSections` entry meaning "nothing": everything unticked on purpose (an
 *  empty list would read as Auto and tick the Case section again). */
export const NO_SECTIONS = "-";
/** Joins a pocket and a hat in an `advSections` path. */
export const SECTION_SEP = " › ";

/** A block that answers a flowed argument: the suggestion (row, speech) and
 *  the match within it. */
export interface Claim {
  s: Suggestion;
  m: BlockMatch;
}

/** One block in a page's 2AC list. */
export interface StarterBlock {
  id: string;
  title: string;
  node: DocNode;
  cardCount: number;
  /** It answers this flowed 1NC argument - Insert puts it in that row. */
  answers?: Claim;
}

/**
 * An off-case page's 2AC blocks: EVERY block under that position's hat in
 * your 2AC file, in file order - minus ones already on the page and ones
 * already offered under one of the 1NC's arguments (each block once per page).
 */
export interface Starter {
  key: string;
  sheetId: string;
  sheetTitle: string;
  toCol: number;
  blocks: StarterBlock[];
  fileName: string;
  /** The 2AC file's key, for the exact CardMirror copy on insert. */
  file: string;
}

interface Parsed {
  /** The whole heading tree - what the File tab shows, Ctrl+K style. */
  roots: DocNode[];
  blocks: KitBlock[];
  firstHeading: string;
  error?: string;
}

/** One entry on the Overviews tab: a section and the block that overviews it. */
export interface Overview {
  /** The section the Main sits in - "Uniqueness", "Link", "Impact". */
  section: string;
  node: DocNode;
  cardCount: number;
  /** The kit file it's from - for the exact CardMirror copy on insert. */
  file?: string;
}

interface SavedKit {
  files: KitFile[];
  /** sheet id → file key. "" is an explicit "no file"; absent means auto. */
  links: Record<string, string>;
  /** Only consulted when the round itself has no `mySide`. */
  side?: Side;
  /** Which aff speech Smart blocks is helping with - see `answering`. */
  speechMode?: SpeechMode;
  /** "Your 2AC": the page order you set (sheet ids). Absent = T first, then tabs. */
  twoACOrder?: string[];
}

/** "auto" = the 2AC until the neg block has been flowed, then the 1AR. */
export type SpeechMode = "auto" | "2AC" | "1AR";

export interface Suggestion {
  /** sheet : row id : target speech id - stable across edits and reorders. */
  key: string;
  sheetId: string;
  sheetTitle: string;
  rowId: string;
  row: number;
  fromCol: number;
  toCol: number;
  said: string;
  matches: BlockMatch[];
}

export interface LogEntry {
  t: number;
  ev: "insert" | "dismiss";
  said: string;
  block?: string;
  rank?: number;
  sheet: string;
}

// ---- which side a file is for, by its name ---------------------------------
// Word-bounded ("neg_", "AFF - ", "2ACs_"), case-insensitive, and never inside
// a longer word: "Affordable", "Negotiation", "Negative Income Tax" is caught
// by `negative` only as a whole word.
const CASE_NEG_RE = /case[\s_-]*negs?(?![a-z])/i;
const NEG_RE = /(^|[^a-z0-9])neg(s|ative)?(?![a-z])/i;
const TWO_AC_RE = /(^|[^a-z0-9])2acs?(?![a-z])/i;
/** A 1AR file ("1ARs_Single Payer"): the aff's answers to the neg block. */
const ONE_AR_RE = /(^|[^a-z0-9])1ars?(?![a-z])/i;
const AFF_RE = /(^|[^a-z0-9])aff(irmative)?(?![a-z])/i;
/** A file name that also names a kind of position ("NEG - Midterms DA") is a
 *  file for THAT position, not a whole-case file. */
const POSITION_RE = /(^|[^a-z0-9])(das?|disads?|cps?|counterplans?|pics?|ks?|kritiks?|t|topicality|theory)(?![a-z])/i;

/** A topicality page: "T---NHI", "T - Subsets", "Topicality". */
const T_PAGE_RE = /^\s*(t|topicality)(?![a-z0-9])/i;

/** A 2AC file's own section for the case: "Case", "Case---2AC", "CASE Answers". */
const CASE_SECTION_RE = /(^|[^a-z])case([^a-z]|$)/i;

const LOG_BLOB = "smart-log";
const LOG_MAX = 2000;

const filled = (c: Cell | undefined) => !!c && (!!c.text.trim() || !!c.items?.length);

/** `n` is somewhere under `root`. */
function contains(root: DocNode, n: DocNode): boolean {
  return root.children.some((c) => c === n || contains(c, n));
}

const isCardNode = (n: DocNode) => !!n.isAnalytic || n.level >= 4;

/** The exact CardMirror nodes for an insert: the heading's own (a block with
 *  no cards), and each card's by its tag. */
interface Exact {
  cell?: unknown;
  items: Map<string, unknown>;
}

/** How blocks are told apart for "once per page": by title, whatever file or
 *  hat a copy sits in ("AT: No Link" under two hats is one block). */
const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Every block already inserted on a page - a cell's block and the headings
 * inside it (a starter that brought a whole hat brought its blocks). From the
 * round itself, so a partner's insert counts the moment it syncs.
 */
function usedTitles(sheet: Sheet): Set<string> {
  const out = new Set<string>();
  const walk = (n: DocNode) => {
    if (!n || typeof n.text !== "string" || isCardNode(n)) return;
    out.add(normTitle(n.text));
    (n.children ?? []).forEach(walk);
  };
  for (const row of sheet.rows) for (const cell of row.cells) if (cell.card) walk(cell.card as DocNode);
  return out;
}

/** The aff speech a column is, by its abbr ("2AC · You" → 2AC), or by its
 *  label when the speech was renamed. */
function speechOfCol(speeches: Speech[], c: number): string {
  // By POSITION, so every format has a "2AC" and a "1AR": the aff's first and
  // second answering speeches (Policy 2AC/1AR, LD 1AR/2AR, PF Reb/Sum). Also
  // survives renamed columns, which the old abbr/label match needed a
  // fallback for.
  const t = turnOfCol(speeches, c);
  if (t?.side === "aff" && t.index === 1) return "2AC";
  if (t?.side === "aff" && t.index === 2) return "1AR";
  return baseAbbr(speeches[c]).toUpperCase();
}

/** The aff's first answering speech's column ("the 2AC" in any format) - your
 *  own lane on a split speech - or -1. */
function firstAnswerCol(speeches: Speech[], laneHere: number): number {
  const t = sideTurn(speeches, "aff", 1);
  return t ? targetCol(speeches, t.cols[0] - 1, "aff", laneHere) : -1;
}

/**
 * How a file NAME says which speech it's for, in this format: the speech's
 * name minus any side word - "2AC" in policy, "1AR" for LD's first answer,
 * "Reb"/"Rebuttal" in PF. Word-bounded like the regexes above; a name with a
 * digit is used alone (policy's "2AC" must not also match "constructive").
 */
function speechNameRe(speeches: Speech[], t: Turn | null, fallback: RegExp): RegExp {
  if (!t) return fallback;
  const sp = speeches[t.cols[0]];
  const rest = baseAbbr(sp).replace(/^(pro|con|aff|neg)\s+/i, "").trim();
  if (!rest) return fallback;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alts = [esc(rest)];
  if (!/\d/.test(rest)) {
    const word = sp.label.trim().split(/\s+/).pop();
    if (word && word.toLowerCase() !== rest.toLowerCase()) alts.push(esc(word));
  }
  return new RegExp(`(^|[^a-z0-9])(?:${alts.join("|")})s?(?![a-z])`, "i");
}

/** PF names its sides Pro / Con; a file named "Pro - …" is the aff's there. */
const PRO_RE = /(^|[^a-z0-9])pro(?![a-z])/i;
const CON_RE = /(^|[^a-z0-9])con(?![a-z])/i;

/**
 * The column a reply to `from` goes in: the next speech on OUR side. Landing on
 * a split speech means our own lane - `laneHere`, which is a fact about this
 * copy of the flow, never the session's `myLane` (see POSITION vs IDENTITY).
 */
function targetCol(speeches: Speech[], from: number, mySide: Side, laneHere: number): number {
  for (let j = from + 1; j < speeches.length; j++) {
    const sp = speeches[j];
    if (sp.side !== mySide) continue;
    if (!sp.laneGroup) return j;
    const mine = speeches.findIndex((s) => s.laneGroup === sp.laneGroup && s.lane === laneHere);
    return mine >= 0 ? mine : j;
  }
  return -1;
}

const LIBRARY_BLOB = "smart-library";

class SmartKit {
  roundId = $state<string | null>(null);
  /** This round's own files. */
  files = $state<KitFile[]>([]);
  /**
   * The library: files in EVERY round's kit - the handful of common files you
   * always want (T, theory, framework, your case neg). Saved once, not per
   * round; pinning or unpinning moves a file between here and `files`.
   */
  library = $state<KitFile[]>([]);
  private libraryLoaded = false;
  links = $state<Record<string, string>>({});
  side = $state<Side | undefined>(undefined);
  /** Per round: which aff speech the tray is for (the "Answering" switch). */
  speechMode = $state<SpeechMode>("auto");
  /** Per round: the "Your 2AC" page order you set (sheet ids). */
  twoACOrder = $state<string[]>([]);
  /** Parsed trees are large and never edited - raw, so they aren't proxied. */
  parsed = $state.raw<Record<string, Parsed>>({});
  loading = $state(0);
  /** Suggestions waved away this session. Not saved - a restart offers them again. */
  dismissed = $state<string[]>([]);
  /** Match results kept between recomputes - see `suggestions`. */
  private matchCache = new Map<string, BlockMatch[]>();
  private blocksCache = new Map<string, KitBlock[]>();
  private cacheSig = "";
  private cacheParsed: Record<string, Parsed> | null = null;

  /** Library first, then this round's files; a file is never listed twice. */
  get all(): KitFile[] {
    const lib = this.library;
    return [...lib, ...this.files.filter((f) => !lib.some((l) => l.key === f.key))];
  }

  inLibrary(key: string): boolean {
    return this.library.some((f) => f.key === key);
  }

  private async loadLibrary(): Promise<void> {
    if (this.libraryLoaded) return;
    this.libraryLoaded = true;
    this.library = (await loadBlob<KitFile[]>(LIBRARY_BLOB)) ?? [];
    for (const f of this.library) if (!this.parsed[f.key]) void this.parseFromDisk(f);
  }

  private persistLibrary(): void {
    void saveBlob(LIBRARY_BLOB, $state.snapshot(this.library));
  }

  /** Keep a file in every round's kit (moves it out of this round's list). */
  pin(key: string): void {
    const f = this.all.find((x) => x.key === key);
    if (!f || this.inLibrary(key)) return;
    this.library = [...this.library, f];
    this.files = this.files.filter((x) => x.key !== key);
    this.persistLibrary();
    this.persist();
  }

  /** Stop keeping a file in every round - it stays in THIS round's kit. */
  unpin(key: string): void {
    const f = this.library.find((x) => x.key === key);
    if (!f) return;
    this.library = this.library.filter((x) => x.key !== key);
    if (!this.files.some((x) => x.key === key)) this.files = [...this.files, f];
    this.persistLibrary();
    this.persist();
  }

  /** Load (or switch to) the kit for a round. Cheap when it's already loaded. */
  async attach(roundId: string | undefined): Promise<void> {
    void this.loadLibrary();
    if (!roundId || roundId === this.roundId) return;
    this.roundId = roundId;
    this.files = [];
    this.links = {};
    this.side = undefined;
    this.speechMode = "auto";
    this.twoACOrder = [];
    this.dismissed = [];
    const saved = await loadBlob<SavedKit>(`smartkit-${roundId}`);
    if (this.roundId !== roundId) return; // switched again while loading
    this.files = saved?.files ?? [];
    // A page linked to a pinned file by its old saved-copy key follows the
    // file to its real path (see refreshFromDisk).
    const moved = new Map(this.library.flatMap((f) => (f.was ?? []).map((w) => [w, f.key] as const)));
    this.links = Object.fromEntries(Object.entries(saved?.links ?? {}).map(([s, k]) => [s, moved.get(k) ?? k]));
    this.side = saved?.side;
    this.speechMode = saved?.speechMode ?? "auto";
    this.twoACOrder = saved?.twoACOrder ?? [];
    for (const f of this.files) {
      if (!this.parsed[f.key]) void this.parseFromDisk(f);
    }
  }

  private persist(): void {
    if (!this.roundId) return;
    const kit: SavedKit = {
      files: $state.snapshot(this.files),
      links: $state.snapshot(this.links),
      side: this.side,
      speechMode: this.speechMode,
      ...(this.twoACOrder.length ? { twoACOrder: this.twoACOrder } : {}),
    };
    void saveBlob(`smartkit-${this.roundId}`, kit);
  }

  private setParsed(key: string, p: Parsed): void {
    this.parsed = { ...this.parsed, [key]: p };
  }

  private ingest(key: string, buf: ArrayBuffer): void {
    try {
      const { nodes } = parseSpeechDoc(buf);
      this.setParsed(key, {
        roots: nodes,
        blocks: indexBlocks(key, nodes),
        firstHeading: nodes[0]?.text ?? "",
      });
    } catch (e) {
      this.fail(key, e);
    }
  }

  private fail(key: string, e: unknown): void {
    this.setParsed(key, { roots: [], blocks: [], firstHeading: "", error: String(e instanceof Error ? e.message : e) });
  }

  /**
   * Read a kit file. ⚠ Only ever called for a file the user picked for this
   * kit - on a Dropbox placeholder that read is a download, which is fine for
   * a file you chose and would not be for a library scan.
   */
  private async parseFromDisk(f: KitFile): Promise<void> {
    if (f.key.startsWith("mem:")) {
      this.fail(f.key, "Not saved on disk - add it again");
      return;
    }
    this.loading++;
    try {
      if (f.key.startsWith("copy:")) {
        const b64 = await loadBlob<string>(copyBlobName(f.key));
        if (!b64) throw new Error("The saved copy is gone - drop the file again");
        this.ingest(f.key, fromBase64(b64));
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const at = Date.now();
      const bytes = await invoke<number[]>("read_binary_file", { path: f.key });
      this.ingest(f.key, new Uint8Array(bytes).buffer);
      this.readAt.set(f.key, at);
    } catch (e) {
      this.fail(f.key, e);
    } finally {
      this.loading--;
    }
  }

  // ---- keeping kit files current ---------------------------------------------
  //
  // Adam: a pinned file didn't pick up edits to it. Two causes, both fixed here:
  // a dropped file Nimbus couldn't place was kept as a frozen saved COPY, and a
  // file read from disk was read once per session.

  /** When each on-disk file was last read (ms) - to notice it changed since. */
  private readAt = new Map<string, number>();

  /**
   * Make every kit file follow the real file on disk:
   *
   * 1. A saved `copy:` is relinked to the real file when the Doc Search
   *    library holds one by that name. Several (a team's workshop copies of
   *    the same file) → the most recently edited, then the shortest path. Its
   *    picks ("Adv pages use", every-sheet) and page links carry over. No
   *    match → it stays a copy, as before.
   * 2. A file read from disk is re-read when the library's scan shows it was
   *    modified after we read it.
   *
   * Only uses the library index (no extra disk walk); runs when the tray
   * opens and after every library rescan (window focus).
   */
  refreshFromDisk(): void {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    const idx = fileIndex.files;
    if (!idx.length) return;
    const lookup = (name: string) => {
      const m = /^(.*)\.(docx|cmir)$/i.exec(name);
      if (!m) return undefined;
      const stem = m[1].toLowerCase();
      const ext = m[2].toLowerCase();
      return idx
        .filter((x) => x.ext === ext && x.name.toLowerCase() === stem)
        .sort((a, b) => b.mtime - a.mtime || a.path.length - b.path.length)[0];
    };
    const relink = new Map<string, string>();
    for (const f of this.all) {
      if (!f.key.startsWith("copy:")) continue;
      const hit = lookup(f.name);
      if (hit && !this.all.some((x) => x.key === hit.path)) relink.set(f.key, hit.path);
    }
    if (relink.size) {
      const swap = (f: KitFile): KitFile =>
        relink.has(f.key) ? { ...f, key: relink.get(f.key)!, was: [...(f.was ?? []), f.key] } : f;
      this.library = this.library.map(swap);
      this.files = this.files.map(swap);
      this.links = Object.fromEntries(Object.entries(this.links).map(([s, k]) => [s, relink.get(k) ?? k]));
      this.persistLibrary();
      this.persist();
      for (const [old, key] of relink) {
        this.cmDocs.delete(old);
        const f = this.all.find((x) => x.key === key);
        if (f) void this.parseFromDisk(f);
      }
    }
    for (const f of this.all) {
      if (f.key.startsWith("copy:") || f.key.startsWith("mem:")) continue;
      const hit = idx.find((x) => x.path === f.key);
      const at = this.readAt.get(f.key);
      if (hit && at && hit.mtime > at) {
        this.readAt.set(f.key, Date.now()); // don't queue it twice
        this.cmDocs.delete(f.key);
        void this.parseFromDisk(f);
      }
    }
  }

  // ---- exact CardMirror nodes, for inserts ----------------------------------
  // Read once per file per session (CardMirror's own fromDocx), on first use
  // or when the tray opens (prewarmExact), so an insert doesn't wait on it.
  private cmDocs = new Map<string, Promise<CMDoc | null>>();

  private cmDocFor(key: string): Promise<CMDoc | null> {
    let p = this.cmDocs.get(key);
    if (!p) {
      p = this.loadCMDoc(key);
      this.cmDocs.set(key, p);
    }
    return p;
  }

  private async loadCMDoc(key: string): Promise<CMDoc | null> {
    const f = this.all.find((x) => x.key === key);
    if (!f || key.startsWith("mem:")) return null;
    try {
      let buf: ArrayBuffer;
      if (key.startsWith("copy:")) {
        const b64 = await loadBlob<string>(copyBlobName(key));
        if (!b64) return null;
        buf = fromBase64(b64);
      } else {
        const { invoke } = await import("@tauri-apps/api/core");
        buf = new Uint8Array(await invoke<number[]>("read_binary_file", { path: key })).buffer;
      }
      return await cmDocFromBytes(buf, /\.cmir$/i.test(f.name));
    } catch {
      return null;
    }
  }

  /** Start reading every kit file's CardMirror doc in the background, one at a
   *  time, so the first insert from each is instant. */
  prewarmExact(): void {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const keys = this.all.map((f) => f.key).filter((k) => !this.cmDocs.has(k) && !k.startsWith("mem:"));
    void keys.reduce<Promise<unknown>>((chain, k) => chain.then(() => this.cmDocFor(k)), Promise.resolve());
  }

  /** The exact nodes for inserting `node` from `fileKey` - null if the file
   *  can't be read that way (then the cell uses the DocNode adapter). */
  private async exactFor(fileKey: string | undefined, node: DocNode): Promise<Exact | null> {
    if (!fileKey) return null;
    const cm = await this.cmDocFor(fileKey);
    if (!cm) return null;
    const cards = cardsUnder(node);
    const items = new Map<string, unknown>();
    if (cards.length) {
      for (const c of cards) {
        const ns = extractCMNodes(cm, c.text, 4);
        if (ns.length) items.set(c.text.trim(), ns[0]);
      }
      return { items };
    }
    return { cell: extractCMNodes(cm, node.text, node.level)[0], items };
  }

  /** Add files by path (the Tauri file picker). */
  async addPaths(paths: string[]): Promise<void> {
    for (const path of paths) {
      if (this.all.some((f) => f.key === path)) continue;
      const name = path.split(/[\\/]/).pop() ?? path;
      const f: KitFile = { key: path, name };
      this.files = [...this.files, f];
      await this.parseFromDisk(f);
    }
    this.persist();
  }

  /** Add a file from its bytes (a browser, or a test). Lives for this session. */
  addBytes(name: string, buf: ArrayBuffer): void {
    const key = `mem:${name}`;
    if (!this.all.some((f) => f.key === key)) this.files = [...this.files, { key, name }];
    this.ingest(key, buf);
    this.persist();
  }

  /**
   * Files dropped onto the tray.
   *
   * ⚠ A web drop carries the file's NAME and bytes but never its path (the
   * window's native drop, which would, is off - it breaks dragging blocks onto
   * the grid). So the path is recovered from the Doc Search library index by
   * name + exact size, which keeps the kit pointing at the REAL file and picks
   * up later edits to it. A file the index doesn't hold, or holds ambiguously,
   * is kept as a saved copy instead, and the kit says so.
   */
  async addDropped(dropped: File[]): Promise<void> {
    for (const file of dropped) {
      const ext = /\.(docx|cmir)$/i.exec(file.name)?.[1].toLowerCase();
      if (!ext || file.name.startsWith("~$")) continue;
      const stem = file.name.slice(0, -ext.length - 1).toLowerCase();
      const hits = fileIndex.files.filter(
        (f) => f.ext === ext && f.name.toLowerCase() === stem && f.size === file.size,
      );
      if (hits.length === 1 && "__TAURI_INTERNALS__" in window) {
        await this.addPaths([hits[0].path]);
        continue;
      }
      const key = `copy:${file.name}`;
      const buf = await file.arrayBuffer();
      await saveBlob(copyBlobName(key), toBase64(buf));
      if (!this.all.some((f) => f.key === key)) this.files = [...this.files, { key, name: file.name }];
      this.ingest(key, buf);
      this.persist();
    }
  }

  /**
   * The Overviews tab for a sheet: in its linked file, every heading named
   * "Main" contributes the FIRST block beneath it, labelled with the section
   * the Main sits in (Uniqueness › Main › "Uniqueness---2NC" → Uniqueness).
   * A Main holding cards with no block under it is its own overview.
   */
  overviewsFor(sheet: Sheet): Overview[] {
    const out: Overview[] = [];
    const isCard = (n: DocNode) => n.isAnalytic || n.level >= 4;

    // 2AC impact overviews (aff sheets, when we're aff): in each 2AC file's
    // CASE section, every advantage opens with a block named for itself
    // ("Disease---2AC") whose analytics are the impact overview. The one for
    // THIS sheet's advantage, if its title names one, comes first.
    const want = tokens(sheet.title);
    const affOverviews: Array<Overview & { mine: boolean }> = [];
    // From the files for the speech you're answering (an "AFF - X" file, with
    // no speech in its name, counts as the 2AC's).
    const ans = store.round ? this.answering(store.round) : "2AC";
    const forSpeech = (x: string) => (this.fileSpeech(x) ?? (this.isTwoAC(x) ? "2AC" : undefined)) === ans;
    for (const k of this.twoACsFor(sheet).filter(forSpeech)) {
      const kase = this.scopeFor(sheet, k);
      // Picked "Case + Turns": the advantages live under Case, not Turns.
      const secs = kase ? this.sectionRoots(kase) : [];
      const caseSecs = secs.filter((s) => CASE_SECTION_RE.test(s.text));
      for (const adv of (caseSecs.length ? caseSecs : secs).flatMap((s) => s.children)) {
        // Solvency sits under CASE too, but it has no impact to overview.
        if (isCard(adv) || /^solvency$/i.test(adv.text.trim())) continue;
        const first = adv.children.find((c) => !isCard(c));
        if (!first) continue;
        const advTokens = tokens(adv.text);
        affOverviews.push({
          section: adv.text.trim(),
          node: first,
          cardCount: cardsUnder(first).length,
          file: k,
          mine: want.some((t) => advTokens.includes(t)),
        });
      }
    }
    affOverviews.sort((a, b) => Number(b.mine) - Number(a.mine));
    out.push(...affOverviews.map(({ mine: _mine, ...o }) => o));

    const file = this.fileFor(sheet);
    const roots = file ? (file.scope ? this.sectionRoots(file.scope) : file.roots) : undefined;
    if (!roots) return out;
    const walk = (ns: DocNode[], parent: DocNode | null) => {
      for (const n of ns) {
        if (isCard(n)) continue;
        if (n.text.trim().toLowerCase() === "main") {
          const first = n.children.find((c) => !isCard(c)) ?? (n.children.some(isCard) ? n : undefined);
          if (first) {
            out.push({
              section: parent?.text.trim() || first.text,
              node: first,
              cardCount: cardsUnder(first).length,
              file: file?.key,
            });
          }
          continue;
        }
        walk(n.children, n);
      }
    };
    walk(roots, null);
    return out;
  }

  /** The kit file a sheet's File and Overviews tabs show, with its name and
   *  the section of it that belongs to the sheet (null = the whole file). */
  fileFor(sheet: Sheet): { key: string; name: string; roots: DocNode[]; scope: DocNode | null } | null {
    // An aff sheet with no file of its own shows its case neg / 2AC file.
    let key = this.linkFor(sheet) ?? this.caseFilesFor(sheet)[0] ?? null;
    // Aff, nothing picked by hand: the file for the speech you're answering
    // (the Answering switch) - your 1AR file's section once you're on the 1AR.
    if (!(sheet.id in this.links) && store.round && this.currentSide() === "aff") {
      const ans = this.answering(store.round);
      const hit = [...this.speechFilesFor(sheet), ...this.twoACsFor(sheet)].find((k) => this.fileSpeech(k) === ans);
      if (hit) key = hit;
    }
    const f = this.all.find((x) => x.key === key);
    const p = key ? this.parsed[key] : undefined;
    return f && p ? { key: f.key, name: f.name, roots: p.roots, scope: this.scopeFor(sheet, f.key) } : null;
  }

  /**
   * Put a block into the cell under the cursor - exactly what Ctrl+K does with
   * a click in a file (replaces the cell, then steps down a row so the next
   * one stacks under it). One undo step.
   */
  async insertAtCursor(node: DocNode, fileKey?: string): Promise<boolean> {
    const cur = store.cursor;
    const sheetId = store.activeSheetId;
    if (!store.round || !cur || !sheetId) return false;
    const { row, col } = cur;
    if (!(await this.insertAt(sheetId, row, col, node, fileKey))) return false;
    store.cursor = { row: row + 1, col };
    return true;
  }

  /**
   * Put a block into one cell - what a click does, and what a DRAG from the
   * tray does when it's dropped on the grid. Builds the same cell either way,
   * with the exact CardMirror copy, so a dragged block keeps its tables when
   * you send it to the doc (a drop used to keep only the outline).
   */
  async insertAt(sheetId: string, row: number, col: number, node: DocNode, fileKey?: string): Promise<boolean> {
    if (!store.round) return false;
    // The exact CardMirror copy first (cached - normally instant), so the ONE
    // mutate below has everything: one undo step, one sync.
    const exact = await this.exactFor(fileKey, node).catch(() => null);
    if (!store.round) return false;
    let done = false;
    store.mutate((r) => {
      const sheet = r.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      store.ensureRows(row, sheet);
      const cell = sheet.rows[row]?.cells[col];
      if (!cell) return;
      fillCell(cell, node, exact);
      done = true;
    });
    return done;
  }

  /**
   * Take a file out of the kit. A library file leaves the library (so every
   * round); a round file leaves this round only.
   *
   * ⚠ A dropped file's saved copy is NOT deleted: the same `copy:` key can be
   * in another round's kit, or the library, and deleting it here broke that.
   */
  remove(key: string): void {
    if (this.inLibrary(key)) {
      this.library = this.library.filter((f) => f.key !== key);
      this.persistLibrary();
      return;
    }
    this.files = this.files.filter((f) => f.key !== key);
    const links = { ...this.links };
    for (const [sheet, k] of Object.entries(links)) if (k === key) delete links[sheet];
    this.links = links;
    this.persist();
  }

  setGeneral(key: string, general: boolean): void {
    const set = (f: KitFile) => (f.key === key ? { ...f, general: general || undefined } : f);
    if (this.inLibrary(key)) {
      this.library = this.library.map(set);
      this.persistLibrary();
    } else {
      this.files = this.files.map(set);
      this.persist();
    }
  }

  setSide(side: Side): void {
    this.side = side;
    this.persist();
  }

  /** `null` returns the sheet to automatic linking; "" means "no file". */
  setLink(sheetId: string, key: string | null): void {
    const links = { ...this.links };
    if (key === null) delete links[sheetId];
    else links[sheetId] = key;
    this.links = links;
    this.persist();
  }

  /**
   * A case neg answers the aff's case, whatever the advantage sheets happen to
   * be called ("Adv 1", "Warming") - so it is recognised by its NAME or top
   * heading ("Case Neg", "caseneg", "Case Negs"), not by matching sheet titles.
   *
   * ⚠ Not by folder. `Casenegs\Native Climate\` also holds a China Soft Power
   * DA, and a folder rule would pin that DA to every case sheet.
   */
  isCaseNeg(key: string): boolean {
    // "NEG - Single Payer" is a case neg too - but "NEG - Midterms DA" or
    // "NEG - Midterms" (with a "Midterms" page in the round) is that
    // position's file, and must not land on every advantage page.
    if (this.named(key, CASE_NEG_RE)) return true;
    return this.named(key, NEG_RE) && !this.namesPosition(key) && !this.namesOffcaseSheet(key);
  }

  /** A 2AC file ("2ACs_Single Payer", "AFF - Single Payer"): the aff's
   *  answers, case AND off-case. */
  isTwoAC(key: string): boolean {
    if (this.fileSide(key) === "neg") return false;
    const re = this.speechRes();
    // PF: both teams give a rebuttal, so only a Pro (or AFF) file is yours.
    if (re.pf && this.fileSide(key) !== "aff") return false;
    // "2AC" means this format's first answer: an LD round's "1ARs" file, a
    // PF round's "Pro Rebuttal" file.
    return this.named(key, re.first) || (this.named(key, re.aff) && !this.namesPosition(key));
  }

  /** File-name tests for this round's format (see `speechNameRe`). Policy:
   *  exactly TWO_AC_RE / ONE_AR_RE / AFF_RE / NEG_RE, as before. */
  private speechRes(): { first: RegExp; second: RegExp; aff: RegExp; neg: RegExp; pf: boolean } {
    const sp = store.round?.template.speeches;
    if (!sp) return { first: TWO_AC_RE, second: ONE_AR_RE, aff: AFF_RE, neg: NEG_RE, pf: false };
    const pf = sp.some((s) => /^(pro|con)\s/i.test(s.abbr));
    return {
      first: speechNameRe(sp, sideTurn(sp, "aff", 1), TWO_AC_RE),
      second: speechNameRe(sp, sideTurn(sp, "aff", 2), ONE_AR_RE),
      aff: pf ? new RegExp(`${AFF_RE.source}|${PRO_RE.source}`, "i") : AFF_RE,
      neg: pf ? new RegExp(`${NEG_RE.source}|${CON_RE.source}`, "i") : NEG_RE,
      pf,
    };
  }

  /**
   * Which side a file is FOR, by its name: 2AC / AFF files are the aff's,
   * case neg / NEG files the neg's. undefined = either (a DA file, a T file).
   */
  fileSide(key: string): Side | undefined {
    const re = this.speechRes();
    if (this.named(key, CASE_NEG_RE) || this.named(key, re.neg)) return "neg";
    if (
      this.named(key, TWO_AC_RE) || this.named(key, ONE_AR_RE) || this.named(key, re.aff) ||
      this.named(key, re.first) || this.named(key, re.second)
    ) {
      // PF: "Reb"/"Sum" alone name a speech both teams give - only Pro/Con
      // (or AFF/NEG) says whose file it is.
      if (re.pf && !this.named(key, re.aff)) return undefined;
      return "aff";
    }
    return undefined;
  }

  /** A 1AR file: like a 2AC file (its case sections answer the advantage
   *  pages, each off-case page gets its section by name) but for the 1AR -
   *  answers to the neg BLOCK, so only ever suggested into the 1AR column. */
  isOneAR(key: string): boolean {
    const re = this.speechRes();
    const side = this.fileSide(key);
    if (side === "neg" || (re.pf && side !== "aff")) return false;
    return this.named(key, re.second) && !this.isTwoAC(key);
  }

  /** The aff's per-speech files - 2AC and 1AR. */
  isAffSpeechFile(key: string): boolean {
    return this.isTwoAC(key) || this.isOneAR(key);
  }

  /**
   * The ONE speech a file's blocks may be suggested into, by its name: a 2AC
   * file's go in the 2AC column, a 1AR file's in the 1AR column. undefined =
   * any (a DA file, a T file, a case neg). Name only, never the first heading:
   * a DA file opening on "2NC Overview" is not a 2NC-only file.
   */
  fileSpeech(key: string): "2AC" | "1AR" | undefined {
    const f = this.all.find((x) => x.key === key);
    if (!f || this.fileSide(key) === "neg") return undefined;
    const re = this.speechRes();
    if (re.pf && this.fileSide(key) !== "aff") return undefined;
    const two = re.first.test(f.name);
    const one = re.second.test(f.name);
    return two && !one ? "2AC" : one && !two ? "1AR" : undefined;
  }

  /**
   * The aff speech files that have a section for this (off-case) page - named
   * for it, or holding a pocket/hat named for it. Never one WITHOUT a match:
   * a whole 2AC file on one DA page is exactly the flood to avoid.
   */
  speechFilesFor(sheet: Sheet): string[] {
    if (sheet.kind === "case" || sheet.kind === "cx" || this.currentSide() !== "aff") return [];
    if (this.links[sheet.id] === "") return [];
    return this.all
      .filter((f) => this.isAffSpeechFile(f.key) && !this.wrongSide(f.key) && this.hasSectionFor(sheet, f.key))
      .map((f) => f.key);
  }

  /** The file is named for this page, or has a pocket/hat for it. */
  private hasSectionFor(sheet: Sheet, key: string): boolean {
    const f = this.all.find((x) => x.key === key);
    const p = this.parsed[key];
    if (!f || !p) return false;
    return (
      !!guessFileForSheet(sheet.title, [{ key, name: f.name, firstHeading: p.firstHeading }]) ||
      !!guessSection(sheet.title, p.roots)
    );
  }

  /**
   * A file for the OTHER side than the one you're on - a case neg when you're
   * aff, a 2AC file when you're neg. Never matched to a page automatically (or
   * as a general file); picking it for a sheet by hand still works.
   */
  wrongSide(key: string): boolean {
    const me = this.currentSide();
    const s = this.fileSide(key);
    return !!me && !!s && s !== me;
  }

  /** The file NAME also says what kind of position it is (DA, CP, K, T...). */
  private namesPosition(key: string): boolean {
    const f = this.all.find((x) => x.key === key);
    return !!f && POSITION_RE.test(f.name);
  }

  /** The file is named for one of this round's non-advantage pages - the same
   *  name test as auto-linking ("NEG - Midterms" ↔ a "Midterms" page). */
  private namesOffcaseSheet(key: string): boolean {
    const f = this.all.find((x) => x.key === key);
    if (!f || !store.round) return false;
    const cand = [{ key, name: f.name, firstHeading: this.parsed[key]?.firstHeading ?? "" }];
    return store.round.sheets.some((s) => s.kind !== "case" && s.kind !== "cx" && !!guessFileForSheet(s.title, cand));
  }

  private named(key: string, re: RegExp): boolean {
    const f = this.all.find((x) => x.key === key);
    if (!f) return false;
    return re.test(f.name) || re.test(this.parsed[key]?.firstHeading ?? "");
  }

  private currentSide(): Side | undefined {
    return store.round ? this.mySide(store.round) : undefined;
  }

  /** Case-neg files that apply to this sheet: every aff (case) sheet gets all
   *  of them, unless the sheet was explicitly set to "No file" - and never
   *  when WE are aff (then the 2AC file answers the case; see twoACsFor). */
  // ⚠ "every sheet" (`general`) does NOT take a file out of these. It used to,
  // and a 2AC file ticked "every sheet" then vanished from the advantage pages
  // and from the per-sheet dropdown ("Auto: none found") - a real report. The
  // tick only ADDS the file to every other sheet too.
  caseNegsFor(sheet: Sheet): string[] {
    if (sheet.kind !== "case" || this.links[sheet.id] === "" || this.currentSide() === "aff") return [];
    return this.all.filter((f) => this.isCaseNeg(f.key)).map((f) => f.key);
  }

  /** 2AC files on an aff sheet, when WE are aff - their CASE section answers it,
   *  whatever the advantage sheets are called. Every 2AC file counts, including
   *  a catch-all like "2ACs_Single Payer_Ks" (all the K answers, kept apart). */
  twoACsFor(sheet: Sheet): string[] {
    if (sheet.kind !== "case" || this.links[sheet.id] === "" || this.currentSide() !== "aff") return [];
    // 1AR files too: their case sections answer the block's case arguments
    // (kept to the 1AR column by fileSpeech).
    return this.all.filter((f) => this.isAffSpeechFile(f.key)).map((f) => f.key);
  }

  // ---- which sections of a file the ADVANTAGE pages use ---------------------

  /** A file that feeds advantage pages (2AC / case neg), so it gets the picker. */
  advPickable(key: string): boolean {
    return this.isAffSpeechFile(key) || this.isCaseNeg(key);
  }

  /** The hand-picked sections that still exist in the file, in file order. */
  pickedSections(key: string): DocNode[] {
    const f = this.all.find((x) => x.key === key);
    const p = this.parsed[key];
    if (!f?.advSections?.length || !p) return [];
    if (f.advSections.includes(ALL_SECTIONS)) return p.roots;
    const want = new Set(f.advSections.map((s) => s.trim().toLowerCase()));
    const out: DocNode[] = [];
    for (const root of p.roots) {
      const rp = root.text.trim();
      if (want.has(rp.toLowerCase())) {
        out.push(root);
        continue; // a picked pocket already holds its hats
      }
      for (const hat of root.children) {
        if (want.has(`${rp}${SECTION_SEP}${hat.text.trim()}`.toLowerCase())) out.push(hat);
      }
    }
    return out;
  }

  /** The sections of a file that are CASE, which off-case pages fall back to
   *  only when nothing else matches:
   *  what you picked under "Adv pages use", else its case-named pockets.
   *  "Whole file" / "nothing" picks say nothing about where case is → none. */
  caseSectionsOf(key: string): DocNode[] {
    const f = this.all.find((x) => x.key === key);
    const p = this.parsed[key];
    if (!p || f?.advSections?.includes(ALL_SECTIONS) || f?.advSections?.includes(NO_SECTIONS)) return [];
    const picked = this.pickedSections(key);
    return picked.length ? picked : p.roots.filter((r) => CASE_SECTION_RE.test(r.text));
  }

  /** A 2AC file's automatic sections for an advantage page: its case-named
   *  pockets, plus a section named for this advantage ("Warming"). */
  private autoAdvSections(sheet: Sheet, key: string): DocNode[] {
    const p = this.parsed[key];
    if (!p) return [];
    const out = p.roots.filter((r) => CASE_SECTION_RE.test(r.text));
    const own = guessSection(sheet.title, p.roots);
    if (own && !out.some((r) => r === own || contains(r, own))) out.push(own);
    return out;
  }

  /** What the Kit tab says a file's advantage pages use. `empty` = a 2AC file
   *  with nothing to use until you pick. */
  advSummary(key: string): { text: string; auto: boolean; empty: boolean } {
    const f = this.all.find((x) => x.key === key);
    if (f?.advSections?.includes(ALL_SECTIONS)) return { text: "Whole file", auto: false, empty: false };
    if (f?.advSections?.includes(NO_SECTIONS)) return { text: "", auto: false, empty: true };
    const picked = this.pickedSections(key);
    if (picked.length) return { text: picked.map((n) => n.text.trim()).join(" + "), auto: false, empty: false };
    if (!this.isAffSpeechFile(key)) return { text: "Whole file", auto: true, empty: false };
    const cases = (this.parsed[key]?.roots ?? []).filter((r) => CASE_SECTION_RE.test(r.text));
    return cases.length
      ? { text: cases.map((n) => n.text.trim()).join(" + "), auto: true, empty: false }
      : { text: "", auto: true, empty: true };
  }

  /**
   * What "Auto" currently means for a file, as picker paths: a 2AC/1AR file's
   * case-named pockets, a case neg's every pocket. The picker shows these as
   * ticked, and a first tick starts FROM them - so ticking "Turns" in Auto
   * gives Case + Turns, not Turns alone.
   */
  autoPaths(key: string): string[] {
    const roots = (this.parsed[key]?.roots ?? []).filter((n) => !n.isAnalytic && n.level < 4);
    const use = this.isAffSpeechFile(key) ? roots.filter((r) => CASE_SECTION_RE.test(r.text)) : roots;
    return use.map((r) => r.text.trim());
  }

  /** `null`/[] = back to automatic. */
  setAdvSections(key: string, paths: string[] | null): void {
    const set = (f: KitFile): KitFile => {
      if (f.key !== key) return f;
      const { advSections: _old, ...rest } = f;
      return paths?.length ? { ...rest, advSections: paths } : rest;
    };
    if (this.inLibrary(key)) {
      this.library = this.library.map(set);
      this.persistLibrary();
    } else {
      this.files = this.files.map(set);
      this.persist();
    }
  }

  /**
   * Several sections used as ONE: a stand-in heading holding them, so the File
   * tab, Overviews and block scoping all keep working on "a section". Cached
   * per file + selection (the tray keys off its identity); a re-read file
   * builds a new one. Zero sections is a real, empty answer: nothing.
   */
  private combined = new WeakSet<DocNode>();
  private combineCache = new Map<string, { parsed: Parsed; node: DocNode }>();
  private combine(key: string, nodes: DocNode[]): DocNode {
    if (nodes.length === 1) return nodes[0];
    const p = this.parsed[key];
    const text = nodes.map((n) => n.text.trim()).join(" + ") || "no sections picked";
    const ck = `${key}\u0000${text}`;
    const hit = this.combineCache.get(ck);
    if (hit && hit.parsed === p) return hit.node;
    const node: DocNode = { level: 0, text, runs: [], children: nodes, body: [], bodyRuns: [] };
    this.combined.add(node);
    this.combineCache.set(ck, { parsed: p, node });
    return node;
  }

  /** The real sections behind a scope - itself, or what a combined one holds. */
  sectionRoots(scope: DocNode): DocNode[] {
    return this.combined.has(scope) ? scope.children : [scope];
  }

  /** A combined scope with nothing in it: the file gives this page nothing. */
  isEmptyScope(scope: DocNode | null): boolean {
    return !!scope && this.combined.has(scope) && scope.children.length === 0;
  }

  private inScope(b: KitBlock, scope: DocNode): boolean {
    return this.sectionRoots(scope).some((s) => b.node === s || b.anc.includes(s));
  }

  /** Every file that applies to an aff sheet automatically. */
  private caseFilesFor(sheet: Sheet): string[] {
    return [...this.caseNegsFor(sheet), ...this.twoACsFor(sheet)];
  }

  /**
   * The automatic guess for a sheet, ignoring any explicit choice: a file NAMED
   * for the position first, else a multi-position file with a SECTION for it
   * (an aff master file's `CP---Public Option`). Case negs never auto-link -
   * they have their own rule.
   */
  autoLink(sheet: Sheet): string | null {
    // Aff, off-case: your 2AC (then 1AR) file's section for this position is
    // the page's file - ahead of any same-named file that says no side ("Midterms
    // Uniqueness" is the NEG's, but its name can't say so).
    if (sheet.kind !== "case") {
      const mine = this.speechFilesFor(sheet);
      const pick = mine.find((k) => this.isTwoAC(k)) ?? mine[0];
      if (pick) return pick;
    }
    const pool = this.all.filter(
      (f) => !this.isCaseNeg(f.key) && !this.wrongSide(f.key) && this.parsed[f.key]?.blocks.length,
    );
    const byName = guessFileForSheet(
      sheet.title,
      pool.map((f) => ({ key: f.key, name: f.name, firstHeading: this.parsed[f.key].firstHeading })),
    );
    if (byName) return byName;
    if (sheet.kind === "case") return null; // aff sheets are covered by caseFilesFor
    return pool.find((f) => guessSection(sheet.title, this.parsed[f.key].roots))?.key ?? null;
  }

  /** The file a sheet draws from: an explicit choice, else the guess. */
  linkFor(sheet: Sheet): string | null {
    if (sheet.id in this.links) return this.links[sheet.id] || null;
    return this.autoLink(sheet);
  }

  /**
   * The part of a file that belongs to a sheet, or null for the whole file.
   *
   * A file named for the position ("DA_Midterms" on "Midterms") is used whole:
   * its sections are Uniqueness/Link/Impact, not positions. A multi-position
   * file is cut to the section for the sheet, so two CPs' "AT: Perm" blocks in
   * one master file stay apart. On an aff sheet a 2AC file is cut to its CASE.
   */
  scopeFor(sheet: Sheet, key: string): DocNode | null {
    const f = this.all.find((x) => x.key === key);
    const p = this.parsed[key];
    if (!f || !p) return null;
    if (sheet.kind === "case" && (this.twoACsFor(sheet).includes(key) || this.caseNegsFor(sheet).includes(key))) {
      // Sections picked by hand win, for either kind of file - "nothing" too.
      if (f.advSections?.includes(NO_SECTIONS)) return this.combine(key, []);
      const picked = this.pickedSections(key);
      if (picked.length) return this.combine(key, picked);
      // A 2AC file is NEVER used whole on an advantage page: most of it is
      // off-case answers, and a file with no Case section would flood every
      // advantage with them. Its case-named sections (and one named for this
      // advantage) or nothing - and the Kit tab asks you to pick.
      if (this.isAffSpeechFile(key)) return this.combine(key, this.autoAdvSections(sheet, key));
      // A case neg IS all case: fall through (its section for this advantage,
      // else the whole file) - as it always was.
    }
    if (guessFileForSheet(sheet.title, [{ key, name: f.name, firstHeading: p.firstHeading }])) return null;
    // Every section that ties for this page (an updated hat beside the old one).
    // An off-case page takes a 2AC/1AR file's CASE sections only when nothing
    // else matches (see `caseSectionsOf`).
    const skip = sheet.kind !== "case" && this.isAffSpeechFile(key) ? this.caseSectionsOf(key) : [];
    const secs = guessSections(sheet.title, p.roots, skip);
    return secs.length ? this.combine(key, secs) : null;
  }

  /** Every block a sheet may suggest: its own file's (cut to its section), any
   *  case files (on an aff sheet), then the general files'. Each block once. */
  blocksFor(sheet: Sheet): KitBlock[] {
    const keys = new Set<string>();
    const own = this.linkFor(sheet);
    if (own) keys.add(own);
    const caseFiles = this.caseFilesFor(sheet);
    for (const k of caseFiles) keys.add(k);
    // Off-case pages when aff: every 2AC / 1AR file's section for the page.
    const speechFiles = this.speechFilesFor(sheet);
    for (const k of speechFiles) keys.add(k);
    const general = new Set(this.all.filter((f) => f.general && !this.wrongSide(f.key)).map((f) => f.key));
    for (const k of general) keys.add(k);
    const out: KitBlock[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      // A file that is ONLY here for "every sheet" is used whole; one that is
      // also this sheet's own or case file keeps its section (a 2AC's CASE).
      const onlyGeneral = general.has(k) && k !== own && !caseFiles.includes(k) && !speechFiles.includes(k);
      const scope = onlyGeneral ? null : this.scopeFor(sheet, k);
      for (const b of this.parsed[k]?.blocks ?? []) {
        if (seen.has(b.id)) continue;
        if (scope && !this.inScope(b, scope)) continue;
        seen.add(b.id);
        out.push(b);
      }
    }
    return out;
  }

  mySide(round: Round): Side | undefined {
    const s = round.mySide === "aff" || round.mySide === "neg" ? round.mySide : this.side;
    return s === "aff" || s === "neg" ? s : undefined;
  }

  /**
   * Every open suggestion in the round, across all sheets.
   *
   * An opponent cell gets suggestions when the cell a reply would go in - our
   * next speech on that row - is still empty. Filling that cell (by accepting,
   * by typing, or by a PARTNER accepting on their machine and it syncing over)
   * is what retires it, so two partners cannot both insert the same answer
   * unless they click within the same sync tick.
   */
  suggestions(round: Round, laneHere: number): Suggestion[] {
    const side = this.mySide(round);
    if (!side || !this.all.length) return [];
    const speeches = round.template.speeches;
    // The round's opening speech (a 1AC) is never answered from the kit: the
    // 1NC is read off a prepared shell, not built block-by-block against the
    // 1AC's arguments. By speaking order, not by name - same as lanes.
    const opening = speeches[0];
    const isOpening = (sp: Speech) =>
      sp === opening || (!!opening?.laneGroup && sp.laneGroup === opening.laneGroup);
    const out: Suggestion[] = [];
    // Matches are kept between recomputes, so an edit re-matches only the
    // cells whose text changed - measured ~40ms per pass on a 3,600-cell flow
    // against 748 blocks without it, and this runs after every edit. Anything
    // that changes WHICH blocks a sheet sees drops the lot.
    // Sheet titles/kinds are in it too: whether a "NEG - X" file is a case neg
    // depends on whether some OTHER page is named X (namesOffcaseSheet).
    const sig = JSON.stringify([
      this.all.map((f) => f.key + (f.general ? "*" : "") + (f.advSections ? JSON.stringify(f.advSections) : "")),
      this.links,
      side,
      round.sheets.map((s) => `${s.kind}:${s.title}`),
    ]);
    if (sig !== this.cacheSig || this.parsed !== this.cacheParsed || this.matchCache.size > 50_000) {
      this.matchCache.clear();
      this.blocksCache.clear();
      this.cacheSig = sig;
      this.cacheParsed = this.parsed;
    }
    const memo = this.matchCache;
    const dismissed = new Set(this.dismissed);
    const byKey = new Map<string, Suggestion>();
    // A 2AC file's blocks go only in the 2AC column, a 1AR file's only in the
    // 1AR column - so the 2AC file stops answering the block, and the 1AR file
    // never answers the 1NC.
    const colSpeech = (c: number) => speechOfCol(speeches, c);
    const speechOfFile = new Map<string, string | undefined>();
    const fileOk = (file: string, col: string) => {
      if (!speechOfFile.has(file)) speechOfFile.set(file, this.fileSpeech(file));
      const s = speechOfFile.get(file);
      return !s || s === col;
    };
    for (const sheet of round.sheets) {
      // Which file and section a sheet uses only changes with the kit (the
      // sig above) or the sheet's own title/kind - not with every edit.
      const bKey = `${sheet.id}\u0000${sheet.title}\u0000${sheet.kind}`;
      let all = this.blocksCache.get(bKey);
      if (!all) {
        all = this.blocksFor(sheet);
        this.blocksCache.set(bKey, all);
      }
      if (!all.length) continue;
      const sheetBlocks = all;
      const forCol = new Map<string, KitBlock[]>();
      const blocksInto = (col: string) => {
        let b = forCol.get(col);
        if (!b) {
          b = sheetBlocks.filter((x) => fileOk(x.file, col));
          forCol.set(col, b);
        }
        return b;
      };
      // Blocks already put on this page are not suggested again here. Re-read
      // every pass (cheap), so an insert - yours or a partner's - retires every
      // copy at once. (The page's 2AC list leaves out what's offered here.)
      const used = usedTitles(sheet);
      const taken = (m: BlockMatch) => used.has(normTitle(m.block.title));
      const pageWords = tokens(sheet.title);
      const onPage: Suggestion[] = [];
      sheet.rows.forEach((row, r) => {
        for (let c = Math.max(0, sheet.startCol); c < speeches.length; c++) {
          const sp = speeches[c];
          if (sp.side === side || sp.side === "neutral" || isOpening(sp)) continue;
          const cell = row.cells[c];
          if (!filled(cell) || !cell.text.trim()) continue;
          const to = targetCol(speeches, c, side, laneHere);
          if (to < 0) continue;
          const group = speeches[to].laneGroup;
          const answered = group
            ? speeches.some((s, i) => s.laneGroup === group && filled(row.cells[i]))
            : filled(row.cells[to]);
          if (answered) continue;
          const key = `${sheet.id}:${row.id}:${speeches[to].id}`;
          if (dismissed.has(key)) continue;
          // Title and kind decide the sheet's file and section, so they're
          // part of the key: renaming a sheet can change what it matches.
          const col = colSpeech(to);
          const memoKey = `${sheet.id}\u0000${sheet.title}\u0000${sheet.kind}\u0000${col}\u0000${cell.text}`;
          let raw = memo.get(memoKey);
          if (!raw) {
            const blocks = blocksInto(col);
            // A few spare past the 3 shown: some drop out below (inserted, or
            // better placed on another argument). One copy per title.
            const seenT = new Set<string>();
            // The page's own name is ignored: it's in every block title here.
            raw = (blocks.length ? matchBlocks(cell.text, blocks, 8, pageWords) : []).filter((m) => {
              const t = normTitle(m.block.title);
              if (seenT.has(t)) return false;
              seenT.add(t);
              return true;
            });
            memo.set(memoKey, raw);
          }
          // A new array - the memo's is shared across passes.
          const matches = raw.filter((m) => !taken(m));
          if (!matches.length) continue;
          // ⚠ ONE suggestion per reply cell. Both partners' lanes of the same
          // opponent speech answer into the same cell, so two arguments on one
          // row share a key - and a duplicate key in the tray's keyed list is
          // a FATAL Svelte error. Merge instead: both arguments shown, the best
          // blocks for either offered. The first lane stays the reply target.
          const same = byKey.get(key);
          if (same) {
            same.said = `${same.said} / ${cell.text}`;
            const seen = new Set(same.matches.map((m) => normTitle(m.block.title)));
            same.matches = [...same.matches, ...matches.filter((m) => !seen.has(normTitle(m.block.title)))].sort(
              (a, b) => b.score - a.score,
            );
            continue;
          }
          const s: Suggestion = {
            key,
            sheetId: sheet.id,
            sheetTitle: sheet.title,
            rowId: row.id,
            row: r,
            fromCol: c,
            toCol: to,
            said: cell.text,
            matches,
          };
          byKey.set(key, s);
          onPage.push(s);
        }
      });
      // Once per page: each block is offered under the ONE argument it
      // answers best. Greedy, best score first, and an argument only claims
      // what it will SHOW (3): claiming a 4th it then hid used to take that
      // block away from the argument it was the answer to.
      const pairs = onPage.flatMap((s) => s.matches.map((m) => ({ s, m })));
      pairs.sort((a, b) => b.m.score - a.m.score);
      const owned = new Set<string>();
      const kept = new Map<Suggestion, BlockMatch[]>();
      for (const { s, m } of pairs) {
        const t = normTitle(m.block.title);
        const mine = kept.get(s) ?? [];
        if (owned.has(t) || mine.length >= 3) continue;
        owned.add(t);
        mine.push(m);
        kept.set(s, mine);
      }
      for (const s of onPage) {
        s.matches = kept.get(s) ?? [];
        if (s.matches.length) out.push(s);
      }
    }
    return out;
  }

  // ---- which aff speech the tray is for -------------------------------------

  setSpeechMode(mode: SpeechMode): void {
    this.speechMode = mode;
    this.persist();
  }

  /**
   * The aff speech Smart blocks is helping with: picked by hand, or (auto) the
   * 2AC until the neg block has anything flowed on any page, then the 1AR.
   * Suggestions, the File/Overviews tabs and the starters all follow it.
   */
  answering(round: Round): "2AC" | "1AR" {
    if (this.speechMode !== "auto") return this.speechMode;
    const turns = turnsOf(round.template.speeches);
    // The aff's first answer ("the 2AC" - LD's 1AR, PF's rebuttal), then the
    // neg turn right after it: the block (LD's NR, PF's rebuttal).
    const first = turns.findIndex((t) => t.side === "aff" && t.index === 1);
    const block = first < 0 ? undefined : turns.slice(first + 1).find((t) => t.side === "neg");
    if (!block) return "2AC";
    const flowed = round.sheets.some((s) => s.rows.some((r) => block.cols.some((c) => filled(r.cells[c]))));
    return flowed ? "1AR" : "2AC";
  }

  /** What this format calls the "2AC" / "1AR" role, for the tray's labels:
   *  2AC / 1AR in policy, 1AR / 2AR in LD, "Pro Reb" / "Pro Sum" in PF. */
  speechName(round: Round | null | undefined, role: "2AC" | "1AR"): string {
    if (!round) return role;
    const sp = round.template.speeches;
    const t = sideTurn(sp, "aff", role === "2AC" ? 1 : 2);
    return (t && baseAbbr(sp[t.cols[0]])) || role;
  }

  /** The aff speech a column is (2AC / 1AR), for the tray's filter. */
  speechOfCol(round: Round, col: number): string {
    return speechOfCol(round.template.speeches, col);
  }

  /** The suggestions minus any block a page's 2AC list already shows (the
   *  list marks and places those itself). A suggestion left empty goes. */
  withoutListed(suggestions: Suggestion[], starters: Starter[]): Suggestion[] {
    const listed = new Set<string>();
    for (const st of starters) for (const b of st.blocks) listed.add(`${st.sheetId}\u0000${normTitle(b.title)}`);
    if (!listed.size) return suggestions;
    const out: Suggestion[] = [];
    for (const s of suggestions) {
      const matches = s.matches.filter((m) => !listed.has(`${s.sheetId}\u0000${normTitle(m.block.title)}`));
      if (matches.length) out.push(matches.length === s.matches.length ? s : { ...s, matches });
    }
    return out;
  }

  /** "Sheet \0 title" → the argument a block answers (from the suggestions),
   *  so a page's 2AC list can mark it and put it in that argument's row. */
  claimedBy(suggestions: Suggestion[]): Map<string, Claim> {
    const out = new Map<string, Claim>();
    // Only each argument's BEST block is marked as its answer - its 2nd and
    // 3rd guesses are just related, and marking them was noise.
    for (const s of suggestions) {
      const m = s.matches[0];
      if (!m) continue;
      const k = `${s.sheetId}\u0000${normTitle(m.block.title)}`;
      if (!out.has(k)) out.set(k, { s, m });
    }
    return out;
  }

  /**
   * Put the whole block into the reply cell - the same cell shape Doc Search
   * builds (header, chip, full node, one item per card, collapsed) - and link
   * it as the reply to the argument it answers, so the doc's "AT:" is right.
   *
   * Refuses a cell that filled up since the suggestion was drawn: a partner
   * may have answered it a moment ago, and their answer wins.
   */
  async insert(s: Suggestion, m: BlockMatch, rank: number): Promise<boolean> {
    const locate = (round: Round) => {
      const sheet = round.sheets.find((x) => x.id === s.sheetId);
      return sheet?.rows.find((x) => x.id === s.rowId)?.cells[s.toCol];
    };
    const from = store.round?.template.speeches[s.fromCol];
    // Checked BEFORE mutate: mutate pushes an undo step first, and a refused
    // insert must not leave an empty one behind.
    if (!store.round || !from || filled(locate(store.round)) || !locate(store.round)) return false;
    const exact = await this.exactFor(m.block.file, m.block.node).catch(() => null);
    // ...and again after the wait: a partner may have answered it meanwhile.
    if (!store.round || filled(locate(store.round)) || !locate(store.round)) return false;
    let done = false;
    store.mutate((round) => {
      const cell = locate(round);
      if (!cell || filled(cell)) return;
      fillCell(cell, m.block.node, exact);
      cell.repliesTo = from.id;
      done = true;
    });
    if (!done) return false;
    void this.log({ t: Date.now(), ev: "insert", said: s.said, block: m.block.title, rank, sheet: s.sheetTitle });
    // Step down a row under the answer, like every other block insert (Ctrl+K,
    // the tray's File tab). Only on the sheet you're on - a suggestion from
    // another sheet must not pull you off yours. The row is found by ID, not
    // `s.row`: rows may have moved since the suggestion was drawn.
    if (store.activeSheetId === s.sheetId) {
      const r = store.round?.sheets.find((x) => x.id === s.sheetId)?.rows.findIndex((x) => x.id === s.rowId) ?? -1;
      if (r >= 0) store.cursor = { row: r + 1, col: s.toCol };
    }
    return true;
  }

  // ---- a page's 2AC blocks ("2AC off-case") ----------------------------------
  //
  // When you're aff, each named off-case page ("Midterms DA") finds its hat(s)
  // in your 2AC file by name, and lists EVERY block under them, in file order,
  // for a click each - the one complete, predictable place for that position.
  // A block already on the page is gone from the list. One that answers a
  // flowed 1NC argument STAYS in its place, marked with that argument, and
  // goes into that argument's row (the tray shows no separate per-argument
  // cards for a page that has a list - each block once, never missing). The
  // list lasts until it's used up or you × it.

  starters(round: Round, laneHere: number, enabled: boolean, answering?: Map<string, Claim>): Starter[] {
    if (!enabled || this.mySide(round) !== "aff") return [];
    const to = firstAnswerCol(round.template.speeches, laneHere);
    if (to < 0) return [];
    const out: Starter[] = [];
    for (const sheet of round.sheets) {
      if (sheet.kind === "case" || sheet.kind === "cx" || sheet.kind === "overview") continue;
      if (to < sheet.startCol) continue;
      const key = `starter:${sheet.id}`;
      if (this.dismissed.includes(key)) continue;
      // ONLY from a 2AC file, and found on its own - never through the page's
      // linked file, which can be any file named like the page (a reported
      // bug: the neg's "Midterms Uniqueness" file supplied a "starter").
      for (const f of this.all) {
        if (!this.isTwoAC(f.key) || this.wrongSide(f.key)) continue;
        const p = this.parsed[f.key];
        if (!p) continue;
        const cand = [{ key: f.key, name: f.name, firstHeading: p.firstHeading }];
        const whole = !!guessFileForSheet(sheet.title, cand);
        // Every hat that ties for the page - an updated hat and the old one.
        // The file's CASE sections only as a fallback: an off-case "Economy"
        // page must not list the case Economy blocks (Adam's real 2AC file
        // has a CASE › Economy hat AND a DA---Economy hat).
        const secs = whole ? [] : guessSections(sheet.title, p.roots, this.caseSectionsOf(f.key));
        if (!whole && !secs.length) continue;
        const used = usedTitles(sheet);
        const seen = new Set<string>();
        const blocks: StarterBlock[] = [];
        for (const b of p.blocks) {
          if (secs.length && !secs.some((s) => b.node === s || b.anc.includes(s))) continue;
          // One copy per title - the first in the file (the updated hat, when
          // it comes first) - and none that are already on the page.
          const t = normTitle(b.title);
          if (seen.has(t) || used.has(t)) continue;
          seen.add(t);
          const answers = answering?.get(`${sheet.id}\u0000${t}`);
          blocks.push({ id: b.id, title: b.title, node: b.node, cardCount: b.cardCount, ...(answers ? { answers } : {}) });
        }
        if (!blocks.length) break; // this position's 2AC is all in
        out.push({
          key,
          sheetId: sheet.id,
          sheetTitle: sheet.title,
          toCol: to,
          blocks,
          fileName: f.name.replace(/\.(docx|cmir)$/i, ""),
          file: f.key,
        });
        break;
      }
    }
    return out;
  }

  /**
   * "Your 2AC": every off-case page (the same pages the 2AC lists cover) with
   * how many cells of your 2AC are on it - what the tray's Send buttons send.
   * Read from the flow itself, so it is never out of step with it or with
   * your partner. Not affected by ×-ing a page's block list.
   */
  twoACPages(round: Round, laneHere: number): { sheetId: string; title: string; toCol: number; count: number }[] {
    if (this.mySide(round) !== "aff") return [];
    const to = firstAnswerCol(round.template.speeches, laneHere);
    if (to < 0) return [];
    const pages = round.sheets
      .filter((s) => s.kind !== "case" && s.kind !== "cx" && s.kind !== "overview" && to >= s.startCol)
      .map((s) => ({
        sheetId: s.id,
        title: s.title,
        toCol: to,
        count: s.rows.reduce((n, r) => n + (filled(r.cells[to]) ? 1 : 0), 0),
      }));
    // T first by default (Adam), then tab order. Once you reorder, yours
    // sticks; a page added later goes on top if it's T, else at the bottom.
    const isT = (t: string) => T_PAGE_RE.test(t);
    const byDefault = [...pages.filter((p) => isT(p.title)), ...pages.filter((p) => !isT(p.title))];
    if (!this.twoACOrder.length) return byDefault;
    const at = new Map(this.twoACOrder.map((id, i) => [id, i]));
    const known = byDefault.filter((p) => at.has(p.sheetId)).sort((a, b) => at.get(a.sheetId)! - at.get(b.sheetId)!);
    const fresh = byDefault.filter((p) => !at.has(p.sheetId));
    return [...fresh.filter((p) => isT(p.title)), ...known, ...fresh.filter((p) => !isT(p.title))];
  }

  /** Drag a page to position `to` in "Your 2AC". Saved per round. */
  moveTwoACPage(round: Round, laneHere: number, sheetId: string, to: number): void {
    const ids = this.twoACPages(round, laneHere).map((p) => p.sheetId);
    const from = ids.indexOf(sheetId);
    if (from < 0) return;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, sheetId);
    this.twoACOrder = ids;
    this.persist();
  }

  /**
   * Put one block from a page's 2AC list in: under the last thing in your 2AC
   * column on that page (so a run of clicks stacks down), or beside the 1NC's
   * first argument when the column is empty. Refused if the block landed on
   * the page meanwhile. One undo step; the cursor steps down under it.
   */
  async insertStarterBlock(st: Starter, b: StarterBlock): Promise<boolean> {
    const exact = await this.exactFor(st.file, b.node).catch(() => null);
    const round = store.round;
    const sheet = round?.sheets.find((s) => s.id === st.sheetId);
    if (!round || !sheet) return false;
    if (usedTitles(sheet).has(normTitle(b.title))) return false;
    // The speech your 2AC answers (the 1NC, both lanes - LD's NC, PF's case).
    const turns = turnsOf(round.template.speeches);
    const at = turns.findIndex((t) => t.cols.includes(st.toCol));
    const theirs = at > 0 ? turns[at - 1].cols : [];
    let last = -1;
    sheet.rows.forEach((r, i) => {
      if (filled(r.cells[st.toCol])) last = i;
    });
    let row = last >= 0 ? last + 1 : sheet.rows.findIndex((r, i) => i > 0 && theirs.some((c) => filled(r.cells[c])));
    if (row < 1) row = 1;
    // Never into a row whose argument has its own marked answer waiting in
    // this list - that answer goes there.
    const waiting = new Set(st.blocks.filter((x) => x !== b && x.answers).map((x) => x.answers!.s.rowId));
    while (row < sheet.rows.length && (filled(sheet.rows[row].cells[st.toCol]) || waiting.has(sheet.rows[row].id))) row++;
    let done = false;
    store.mutate((r) => {
      const s = r.sheets.find((x) => x.id === st.sheetId);
      if (!s) return;
      store.ensureRows(row, s);
      const cell = s.rows[row]?.cells[st.toCol];
      if (!cell || filled(cell)) return;
      fillCell(cell, b.node, exact);
      done = true;
    });
    if (!done) return false;
    if (store.activeSheetId === st.sheetId) store.cursor = { row: row + 1, col: st.toCol };
    void this.log({ t: Date.now(), ev: "insert", said: "(2AC list)", block: b.title, rank: 0, sheet: st.sheetTitle });
    return true;
  }

  dismissStarter(st: Starter): void {
    this.dismissed = [...this.dismissed, st.key];
  }

  dismiss(s: Suggestion): void {
    this.dismissed = [...this.dismissed, s.key];
    void this.log({ t: Date.now(), ev: "dismiss", said: s.said, sheet: s.sheetTitle });
  }

  /**
   * What was taken and what was waved away, kept on this machine only. This is
   * the evidence for what the plain matcher gets wrong - the input to deciding
   * whether AI is worth it, and where.
   */
  private async log(e: LogEntry): Promise<void> {
    const log = (await loadBlob<LogEntry[]>(LOG_BLOB)) ?? [];
    log.push(e);
    await saveBlob(LOG_BLOB, log.slice(-LOG_MAX));
  }
}

/**
 * Fill a flow cell with a block - the same shape Doc Search builds: header,
 * chip, the full node, one item per card, collapsed.
 *
 * ⚠ Works on a COPY: the kit's tree is shared by every suggestion and tab and
 * must never be aliased into the round, where edits and sync would reach it.
 */
function fillCell(cell: Cell, source: DocNode, exact?: Exact | null): void {
  const node = structuredClone(source) as DocNode;
  const cards = cardsUnder(node);
  cell.text = node.text;
  cell.chip = nodeChip(node);
  cell.card = node;
  // The exact CardMirror node, when we have it, is what Send to Doc / tilde
  // uses - so tables and images survive. Without it, the DocNode adapter.
  if (exact?.cell && !cards.length) cell.cmNode = structuredClone(exact.cell);
  else delete cell.cmNode;
  if (cards.length) {
    cell.items = cards.map((c) => {
      const cm = exact?.items.get(c.text.trim());
      return {
        id: crypto.randomUUID(),
        text: c.text,
        kind: "card" as const,
        chip: nodeChip(c),
        card: c,
        ...(cm ? { cmNode: structuredClone(cm) } : {}),
      };
    });
    cell.expanded = false;
  } else {
    delete cell.items;
    delete cell.expanded;
  }
}

/** Blob names allow only [A-Za-z0-9_-]; a hash keeps distinct names distinct. */
function copyBlobName(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `smartcopy-${h.toString(36)}`;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export const smartKit = new SmartKit();
