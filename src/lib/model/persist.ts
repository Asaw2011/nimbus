// Persistence bridge: Tauri native commands when running in the app,
// localStorage when running as a plain web page (dev / future web build).

import type { Round, RoundMeta } from "./types";
import { migrateLegacyRound } from "./round.svelte";

const LS_PREFIX = "debate-flow:round:";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function saveRound(round: Round): Promise<void> {
  const json = JSON.stringify(round);
  if (inTauri()) {
    await invoke("save_round", { id: round.id, json });
  } else {
    localStorage.setItem(LS_PREFIX + round.id, json);
  }
}

export async function loadRound(id: string): Promise<Round | null> {
  if (inTauri()) {
    try {
      return migrateLegacyRound(
        JSON.parse(await invoke<string>("load_round", { id })),
      );
    } catch {
      return null;
    }
  }
  const raw = localStorage.getItem(LS_PREFIX + id);
  return raw ? migrateLegacyRound(JSON.parse(raw)) : null;
}

export async function deleteRound(id: string): Promise<void> {
  if (inTauri()) {
    await invoke("delete_round", { id });
  } else {
    localStorage.removeItem(LS_PREFIX + id);
  }
}

export async function listRounds(): Promise<RoundMeta[]> {
  let rounds: Round[] = [];
  if (inTauri()) {
    const raws = await invoke<string[]>("list_rounds");
    rounds = raws.flatMap((r) => {
      try {
        return [JSON.parse(r) as Round];
      } catch {
        return [];
      }
    });
  } else {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX)) {
        rounds.push(JSON.parse(localStorage.getItem(key)!) as Round);
      }
    }
  }
  return rounds
    .map((r) => ({
      id: r.id,
      name: r.name,
      tournament: r.tournament,
      opponent: r.opponent,
      templateName: r.template.name,
      sheets: r.sheets.map((s) => ({
        title: s.title,
        kind: s.kind,
        color: s.color,
      })),
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
