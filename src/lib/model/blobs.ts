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

/** Save to localStorage immediately and to disk in the background. */
export function saveBlob(name: string, value: unknown): void {
  const json = JSON.stringify(value);
  try {
    localStorage.setItem(LS_PREFIX + name, json);
  } catch {
    // storage full/blocked — the disk write below still protects the data
  }
  if (inTauri()) {
    void invoke("save_blob", { name, json }).catch((e) =>
      console.error(`save_blob(${name}) failed:`, e),
    );
  }
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
