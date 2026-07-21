// Saving a flow to a location the user picks on disk (in addition to the
// automatic app-data autosave). Tracks whether the open round has changes not
// yet written to its file, for the on-close "Save / Don't Save / Save As" prompt.

import type { Round } from "./types";
import { store } from "./round.svelte";
import { saveRound } from "./persist";

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

/** Always prompt for a location (native folder picker). */
export async function saveAs(round: Round): Promise<boolean> {
  if (!inTauri()) {
    // Browser fallback: download.
    triggerDownload(suggestName(round), JSON.stringify(round, null, 2));
    return true;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: suggestName(round),
    filters: [{ name: "Nimbus flow", extensions: ["nimbus", "json"] }],
  });
  if (!path) return false;
  return writeTo(round, path);
}

async function writeTo(round: Round, path: string): Promise<boolean> {
  store.mutate((r) => {
    r.filePath = path;
  });
  const toWrite = { ...($state.snapshot(round) as Round), filePath: path };
  try {
    await invoke("write_text_file", {
      path,
      contents: JSON.stringify(toWrite, null, 2),
    });
  } catch (e) {
    console.error("save failed:", e);
    return false;
  }
  savedSig = sig(toWrite);
  sigRoundId = round.id;
  return true;
}

/** Open a .nimbus/.json flow file the user picks. */
export async function openFromFile(): Promise<Round | null> {
  if (!inTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    multiple: false,
    filters: [{ name: "Nimbus flow", extensions: ["nimbus", "json"] }],
  });
  if (typeof path !== "string") return null;
  return openPath(path);
}

/** Load a .nimbus file at a known path (double-click / "open with"). */
export async function openPath(path: string): Promise<Round | null> {
  if (!inTauri()) return null;
  try {
    const text = await invoke<string>("read_text_file", { path });
    const round = JSON.parse(text) as Round;
    round.filePath = path;
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
