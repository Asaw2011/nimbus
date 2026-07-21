// Round export: a self-contained HTML report (shareable with judges and
// teammates, print-friendly) and a raw round file (.json) that another Flow
// user can import.

import type { Round, Sheet } from "./types";
import { exportTextToDownloads, exportToDownloads } from "./blobs";

// Concrete hexes for the report (CSS vars don't exist outside the app).
const COLORS = {
  aff: "#1a6fd4",
  neg: "#c8442a",
  analytic: "#1e8e4a",
  card: "#7c4dbe",
  neutral: "#444444",
};

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "round";
}

function sheetAccentHex(sheet: Sheet): string {
  if (sheet.color) return sheet.color;
  if (sheet.kind === "case") return COLORS.aff;
  if (sheet.kind === "offcase" || sheet.kind === "overview") return COLORS.neg;
  return COLORS.neutral;
}

function sheetHtml(round: Round, sheet: Sheet): string {
  const speeches = round.template.speeches.slice(sheet.startCol);
  const lastUsed = sheet.rows.findLastIndex((r) =>
    r.cells.slice(sheet.startCol).some((c) => c.text.trim() !== ""),
  );
  const title = `<h2 style="color:${esc(sheetAccentHex(sheet))}">${esc(sheet.title || "(untitled)")}</h2>`;
  if (lastUsed < 0) {
    return `${title}<p class="empty">(empty)</p>`;
  }
  const head = speeches
    .map(
      (sp) =>
        `<th style="color:${sp.side === "aff" ? COLORS.aff : sp.side === "neg" ? COLORS.neg : COLORS.neutral}">${esc(sp.abbr)}</th>`,
    )
    .join("");
  const body = sheet.rows
    .slice(0, lastUsed + 1)
    .map((row) => {
      const cells = row.cells
        .slice(sheet.startCol)
        .map((cell, i) => {
          const side = speeches[i]?.side;
          const ev = cell.marks?.evidence;
          const color = ev
            ? COLORS[ev]
            : side === "aff"
              ? COLORS.aff
              : side === "neg"
                ? COLORS.neg
                : COLORS.neutral;
          const classes = [
            cell.marks?.dropped ? "dropped" : "",
            cell.marks?.starred ? "starred" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const prefix = cell.ext ? "⟶ " : "";
          const star = cell.marks?.starred ? " ★" : "";
          return `<td class="${classes}" style="color:${color}">${prefix}${esc(cell.text)}${star}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `${title}\n<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

export function roundToHtml(round: Round): string {
  const meta = [
    round.tournament,
    round.judges && `Judges: ${round.judges}`,
    round.affTeam && `AFF: ${round.affTeam}`,
    round.negTeam && `NEG: ${round.negTeam}`,
    round.template.name,
    new Date(round.updatedAt).toLocaleString(),
  ]
    .filter(Boolean)
    .map((m) => esc(String(m)))
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(round.name)} — flow</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 32px auto; max-width: 1200px; padding: 0 16px; color: #1d1d1b; background: #fdfdfb; }
  h1 { margin-bottom: 2px; }
  .meta { color: #6d6b64; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 16px; margin: 26px 0 6px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 12px; }
  th, td { border: 1px solid #d9d7cf; padding: 4px 6px; vertical-align: top; text-align: left; white-space: pre-wrap; word-break: break-word; }
  th { background: #f2f1ec; font-size: 11px; letter-spacing: 0.04em; }
  td.dropped { background: #fbe9e7; box-shadow: inset 3px 0 0 ${COLORS.neg}; }
  td.starred { box-shadow: inset 3px 0 0 #b8860b; }
  td.dropped.starred { box-shadow: inset 3px 0 0 ${COLORS.neg}, inset -3px 0 0 #b8860b; }
  .empty { color: #999; font-style: italic; }
  footer { margin-top: 36px; color: #999; font-size: 11px; }
  @media print { body { margin: 0; } h2 { break-after: avoid; } table { break-inside: auto; } }
</style>
</head>
<body>
<h1>${esc(round.name)}</h1>
<p class="meta">${meta}</p>
${round.sheets.map((s) => sheetHtml(round, s)).join("\n")}
<footer>Exported from Flow</footer>
</body>
</html>`;
}

export async function exportRoundHtml(round: Round): Promise<string> {
  return exportTextToDownloads(
    `${safeFilename(round.name)}-flow.html`,
    roundToHtml(round),
  );
}

export async function exportRoundFile(round: Round): Promise<string> {
  return exportToDownloads(`${safeFilename(round.name)}.flowround.json`, round);
}
