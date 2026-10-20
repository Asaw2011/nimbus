// The guided tour's practice round. Starts blank, you fill it from the free
// Midterms DA file with ⌘K. Never saved; thrown away when the tour ends.

import { store } from "./round.svelte";
import { policyTemplate } from "./templates";
import { makeSheet, INITIAL_ROWS } from "./types";
import { smartKit } from "../smart/kit.svelte";

export async function openPracticeRound(): Promise<void> {
  const template = policyTemplate();
  store.newRound(template, "Tour Practice");
  const r = store.round;
  if (!r) return;
  store.scratchId = r.id;
  r.affTeam = "Aff";
  r.negTeam = "Neg";
  // one off-case page at the 1NC, cursor parked right under the label
  const sheet = makeSheet("Midterms DA", template.speeches.length, "offcase", 1, INITIAL_ROWS);
  sheet.rows[0].cells[1].text = "Midterms DA";
  r.sheets = [sheet];
  store.activeSheetId = sheet.id;
  store.cursor = { row: 1, col: 1 };
  // same file goes in the Smart kit so that step has real blocks to show
  try {
    const res = await fetch("/samples/midterms-da.docx");
    if (!res.ok) return;
    const file = new File([await res.arrayBuffer()], "Midterms DA.docx");
    await smartKit.attach(r.id);
    await smartKit.addDropped([file]);
  } catch {
    // kit is a nicety, never block the tour on it
  }
}

/** Drop the practice round if it's the one open. Returns true if it was. */
export function closePracticeRound(): boolean {
  const open = !!store.round && store.round.id === store.scratchId;
  if (open) store.round = null;
  store.scratchId = "";
  return open;
}
