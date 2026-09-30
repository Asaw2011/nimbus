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
import { parseSpeechDoc } from "$lib/docx/cmir";
import { loadBlob, saveBlob } from "$lib/model/blobs";
import { store } from "$lib/model/round.svelte";
import { fileIndex } from "$lib/search/file-index.svelte";
import type { Cell, Round, Sheet, Side, Speech } from "$lib/model/types";
import {
  cardsUnder,
  guessFileForSheet,
  guessSection,
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
}

/** `advSections` entry meaning "the whole file". */
export const ALL_SECTIONS = "*";
/** `advSections` entry meaning "nothing": everything unticked on purpose (an
 *  empty list would read as Auto and tick the Case section again). */
export const NO_SECTIONS = "-";
/** Joins a pocket and a hat in an `advSections` path. */
export const SECTION_SEP = " › ";

/** One "2AC starter": the prepared 2AC block for a whole off-case position. */
export interface Starter {
  key: string;
  sheetId: string;
  sheetTitle: string;
  /** The row it goes in - by id when the row exists, so a moved row is followed. */
  rowId: string | null;
  row: number;
  toCol: number;
  node: DocNode;
  cardCount: number;
  fileName: string;
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
}

interface SavedKit {
  files: KitFile[];
  /** sheet id → file key. "" is an explicit "no file"; absent means auto. */
  links: Record<string, string>;
  /** Only consulted when the round itself has no `mySide`. */
  side?: Side;
}

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

/** A 2AC file's own section for the case: "Case", "Case---2AC", "CASE Answers". */
const CASE_SECTION_RE = /(^|[^a-z])case([^a-z]|$)/i;
/** The heading of a position's prepared 2AC: "2AC", "Midterms---2AC", "Frontline". */
const STARTER_RE = /(^|[^a-z0-9])(2acs?|front\s*lines?)(?![a-z])/i;

const LOG_BLOB = "smart-log";
const LOG_MAX = 2000;

const filled = (c: Cell | undefined) => !!c && (!!c.text.trim() || !!c.items?.length);

/** `n` is somewhere under `root`. */
function contains(root: DocNode, n: DocNode): boolean {
  return root.children.some((c) => c === n || contains(c, n));
}

const isCardNode = (n: DocNode) => !!n.isAnalytic || n.level >= 4;

/**
 * The prepared 2AC for a position, inside its section: the DEEPEST heading
 * named for it ("Midterms---2AC" under "2AC", or "Frontline"), else the first
 * block that holds cards (not a 1AC/1NC shell).
 */
function pickStarter(roots: DocNode[]): DocNode | null {
  const named = (ns: DocNode[]): DocNode | null => {
    for (const n of ns) {
      if (isCardNode(n)) continue;
      const inner = named(n.children);
      if (inner) return inner;
      if (STARTER_RE.test(n.text) && cardsUnder(n).length) return n;
    }
    return null;
  };
  const first = (ns: DocNode[]): DocNode | null => {
    for (const n of ns) {
      if (isCardNode(n)) continue;
      if (n.children.some(isCardNode) && !/(^|[^a-z0-9])(1nc|1ac)([^a-z0-9]|$)/i.test(n.text)) return n;
      const inner = first(n.children);
      if (inner) return inner;
    }
    return null;
  };
  return named(roots) ?? first(roots);
}

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
    this.dismissed = [];
    const saved = await loadBlob<SavedKit>(`smartkit-${roundId}`);
    if (this.roundId !== roundId) return; // switched again while loading
    this.files = saved?.files ?? [];
    this.links = saved?.links ?? {};
    this.side = saved?.side;
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
      const bytes = await invoke<number[]>("read_binary_file", { path: f.key });
      this.ingest(f.key, new Uint8Array(bytes).buffer);
    } catch (e) {
      this.fail(f.key, e);
    } finally {
      this.loading--;
    }
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
    for (const k of this.twoACsFor(sheet).filter((x) => this.isTwoAC(x))) {
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
    const key = this.linkFor(sheet) ?? this.caseFilesFor(sheet)[0] ?? null;
    const f = this.all.find((x) => x.key === key);
    const p = key ? this.parsed[key] : undefined;
    return f && p ? { key: f.key, name: f.name, roots: p.roots, scope: this.scopeFor(sheet, f.key) } : null;
  }

  /**
   * Put a block into the cell under the cursor - exactly what Ctrl+K does with
   * a click in a file (replaces the cell, then steps down a row so the next
   * one stacks under it). One undo step.
   */
  insertAtCursor(node: DocNode): boolean {
    const cur = store.cursor;
    const sheetId = store.activeSheetId;
    if (!store.round || !cur || !sheetId) return false;
    const { row, col } = cur;
    store.mutate((r) => {
      const sheet = r.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      store.ensureRows(row, sheet);
      const cell = sheet.rows[row]?.cells[col];
      if (!cell) return;
      fillCell(cell, node);
    });
    store.cursor = { row: row + 1, col };
    return true;
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
    return this.named(key, TWO_AC_RE) || (this.named(key, AFF_RE) && !this.namesPosition(key));
  }

  /**
   * Which side a file is FOR, by its name: 2AC / AFF files are the aff's,
   * case neg / NEG files the neg's. undefined = either (a DA file, a T file).
   */
  fileSide(key: string): Side | undefined {
    if (this.named(key, CASE_NEG_RE) || this.named(key, NEG_RE)) return "neg";
    if (this.named(key, TWO_AC_RE) || this.named(key, AFF_RE) || this.named(key, ONE_AR_RE)) return "aff";
    return undefined;
  }

  /** A 1AR file: like a 2AC file (its case sections answer the advantage
   *  pages, each off-case page gets its section by name) but for the 1AR -
   *  answers to the neg BLOCK, so only ever suggested into the 1AR column. */
  isOneAR(key: string): boolean {
    return this.fileSide(key) !== "neg" && this.named(key, ONE_AR_RE) && !this.isTwoAC(key);
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
    const two = TWO_AC_RE.test(f.name);
    const one = ONE_AR_RE.test(f.name);
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
    return guessSection(sheet.title, p.roots);
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
    // never answers the 1NC. By the column's base abbr ("2AC · You" → 2AC).
    // A renamed speech ("2AC" → "2A") is still known by its label.
    const colSpeech = (c: number) => {
      const abbr = speeches[c].abbr.split(" · ")[0].trim().toUpperCase();
      if (abbr === "2AC" || abbr === "1AR") return abbr;
      const label = speeches[c].label.toLowerCase();
      if (/second affirmative constructive/.test(label)) return "2AC";
      if (/first affirmative rebuttal/.test(label)) return "1AR";
      return abbr;
    };
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
          let matches = memo.get(memoKey);
          if (!matches) {
            const blocks = blocksInto(col);
            matches = blocks.length ? matchBlocks(cell.text, blocks) : [];
            memo.set(memoKey, matches);
          }
          if (!matches.length) continue;
          // ⚠ ONE suggestion per reply cell. Both partners' lanes of the same
          // opponent speech answer into the same cell, so two arguments on one
          // row share a key - and a duplicate key in the tray's keyed list is
          // a FATAL Svelte error. Merge instead: both arguments shown, the best
          // blocks for either offered. The first lane stays the reply target.
          const same = byKey.get(key);
          if (same) {
            same.said = `${same.said} / ${cell.text}`;
            const seen = new Set(same.matches.map((m) => m.block.id));
            same.matches = [...same.matches, ...matches.filter((m) => !seen.has(m.block.id))]
              .sort((a, b) => b.score - a.score)
              .slice(0, 3);
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
          out.push(s);
        }
      });
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
  insert(s: Suggestion, m: BlockMatch, rank: number): boolean {
    const locate = (round: Round) => {
      const sheet = round.sheets.find((x) => x.id === s.sheetId);
      return sheet?.rows.find((x) => x.id === s.rowId)?.cells[s.toCol];
    };
    const from = store.round?.template.speeches[s.fromCol];
    // Checked BEFORE mutate: mutate pushes an undo step first, and a refused
    // insert must not leave an empty one behind.
    if (!store.round || !from || filled(locate(store.round)) || !locate(store.round)) return false;
    let done = false;
    store.mutate((round) => {
      const cell = locate(round);
      if (!cell || filled(cell)) return;
      fillCell(cell, m.block.node);
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

  // ---- 2AC starters ---------------------------------------------------------
  //
  // When you're aff, each named off-case page ("Midterms DA") already finds its
  // section of your 2AC file by name. A starter offers that section's prepared
  // 2AC block for the whole position, before the 1NC's arguments are flowed.
  // Offered while your 2AC column on that page is still empty - writing in it
  // (by inserting, typing, or a partner syncing over) is what retires it.

  starters(round: Round, laneHere: number, enabled: boolean): Starter[] {
    if (!enabled || this.mySide(round) !== "aff") return [];
    const speeches = round.template.speeches;
    const negFirst = speeches.findIndex((s) => s.side === "neg");
    if (negFirst < 0) return [];
    const to = targetCol(speeches, negFirst, "aff", laneHere);
    if (to < 0) return [];
    const colsOf = (c: number) => {
      const g = speeches[c].laneGroup;
      return g ? speeches.flatMap((s, i) => (s.laneGroup === g ? [i] : [])) : [c];
    };
    const mine = colsOf(to);
    const theirs = colsOf(negFirst);
    const out: Starter[] = [];
    for (const sheet of round.sheets) {
      if (sheet.kind === "case" || sheet.kind === "cx" || sheet.kind === "overview") continue;
      if (to < sheet.startCol) continue;
      const key = `starter:${sheet.id}`;
      if (this.dismissed.includes(key)) continue;
      // Your 2AC on this page has begun (either lane): nothing to offer.
      if (sheet.rows.some((r) => mine.some((c) => filled(r.cells[c])))) continue;
      // ONLY from a 2AC file, and found on its own - never through the page's
      // linked file, which can be any file named like the page (a reported
      // bug: the neg's "Midterms Uniqueness" file supplied a "starter").
      let file: string | null = null;
      let node: DocNode | null = null;
      for (const f of this.all) {
        if (!this.isTwoAC(f.key) || this.wrongSide(f.key)) continue;
        const p = this.parsed[f.key];
        if (!p) continue;
        const cand = [{ key: f.key, name: f.name, firstHeading: p.firstHeading }];
        const sec = guessFileForSheet(sheet.title, cand) ? null : guessSection(sheet.title, p.roots);
        if (!sec && !guessFileForSheet(sheet.title, cand)) continue;
        node = pickStarter(sec ? [sec] : p.roots);
        if (node) {
          file = f.key;
          break;
        }
      }
      if (!file || !node) continue;
      // Beside the 1NC's first argument on the page (row 0 is the label row).
      let row = sheet.rows.findIndex((r, i) => i > 0 && theirs.some((c) => filled(r.cells[c])));
      if (row < 1) row = 1;
      out.push({
        key,
        sheetId: sheet.id,
        sheetTitle: sheet.title,
        rowId: sheet.rows[row]?.id ?? null,
        row,
        toCol: to,
        node,
        cardCount: cardsUnder(node).length,
        fileName: this.all.find((f) => f.key === file)?.name.replace(/\.(docx|cmir)$/i, "") ?? "",
      });
    }
    return out;
  }

  /** Put a starter in. Refuses a cell that filled since (checked BEFORE mutate,
   *  so a refusal leaves no empty undo step), and steps the cursor down. */
  insertStarter(st: Starter): boolean {
    const round = store.round;
    const sheet = round?.sheets.find((s) => s.id === st.sheetId);
    if (!round || !sheet) return false;
    const byId = st.rowId ? sheet.rows.findIndex((r) => r.id === st.rowId) : -1;
    const row = byId >= 0 ? byId : st.row;
    if (filled(sheet.rows[row]?.cells[st.toCol])) return false;
    store.mutate((r) => {
      const s = r.sheets.find((x) => x.id === st.sheetId);
      if (!s) return;
      store.ensureRows(row, s);
      const cell = s.rows[row]?.cells[st.toCol];
      if (cell && !filled(cell)) fillCell(cell, st.node);
    });
    if (store.activeSheetId === st.sheetId) store.cursor = { row: row + 1, col: st.toCol };
    void this.log({ t: Date.now(), ev: "insert", said: "(2AC starter)", block: st.node.text, rank: 0, sheet: st.sheetTitle });
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
function fillCell(cell: Cell, source: DocNode): void {
  const node = structuredClone(source) as DocNode;
  const cards = cardsUnder(node);
  cell.text = node.text;
  cell.chip = nodeChip(node);
  cell.card = node;
  delete cell.cmNode;
  if (cards.length) {
    cell.items = cards.map((c) => ({
      id: crypto.randomUUID(),
      text: c.text,
      kind: "card" as const,
      chip: nodeChip(c),
      card: c,
    }));
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
