// Saving a flow to a location the user picks on disk (in addition to the
// automatic app-data autosave). Tracks whether the open round has changes not
// yet written to its file, for the on-close "Save / Don't Save / Save As" prompt.

import type { Round } from "./types";
import { store } from "./round.svelte";
import { loadRound, saveRound } from "./persist";
import { safeFileName } from "./tournaments.svelte";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// Signature of the round as last written to its file; used for dirty checks.
let savedSig = "";
let sigRoundId = "";

function sig(round: Round): string {
  const { filePath, updatedAt, ...rest } = round;
  return JSON.stringify(rest);
}

/** Call when a round is opened/created so dirty state starts clean-ish. */
export function markOpened(round: Round | null): void {
  if (!round) {
    savedSig = "";
    sigRoundId = "";
    return;
  }
  // A round loaded from a file starts "saved"; a fresh/app-data one starts
  // "unsaved to file" (empty savedSig ≠ its content).
  sigRoundId = round.id;
  savedSig = round.filePath ? sig(round) : "";
}

/** True if the open round has changes not written to a chosen file location. */
export function isDirty(round: Round | null): boolean {
  if (!round) return false;
  if (round.id !== sigRoundId) return true;
  // Nothing typed yet → nothing worth prompting about.
  const hasContent = round.sheets.some((s) =>
    s.rows.some((r) => r.cells.some((c) => c.text.trim() !== "")),
  );
  if (!hasContent && !round.filePath) return false;
  return sig(round) !== savedSig;
}

function suggestName(round: Round): string {
  const base = (round.name || "flow").replace(/[^A-Za-z0-9-_ ]+/g, "").trim();
  return `${base || "flow"}.nimbus`;
}

/**
 * Save to the round's existing file, or prompt for a location if it has none.
 * Returns true on success, false if cancelled.
 */
export async function saveToFile(round: Round): Promise<boolean> {
  if (!round.filePath) return saveAs(round);
  return writeTo(round, round.filePath);
}

/** Always prompt for a location. Flows save as Excel (.xlsx) — the single
 *  flow format. A Nimbus .xlsx embeds the full round JSON in a hidden sheet,
 *  so it is lossless; the old native .nimbus format has been retired. */
export async function saveAs(round: Round): Promise<boolean> {
  if (!inTauri()) {
    triggerDownload(suggestName(round), JSON.stringify(round, null, 2));
    return true;
  }
  const excelFilter = { name: "Excel workbook", extensions: ["xlsx"] };
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: excelName(round),
    filters: [excelFilter],
  });
  if (!path) return false;
  return writeTo(round, path);
}

function normalizeExt(path: string): string {
  const low = path.toLowerCase();
  // Recognize old .nimbus/.json files so they still round-trip, but new saves
  // default to .xlsx.
  if (low.endsWith(".xlsx") || low.endsWith(".nimbus") || low.endsWith(".json")) {
    return path;
  }
  return path + ".xlsx";
}

// Throws on a real write failure so the caller can show the user why.
async function writeTo(round: Round, rawPath: string): Promise<boolean> {
  const path = normalizeExt(rawPath);
  store.mutate((r) => {
    r.filePath = path;
  });
  const toWrite = { ...($state.snapshot(round) as Round), filePath: path };
  if (path.toLowerCase().endsWith(".xlsx")) {
    const { roundToXlsx } = await import("../xlsx/xlsx");
    const bytes = roundToXlsx(toWrite);
    await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
  } else {
    await invoke("write_text_file", {
      path,
      contents: JSON.stringify(toWrite, null, 2),
    });
  }
  savedSig = sig(toWrite);
  sigRoundId = round.id;
  return true;
}

/**
 * Write the open round back to its OWN file, if it has one and it has drifted.
 *
 * The app-data copy gets an autosave heartbeat; the file used to get nothing but
 * an explicit ⌘S. That gap is why the two copies could sit weeks apart — and a
 * disagreement between them is what let a stale file be opened over newer work.
 * Keeping the file current means there is nothing left to disagree about.
 *
 * Deliberately does NOT go through `writeTo`: that calls `store.mutate` to set
 * filePath, and pushing an undo step from a timer would poison the undo stack.
 * filePath is already correct here, so there is nothing to mutate.
 */
export async function autosaveToFile(round: Round | null): Promise<boolean> {
  if (!inTauri() || !round?.filePath) return false;
  if (!isDirty(round)) return false;
  // Converge the filename on the title here too, not just on the title field's
  // blur. Blur is easy to miss (closing the window, switching flows, a stray
  // click), and a filename that silently stops matching the title is exactly the
  // drift that let two copies of one flow diverge.
  const renamed = await renameFileToMatchTitle(round);
  if (renamed) return true; // it wrote the content at the new path already
  const path = round.filePath;
  try {
    const snap = { ...($state.snapshot(round) as Round), filePath: path };
    if (path.toLowerCase().endsWith(".xlsx")) {
      const { roundToXlsx } = await import("../xlsx/xlsx");
      await invoke("write_binary_file", { path, bytes: Array.from(roundToXlsx(snap)) });
    } else {
      await invoke("write_text_file", {
        path,
        contents: JSON.stringify(snap, null, 2),
      });
    }
    savedSig = sig(snap);
    sigRoundId = round.id;
    return true;
  } catch (e) {
    // A sync conflict or a folder that went away must not break flowing; the
    // app-data autosave is still the backstop and we retry on the next tick.
    console.warn("autosaveToFile failed", e);
    return false;
  }
}

/**
 * Keep the file on disk named after the round's own title.
 *
 * `round.name` is the single source of truth for what a flow is called. The
 * dashboard used to show the FILENAME instead, so renaming a flow from its round
 * home page changed one and not the other, and the two drifted apart until they
 * no longer looked like the same flow.
 */
export async function renameFileToMatchTitle(round: Round | null): Promise<string | null> {
  if (!inTauri() || !round?.filePath) return null;
  const path = round.filePath;
  const sep = path.includes("\\") ? "\\" : "/";
  const cut = path.lastIndexOf(sep);
  const dir = path.slice(0, cut);
  const dot = path.lastIndexOf(".");
  const ext = dot > cut ? path.slice(dot + 1) : "xlsx";
  const safe = safeFileName(round.name);
  if (!safe) return null;
  const newPath = `${dir}${sep}${safe}.${ext}`;
  if (newPath === path) return null;
  try {
    // Never rename ON TOP OF a different flow. Two flows in one folder titled
    // the same would otherwise have this write over one and then delete the
    // other — silently, on an autosave tick, with no error anywhere.
    //
    // Skip the rename rather than uniquifying to "name 2": this runs on EVERY
    // autosave, so a suffix would be recomputed each tick against a target
    // that is still taken, walking the file's name upward forever. Leaving the
    // filename alone lets it disagree with the title until the user resolves
    // it, which is recoverable; overwriting the other flow is not.
    if (
      newPath.toLowerCase() !== path.toLowerCase() &&
      (await invoke<boolean>("file_exists", { path: newPath }))
    ) {
      return null;
    }
    const snap = { ...($state.snapshot(round) as Round), filePath: newPath };
    if (newPath.toLowerCase().endsWith(".xlsx")) {
      const { roundToXlsx } = await import("../xlsx/xlsx");
      await invoke("write_binary_file", { path: newPath, bytes: Array.from(roundToXlsx(snap)) });
    } else {
      await invoke("write_text_file", { path: newPath, contents: JSON.stringify(snap, null, 2) });
    }
    // Case-insensitive: on Windows/macOS "flow.nimbus" and "Flow.nimbus" are the
    // SAME file, so deleting the old path would delete what we just wrote.
    if (newPath.toLowerCase() !== path.toLowerCase()) {
      try {
        await invoke("delete_path", { path });
      } catch (e) {
        console.warn("renameFileToMatchTitle: couldn't remove the old file", path, e);
      }
    }
    // applyRemote, not mutate: a rename shouldn't leave an undo step pointing at
    // a path that no longer exists.
    store.applyRemote((r) => { r.filePath = newPath; });
    savedSig = sig(snap);
    sigRoundId = round.id;
    return newPath;
  } catch (e) {
    console.warn("renameFileToMatchTitle failed", e);
    return null;
  }
}

function excelName(round: Round): string {
  const base = (round.name || "flow").replace(/[^A-Za-z0-9-_ ]+/g, "").trim();
  return `${base || "flow"}.xlsx`;
}

/** Save the round as an Excel workbook (the one flow format). */
export async function exportExcel(round: Round): Promise<boolean> {
  return saveAs(round);
}


/** Open an Excel (.xlsx) flow the user picks. Older .nimbus/.json flows still
 *  open (secondary filter) so nothing saved before the switch is stranded. */
export async function openFromFile(): Promise<Round | null> {
  if (!inTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    multiple: false,
    filters: [
      { name: "Excel workbook", extensions: ["xlsx"] },
      { name: "All flow files", extensions: ["xlsx", "nimbus", "json"] },
    ],
  });
  if (typeof path !== "string") return null;
  return openPath(path);
}

/** Load a .nimbus or .xlsx flow at a known path (double-click / "open with"). */
export async function openPath(path: string): Promise<Round | null> {
  if (!inTauri()) return null;
  try {
    let round: Round;
    if (path.toLowerCase().endsWith(".xlsx")) {
      const arr = await invoke<number[]>("read_binary_file", { path });
      const { xlsxToRound } = await import("../xlsx/xlsx");
      round = xlsxToRound(new Uint8Array(arr));
    } else {
      const text = await invoke<string>("read_text_file", { path });
      round = JSON.parse(text) as Round;
    }
    round.filePath = path;

    // NEVER let a stale file overwrite newer autosaved work.
    //
    // This line used to be an unconditional `saveRound(round)`. The app-data
    // copy is the one that gets the autosave heartbeat, while the FILE is only
    // rewritten by an explicit save — so app data is routinely the newer of the
    // two. Opening the file then mirrored its older content over the newer
    // round under the same id, and the newer version was simply gone. That is
    // how a fully flowed round got reduced to the 1AC it was first saved with.
    //
    // Both sides carry the round's own logical `updatedAt`, so they are
    // directly comparable — unlike a filesystem mtime, which Dropbox rewrites
    // on sync and which therefore cannot be trusted to say which is newer.
    const existing = await loadRound(round.id);
    if (existing && (existing.updatedAt ?? 0) > (round.updatedAt ?? 0)) {
      // The autosaved copy is ahead: open THAT, and only re-point it at the
      // file it was opened from. The file's stale content is left untouched on
      // disk and is never written into app data.
      existing.filePath = path;
      await saveRound(existing);
      return existing;
    }

    await saveRound(round); // mirror into app-data so it appears on the dashboard
    return round;
  } catch (e) {
    console.error("open failed:", e);
    return null;
  }
}

function triggerDownload(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
