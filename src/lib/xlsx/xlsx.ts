// XLSX conversion (self-contained; delete this folder + the marked bits in
// filedoc/RoundHome and `npm uninstall xlsx-js-style` to remove).
//
// Mirrors CardMirror's .cmir/.docx dynamic: .nimbus is the native full-fidelity
// format; .xlsx is the interchange format everyone already flows in.
//
// A Nimbus-made .xlsx carries a hidden "_nimbus" sheet holding the exact round
// JSON, so reopening it is lossless. Any other Excel flow is read from the
// visible grid (Verbatim style: row 1 = speech names, each worksheet = a sheet).

import XLSX from "xlsx-js-style";
import type { Round, Sheet, Speech, SheetKind } from "../model/types";
import { INITIAL_ROWS, makeRow, uid } from "../model/types";

const META_SHEET = "_nimbus";
const META_TAG = "NIMBUS_ROUND_JSON_V1";
const CHUNK = 30000; // Excel's per-cell text limit is 32767

// Concrete hexes (Excel styles need literal colors, no CSS vars).
const HEX = {
  aff: "1A6FD4",
  neg: "C8442A",
  analytic: "1E8E4A",
  card: "7C4DBE",
  neutral: "333333",
  headerFill: "F2F1EC",
  droppedFill: "FBE9E7",
  star: "B8860B",
};

function inkFor(side: string, ev?: string): string {
  if (ev === "analytic") return HEX.analytic;
  if (ev === "card") return HEX.card;
  if (side === "aff") return HEX.aff;
  if (side === "neg") return HEX.neg;
  return HEX.neutral;
}

// ---- export ---------------------------------------------------------------

export function roundToXlsx(round: Round): Uint8Array {
  const wb = XLSX.utils.book_new();
  const speeches = round.template.speeches;
  const usedNames = new Set<string>();

  for (const sheet of round.sheets) {
    const visible = speeches.slice(sheet.startCol);
    const lastUsed = sheet.rows.findLastIndex((r) =>
      r.cells.slice(sheet.startCol).some((c) => c.text.trim() !== ""),
    );
    const aoa: string[][] = [visible.map((s) => s.abbr)];
    for (let r = 0; r <= Math.max(lastUsed, 0); r++) {
      aoa.push(
        visible.map((_, i) => sheet.rows[r]?.cells[sheet.startCol + i]?.text ?? ""),
      );
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // header styling
    visible.forEach((sp, c) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[ref])
        ws[ref].s = {
          font: { bold: true, color: { rgb: inkFor(sp.side) } },
          fill: { patternType: "solid", fgColor: { rgb: HEX.headerFill } },
          alignment: { horizontal: "center" },
        };
    });

    // data-cell styling (color by speech side / mark, marks as fills/borders)
    for (let r = 0; r <= Math.max(lastUsed, 0); r++) {
      const row = sheet.rows[r];
      if (!row) continue;
      visible.forEach((sp, c) => {
        const cell = row.cells[sheet.startCol + c];
        if (!cell) return;
        const ref = XLSX.utils.encode_cell({ r: r + 1, c });
        if (!ws[ref]) return;
        const s: Record<string, unknown> = {
          alignment: { wrapText: true, vertical: "top" },
          font: {
            color: { rgb: cell.marks?.color?.replace("#", "") || inkFor(sp.side, cell.marks?.evidence) },
            bold: !!cell.marks?.bold,
            italic: !!cell.marks?.italic,
          },
        };
        if (cell.marks?.dropped) {
          s.fill = { patternType: "solid", fgColor: { rgb: HEX.droppedFill } };
          s.border = { left: { style: "thick", color: { rgb: HEX.neg } } };
        }
        if (cell.marks?.starred) {
          s.border = {
            ...(s.border as object),
            right: { style: "thick", color: { rgb: HEX.star } },
          };
        }
        ws[ref].s = s;
      });
    }
    ws["!cols"] = visible.map(() => ({ wch: 34 }));
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(sheet.title, usedNames));
  }

  // hidden sheet with the exact round for lossless reopen
  const json = JSON.stringify(round);
  const chunks: string[][] = [[META_TAG]];
  for (let i = 0; i < json.length; i += CHUNK) chunks.push([json.slice(i, i + CHUNK)]);
  const metaWs = XLSX.utils.aoa_to_sheet(chunks);
  XLSX.utils.book_append_sheet(wb, metaWs, META_SHEET);
  markHidden(wb, META_SHEET);

  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

function uniqueSheetName(title: string, used: Set<string>): string {
  // Excel: <=31 chars, no \ / ? * [ ] :
  let base = (title || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base.slice(0, 28)} ${n++}`;
  }
  used.add(name.toLowerCase());
  return name;
}

function markHidden(wb: ReturnType<typeof XLSX.utils.book_new>, name: string): void {
  wb.Workbook ??= {};
  wb.Workbook.Sheets ??= [];
  const idx = wb.SheetNames.indexOf(name);
  while (wb.Workbook.Sheets.length <= idx) wb.Workbook.Sheets.push({});
  wb.Workbook.Sheets[idx].Hidden = 1;
}

// ---- import ---------------------------------------------------------------

export function xlsxToRound(bytes: Uint8Array): Round {
  const wb = XLSX.read(bytes, { type: "array" });

  // Lossless path: our own hidden round JSON.
  const meta = wb.Sheets[META_SHEET];
  if (meta) {
    const rows = XLSX.utils.sheet_to_json<string[]>(meta, { header: 1 });
    if (rows[0]?.[0] === META_TAG) {
      const json = rows.slice(1).map((r) => r[0] ?? "").join("");
      try {
        return JSON.parse(json) as Round;
      } catch {
        /* fall through to grid parse */
      }
    }
  }

  // Verbatim-style grid parse.
  const sheets: Sheet[] = [];
  let speeches: Speech[] | null = null;
  for (const name of wb.SheetNames) {
    if (name === META_SHEET) continue;
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[name], {
      header: 1,
      blankrows: true,
    });
    if (aoa.length === 0) continue;
    const headers = (aoa[0] ?? []).map((h) => String(h ?? "").trim());
    if (!speeches) speeches = headers.map(headerToSpeech);
    const nCols = speeches.length;
    const rows = [];
    for (let r = 1; r < aoa.length; r++) {
      const row = makeRow(nCols);
      for (let c = 0; c < nCols; c++) {
        row.cells[c].text = String(aoa[r]?.[c] ?? "");
      }
      rows.push(row);
    }
    while (rows.length < INITIAL_ROWS) rows.push(makeRow(nCols));
    sheets.push({ id: uid(), title: name, kind: guessKind(name), startCol: 0, rows });
  }

  const template = { id: uid(), name: "Imported", speeches: speeches ?? [] };
  const now = Date.now();
  return {
    id: uid(),
    name: "Imported flow",
    tournament: "",
    opponent: "",
    judges: "",
    affTeam: "",
    negTeam: "",
    template,
    sheets: sheets.length ? sheets : [],
    createdAt: now,
    updatedAt: now,
  };
}

function headerToSpeech(abbr: string): Speech {
  const a = abbr.toLowerCase();
  const aff = /\b(1ac|2ac|1ar|2ar|ac|ar|aff|pro)\b/.test(a) || /^a/.test(a);
  const neg = /\b(1nc|2nc|1nr|2nr|nc|nr|neg|con|block)\b/.test(a);
  const side = neg ? "neg" : aff ? "aff" : "neutral";
  return { id: uid(), abbr: abbr || "?", label: abbr, side };
}

function guessKind(name: string): SheetKind {
  const n = name.toLowerCase();
  if (/off|da|cp|\bk\b|kritik|t-|topicality/.test(n)) return "offcase";
  if (/case|adv|advantage|1ac|aff/.test(n)) return "case";
  if (/overview|ov/.test(n)) return "overview";
  if (/cx|cross/.test(n)) return "cx";
  return "custom";
}
