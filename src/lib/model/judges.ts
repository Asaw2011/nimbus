// Judge history: every judge you've had, across every flow you have, with the
// notes you wrote on their ballot (RoundHome's "Judge decision" section) and
// how they voted. Read on demand - only when the Judges panel opens - straight
// from the flow files, so nothing new is stored and nothing is ever written.
//
// Sources: every .nimbus file in every tournament folder (the same listing the
// dashboard uses), plus app-data rounds that have no file. A round's judges
// come from its ballots (name + notes + vote) and from the round's "Judges"
// box; a judge named only in the box still shows, without notes.

import type { Round, Side } from "./types";
import { ballotNotes } from "./types";
import { tournaments, type FlowFile } from "./tournaments.svelte";

export interface JudgeRound {
  /** The judge's name as written on this round. */
  judge: string;
  roundName: string;
  tournament: string;
  opponent: string;
  /** What you wrote on their ballot ("" when only named in the Judges box). */
  notes: string;
  /** "Voted aff" / "You won their ballot" / "" when not recorded. */
  result: string;
  when: number;
  /** Open with this file path, else the app-data round id. */
  path?: string;
  roundId?: string;
}

export interface JudgeEntry {
  /** Display name (the most recent spelling). */
  name: string;
  rounds: JudgeRound[];
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** One key per person: case, spacing and punctuation don't split a judge. */
export function judgeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "Smith, Jones & Lee" / "Smith and Jones" / one per line → names. */
function splitJudges(field: string): string[] {
  return field
    .split(/[,;&/\n]|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function resultOf(winner: "aff" | "neg" | "", mySide: Side | undefined): string {
  if (winner !== "aff" && winner !== "neg") return "";
  if (mySide === "aff" || mySide === "neg") return winner === mySide ? "You won their ballot" : "You lost their ballot";
  return `Voted ${winner}`;
}

function judgesOf(round: Round, when: number, src: { path?: string; roundId?: string }): JudgeRound[] {
  const base = {
    roundName: round.name || "Untitled",
    tournament: round.tournament ?? "",
    opponent: round.opponent ?? "",
    when,
    ...src,
  };
  const out: JudgeRound[] = [];
  const seen = new Set<string>();
  for (const b of round.rfd?.ballots ?? []) {
    const name = (b.judge ?? "").trim();
    if (!name) continue;
    seen.add(judgeKey(name));
    out.push({ ...base, judge: name, notes: ballotNotes(b).trim(), result: resultOf(b.winner, round.mySide) });
  }
  for (const name of splitJudges(round.judges ?? "")) {
    const k = judgeKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...base, judge: name, notes: "", result: "" });
  }
  return out;
}

/** Parsed rounds by "path|mtime", so reopening the panel doesn't re-read
 *  unchanged files. Session only. */
const fileCache = new Map<string, JudgeRound[]>();

/** Every judge, most rounds first. */
export async function collectJudges(): Promise<JudgeEntry[]> {
  const all: JudgeRound[] = [];
  const filePaths = new Set<string>();
  if (inTauri()) {
    const files: FlowFile[] = [];
    for (const t of tournaments.list) files.push(...(await tournaments.flows(t)));
    for (const f of files) {
      if (f.ext !== "nimbus") continue; // .xlsx carries no judge notes
      const pk = f.path.toLowerCase();
      if (filePaths.has(pk)) continue;
      filePaths.add(pk);
      const ck = `${f.path}|${f.modified}`;
      let got = fileCache.get(ck);
      if (!got) {
        try {
          const r = JSON.parse(await invoke<string>("read_text_file", { path: f.path })) as Round;
          got = judgesOf(r, f.modified || r.updatedAt || 0, { path: f.path });
        } catch {
          got = [];
        }
        fileCache.set(ck, got);
      }
      all.push(...got);
    }
    // App-data rounds that never became a file (or whose file isn't in a
    // linked folder) - the same rounds "Not saved to a file" lists.
    try {
      for (const raw of await invoke<string[]>("list_rounds")) {
        try {
          const r = JSON.parse(raw) as Round;
          if (r.filePath && filePaths.has(r.filePath.toLowerCase())) continue;
          all.push(...judgesOf(r, r.updatedAt || 0, r.filePath ? { path: r.filePath } : { roundId: r.id }));
        } catch {
          /* unreadable round - skip */
        }
      }
    } catch {
      /* no app-data rounds */
    }
  }
  const byKey = new Map<string, JudgeEntry>();
  for (const jr of all.sort((a, b) => b.when - a.when)) {
    const k = judgeKey(jr.judge);
    const e = byKey.get(k);
    if (e) e.rounds.push(jr);
    else byKey.set(k, { name: jr.judge, rounds: [jr] });
  }
  return [...byKey.values()].sort((a, b) => b.rounds.length - a.rounds.length || a.name.localeCompare(b.name));
}
