// Saving a flow to a location the user picks on disk (in addition to the
// automatic app-data autosave). Tracks whether the open round has changes not
// yet written to its file, for the on-close "Save / Don't Save / Save As" prompt.

import type { Round } from "./types";
import { store } from "./round.svelte";
import { saveRound } from "./persist";
import { settings } from "./settings.svelte";

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

/** Always prompt for a location. Format defaults to the user's setting. */
export async function saveAs(
  round: Round,
  format?: "nimbus" | "xlsx",
): Promise<boolean> {
  const fmt = format ?? settings.defaultSaveFormat;
  if (!inTauri()) {
    triggerDownload(suggestName(round), JSON.stringify(round, null, 2));
    return true;
  }
  const nimbusFilter = { name: "Nimbus flow", extensions: ["nimbus"] };
  const excelFilter = { name: "Excel workbook", extensions: ["xlsx"] };
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: fmt === "xlsx" ? excelName(round) : suggestName(round),
    filters: fmt === "xlsx" ? [excelFilter, nimbusFilter] : [nimbusFilter, excelFilter],
  });
  if (!path) return false;
  return writeTo(round, path);
}

function normalizeExt(path: string): string {
  const low = path.toLowerCase();
  if (low.endsWith(".nimbus") || low.endsWith(".json") || low.endsWith(".xlsx")) {
    return path;
  }
  return path + ".nimbus";
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

function excelName(round: Round): string {
  const base = (round.name || "flow").replace(/[^A-Za-z0-9-_ ]+/g, "").trim();
  return `${base || "flow"}.xlsx`;
}

/** Export/convert straight to an Excel workbook. */
export async function exportExcel(round: Round): Promise<boolean> {
  return saveAs(round, "xlsx");
}

/** Export/convert straight to a native .nimbus file. */
export async function exportNimbus(round: Round): Promise<boolean> {
  return saveAs(round, "nimbus");
}

// ---- standalone file conversion (doesn't touch the open round) ------------

async function readAnyFlow(path: string): Promise<Round> {
  if (path.toLowerCase().endsWith(".xlsx")) {
    const arr = await invoke<number[]>("read_binary_file", { path });
    const { xlsxToRound } = await import("../xlsx/xlsx");
    return xlsxToRound(new Uint8Array(arr));
  }
  const text = await invoke<string>("read_text_file", { path });
  return JSON.parse(text) as Round;
}

async function writeFlowTo(round: Round, path: string): Promise<void> {
  const toWrite = { ...round, filePath: path };
  if (path.toLowerCase().endsWith(".xlsx")) {
    const { roundToXlsx } = await import("../xlsx/xlsx");
    await invoke("write_binary_file", { path, bytes: Array.from(roundToXlsx(toWrite)) });
  } else {
    await invoke("write_text_file", {
      path,
      contents: JSON.stringify(toWrite, null, 2),
    });
  }
}

/** Pick a flow file and save it in the other format. Returns a status message. */
export async function convertFlowFile(): Promise<string> {
  if (!inTauri()) return "";
  const { open, save } = await import("@tauri-apps/plugin-dialog");
  const inPath = await open({
    multiple: false,
    filters: [{ name: "Flow files", extensions: ["nimbus", "xlsx", "json"] }],
  });
  if (typeof inPath !== "string") return "";
  let round: Round;
  try {
    round = await readAnyFlow(inPath);
  } catch {
    return "Couldn't read that file.";
  }
  const toExcel = !inPath.toLowerCase().endsWith(".xlsx");
  const outPath = await save({
    defaultPath: toExcel ? excelName(round) : suggestName(round),
    filters: toExcel
      ? [{ name: "Excel workbook", extensions: ["xlsx"] }]
      : [{ name: "Nimbus flow", extensions: ["nimbus"] }],
  });
  if (!outPath) return "";
  const finalPath = normalizeExt(outPath);
  try {
    await writeFlowTo(round, finalPath);
  } catch (e) {
    return "Couldn't save: " + (e instanceof Error ? e.message : e);
  }
  return `Converted to ${toExcel ? "Excel (.xlsx)" : "Nimbus (.nimbus)"} ✓`;
}

/** Open a .nimbus/.json flow file the user picks. */
export async function openFromFile(): Promise<Round | null> {
  if (!inTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    multiple: false,
    filters: [
      { name: "Flow files", extensions: ["nimbus", "xlsx", "json"] },
      { name: "Nimbus flow", extensions: ["nimbus"] },
      { name: "Excel workbook", extensions: ["xlsx"] },
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
