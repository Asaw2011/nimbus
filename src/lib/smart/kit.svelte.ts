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
import type { Cell, Round, Sheet, Side, Speech } from "$lib/model/types";
import {
  cardsUnder,
  guessFileForSheet,
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
  blocks: KitBlock[];
  firstHeading: string;
  error?: string;
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

class SmartKit {
  roundId = $state<string | null>(null);
  files = $state<KitFile[]>([]);
  links = $state<Record<string, string>>({});
  side = $state<Side | undefined>(undefined);
  /** Parsed trees are large and never edited — raw, so they aren't proxied. */
  parsed = $state.raw<Record<string, Parsed>>({});
  loading = $state(0);
  /** Suggestions waved away this session. Not saved — a restart offers them again. */
  dismissed = $state<string[]>([]);

  /** Load (or switch to) the kit for a round. Cheap when it's already loaded. */
  async attach(roundId: string | undefined): Promise<void> {
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
        blocks: indexBlocks(key, nodes),
        firstHeading: nodes[0]?.text ?? "",
      });
    } catch (e) {
      this.setParsed(key, { blocks: [], firstHeading: "", error: String(e instanceof Error ? e.message : e) });
    }
  }

  /**
   * Read a kit file. ⚠ Only ever called for a file the user picked for this
   * kit — on a Dropbox placeholder that read is a download, which is fine for
   * a file you chose and would not be for a library scan.
   */
  private async parseFromDisk(f: KitFile): Promise<void> {
    if (f.key.startsWith("mem:")) {
      this.setParsed(f.key, { blocks: [], firstHeading: "", error: "Not saved on disk — add it again" });
      return;
    }
    this.loading++;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const bytes = await invoke<number[]>("read_binary_file", { path: f.key });
      this.ingest(f.key, new Uint8Array(bytes).buffer);
    } catch (e) {
      this.setParsed(f.key, { blocks: [], firstHeading: "", error: String(e instanceof Error ? e.message : e) });
    } finally {
      this.loading--;
    }
  }

  /** Add files by path (the Tauri file picker). */
  async addPaths(paths: string[]): Promise<void> {
    for (const path of paths) {
      if (this.files.some((f) => f.key === path)) continue;
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
    if (!this.files.some((f) => f.key === key)) this.files = [...this.files, { key, name }];
    this.ingest(key, buf);
    this.persist();
  }

  remove(key: string): void {
    this.files = this.files.filter((f) => f.key !== key);
    const links = { ...this.links };
    for (const [sheet, k] of Object.entries(links)) if (k === key) delete links[sheet];
    this.links = links;
    this.persist();
  }

  setGeneral(key: string, general: boolean): void {
    this.files = this.files.map((f) => (f.key === key ? { ...f, general: general || undefined } : f));
    this.persist();
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

  /** The automatic guess for a sheet, ignoring any explicit choice. */
  autoLink(sheet: Sheet): string | null {
    const candidates = this.files
      .filter((f) => !f.general && this.parsed[f.key]?.blocks.length)
      .map((f) => ({ key: f.key, name: f.name, firstHeading: this.parsed[f.key].firstHeading }));
    return guessFileForSheet(sheet.title, candidates);
  }

  /** The file a sheet draws from: an explicit choice, else the guess. */
  linkFor(sheet: Sheet): string | null {
    if (sheet.id in this.links) return this.links[sheet.id] || null;
    return this.autoLink(sheet);
  }

  /** Every block a sheet may suggest: its own file's, then the general files'. */
  blocksFor(sheet: Sheet): KitBlock[] {
    const out: KitBlock[] = [];
    const own = this.linkFor(sheet);
    if (own) out.push(...(this.parsed[own]?.blocks ?? []));
    for (const f of this.files) if (f.general) out.push(...(this.parsed[f.key]?.blocks ?? []));
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
    if (!side || !this.files.length) return [];
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
      // A copy: the kit's tree is shared by every suggestion and must never be
      // aliased into the round, where edits and sync would reach it.
      const node = structuredClone(m.block.node) as DocNode;
      const cards = cardsUnder(node);
      cell.text = node.text;
      cell.chip = nodeChip(node);
      cell.card = node;
      delete cell.cmNode;
      cell.repliesTo = from.id;
      if (cards.length) {
        cell.items = cards.map((c) => ({
          id: crypto.randomUUID(),
          text: c.text,
          kind: "card" as const,
          chip: nodeChip(c),
          card: c,
        }));
        cell.expanded = false;
      }
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

export const smartKit = new SmartKit();
