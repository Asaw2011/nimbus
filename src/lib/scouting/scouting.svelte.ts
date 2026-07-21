// SCOUTING: School → Team → Tournament → Round → Docs + auto-flows.
// Self-contained — delete this folder + the marked block in Dashboard.svelte to remove.

import { parseDocx, flowLines } from "../docx/parse";
import { loadBlob, loadBlobCached, saveBlob } from "../model/blobs";

export interface ScoutPosition {
  id: string;
  name: string;
  blocks: string[];
  tags: string[];
  strategy: string;
}

export interface ScoutDoc {
  id: string;
  name: string;
  side: "aff" | "neg" | "unknown";
  owner: "you" | "them";
  source: string;
  addedAt: number;
  positions: ScoutPosition[];
}

export interface ScoutRound {
  id: string;
  name: string;    // e.g. "Round 1", "Doubles"
  notes: string;
  docs: ScoutDoc[];
  createdAt: number;
}

export interface ScoutTournament {
  id: string;
  name: string;    // e.g. "Harvard", "Berkeley"
  rounds: ScoutRound[];
}

export interface ScoutTeam {
  id: string;
  code: string;    // e.g. "HJ"
  tournaments: ScoutTournament[];
  updatedAt: number;
}

export interface ScoutSchool {
  id: string;
  name: string;    // e.g. "Greenhill"
  teams: ScoutTeam[];
}

const BLOB = "scouting";

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function sideOf(name: string): "aff" | "neg" | "unknown" {
  const n = name.toLowerCase();
  if (/\b(1nc|2nc|1nr|2nr|da|cp|k|kritik|counterplan|disad|disadvantage|topicality|\bt\b|neg|off|politics|ptx)\b/.test(n))
    return "neg";
  if (/\b(1ac|2ac|1ar|2ar|adv|advantage|aff|case|plan|contention)\b/.test(n)) return "aff";
  return "unknown";
}

function baseName(filename: string): string {
  return filename.replace(/\.(docx?|pdf)$/i, "").replace(/[_-]+/g, " ").trim() || "Doc";
}

function migrateDoc(d: Record<string, unknown>): ScoutDoc {
  return {
    id: (d.id as string) ?? uid(),
    name: (d.name as string) ?? "Doc",
    side: (d.side as ScoutDoc["side"]) ?? "unknown",
    owner: (d.owner as ScoutDoc["owner"]) ?? "them",
    source: (d.source as string) ?? "",
    addedAt: (d.addedAt as number) ?? Date.now(),
    positions: ((d.positions as Record<string, unknown>[]) ?? []).map((p) => ({
      id: (p.id as string) ?? uid(),
      name: (p.name as string) ?? "",
      blocks: (p.blocks as string[]) ?? [],
      tags: (p.tags as string[]) ?? [],
      strategy: (p.strategy as string) ?? "",
    })),
  };
}

// Migrate any prior schema into School → Team → Tournament → Round.
function normalize(raw: unknown): ScoutSchool[] {
  if (!raw) return [];

  // Current School → Team → Round[] (rounds had a `tournament` field) schema.
  if (Array.isArray(raw)) {
    // Check if items look like schools with teams having tournaments already.
    const first = raw[0] as Record<string, unknown> | undefined;
    if (first && Array.isArray(first.teams)) {
      const firstTeam = (first.teams as Record<string, unknown>[])[0];
      if (firstTeam && Array.isArray(firstTeam.tournaments)) {
        // Already current schema.
        return raw as ScoutSchool[];
      }
    }

    // Older School → Team → Round[] where round.tournament was a string.
    return (raw as Record<string, unknown>[]).map((s) => {
      const rawTeams = Array.isArray(s.teams) ? (s.teams as Record<string, unknown>[]) : [s];
      return {
        id: (s.id as string) ?? uid(),
        name: (s.name as string) ?? "School",
        teams: rawTeams.map((t) => {
          // t might have `rounds` (recent schema) or `docs` or `positions`.
          const tourneyMap = new Map<string, ScoutTournament>();

          if (Array.isArray(t.rounds)) {
            for (const r of t.rounds as Record<string, unknown>[]) {
              const tname = (r.tournament as string) ?? "Imported";
              let tourney = tourneyMap.get(tname);
              if (!tourney) { tourney = { id: uid(), name: tname, rounds: [] }; tourneyMap.set(tname, tourney); }
              tourney.rounds.push({
                id: (r.id as string) ?? uid(),
                name: (r.name as string) ?? `Round ${tourney.rounds.length + 1}`,
                notes: (r.notes as string) ?? "",
                docs: ((r.docs as Record<string, unknown>[]) ?? []).map(migrateDoc),
                createdAt: (r.createdAt as number) ?? Date.now(),
              });
            }
          } else {
            // Even older: team had docs or positions directly — one "Imported" tourney, one round.
            let docs: ScoutDoc[] = [];
            if (Array.isArray(t.docs)) {
              docs = (t.docs as Record<string, unknown>[]).map(migrateDoc);
            } else if (Array.isArray(t.positions)) {
              const bySrc = new Map<string, ScoutDoc>();
              for (const p of t.positions as Record<string, unknown>[]) {
                const src = (p.source as string) ?? "Imported";
                let doc = bySrc.get(src);
                if (!doc) { doc = { id: uid(), name: baseName(src), side: sideOf(src), owner: "them", source: src, addedAt: Date.now(), positions: [] }; bySrc.set(src, doc); }
                doc.positions.push({ id: (p.id as string) ?? uid(), name: (p.name as string) ?? "", blocks: (p.blocks as string[]) ?? [], tags: (p.tags as string[]) ?? [], strategy: (p.strategy as string) ?? "" });
              }
              docs = [...bySrc.values()];
            }
            if (docs.length) {
              tourneyMap.set("Imported", { id: uid(), name: "Imported", rounds: [{ id: uid(), name: "Round 1", notes: (t.notes as string) ?? "", docs, createdAt: Date.now() }] });
            }
          }

          return {
            id: (t.id as string) ?? uid(),
            code: (t.code as string) ?? "",
            tournaments: [...tourneyMap.values()],
            updatedAt: (t.updatedAt as number) ?? Date.now(),
          };
        }),
      };
    });
  }

  // Old { tourneys, rounds } object schema — group by team string then tournament.
  if (typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).rounds)) {
    const d = raw as { rounds: Record<string, unknown>[] };
    const schoolMap = new Map<string, ScoutSchool>();
    for (const r of d.rounds) {
      const teamStr = ((r.team as string) ?? "").trim();
      const parts = teamStr.split(/\s+/);
      const last = parts[parts.length - 1];
      let schoolName: string; let code: string;
      if (parts.length > 1 && /^[A-Za-z]{1,3}$/.test(last)) { code = last.toUpperCase(); schoolName = parts.slice(0, -1).join(" "); }
      else { schoolName = teamStr || "School"; code = ""; }
      let school = schoolMap.get(schoolName);
      if (!school) { school = { id: uid(), name: schoolName, teams: [] }; schoolMap.set(schoolName, school); }
      let team = school.teams.find((t) => t.code === code);
      if (!team) { team = { id: uid(), code, tournaments: [], updatedAt: Date.now() }; school.teams.push(team); }
      const tname = (r.tournament as string) ?? "Imported";
      let tourney = team.tournaments.find((t) => t.name === tname);
      if (!tourney) { tourney = { id: uid(), name: tname, rounds: [] }; team.tournaments.push(tourney); }
      tourney.rounds.push({ id: (r.id as string) ?? uid(), name: `Round ${tourney.rounds.length + 1}`, notes: (r.notes as string) ?? "", docs: ((r.docs as Record<string, unknown>[]) ?? []).map(migrateDoc), createdAt: (r.createdAt as number) ?? Date.now() });
    }
    return [...schoolMap.values()];
  }

  return [];
}

class ScoutingStore {
  schools = $state<ScoutSchool[]>(normalize(loadBlobCached<unknown>(BLOB) ?? []));

  async init(): Promise<void> {
    const disk = await loadBlob<unknown>(BLOB);
    if (disk) this.schools = normalize(disk);
  }

  private touch(): void {
    this.schools = [...this.schools];
    saveBlob(BLOB, $state.snapshot(this.schools) as ScoutSchool[]);
  }

  getTeam(schoolId: string, teamId: string) {
    return this.schools.find((s) => s.id === schoolId)?.teams.find((t) => t.id === teamId);
  }
  getTourney(schoolId: string, teamId: string, tourneyId: string) {
    return this.getTeam(schoolId, teamId)?.tournaments.find((t) => t.id === tourneyId);
  }
  getRound(schoolId: string, teamId: string, tourneyId: string, roundId: string) {
    return this.getTourney(schoolId, teamId, tourneyId)?.rounds.find((r) => r.id === roundId);
  }

  addSchool(name: string): ScoutSchool {
    const s: ScoutSchool = { id: uid(), name: name.trim() || "School", teams: [] };
    this.schools = [...this.schools, s]; this.touch(); return s;
  }
  deleteSchool(id: string): void { this.schools = this.schools.filter((s) => s.id !== id); this.touch(); }

  addTeam(schoolId: string, code: string): ScoutTeam | null {
    const s = this.schools.find((x) => x.id === schoolId);
    if (!s) return null;
    const t: ScoutTeam = { id: uid(), code: code.trim() || "Team", tournaments: [], updatedAt: Date.now() };
    s.teams.push(t); this.touch(); return t;
  }
  updateTeam(schoolId: string, teamId: string, patch: Partial<Pick<ScoutTeam, "code">>): void {
    const t = this.getTeam(schoolId, teamId); if (!t) return;
    Object.assign(t, patch); t.updatedAt = Date.now(); this.touch();
  }
  deleteTeam(schoolId: string, teamId: string): void {
    const s = this.schools.find((x) => x.id === schoolId); if (!s) return;
    s.teams = s.teams.filter((t) => t.id !== teamId); this.touch();
  }

  addTournament(schoolId: string, teamId: string, name: string): ScoutTournament | null {
    const t = this.getTeam(schoolId, teamId); if (!t) return null;
    const tourney: ScoutTournament = { id: uid(), name: name.trim() || "Tournament", rounds: [] };
    t.tournaments.push(tourney); t.updatedAt = Date.now(); this.touch(); return tourney;
  }
  renameTournament(schoolId: string, teamId: string, tourneyId: string, name: string): void {
    const tourney = this.getTourney(schoolId, teamId, tourneyId); if (!tourney) return;
    tourney.name = name; this.touch();
  }
  deleteTournament(schoolId: string, teamId: string, tourneyId: string): void {
    const t = this.getTeam(schoolId, teamId); if (!t) return;
    t.tournaments = t.tournaments.filter((x) => x.id !== tourneyId); this.touch();
  }

  addRound(schoolId: string, teamId: string, tourneyId: string, name: string): ScoutRound | null {
    const tourney = this.getTourney(schoolId, teamId, tourneyId); if (!tourney) return null;
    const r: ScoutRound = { id: uid(), name: name.trim() || `Round ${tourney.rounds.length + 1}`, notes: "", docs: [], createdAt: Date.now() };
    tourney.rounds.push(r); this.touch(); return r;
  }
  updateRound(schoolId: string, teamId: string, tourneyId: string, roundId: string, patch: Partial<Pick<ScoutRound, "name" | "notes">>): void {
    const r = this.getRound(schoolId, teamId, tourneyId, roundId); if (!r) return;
    Object.assign(r, patch); this.touch();
  }
  deleteRound(schoolId: string, teamId: string, tourneyId: string, roundId: string): void {
    const tourney = this.getTourney(schoolId, teamId, tourneyId); if (!tourney) return;
    tourney.rounds = tourney.rounds.filter((r) => r.id !== roundId); this.touch();
  }

  addDoc(schoolId: string, teamId: string, tourneyId: string, roundId: string, filename: string, buf: ArrayBuffer, owner: "you" | "them"): ScoutDoc | null {
    const r = this.getRound(schoolId, teamId, tourneyId, roundId); if (!r) return null;
    const parsed = parseDocx(buf);
    const doc: ScoutDoc = {
      id: uid(), name: baseName(filename), side: sideOf(filename), owner, source: filename, addedAt: Date.now(),
      positions: parsed.nodes.map((node) => ({ id: uid(), name: node.text, blocks: node.children.map((c) => c.text), tags: flowLines(node), strategy: "" })),
    };
    r.docs.push(doc); this.touch(); return doc;
  }
  updateDoc(schoolId: string, teamId: string, tourneyId: string, roundId: string, docId: string, patch: Partial<Pick<ScoutDoc, "name" | "side" | "owner">>): void {
    const doc = this.getRound(schoolId, teamId, tourneyId, roundId)?.docs.find((d) => d.id === docId);
    if (!doc) return; Object.assign(doc, patch); this.touch();
  }
  deleteDoc(schoolId: string, teamId: string, tourneyId: string, roundId: string, docId: string): void {
    const r = this.getRound(schoolId, teamId, tourneyId, roundId); if (!r) return;
    r.docs = r.docs.filter((d) => d.id !== docId); this.touch();
  }
  updatePosition(schoolId: string, teamId: string, tourneyId: string, roundId: string, docId: string, posId: string, strategy: string): void {
    const pos = this.getRound(schoolId, teamId, tourneyId, roundId)?.docs.find((d) => d.id === docId)?.positions.find((p) => p.id === posId);
    if (pos) { pos.strategy = strategy; this.touch(); }
  }
}

export const scouting = new ScoutingStore();

// ---- export ---------------------------------------------------------------

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function teamReportHtml(school: ScoutSchool, team: ScoutTeam): string {
  const sideLabel = (s: ScoutDoc["side"]) => s === "aff" ? "Aff" : s === "neg" ? "Neg" : "";
  const docBlock = (d: ScoutDoc) => `<div class="doc">
    <h5>${esc(d.name)} <span class="src">${sideLabel(d.side)}</span></h5>
    ${d.positions.map((p) => `<div class="pos"><b>${esc(p.name)}</b>
      ${p.strategy ? `<p class="strat">${esc(p.strategy)}</p>` : ""}
      ${p.tags.length ? `<ol>${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}</div>`).join("")}
  </div>`;
  const roundBlock = (r: ScoutRound) => `<div class="rnd">
    <h4>${esc(r.name)}</h4>
    ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}
    ${r.docs.filter(d => d.owner === "them").length ? `<p class="owner-lbl">Their docs</p>${r.docs.filter(d => d.owner === "them").map(docBlock).join("")}` : ""}
    ${r.docs.filter(d => d.owner === "you").length ? `<p class="owner-lbl">Your docs</p>${r.docs.filter(d => d.owner === "you").map(docBlock).join("")}` : ""}
  </div>`;
  const tourneyBlock = (t: ScoutTournament) => `<div class="tourney">
    <h3>${esc(t.name)}</h3>${t.rounds.map(roundBlock).join("")}
  </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(school.name)} ${esc(team.code)} — scouting</title>
<style>body{font-family:-apple-system,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#1d1d1b}
.tourney{border-top:2px solid #ddd;margin-top:24px;padding-top:8px}
.rnd{margin:12px 0 12px 12px;border-left:3px solid #eee;padding-left:12px}
.doc{margin:8px 0}.src{color:#999;font-weight:400;font-size:12px}.owner-lbl{font-size:11px;text-transform:uppercase;color:#999;margin:8px 0 2px}
.strat{background:#fff8e6;border-left:3px solid #e0b64c;padding:6px 10px;margin:4px 0;font-size:13px}
.notes{background:#f2f6fb;border-left:3px solid #1a6fd4;padding:8px 12px;font-size:14px}
ol{font-size:13px;color:#333}</style></head>
<body><h1>${esc(school.name)} ${esc(team.code)}</h1>
<p style="color:#666;font-size:13px">Scouting report · ${new Date().toLocaleString()}</p>
${team.tournaments.map(tourneyBlock).join("\n")}</body></html>`;
}
