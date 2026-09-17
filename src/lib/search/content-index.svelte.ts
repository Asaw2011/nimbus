// Content index — maps every library .docx to the text of its headings (hats,
// blocks, tags, cards, analytics) so "search by content" can find which doc a
// tagline lives in without re-parsing anything on each keystroke.
//
// Cost strategy (fast + low power):
//  1. Parse each doc's HEADINGS ONLY (extractHeadings skips body runs).
//  2. Build INCREMENTALLY — a file already indexed at the same mtime is reused.
//  3. THROTTLE — yield to the event loop every few files so the UI never stalls.
//  4. PERSIST to disk — subsequent launches reload instantly and only re-parse
//     files that actually changed.
//  5. SEARCH scans cached lowercased strings only — no file I/O, no parsing.
//
// ── ⚠ INDEXING IS EXPLICIT, AND INTERRUPTIBLE ──────────────────────────────
//
// Building this index reads every .docx in the library. On a Dropbox or
// OneDrive library that is not a cheap read: the files are PLACEHOLDERS, and
// reading one downloads it and keeps it on the disk from then on. It used to
// start the moment you selected "By content" — one click, no confirmation and
// no way to stop it — which on a real library meant six minutes of work and
// 219 MB pulled down by someone who had clicked the wrong button.
//
// So: nothing here starts on its own (`build()` is only ever reached from a
// click), `stop()` works at any point, and files that are not already on the
// disk are skipped by default rather than downloaded.

import { invoke } from "@tauri-apps/api/core";
import { saveBlob, loadBlob, loadBlobCached } from "$lib/model/blobs";
import { fileIndex, type LibFile } from "./file-index.svelte";
import { extractHeadings } from "$lib/docx/parse";

interface ContentDoc {
  path: string;
  mtime: number;
  headings: string[];
}

export interface ContentHit {
  file: LibFile;
  hits: string[]; // the matching heading texts (for the snippet)
  score: number;
}

const BLOB = "content-index-v1";
const MAX_HEADINGS_PER_DOC = 4000; // bound memory on giant card files
const YIELD_EVERY = 6; // files parsed between event-loop yields

class ContentIndexStore {
  building = $state(false);
  built = $state(0); // files processed so far this build
  total = $state(0); // files to process this build
  builtAt = $state(0); // ms of last full build
  /** True when the last build was halted by {@link stop} rather than finishing.
   *  Surfaced so the panel can say "partly indexed" instead of implying the
   *  library was covered. */
  stopped = $state(false);
  /** Library files skipped because they are not downloaded — see
   *  {@link LibFile.offline}. Shown as a count so the skipping is visible
   *  rather than silent, with an opt-in to include them. */
  skippedOffline = $state(0);
  /** Set by {@link stop}; checked at every yield point in {@link build}. */
  private cancel = false;

  private docs: ContentDoc[] = [];
  private byPath = new Map<string, ContentDoc>();
  /** Lowercased headings per path, built on first search and reused after.
   *  Lowercasing every heading of every doc per keystroke was the cost of
   *  "search by content" typing on a big library. Reset whenever docs change. */
  private lcByPath = new Map<string, string[]>();
  /** Bumped whenever `docs` changes, so $derived searches recompute. */
  version = $state(0);

  constructor() {
    const cached = loadBlobCached<{ docs: ContentDoc[]; builtAt: number }>(BLOB);
    if (cached?.docs) this.apply(cached);
    // The index can exceed the localStorage quota (many docs) and then live only
    // on disk — load that async so we don't needlessly re-parse everything.
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void loadBlob<{ docs: ContentDoc[]; builtAt: number }>(BLOB).then((disk) => {
        if (disk?.docs && (disk.builtAt ?? 0) >= this.builtAt) this.apply(disk);
      });
    }
  }

  private apply(data: { docs: ContentDoc[]; builtAt: number }): void {
    this.docs = data.docs;
    this.builtAt = data.builtAt ?? 0;
    this.byPath = new Map(data.docs.map((d) => [d.path, d]));
    this.lcByPath.clear();
    this.version++;
  }

  /** Lowercased headings for a doc, cached. */
  private lower(d: ContentDoc): string[] {
    let lc = this.lcByPath.get(d.path);
    if (!lc) {
      lc = d.headings.map((h) => h.toLowerCase());
      this.lcByPath.set(d.path, lc);
    }
    return lc;
  }

  /** True once at least some docs are indexed. */
  get ready(): boolean {
    return this.docs.length > 0;
  }

  /**
   * How much of the library the index actually covers, right now.
   *
   * ⚠ Counted against the CURRENT file list rather than against whatever the
   * last build happened to walk: files appear and disappear between runs, and
   * the honest question the panel needs to answer is "will searching by content
   * find things", not "did a build once finish".
   *
   * `offline` is the part that cannot be covered without downloading it, which
   * is why it is reported separately instead of just making the index look
   * permanently incomplete.
   */
  get coverage(): { indexed: number; local: number; offline: number } {
    const all = fileIndex.files.filter(
      (f) => f.ext === "docx" && !f.name.startsWith("~$"),
    );
    let indexed = 0;
    let offline = 0;
    for (const f of all) {
      if (f.offline) offline++;
      else if (this.byPath.has(f.path)) indexed++;
    }
    return { indexed, local: all.length - offline, offline };
  }

  /**
   * Build / refresh the content index for every library .docx. Incremental and
   * throttled. Safe to call repeatedly — a file unchanged since last time is
   * reused, so a re-build after the first is nearly free.
   */
  async build(force = false, includeOffline = false): Promise<void> {
    if (this.building) return;
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    this.building = true;
    this.cancel = false;
    this.stopped = false;
    try {
      const all = fileIndex.files.filter(
        (f) => f.ext === "docx" && !f.name.startsWith("~$"),
      );
      // ⚠ Skip what isn't on the disk. A placeholder's bytes cost a download,
      // and a library search is not worth silently pulling someone's whole
      // Dropbox onto their laptop mid-tournament. Counted, not hidden, and
      // `includeOffline` is the deliberate way to fetch them anyway.
      const files = includeOffline ? all : all.filter((f) => !f.offline);
      this.skippedOffline = all.length - files.length;
      this.total = files.length;
      this.built = 0;
      // Start from what is already indexed, so stopping keeps every file done
      // so far AND everything a previous run covered. Rebuilding `result` from
      // only this pass would throw away the rest of the library the moment you
      // pressed Stop.
      //
      // ⚠ Carried forward only for files the library still lists. The old code
      // rebuilt the map from scratch each time, so deletions fell out on their
      // own; seeding from the previous run without this would keep every file
      // ever indexed forever, and the stored index is already megabytes.
      // Compared against `all`, not `files`, so skipping the offline ones does
      // not evict what we know about them.
      const live = new Set(all.map((f) => f.path));
      const result = new Map(
        this.docs.filter((d) => live.has(d.path)).map((d) => [d.path, d] as const),
      );
      let sinceYield = 0;
      for (const f of files) {
        const cached = this.byPath.get(f.path);
        if (!force && cached && cached.mtime === f.mtime) {
          result.set(f.path, cached);
        } else {
          try {
            const bytes = await invoke<number[]>("read_binary_file", { path: f.path });
            const heads = extractHeadings(new Uint8Array(bytes).buffer);
            const headings = heads.map((h) => h.text).slice(0, MAX_HEADINGS_PER_DOC);
            result.set(f.path, { path: f.path, mtime: f.mtime, headings });
          } catch {
            result.set(f.path, { path: f.path, mtime: f.mtime, headings: [] });
          }
        }
        this.built++;
        if (++sinceYield >= YIELD_EVERY || this.cancel) {
          sinceYield = 0;
          // Publish partial progress so results appear as they index, then yield.
          this.publish(result);
          if (this.cancel) break;
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      this.stopped = this.cancel;
      this.publish(result);
      // ⚠ Persist a halted build too. The reads already happened — throwing the
      // parse away would mean doing them again next time, which on a cloud
      // library is the expensive half. `builtAt` only moves on a COMPLETE pass,
      // so a stopped build still reads as "not fully indexed".
      if (!this.cancel) this.builtAt = Date.now();
      saveBlob(BLOB, { docs: [...result.values()], builtAt: this.builtAt });
    } finally {
      this.building = false;
      this.cancel = false;
    }
  }

  /**
   * Halt a build in progress. Everything parsed so far is kept and saved.
   *
   * Takes effect at the next yield point (at most a few files later) — the
   * in-flight `read_binary_file` cannot be recalled, so one more file may
   * finish downloading after the click. Stopping is not a rollback.
   */
  stop(): void {
    if (this.building) this.cancel = true;
  }

  /** Swap in a set of indexed docs and invalidate the derived caches. */
  private publish(result: Map<string, ContentDoc>): void {
    this.docs = [...result.values()];
    this.byPath = new Map(this.docs.map((d) => [d.path, d]));
    this.lcByPath.clear();
    this.version++;
  }

  /**
   * Files whose headings contain the query (all tokens within a single heading),
   * ranked by how many headings match. Pure in-memory string scan.
   */
  search(query: string, limit = 100): ContentHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const matched: { path: string; hits: string[] }[] = [];
    for (const d of this.docs) {
      const hits: string[] = [];
      const lc = this.lower(d);
      for (let i = 0; i < lc.length; i++) {
        if (tokens.every((t) => lc[i].includes(t))) {
          hits.push(d.headings[i]);
          if (hits.length >= 4) break; // enough for a snippet
        }
      }
      if (hits.length) matched.push({ path: d.path, hits });
    }
    if (matched.length === 0) return [];
    // Only now build the path -> LibFile map: on a large library that's tens of
    // thousands of entries, and most keystrokes (partial words) match nothing.
    const fileByPath = new Map(fileIndex.files.map((f) => [f.path, f]));
    const out: ContentHit[] = [];
    for (const m of matched) {
      const file = fileByPath.get(m.path);
      if (file) out.push({ file, hits: m.hits, score: m.hits.length });
    }
    out.sort((a, b) => b.score - a.score || b.file.mtime - a.file.mtime);
    return out.slice(0, limit);
  }
}

export const contentIndex = new ContentIndexStore();
