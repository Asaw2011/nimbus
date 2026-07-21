// Tournaments = real folders on the user's Mac. A tournament is a linked
// directory; its flows are the .nimbus / .xlsx files inside it. Creating a
// tournament creates a folder; moving a flow moves the file on disk.

import type { Round } from "./types";
import { loadBlob, loadBlobCached, saveBlob } from "./blobs";
import { settings } from "./settings.svelte";

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

function safeFileName(name: string): string {
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
        if (f.ext === "nimbus") {
          try {
            const r = JSON.parse(await invoke<string>("read_text_file", { path: f.path }));
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

  /** Save a round into a tournament folder, using the default save format. */
  async saveRoundInto(t: Tournament, round: Round): Promise<string> {
    const excel = settings.defaultSaveFormat === "xlsx";
    const ext = excel ? "xlsx" : "nimbus";
    const path = join(t.path, `${safeFileName(round.name)}.${ext}`);
    const toWrite = { ...round, filePath: path };
    if (excel) {
      const { roundToXlsx } = await import("../xlsx/xlsx");
      await invoke("write_binary_file", { path, bytes: Array.from(roundToXlsx(toWrite)) });
    } else {
      await invoke("write_text_file", {
        path,
        contents: JSON.stringify(toWrite, null, 2),
      });
    }
    return path;
  }

  /** Move a flow file into another tournament folder. */
  async moveFlow(file: FlowFile, target: Tournament): Promise<void> {
    const to = join(target.path, `${file.name}.${file.ext}`);
    if (to === file.path) return;
    await invoke("move_path", { from: file.path, to });
  }

  async deleteFlow(file: FlowFile): Promise<void> {
    await invoke("delete_path", { path: file.path });
  }

  /** Rename a flow: renames the file on disk and the name stored inside it. */
  async renameFlow(file: FlowFile, newName: string): Promise<void> {
    const safe = safeFileName(newName);
    if (!safe) return;
    const sep = file.path.includes("\\") ? "\\" : "/";
    const dir = file.path.slice(0, file.path.lastIndexOf(sep));
    const newPath = join(dir, `${safe}.${file.ext}`);

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
    if (newPath !== file.path) await invoke("delete_path", { path: file.path });
  }
}

export const tournaments = new TournamentStore();
