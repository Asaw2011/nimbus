// Frontend file index — caches the Rust scan results and exposes search.
// The Rust scan_library_roots command does the actual filesystem walk;
// this module owns the in-memory cache and the fuzzy scoring logic.

import { invoke } from "@tauri-apps/api/core";
import { loadBlob, loadBlobCached, saveBlob } from "$lib/model/blobs";
import { settings } from "$lib/model/settings.svelte";

export interface LibFile {
  path: string;
  name: string; // stem only, no extension
  ext: string;  // "docx" | "nimbus"
  mtime: number; // ms since epoch
  size: number;
}

const CACHE_BLOB = "file-index";

class FileIndexStore {
  files = $state<LibFile[]>([]);
  scanning = $state(false);
  lastScanned = $state(0);
  error = $state("");

  constructor() {
    // Load cached index immediately for instant first paint
    const cached = loadBlobCached<{ files: LibFile[]; scannedAt: number }>(CACHE_BLOB);
    if (cached?.files) {
      this.files = cached.files;
      this.lastScanned = cached.scannedAt ?? 0;
    }
    // Rescan in background when app starts
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      // A real card library's index is far too big for the localStorage cache,
      // so it lives only on disk. Load that (fast) copy while the filesystem
      // walk runs, instead of showing an empty library until the walk finishes.
      // Never applied over a completed scan — that data is fresher.
      if (!cached?.files) {
        void loadBlob<{ files: LibFile[]; scannedAt: number }>(CACHE_BLOB).then((disk) => {
          if (this.scanDone || !disk?.files) return;
          this.files = disk.files;
          this.lastScanned = disk.scannedAt ?? 0;
        });
      }
      void this.scan();
      // Rescan when window regains focus (files may have changed)
      window.addEventListener("focus", () => this.scheduleRescan());
    }
  }

  /** True once a filesystem scan has produced a result this session. */
  private scanDone = false;

  private rescanTimer: ReturnType<typeof setTimeout> | null = null;

  scheduleRescan() {
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => void this.scan(), 500);
  }

  async scan(): Promise<void> {
    const roots = settings.libraryRoots
      .filter((r) => r.enabled)
      .map((r) => r.path);

    if (roots.length === 0) {
      this.scanDone = true;
      this.files = [];
      return;
    }

    this.scanning = true;
    this.error = "";

    try {
      const files = await invoke<LibFile[]>("scan_library_roots", { roots });
      this.scanDone = true;
      this.files = files;
      this.lastScanned = Date.now();
      saveBlob(CACHE_BLOB, { files, scannedAt: this.lastScanned });
    } catch (err) {
      // Keep last known index; show non-blocking error
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.scanning = false;
    }
  }

  /** Multi-token substring scoring. Returns 0 if no match. */
  score(query: string, text: string): number {
    if (!query) return 1; // empty query matches everything equally
    const q = query.toLowerCase();
    return scoreLower(text.toLowerCase(), q, q.split(/\s+/).filter(Boolean));
  }

  /** Lowercased file names, rebuilt only when the scan replaces `files`. */
  private lcOf: LibFile[] | null = null;
  private lcNames: string[] = [];
  private names(): string[] {
    const files = this.files;
    if (this.lcOf !== files || this.lcNames.length !== files.length) {
      this.lcNames = files.map((f) => f.name.toLowerCase());
      this.lcOf = files;
    }
    return this.lcNames;
  }

  /** Search files by name. Returns up to `limit` results sorted by score then recency. */
  search(query: string, limit = 200): LibFile[] {
    const raw = query.trim();
    if (!raw) {
      return this.files.slice(0, limit);
    }
    // Normalize the query ONCE. This used to happen per file (lowercase + regex
    // split + two array allocations), i.e. tens of thousands of times per
    // keystroke on a real card library.
    const q = raw.toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const lc = this.names();
    const files = this.files;
    const scored: { f: LibFile; s: number }[] = [];
    for (let i = 0; i < files.length; i++) {
      const s = scoreLower(lc[i], q, tokens);
      if (s > 0) scored.push({ f: files[i], s });
    }
    scored.sort((a, b) => b.s - a.s || b.f.mtime - a.f.mtime);
    return scored.slice(0, limit).map(({ f }) => f);
  }
}

/** Scoring core: `t` and `q` are already lowercased, `tokens` already split. */
function scoreLower(t: string, q: string, tokens: string[]): number {
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (tokens.every((tok) => t.includes(tok))) return 60;
  if (tokens.some((tok) => t.startsWith(tok))) return 40;
  if (tokens.some((tok) => t.includes(tok))) return 20;
  return 0;
}

export const fileIndex = new FileIndexStore();

/** Relative time label for display (e.g. "2h ago", "3d ago"). */
export function relativeTime(mtime: number): string {
  const diff = Date.now() - mtime;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}
