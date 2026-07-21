// User macros are plain JavaScript with a `flow` API object — the same model
// as VBA in Excel or Apps Script in Sheets. Code runs at the cursor inside a
// single undo step.
//
//   flow.type("AT: ");
//   flow.insertBelow(4);
//   flow.down();

import type { Combo } from "./keymap";
import { store } from "./round.svelte";
import { uid } from "./types";

export interface Macro {
  id: string;
  name: string;
  combo: Combo | null;
  /** JavaScript source; receives the `flow` API object. */
  code: string;
}

export function defaultMacros(): Macro[] {
  return [
    {
      id: uid(),
      name: "Example: answer block",
      combo: null,
      code: `// Set up an "AT:" answer block at the cursor
flow.type("AT: ");
flow.insertBelow(4);
flow.down();`,
    },
  ];
}

const clampN = (n: unknown) =>
  Math.min(1000, Math.max(1, Math.floor(Number(n) || 1)));

/** The API surface handed to macro code as `flow`. */
function makeFlowApi() {
  const cell = () => {
    const cur = store.cursor;
    const sheet = store.activeSheet;
    if (!cur || !sheet) return null;
    return sheet.rows[cur.row]?.cells[cur.col] ?? null;
  };
  return {
    // --- cursor ---
    cursor: () => (store.cursor ? { ...store.cursor } : null),
    goto: (row: number, col: number) => {
      store.ensureRows(clampN(row + 1) - 1);
      const cur = store.cursor ?? { row: 0, col: 0 };
      store.cursor = { row: Math.max(0, Math.floor(row)), col: cur.col };
      store.moveCursor(0, Math.floor(col) - cur.col);
    },
    down: (n = 1) => store.moveCursor(clampN(n), 0),
    up: (n = 1) => store.moveCursor(-clampN(n), 0),
    left: (n = 1) => store.moveCursor(0, -clampN(n)),
    right: (n = 1) => store.moveCursor(0, clampN(n)),
    /** Last row in the current column with text, or -1 if empty. */
    bottom: () => {
      const cur = store.cursor;
      const sheet = store.activeSheet;
      if (!cur || !sheet) return -1;
      return sheet.rows.findLastIndex((r) => r.cells[cur.col]?.text.trim());
    },

    // --- rows ---
    insertBelow: (n = 1) => {
      for (let i = 0; i < clampN(n); i++) {
        const cur = store.cursor;
        if (cur) store.insertRow(cur.row + 1);
      }
    },
    insertAbove: (n = 1) => {
      for (let i = 0; i < clampN(n); i++) {
        const cur = store.cursor;
        if (!cur) return;
        store.insertRow(cur.row);
        store.cursor = { row: cur.row + 1, col: cur.col };
      }
    },
    deleteRow: () => {
      const cur = store.cursor;
      if (cur) store.deleteRow(cur.row);
    },
    rowCount: () => store.activeSheet?.rows.length ?? 0,
    colCount: () => store.nCols,

    // --- cell content ---
    getText: () => cell()?.text ?? "",
    setText: (text: unknown) => {
      const cur = store.cursor;
      if (cur) store.setCell(cur.row, cur.col, String(text ?? ""));
    },
    type: (text: unknown) => {
      const cur = store.cursor;
      const c = cell();
      if (cur && c) store.setCell(cur.row, cur.col, c.text + String(text ?? ""));
    },
    clear: () => {
      const cur = store.cursor;
      if (cur) store.setCell(cur.row, cur.col, "");
    },

    // --- marks ---
    dropped: () => {
      const cur = store.cursor;
      if (cur) store.toggleMark(cur.row, cur.col, "dropped");
    },
    star: () => {
      const cur = store.cursor;
      if (cur) store.toggleMark(cur.row, cur.col, "starred");
    },
    analytic: () => {
      const cur = store.cursor;
      if (cur) store.toggleEvidence(cur.row, cur.col, "analytic");
    },
    card: () => {
      const cur = store.cursor;
      if (cur) store.toggleEvidence(cur.row, cur.col, "card");
    },

    // --- sheet ---
    sheetName: () => store.activeSheet?.title ?? "",
  };
}

export type FlowApi = ReturnType<typeof makeFlowApi>;

/** Syntax-check macro code. Returns an error message or null if it compiles. */
export function validateMacroCode(code: string): string | null {
  try {
    new Function("flow", `"use strict";\n${code}`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Execute a macro as one undo step. Returns a runtime error message or null. */
export function runMacro(macro: Macro): string | null {
  let error: string | null = null;
  store.runBatch(() => {
    try {
      const fn = new Function("flow", `"use strict";\n${macro.code}`);
      fn(makeFlowApi());
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });
  if (error) console.error(`Macro "${macro.name}" failed:`, error);
  return error;
}

// ---- migration from the old step-list macro format -----------------------

interface LegacyStep {
  kind: string;
  count?: number;
  text?: string;
}

const LEGACY_TO_JS: Record<string, (s: LegacyStep) => string> = {
  insertRowBelow: (s) => `flow.insertBelow(${s.count ?? 1});`,
  insertRowAbove: (s) => `flow.insertAbove(${s.count ?? 1});`,
  deleteRow: () => `flow.deleteRow();`,
  moveDown: (s) => `flow.down(${s.count ?? 1});`,
  moveUp: (s) => `flow.up(${s.count ?? 1});`,
  moveLeft: (s) => `flow.left(${s.count ?? 1});`,
  moveRight: (s) => `flow.right(${s.count ?? 1});`,
  typeText: (s) => `flow.type(${JSON.stringify(s.text ?? "")});`,
  markDropped: () => `flow.dropped();`,
  markStarred: () => `flow.star();`,
};

export function migrateLegacyMacro(raw: unknown): Macro | null {
  const m = raw as Partial<Macro> & { steps?: LegacyStep[] };
  if (typeof m.code === "string") return m as Macro;
  if (!Array.isArray(m.steps)) return null;
  // The old built-in 3-row macros are now regular keybinds — drop them.
  if (/^Insert 3 rows (below|above)$/.test(m.name ?? "")) return null;
  const code = m.steps
    .map((s) => LEGACY_TO_JS[s.kind]?.(s))
    .filter(Boolean)
    .join("\n");
  return {
    id: m.id ?? uid(),
    name: m.name ?? "Migrated macro",
    combo: m.combo ?? null,
    code,
  };
}
