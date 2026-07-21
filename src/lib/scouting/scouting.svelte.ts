// SCOUTING: School → Teams → Rounds (per tournament) → Docs + auto-flows.
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
  tournament: string;
  notes: string;
  docs: ScoutDoc[];
  createdAt: number;
}

export interface ScoutTeam {
  id: string;
  code: string;
  rounds: ScoutRound[];
  updatedAt: number;
}

export interface ScoutSchool {
  id: string;
  name: string;
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
  return filename.replace(/\.(docx?|pdf)$/i, "").replace(/[_-]+/g, " ").trim() || "Speech doc";
}

function migrateDoc(d: Record<string, unknown>): ScoutDoc {
  return {
    id: (d.id as string) ?? uid(),
    name: (d.name as string) ?? "Speech doc",
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

function normalize(raw: unknown): ScoutSchool[] {
  if (!raw) return [];

  // Current { tourneys, rounds } schema (teams were stored as full strings like "Peninsula LL")
  if (!Array.isArray(raw) && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).rounds)) {
    const d = raw as { rounds: Record<string, unknown>[] };
    const schoolMap = new Map<string, ScoutSchool>();
    for (const r of d.rounds) {
      const teamStr = ((r.team as string) ?? "").trim();
      // Split "School Code" — last word is code if it looks like initials.
      const parts = teamStr.split(/\s+/);
      const last = parts[parts.length - 1];
      let schoolName: string;
      let code: string;
      if (parts.length > 1 && /^[A-Za-z]{1,3}$/.test(last)) {
        code = last.toUpperCase();
        schoolName = parts.slice(0, -1).join(" ");
      } else {
        schoolName = teamStr || "School";
        code = "";
      }
      let school = schoolMap.get(schoolName);
      if (!school) { school = { id: uid(), name: schoolName, teams: [] }; schoolMap.set(schoolName, school); }
      let team = school.teams.find((t) => t.code === code);
      if (!team) { team = { id: uid(), code, rounds: [], updatedAt: Date.now() }; school.teams.push(team); }
      team.rounds.push({
        id: (r.id as string) ?? uid(),
        tournament: (r.tournament as string) ?? "Imported",
        notes: (r.notes as string) ?? "",
        docs: ((r.docs as Record<string, unknown>[]) ?? []).map(migrateDoc),
        createdAt: (r.createdAt as number) ?? Date.now(),
      });
    }
    return [...schoolMap.values()];
  }

  // School → teams → docs schema (pre-rounds)
  if (Array.isArray(raw)) {
    return (raw as Record<string, unknown>[]).map((s) => {
      const rawTeams = Array.isArray(s.teams) ? (s.teams as Record<string, unknown>[]) : [s];
      return {
        id: (s.id as string) ?? uid(),
        name: (s.name as string) ?? "School",
        teams: rawTeams.map((t) => {
          // Collect docs from either t.docs or t.positions (grouped by source).
          let docs: ScoutDoc[] = [];
          if (Array.isArray(t.docs)) {
            docs = (t.docs as Record<string, unknown>[]).map(migrateDoc);
          } else if (Array.isArray(t.positions)) {
            const bySrc = new Map<string, ScoutDoc>();
            for (const p of t.positions as Record<string, unknown>[]) {
              const src = (p.source as string) ?? "Imported";
              let doc = bySrc.get(src);
              if (!doc) {
                doc = { id: uid(), name: baseName(src), side: sideOf(src), owner: "them", source: src, addedAt: Date.now(), positions: [] };
                bySrc.set(src, doc);
              }
              doc.positions.push({ id: (p.id as string) ?? uid(), name: (p.name as string) ?? "", blocks: (p.blocks as string[]) ?? [], tags: (p.tags as string[]) ?? [], strategy: (p.strategy as string) ?? "" });
            }
            docs = [...bySrc.values()];
          }
          const round: ScoutRound = { id: uid(), tournament: "Imported", notes: (t.notes as string) ?? "", docs, createdAt: Date.now() };
          return { id: (t.id as string) ?? uid(), code: (t.code as string) ?? "", rounds: docs.length ? [round] : [], updatedAt: (t.updatedAt as number) ?? Date.now() };
        }),
      };
    });
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

  getRound(schoolId: string, teamId: string, roundId: string) {
    return this.getTeam(schoolId, teamId)?.rounds.find((r) => r.id === roundId);
  }

  addSchool(name: string): ScoutSchool {
    const s: ScoutSchool = { id: uid(), name: name.trim() || "School", teams: [] };
    this.schools = [...this.schools, s];
    this.touch();
    return s;
  }

  renameSchool(id: string, name: string): void {
    const s = this.schools.find((x) => x.id === id);
    if (s) { s.name = name; this.touch(); }
  }

  deleteSchool(id: string): void {
    this.schools = this.schools.filter((s) => s.id !== id);
    this.touch();
  }

  addTeam(schoolId: string, code: string): ScoutTeam | null {
    const s = this.schools.find((x) => x.id === schoolId);
    if (!s) return null;
    const t: ScoutTeam = { id: uid(), code: code.trim() || "Team", rounds: [], updatedAt: Date.now() };
    s.teams.push(t);
    this.touch();
    return t;
  }

  updateTeam(schoolId: string, teamId: string, patch: Partial<Pick<ScoutTeam, "code">>): void {
    const t = this.getTeam(schoolId, teamId);
    if (!t) return;
    Object.assign(t, patch);
    t.updatedAt = Date.now();
    this.touch();
  }

  deleteTeam(schoolId: string, teamId: string): void {
    const s = this.schools.find((x) => x.id === schoolId);
    if (!s) return;
    s.teams = s.teams.filter((t) => t.id !== teamId);
    this.touch();
  }

  addRound(schoolId: string, teamId: string, tournament: string): ScoutRound | null {
    const t = this.getTeam(schoolId, teamId);
    if (!t) return null;
    const r: ScoutRound = { id: uid(), tournament: tournament.trim() || "Tournament", notes: "", docs: [], createdAt: Date.now() };
    t.rounds.push(r);
    t.updatedAt = Date.now();
    this.touch();
    return r;
  }

  updateRound(schoolId: string, teamId: string, roundId: string, patch: Partial<Pick<ScoutRound, "tournament" | "notes">>): void {
    const r = this.getRound(schoolId, teamId, roundId);
    if (!r) return;
    Object.assign(r, patch);
    this.touch();
  }

  deleteRound(schoolId: string, teamId: string, roundId: string): void {
    const t = this.getTeam(schoolId, teamId);
    if (!t) return;
    t.rounds = t.rounds.filter((r) => r.id !== roundId);
    this.touch();
  }

  addDoc(schoolId: string, teamId: string, roundId: string, filename: string, buf: ArrayBuffer, owner: "you" | "them"): ScoutDoc | null {
    const r = this.getRound(schoolId, teamId, roundId);
    if (!r) return null;
    const parsed = parseDocx(buf);
    const doc: ScoutDoc = {
      id: uid(), name: baseName(filename), side: sideOf(filename), owner, source: filename, addedAt: Date.now(),
      positions: parsed.nodes.map((node) => ({
        id: uid(), name: node.text, blocks: node.children.map((c) => c.text), tags: flowLines(node), strategy: "",
      })),
    };
    r.docs.push(doc);
    this.touch();
    return doc;
  }

  updateDoc(schoolId: string, teamId: string, roundId: string, docId: string, patch: Partial<Pick<ScoutDoc, "name" | "side" | "owner">>): void {
    const doc = this.getRound(schoolId, teamId, roundId)?.docs.find((d) => d.id === docId);
    if (!doc) return;
    Object.assign(doc, patch);
    this.touch();
  }

  deleteDoc(schoolId: string, teamId: string, roundId: string, docId: string): void {
    const r = this.getRound(schoolId, teamId, roundId);
    if (!r) return;
    r.docs = r.docs.filter((d) => d.id !== docId);
    this.touch();
  }

  updatePosition(schoolId: string, teamId: string, roundId: string, docId: string, posId: string, strategy: string): void {
    const pos = this.getRound(schoolId, teamId, roundId)?.docs.find((d) => d.id === docId)?.positions.find((p) => p.id === posId);
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
    <h4>${esc(d.name)} <span class="src">${sideLabel(d.side)} · ${esc(d.source)}</span></h4>
    ${d.positions.map((p) => `<div class="pos"><b>${esc(p.name)}</b>
      ${p.strategy ? `<p class="strat">${esc(p.strategy)}</p>` : ""}
      ${p.tags.length ? `<ol>${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}</div>`).join("")}
  </div>`;
  const roundBlock = (r: ScoutRound) => `<div class="rnd">
    <h3>${esc(r.tournament)}</h3>
    ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}
    ${r.docs.filter(d => d.owner === "them").length ? `<h5>Their docs</h5>${r.docs.filter(d => d.owner === "them").map(docBlock).join("")}` : ""}
    ${r.docs.filter(d => d.owner === "you").length ? `<h5>Your docs</h5>${r.docs.filter(d => d.owner === "you").map(docBlock).join("")}` : ""}
  </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(school.name)} ${esc(team.code)} — scouting</title>
<style>body{font-family:-apple-system,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#1d1d1b}
h1{margin-bottom:2px}.meta{color:#666;font-size:13px;margin-bottom:20px}
.rnd{border-top:2px solid #eee;margin-top:24px;padding-top:8px}
.doc{margin:10px 0}.src{color:#999;font-weight:400;font-size:12px}
.strat{background:#fff8e6;border-left:3px solid #e0b64c;padding:6px 10px;margin:4px 0;font-size:13px}
.notes{background:#f2f6fb;border-left:3px solid #1a6fd4;padding:8px 12px;font-size:14px}
ol{font-size:13px;color:#333}</style></head>
<body><h1>${esc(school.name)} ${esc(team.code)}</h1>
<p class="meta">Scouting report · ${new Date().toLocaleString()}</p>
${team.rounds.map(roundBlock).join("\n")}
</body></html>`;
}
