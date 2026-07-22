// Frontend file index — caches the Rust scan results and exposes search.
// The Rust scan_library_roots command does the actual filesystem walk;
// this module owns the in-memory cache and the fuzzy scoring logic.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { saveBlob, loadBlobCached } from "$lib/model/blobs";
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
      void this.scan();
      // Rescan when window regains focus (files may have changed)
      window.addEventListener("focus", () => this.scheduleRescan());
    }
  }

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
      this.files = [];
      return;
    }

    this.scanning = true;
    this.error = "";

    try {
      const files = await invoke<LibFile[]>("scan_library_roots", { roots });
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
    const t = text.toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    if (tokens.every((tok) => t.includes(tok))) return 60;
    if (tokens.some((tok) => t.startsWith(tok))) return 40;
    if (tokens.some((tok) => t.includes(tok))) return 20;
    return 0;
  }

  /** Search files by name. Returns up to `limit` results sorted by score then recency. */
  search(query: string, limit = 200): LibFile[] {
    if (!query.trim()) {
      return this.files.slice(0, limit);
    }
    const scored = this.files
      .map((f) => ({ f, s: this.score(query, f.name) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s || b.f.mtime - a.f.mtime);
    return scored.slice(0, limit).map(({ f }) => f);
  }
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
