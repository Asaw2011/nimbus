// Smart blocks — the round kit and the suggestions it produces (LAB).
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

import { parseDocx, nodeChip, type DocNode } from "$lib/docx/parse";
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
}

interface Parsed {
  /** The whole heading tree — what the File tab shows, Ctrl+K style. */
  roots: DocNode[];
  blocks: KitBlock[];
  firstHeading: string;
  error?: string;
}

/** One entry on the Overviews tab: a section and the block that overviews it. */
export interface Overview {
  /** The section the Main sits in — "Uniqueness", "Link", "Impact". */
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
  /** sheet : row id : target speech id — stable across edits and reorders. */
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

const LOG_BLOB = "smart-log";
const LOG_MAX = 2000;

const filled = (c: Cell | undefined) => !!c && (!!c.text.trim() || !!c.items?.length);

/**
 * The column a reply to `from` goes in: the next speech on OUR side. Landing on
 * a split speech means our own lane — `laneHere`, which is a fact about this
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
   * The library: files in EVERY round's kit — the handful of common files you
   * always want (T, theory, framework, your case neg). Saved once, not per
   * round; pinning or unpinning moves a file between here and `files`.
   */
  library = $state<KitFile[]>([]);
  private libraryLoaded = false;
  links = $state<Record<string, string>>({});
  side = $state<Side | undefined>(undefined);
  /** Parsed trees are large and never edited — raw, so they aren't proxied. */
  parsed = $state.raw<Record<string, Parsed>>({});
  loading = $state(0);
  /** Suggestions waved away this session. Not saved — a restart offers them again. */
  dismissed = $state<string[]>([]);

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

  /** Stop keeping a file in every round — it stays in THIS round's kit. */
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
      const { nodes } = parseDocx(buf);
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
   * kit — on a Dropbox placeholder that read is a download, which is fine for
   * a file you chose and would not be for a library scan.
   */
  private async parseFromDisk(f: KitFile): Promise<void> {
    if (f.key.startsWith("mem:")) {
      this.fail(f.key, "Not saved on disk — add it again");
      return;
    }
    this.loading++;
    try {
      if (f.key.startsWith("copy:")) {
        const b64 = await loadBlob<string>(copyBlobName(f.key));
        if (!b64) throw new Error("The saved copy is gone — drop the file again");
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
   * window's native drop, which would, is off — it breaks dragging blocks onto
   * the grid). So the path is recovered from the Doc Search library index by
   * name + exact size, which keeps the kit pointing at the REAL file and picks
   * up later edits to it. A file the index doesn't hold, or holds ambiguously,
   * is kept as a saved copy instead, and the kit says so.
   */
  async addDropped(dropped: File[]): Promise<void> {
    for (const file of dropped) {
      if (!/\.docx$/i.test(file.name) || file.name.startsWith("~$")) continue;
      const stem = file.name.replace(/\.docx$/i, "").toLowerCase();
      const hits = fileIndex.files.filter(
        (f) => f.ext === "docx" && f.name.toLowerCase() === stem && f.size === file.size,
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
    for (const k of this.twoACsFor(sheet)) {
      const kase = this.scopeFor(sheet, k);
      for (const adv of kase?.children ?? []) {
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
    const roots = file ? (file.scope ? [file.scope] : file.roots) : undefined;
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
   * Put a block into the cell under the cursor — exactly what Ctrl+K does with
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
   * be called ("Adv 1", "Warming") — so it is recognised by its NAME or top
   * heading ("Case Neg", "caseneg", "Case Negs"), not by matching sheet titles.
   *
   * ⚠ Not by folder. `Casenegs\Native Climate\` also holds a China Soft Power
   * DA, and a folder rule would pin that DA to every case sheet.
   */
  isCaseNeg(key: string): boolean {
    return this.named(key, /case[\s_-]*negs?(?![a-z])/i);
  }

  /** A 2AC file ("2ACs_Single Payer"): the aff's answers, case AND off-case. */
  isTwoAC(key: string): boolean {
    return !this.isCaseNeg(key) && this.named(key, /(^|[^a-z0-9])2acs?(?![a-z])/i);
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
   *  of them, unless the sheet was explicitly set to "No file". */
  caseNegsFor(sheet: Sheet): string[] {
    if (sheet.kind !== "case" || this.links[sheet.id] === "") return [];
    return this.all.filter((f) => !f.general && this.isCaseNeg(f.key)).map((f) => f.key);
  }

  /** 2AC files on an aff sheet, when WE are aff — their CASE section answers it,
   *  whatever the advantage sheets are called. */
  twoACsFor(sheet: Sheet): string[] {
    if (sheet.kind !== "case" || this.links[sheet.id] === "" || this.currentSide() !== "aff") return [];
    return this.all.filter((f) => !f.general && this.isTwoAC(f.key)).map((f) => f.key);
  }

  /** Every file that applies to an aff sheet automatically. */
  private caseFilesFor(sheet: Sheet): string[] {
    return [...this.caseNegsFor(sheet), ...this.twoACsFor(sheet)];
  }

  /**
   * The automatic guess for a sheet, ignoring any explicit choice: a file NAMED
   * for the position first, else a multi-position file with a SECTION for it
   * (an aff master file's `CP---Public Option`). Case negs never auto-link —
   * they have their own rule.
   */
  autoLink(sheet: Sheet): string | null {
    const pool = this.all.filter((f) => !f.general && !this.isCaseNeg(f.key) && this.parsed[f.key]?.blocks.length);
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
    if (sheet.kind === "case" && this.twoACsFor(sheet).includes(key)) {
      return p.roots.find((n) => n.text.trim().toLowerCase() === "case") ?? null;
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
    for (const k of this.caseFilesFor(sheet)) keys.add(k);
    const general = new Set(this.all.filter((f) => f.general).map((f) => f.key));
    for (const k of general) keys.add(k);
    const out: KitBlock[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      const scope = general.has(k) ? null : this.scopeFor(sheet, k);
      for (const b of this.parsed[k]?.blocks ?? []) {
        if (seen.has(b.id)) continue;
        if (scope && b.node !== scope && !b.anc.includes(scope)) continue;
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
   * An opponent cell gets suggestions when the cell a reply would go in — our
   * next speech on that row — is still empty. Filling that cell (by accepting,
   * by typing, or by a PARTNER accepting on their machine and it syncing over)
   * is what retires it, so two partners cannot both insert the same answer
   * unless they click within the same sync tick.
   */
  suggestions(round: Round, laneHere: number): Suggestion[] {
    const side = this.mySide(round);
    if (!side || !this.all.length) return [];
    const speeches = round.template.speeches;
    const out: Suggestion[] = [];
    const memo = new Map<string, BlockMatch[]>();
    for (const sheet of round.sheets) {
      const blocks = this.blocksFor(sheet);
      if (!blocks.length) continue;
      sheet.rows.forEach((row, r) => {
        for (let c = Math.max(0, sheet.startCol); c < speeches.length; c++) {
          const sp = speeches[c];
          if (sp.side === side || sp.side === "neutral") continue;
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
          if (this.dismissed.includes(key)) continue;
          const memoKey = `${sheet.id}\u0000${cell.text}`;
          let matches = memo.get(memoKey);
          if (!matches) {
            matches = matchBlocks(cell.text, blocks);
            memo.set(memoKey, matches);
          }
          if (!matches.length) continue;
          out.push({
            key,
            sheetId: sheet.id,
            sheetTitle: sheet.title,
            rowId: row.id,
            row: r,
            fromCol: c,
            toCol: to,
            said: cell.text,
            matches,
          });
        }
      });
    }
    return out;
  }

  /**
   * Put the whole block into the reply cell — the same cell shape Doc Search
   * builds (header, chip, full node, one item per card, collapsed) — and link
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
    if (done) void this.log({ t: Date.now(), ev: "insert", said: s.said, block: m.block.title, rank, sheet: s.sheetTitle });
    return done;
  }

  dismiss(s: Suggestion): void {
    this.dismissed = [...this.dismissed, s.key];
    void this.log({ t: Date.now(), ev: "dismiss", said: s.said, sheet: s.sheetTitle });
  }

  /**
   * What was taken and what was waved away, kept on this machine only. This is
   * the evidence for what the plain matcher gets wrong — the input to deciding
   * whether AI is worth it, and where.
   */
  private async log(e: LogEntry): Promise<void> {
    const log = (await loadBlob<LogEntry[]>(LOG_BLOB)) ?? [];
    log.push(e);
    await saveBlob(LOG_BLOB, log.slice(-LOG_MAX));
  }
}

/**
 * Fill a flow cell with a block — the same shape Doc Search builds: header,
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
