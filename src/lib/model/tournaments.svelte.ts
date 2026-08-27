// Tournaments = real folders on the user's Mac. A tournament is a linked
// directory; its flows are the .nimbus / .xlsx files inside it. Creating a
// tournament creates a folder; moving a flow moves the file on disk.

import type { Round } from "./types";
import { loadBlob, loadBlobCached, saveBlob } from "./blobs";

export interface Tournament {
  id: string;
  name: string;
  path: string;
}

export interface FlowFile {
  name: string;
  path: string;
  ext: string;
  modified: number;
  /** Sub-folder within the tournament ("" = directly in the tournament folder). */
  rel?: string;
}

/** A flow discovered on disk, with opponent metadata for scouting auto-match. */
export interface ScannedFlow {
  name: string;
  path: string;
  ext: string;
  tournament: string;
  modified: number;
  /** Lowercased "name opponent affTeam negTeam" for matching. */
  haystack: string;
}

const BLOB = "tournaments";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Join a folder path with a filename, using the platform separator. */
function join(dir: string, file: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + file;
}

export function safeFileName(name: string): string {
  return (name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "flow").slice(0, 80);
}

class TournamentStore {
  list = $state<Tournament[]>(loadBlobCached<Tournament[]>(BLOB) ?? []);

  async init(): Promise<void> {
    const disk = await loadBlob<Tournament[]>(BLOB);
    if (disk) {
      // Drop any whose folder was deleted on disk.
      const alive: Tournament[] = [];
      for (const t of disk) {
        if (!inTauri() || (await invoke<boolean>("dir_exists", { path: t.path }))) {
          alive.push(t);
        }
      }
      this.list = alive;
      if (alive.length !== disk.length) this.persist();
    }
  }

  private persist(): void {
    saveBlob(BLOB, $state.snapshot(this.list) as Tournament[]);
  }

  /** Pick a parent location and create a new tournament folder there. */
  async createInPicked(name: string): Promise<Tournament | null> {
    if (!inTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const parent = await open({ directory: true, multiple: false, title: "Where to create this tournament folder" });
    if (typeof parent !== "string") return null;
    const path = join(parent, safeFileName(name));
    await invoke("create_dir", { path });
    return this.add(name, path);
  }

  /** Link an existing folder on the Mac as a tournament. */
  async linkExisting(): Promise<Tournament | null> {
    if (!inTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ directory: true, multiple: false, title: "Choose a folder to use as a tournament" });
    if (typeof path !== "string") return null;
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "Tournament";
    return this.add(name, path);
  }

  private add(name: string, path: string): Tournament {
    const existing = this.list.find((t) => t.path === path);
    if (existing) return existing;
    const t: Tournament = { id: uid(), name, path };
    this.list = [...this.list, t];
    this.persist();
    return t;
  }

  rename(id: string, name: string): void {
    this.list = this.list.map((t) => (t.id === id ? { ...t, name } : t));
    this.persist();
  }

  /** Unlink from Nimbus (does NOT delete the folder or its files). */
  unlink(id: string): void {
    this.list = this.list.filter((t) => t.id !== id);
    this.persist();
  }

  async flows(t: Tournament): Promise<FlowFile[]> {
    if (!inTauri()) return [];
    try {
      return await invoke<FlowFile[]>("list_flows", { path: t.path });
    } catch {
      return [];
    }
  }

  /**
   * Every flow across all tournament folders, with the opponent metadata read
   * from the file (for auto-matching to scouting teams). Reads .nimbus files;
   * .xlsx uses the filename only.
   */
  async scanAllFlows(): Promise<ScannedFlow[]> {
    if (!inTauri()) return [];
    const out: ScannedFlow[] = [];
    for (const t of this.list) {
      const files = await this.flows(t);
      for (const f of files) {
        let opponent = "";
        let affTeam = "";
        let negTeam = "";
        let name = f.name;
        if (f.ext === "xlsx" || f.ext === "nimbus") {
          try {
            let r: { opponent?: string; affTeam?: string; negTeam?: string; name?: string };
            if (f.ext === "xlsx") {
              const arr = await invoke<number[]>("read_binary_file", { path: f.path });
              const { xlsxToRound } = await import("../xlsx/xlsx");
              r = xlsxToRound(new Uint8Array(arr)) as typeof r;
            } else {
              r = JSON.parse(await invoke<string>("read_text_file", { path: f.path }));
            }
            opponent = r.opponent ?? "";
            affTeam = r.affTeam ?? "";
            negTeam = r.negTeam ?? "";
            name = r.name || f.name;
          } catch {
            /* keep filename-only */
          }
        }
        out.push({
          name,
          path: f.path,
          ext: f.ext,
          tournament: t.name,
          modified: f.modified,
          haystack: `${name} ${opponent} ${affTeam} ${negTeam}`.toLowerCase(),
        });
      }
    }
    return out;
  }

  /**
   * A flow name that won't collide with a file already sitting directly in the
   * tournament folder. Follows the " 2", " 3" convention the docs list uses.
   *
   * Only root-level files count: those are the only ones a write to `t.path`
   * can actually clobber, so a same-named flow filed away in a per-round
   * subfolder must not push the name along. The compare is case-INSENSITIVE
   * because Windows and macOS treat "New Flow.nimbus" and "new flow.nimbus" as
   * the same file — the same reason renameFlow compares paths that way.
   */
  async uniqueFlowName(t: Tournament, base: string, ext?: string): Promise<string> {
    const wanted = (base ?? "").trim() || "New Flow";
    if (!inTauri()) return wanted;
    const want = ext ?? "xlsx";
    let taken: Set<string>;
    try {
      const files = await invoke<FlowFile[]>("list_flows", { path: t.path });
      taken = new Set(
        files
          .filter((f) => (f.rel ?? "") === "" && f.ext === want)
          .map((f) => f.name.trim().toLowerCase()),
      );
    } catch {
      // Can't read the folder, so we can't prove the name is free. Fall back to
      // the plain name — that is exactly the old behaviour, and a folder we
      // can't list is one the write below will almost certainly fail on anyway.
      return wanted;
    }
    // Compare on the FILE STEM the name will actually produce, not the name.
    const stem = (n: string) => safeFileName(n).trim().toLowerCase();
    if (!taken.has(stem(wanted))) return wanted;
    for (let i = 2; i <= taken.size + 2; i++) {
      // Trim the base so the " N" can't be truncated away by safeFileName's
      // 80-char cap: without this a very long name collapses every candidate to
      // the same stem and the loop could never find a free one.
      const suffix = ` ${i}`;
      const cand = wanted.slice(0, 80 - suffix.length) + suffix;
      if (!taken.has(stem(cand))) return cand;
    }
    return `${wanted.slice(0, 70)} ${uid()}`;
  }

  /** Save a round into a tournament folder as Excel (.xlsx), the one flow format. */
  async saveRoundInto(t: Tournament, round: Round): Promise<string> {
    const ext = "xlsx";
    // Uniquify the ROUND NAME, not merely the file name. Two flows made with
    // "+ New flow" are both called "New Flow", and both writing to
    // "New Flow.nimbus" made the second overwrite the first outright.
    //
    // It must be the name and not just the filename because autosave runs
    // renameFileToMatchTitle(), which derives the path from round.name ALONE
    // and then deletes the old file. A file uniquified to "New Flow 2.nimbus"
    // while its round was still titled "New Flow" would be renamed back on top
    // of the original within 30s — destroying it after the fact.
    const name = await this.uniqueFlowName(t, round.name, ext);
    const path = join(t.path, `${safeFileName(name)}.${ext}`);
    const toWrite = { ...round, name, filePath: path };
    const { roundToXlsx } = await import("../xlsx/xlsx");
    await invoke("write_binary_file", { path, bytes: Array.from(roundToXlsx(toWrite)) });
    // Keep the caller's in-memory round in step with what actually landed on
    // disk. If it kept the colliding title, the next autosave would rename the
    // file straight back onto the flow we just took care not to overwrite.
    round.name = name;
    return path;
  }

  /** Move a flow file into another tournament folder. Returns the new path (or
   *  null if it was already there) so the caller can re-point anything holding
   *  the old one — the dashboard's app-data mirror, in particular. */
  async moveFlow(file: FlowFile, target: Tournament): Promise<string | null> {
    const to = join(target.path, `${file.name}.${file.ext}`);
    if (to === file.path) return null;
    await invoke("move_path", { from: file.path, to });
    return to;
  }

  async deleteFlow(file: FlowFile): Promise<void> {
    await invoke("delete_path", { path: file.path });
  }

  /** Rename a flow: renames the file on disk and the name stored inside it.
   *  Returns the new path (null if the name was unusable). */
  async renameFlow(file: FlowFile, newName: string): Promise<string | null> {
    const safe = safeFileName(newName);
    if (!safe) return null;
    const sep = file.path.includes("\\") ? "\\" : "/";
    const dir = file.path.slice(0, file.path.lastIndexOf(sep));
    const newPath = join(dir, `${safe}.${file.ext}`);

    // Refuse to rename ON TOP OF a different flow. The write below would
    // overwrite it and the delete further down would then remove the original,
    // so a collision destroyed the other file outright and still reported
    // success. Case-insensitively equal paths are this same file being
    // re-cased, which is handled safely below and must still be allowed.
    if (
      newPath.toLowerCase() !== file.path.toLowerCase() &&
      (await invoke<boolean>("file_exists", { path: newPath }))
    ) {
      throw new Error(`a flow called "${safe}" is already in this folder`);
    }

    // Load, update the internal name, write to the new path.
    let round: Round;
    if (file.ext === "xlsx") {
      const arr = await invoke<number[]>("read_binary_file", { path: file.path });
      const { xlsxToRound } = await import("../xlsx/xlsx");
      round = xlsxToRound(new Uint8Array(arr));
    } else {
      round = JSON.parse(
        await invoke<string>("read_text_file", { path: file.path }),
      ) as Round;
    }
    round.name = newName.trim();
    round.filePath = newPath;
    if (file.ext === "xlsx") {
      const { roundToXlsx } = await import("../xlsx/xlsx");
      await invoke("write_binary_file", { path: newPath, bytes: Array.from(roundToXlsx(round)) });
    } else {
      await invoke("write_text_file", {
        path: newPath,
        contents: JSON.stringify(round, null, 2),
      });
    }
    // Only remove the original AFTER the new file is safely written (above —
    // a failed write rejects and we never get here).
    //
    // The comparison is case-INSENSITIVE on purpose. Windows and macOS treat
    // "untitled.nimbus" and "Untitled.nimbus" as the same file, so a rename
    // that only changes capitalization writes and then deletes the very same
    // file — destroying it. Skipping the delete in that case can at worst leave
    // a stray duplicate on a case-sensitive volume; the alternative loses the
    // flow outright.
    if (newPath.toLowerCase() !== file.path.toLowerCase()) {
      try {
        await invoke("delete_path", { path: file.path });
      } catch (e) {
        // The original was already gone or moved (Dropbox sync can do this
        // mid-operation). The rename itself SUCCEEDED, so this must not reject:
        // an unhandled rejection here skipped the caller's bookkeeping, left
        // the app-data mirror pointing at a path that no longer existed, and
        // that mismatch is what later let a stale file be opened over newer
        // work. Worst case now is a leftover copy of the old file.
        console.warn("renameFlow: couldn't remove the original", file.path, e);
      }
    }
    return newPath;
  }
}

export const tournaments = new TournamentStore();
