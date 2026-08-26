// Write-through persistence for user configuration (settings, macros,
// snippets, folders). localStorage is the fast synchronous cache; the disk
// (app data dir, next to saved rounds) is the durable copy — customization
// must survive webview storage wipes, app updates, and reinstalls.

const LS_PREFIX = "debate-flow:blob:";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * Largest payload we mirror into the localStorage cache when a disk is
 * available. `setItem` is SYNCHRONOUS, so mirroring a multi-megabyte doc there
 * every few keystrokes stalls the main thread — and it crowds the small
 * localStorage quota, which is what used to evict doc content. Big blobs go to
 * disk only; the sync cache exists for small first-paint reads (settings, the
 * doc list), which all sit far below this.
 */
const LS_MAX_CHARS = 128 * 1024;

/**
 * Save to localStorage immediately and to disk in the background.
 *
 * Returns the disk write so a caller that is about to tear the app down can
 * AWAIT it — closing Nimbus force-quits the process, which would otherwise kill
 * an in-flight IPC write. Every other caller can keep ignoring the result.
 */
export function saveBlob(name: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  // Outside Tauri localStorage is the ONLY store, so it always gets the write.
  if (!inTauri() || json.length <= LS_MAX_CHARS) {
    try {
      localStorage.setItem(LS_PREFIX + name, json);
    } catch {
      // storage full/blocked — the disk write below still protects the data
    }
  } else {
    // Disk-only from here on. Drop any smaller cached copy from when this blob
    // was under the limit, so a failed disk read can't resurrect stale content.
    dropBlobCache(name);
  }
  if (inTauri()) {
    return invoke<void>("save_blob", { name, json }).catch((e) =>
      console.error(`save_blob(${name}) failed:`, e),
    );
  }
  return Promise.resolve();
}

/**
 * Load the durable copy: disk first (authoritative), localStorage fallback.
 * If only localStorage has it (pre-disk versions), migrate it to disk.
 */
export async function loadBlob<T>(name: string): Promise<T | null> {
  if (inTauri()) {
    try {
      return JSON.parse(await invoke<string>("load_blob", { name })) as T;
    } catch {
      // not on disk yet — fall through to localStorage + migrate
    }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + name);
    if (raw !== null) {
      const value = JSON.parse(raw) as T;
      if (inTauri()) saveBlob(name, value); // migrate old saves to disk
      return value;
    }
  } catch {
    // corrupted cache
  }
  return null;
}

/** Drop a blob's localStorage cache entry (the disk copy, if any, is left
 *  alone). Used to reclaim the small localStorage quota after a blob has been
 *  re-homed onto disk under a new name. */
export function dropBlobCache(name: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + name);
  } catch {
    // nothing to drop / storage blocked
  }
}

/** Synchronous read of the localStorage cache (for first-paint defaults). */
export function loadBlobCached<T>(name: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + name);
    return raw !== null ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function exportToDownloads(
  filename: string,
  value: unknown,
): Promise<string> {
  return exportTextToDownloads(filename, JSON.stringify(value, null, 2));
}

export async function exportTextToDownloads(
  filename: string,
  text: string,
): Promise<string> {
  if (inTauri()) {
    return invoke<string>("export_to_downloads", { filename, json: text });
  }
  // Browser fallback: trigger a download.
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return `Downloads/${filename}`;
}
