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

  private docs: ContentDoc[] = [];
  private byPath = new Map<string, ContentDoc>();
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
    this.version++;
  }

  /** True once at least some docs are indexed. */
  get ready(): boolean {
    return this.docs.length > 0;
  }

  /**
   * Build / refresh the content index for every library .docx. Incremental and
   * throttled. Safe to call repeatedly — a file unchanged since last time is
   * reused, so a re-build after the first is nearly free.
   */
  async build(force = false): Promise<void> {
    if (this.building) return;
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    this.building = true;
    try {
      const files = fileIndex.files.filter(
        (f) => f.ext === "docx" && !f.name.startsWith("~$"),
      );
      this.total = files.length;
      this.built = 0;
      const result: ContentDoc[] = [];
      let sinceYield = 0;
      for (const f of files) {
        const cached = this.byPath.get(f.path);
        if (!force && cached && cached.mtime === f.mtime) {
          result.push(cached);
        } else {
          try {
            const bytes = await invoke<number[]>("read_binary_file", { path: f.path });
            const heads = extractHeadings(new Uint8Array(bytes).buffer);
            const headings = heads.map((h) => h.text).slice(0, MAX_HEADINGS_PER_DOC);
            result.push({ path: f.path, mtime: f.mtime, headings });
          } catch {
            result.push({ path: f.path, mtime: f.mtime, headings: [] });
          }
        }
        this.built++;
        if (++sinceYield >= YIELD_EVERY) {
          sinceYield = 0;
          // Publish partial progress so results appear as they index, then yield.
          this.docs = result.slice();
          this.byPath = new Map(this.docs.map((d) => [d.path, d]));
          this.version++;
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      this.docs = result;
      this.byPath = new Map(result.map((d) => [d.path, d]));
      this.builtAt = Date.now();
      this.version++;
      saveBlob(BLOB, { docs: result, builtAt: this.builtAt });
    } finally {
      this.building = false;
    }
  }

  /**
   * Files whose headings contain the query (all tokens within a single heading),
   * ranked by how many headings match. Pure in-memory string scan.
   */
  search(query: string, limit = 100): ContentHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    // Map path -> LibFile once, so we can attach mtime/name to each hit.
    const fileByPath = new Map(fileIndex.files.map((f) => [f.path, f]));
    // Relevance of ONE heading to the query. Reward tight matches so the file
    // that's actually ABOUT the query beats files with incidental mentions.
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRes = tokens.map((t) => new RegExp(`(^|\\W)${esc(t)}(\\W|$)`));
    const headingScore = (hl: string): number => {
      if (!tokens.every((t) => hl.includes(t))) return 0;
      let s = 1; // every token appears somewhere in this heading
      if (hl === q) s += 100; // the heading IS the query
      if (hl.startsWith(q)) s += 20; // "Clash — ..." style
      for (const re of wordRes) if (re.test(hl)) s += 8; // whole word, not mid-word
      return s;
    };
    const out: ContentHit[] = [];
    for (const d of this.docs) {
      const file = fileByPath.get(d.path);
      if (!file) continue;
      const nameHit = file.name.toLowerCase().includes(q) ? 40 : 0; // filename match is a strong signal
      const hits: string[] = [];
      let score = nameHit;
      for (const h of d.headings) {
        const hs = headingScore(h.toLowerCase());
        if (hs > 0) {
          score += hs;
          if (hits.length < 4) hits.push(h);
        }
      }
      if (score > 0 && (hits.length || nameHit)) out.push({ file, hits, score });
    }
    out.sort((a, b) => b.score - a.score || b.file.mtime - a.file.mtime);
    return out.slice(0, limit);
  }
}

export const contentIndex = new ContentIndexStore();
