// Tournaments = real folders on the user's computer. A tournament is a linked
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

/** A tournament's flows live in a sub-folder with this name when it has one
 *  (Adam's layout: Glenbrooks\ for the docs, Glenbrooks\flows\ for flows). */
export const FLOWS_SUB = "flows";

const LAST_PARENT_KEY = "nimbus.lastTourneyParent";
const UNLINKED_BLOB = "tournaments-unlinked";

/** Paths compare case- and slash-insensitively (Windows / macOS). */
function pathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

class TournamentStore {
  list = $state<Tournament[]>(loadBlobCached<Tournament[]>(BLOB) ?? []);
  /** Ids whose folder wasn't there at startup - renamed, moved, or a Dropbox
   *  folder not synced yet. Shown with "Find it…", never dropped. */
  missing = $state<string[]>([]);
  /** Folders you unlinked. Startup discovery (the folders inside
   *  Documents\Nimbus\tournaments) skips these - it used to re-add an
   *  unlinked folder on every launch, so an empty duplicate "04---St Marks"
   *  kept coming back (Adam). Linking the folder yourself clears it. */
  private unlinked = new Set<string>(loadBlobCached<string[]>(UNLINKED_BLOB) ?? []);

  async init(): Promise<void> {
    const gone = await loadBlob<string[]>(UNLINKED_BLOB);
    if (gone) for (const p of gone) this.unlinked.add(p);
    const disk = await loadBlob<Tournament[]>(BLOB);
    if (disk) {
      // ⚠ A missing folder is KEPT, not dropped. Dropping it meant renaming the
      // folder on disk (or Dropbox not having synced it yet) silently erased
      // the tournament from Nimbus (Adam). Now it says so and offers "Find it…".
      const gone: string[] = [];
      if (inTauri()) {
        for (const t of disk) {
          if (!(await invoke<boolean>("dir_exists", { path: t.path }))) gone.push(t.id);
        }
      }
      this.list = disk;
      this.missing = gone;
    }
  }

  /** Point a tournament whose folder went missing at its new location. */
  async relink(id: string): Promise<boolean> {
    if (!inTauri()) return false;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ directory: true, multiple: false, title: "Find this tournament's folder" });
    if (typeof path !== "string") return false;
    this.list = this.list.map((t) => (t.id === id ? { ...t, path } : t));
    this.missing = this.missing.filter((x) => x !== id);
    this.persist();
    return true;
  }

  /** Where this tournament's flows go: its `flows` sub-folder when it has one,
   *  else the tournament folder itself. */
  async flowsDir(t: Tournament): Promise<string> {
    const sub = join(t.path, FLOWS_SUB);
    if (inTauri()) {
      try {
        if (await invoke<boolean>("dir_exists", { path: sub })) return sub;
      } catch {
        /* fall back to the folder itself */
      }
    }
    return t.path;
  }

  private persistUnlinked(): void {
    saveBlob(UNLINKED_BLOB, [...this.unlinked]);
  }

  private persist(): void {
    saveBlob(BLOB, $state.snapshot(this.list) as Tournament[]);
  }

  /**
   * A new tournament: `name` is only what Nimbus shows; the folder its flows go
   * in is whatever you pick (or make with the picker's "New folder"). Nimbus
   * creates NO folder of its own.
   *
   * ⚠ The name and the folder are deliberately separate. Making a folder named
   * after the tournament put "04---St Marks" inside Adam's own "04---St Marks";
   * renaming that copy to "flows" on disk then lost the tournament. The picker
   * starts one level above the last folder picked (the next tournament's
   * folder is usually a sibling). Null if the picker was cancelled.
   */
  async createInPicked(name: string): Promise<Tournament | null> {
    if (!inTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    let last: string | undefined;
    try {
      last = localStorage.getItem(LAST_PARENT_KEY) ?? undefined;
    } catch {
      /* no memory then */
    }
    const path = await open({
      directory: true,
      multiple: false,
      title: `Pick the folder for "${name.trim()}" flows (or make one with New folder)`,
      ...(last ? { defaultPath: last } : {}),
    });
    if (typeof path !== "string") return null;
    try {
      const sep = path.includes("\\") ? "\\" : "/";
      const trimmed = path.replace(/[\\/]+$/, "");
      // Two levels up for a "flows" folder (…\Tournaments\04---St Marks\flows
      // → …\Tournaments), else one level up.
      let up = trimmed.slice(0, trimmed.lastIndexOf(sep));
      if (trimmed.split(sep).pop()?.toLowerCase() === FLOWS_SUB) up = up.slice(0, up.lastIndexOf(sep));
      if (up) localStorage.setItem(LAST_PARENT_KEY, up);
    } catch {
      /* fine */
    }
    const label = name.trim() || "Tournament";
    const t = this.add(label, path);
    // That folder was already a tournament: it just takes the new name.
    if (t.name !== label) this.rename(t.id, label);
    return { ...t, name: label };
  }

  /** Link an existing folder on the computer as a tournament. */
  async linkExisting(): Promise<Tournament | null> {
    if (!inTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ directory: true, multiple: false, title: "Choose a folder to use as a tournament" });
    if (typeof path !== "string") return null;
    // Linking a "flows" folder itself: name it after the tournament folder
    // around it ("Glenbrooks"), not "flows".
    const parts = path.split(/[\\/]/).filter(Boolean);
    let name = parts.pop() ?? "Tournament";
    if (name.toLowerCase() === FLOWS_SUB && parts.length) name = parts.pop()!;
    return this.add(name, path);
  }

  /** Register a folder as a tournament without a picker dialog - used for the
   *  auto-created default flow library. Dedupes by path. */
  addLibrary(name: string, path: string): Tournament {
    return this.add(name, path);
  }

  /** A folder found inside Documents\Nimbus\tournaments at startup: added
   *  unless you unlinked it before. Null when skipped. */
  discover(name: string, path: string): Tournament | null {
    if (this.unlinked.has(pathKey(path))) return null;
    return this.add(name, path);
  }

  /** Immediate sub-folders of a directory. Used to discover tournament folders
   *  that live inside the home library's `tournaments/` folder - empty ones
   *  included, which a flow listing can't see. */
  async subdirs(path: string): Promise<{ name: string; path: string }[]> {
    if (!inTauri()) return [];
    try {
      return await invoke<{ name: string; path: string }[]>("list_subdirs", { path });
    } catch {
      return [];
    }
  }

  /** Create a tournament folder inside the home library's `tournaments/` folder
   *  (no picker - tournaments always live there now) and register it. */
  async createInHome(tournamentsDir: string, name: string): Promise<Tournament | null> {
    if (!inTauri()) return null;
    const clean = safeFileName(name);
    const path = join(tournamentsDir, clean);
    await invoke("create_dir", { path });
    return this.add(name.trim() || clean, path);
  }

  private add(name: string, path: string): Tournament {
    // Adding a folder on purpose undoes an earlier unlink of it.
    if (this.unlinked.delete(pathKey(path))) this.persistUnlinked();
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

  /**
   * Move a tournament so it sits where `beforeId` currently is.
   *
   * The list's own order is what the dashboard renders, so reordering it IS the
   * feature - no separate rank to keep in step with the array, and nothing to
   * migrate for anyone whose list predates this.
   *
   * `beforeId` of null drops it at the end. A no-op move persists nothing.
   */
  move(id: string, beforeId: string | null): void {
    if (id === beforeId) return;
    const from = this.list.findIndex((t) => t.id === id);
    if (from < 0) return;
    const next = this.list.slice();
    const [moved] = next.splice(from, 1);
    const to = beforeId === null ? next.length : next.findIndex((t) => t.id === beforeId);
    if (beforeId !== null && to < 0) return; // target vanished mid-drag
    next.splice(to, 0, moved);
    if (next.every((t, i) => t.id === this.list[i]?.id)) return;
    this.list = next;
    this.persist();
  }

  /** Unlink from Nimbus (does NOT delete the folder or its files). */
  unlink(id: string): void {
    const t = this.list.find((x) => x.id === id);
    if (t) {
      this.unlinked.add(pathKey(t.path));
      this.persistUnlinked();
    }
    this.list = this.list.filter((t) => t.id !== id);
    this.missing = this.missing.filter((x) => x !== id);
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

  /**
   * A flow name that won't collide with a file already sitting directly in the
   * tournament folder. Follows the " 2", " 3" convention the docs list uses.
   *
   * Only root-level files count: those are the only ones a write to `t.path`
   * can actually clobber, so a same-named flow filed away in a per-round
   * subfolder must not push the name along. The compare is case-INSENSITIVE
   * because Windows and macOS treat "New Flow.nimbus" and "new flow.nimbus" as
   * the same file - the same reason renameFlow compares paths that way.
   */
  async uniqueFlowName(t: Tournament, base: string, ext?: string): Promise<string> {
    const wanted = (base ?? "").trim() || "New Flow";
    if (!inTauri()) return wanted;
    const want = ext ?? (settings.defaultSaveFormat === "xlsx" ? "xlsx" : "nimbus");
    let taken: Set<string>;
    try {
      // The folder new flows are written to: `flows` when the tournament has
      // one (its files list with rel "flows"), else the tournament folder.
      const dir = await this.flowsDir(t);
      const rel = dir === t.path ? "" : FLOWS_SUB;
      const files = await invoke<FlowFile[]>("list_flows", { path: t.path });
      taken = new Set(
        files
          .filter((f) => (f.rel ?? "").toLowerCase() === rel && f.ext === want)
          .map((f) => f.name.trim().toLowerCase()),
      );
    } catch {
      // Can't read the folder, so we can't prove the name is free. Fall back to
      // the plain name - that is exactly the old behaviour, and a folder we
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

  /** Save a round into a tournament folder, using the default save format. */
  async saveRoundInto(t: Tournament, round: Round): Promise<string> {
    const excel = settings.defaultSaveFormat === "xlsx";
    const ext = excel ? "xlsx" : "nimbus";
    // Uniquify the ROUND NAME, not merely the file name. Two flows made with
    // "+ New flow" are both called "New Flow", and both writing to
    // "New Flow.nimbus" made the second overwrite the first outright.
    //
    // It must be the name and not just the filename because autosave runs
    // renameFileToMatchTitle(), which derives the path from round.name ALONE
    // and then deletes the old file. A file uniquified to "New Flow 2.nimbus"
    // while its round was still titled "New Flow" would be renamed back on top
    // of the original within 30s - destroying it after the fact.
    let name = await this.uniqueFlowName(t, round.name, ext);
    const dir = await this.flowsDir(t);
    let path = join(dir, `${safeFileName(name)}.${ext}`);
    // Belt and braces: never write over a file that's already there, even if
    // the listing above missed it (Dropbox mid-sync).
    if (await invoke<boolean>("file_exists", { path })) {
      name = `${name.slice(0, 70)} ${uid()}`;
      path = join(dir, `${safeFileName(name)}.${ext}`);
    }
    const toWrite = { ...round, name, filePath: path };
    if (excel) {
      const { roundToXlsx } = await import("../xlsx/xlsx");
      await invoke("write_binary_file", { path, bytes: Array.from(roundToXlsx(toWrite)) });
    } else {
      await invoke("write_text_file", {
        path,
        contents: JSON.stringify(toWrite, null, 2),
      });
    }
    // Keep the caller's in-memory round in step with what actually landed on
    // disk. If it kept the colliding title, the next autosave would rename the
    // file straight back onto the flow we just took care not to overwrite.
    round.name = name;
    return path;
  }

  /** Move a flow file into another tournament folder. Returns the new path (or
   *  null if it was already there) so the caller can re-point anything holding
   *  the old one - the dashboard's app-data mirror, in particular. */
  async moveFlow(file: FlowFile, target: Tournament): Promise<string | null> {
    const to = join(await this.flowsDir(target), `${file.name}.${file.ext}`);
    if (to.toLowerCase() === file.path.toLowerCase()) return null;
    // Never move ON TOP OF another flow - the move would replace it.
    if (await invoke<boolean>("file_exists", { path: to })) {
      throw new Error(`"${target.name}" already has a flow called "${file.name}". Rename one first.`);
    }
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
    // Only remove the original AFTER the new file is safely written (above -
    // a failed write rejects and we never get here).
    //
    // The comparison is case-INSENSITIVE on purpose. Windows and macOS treat
    // "untitled.nimbus" and "Untitled.nimbus" as the same file, so a rename
    // that only changes capitalization writes and then deletes the very same
    // file - destroying it. Skipping the delete in that case can at worst leave
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
