// A speech doc as CardMirror's own document (ProseMirror JSON), and the exact
// nodes for one heading or card in it. What a flow cell keeps in `cmNode` so a
// later tilde / Send to Doc reproduces the card EXACTLY - tables, images and
// all - instead of rebuilding it from the DocNode outline, which flattens a
// table into one paragraph per table cell.
//
// Same logic as Doc Search's getCMDocJSON / extractCMNodes (DocSearch.svelte),
// shared here for Smart blocks; Doc Search keeps its own copy untouched.

import { cmirTopLevel, readCmirDoc } from "./cmir";

export interface CMDoc {
  type: string;
  content?: unknown[];
}

/** A .docx (via CardMirror's fromDocx) or .cmir as CardMirror doc JSON; null
 *  when it can't be read or doesn't pass our schema (then the DocNode adapter
 *  is used, as before). */
export async function cmDocFromBytes(buf: ArrayBuffer, isCmir: boolean): Promise<CMDoc | null> {
  try {
    let json: CMDoc;
    if (isCmir) {
      const { schema } = await import("$lib/cardmirror");
      json = { type: "doc", content: cmirTopLevel(readCmirDoc(buf)) };
      schema.nodeFromJSON(json).check();
    } else {
      json = await docxInWorker(buf);
    }
    cleanWhitespaceMarks(json);
    return json;
  } catch (err) {
    console.error("cmDocFromBytes failed", err);
    return null;
  }
}

// ---- fromDocx in a worker ----------------------------------------------------
// A big .docx is one multi-second task; in a worker the window stays live.
// If a worker can't be made (or dies), the same work runs here instead - slower
// to the eye, never wrong.

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (d: CMDoc) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./cmExact.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; json?: CMDoc; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.json) p.resolve(e.data.json);
      else p.reject(new Error(e.data.error ?? "fromDocx failed"));
    };
    worker.onerror = () => {
      // The worker itself died: fail what's waiting, stop using it.
      workerBroken = true;
      worker = null;
      for (const p of pending.values()) p.reject(new Error("worker failed"));
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function docxOnMainThread(buf: ArrayBuffer): Promise<CMDoc> {
  const { fromDocx } = await import("$lib/cardmirror");
  return (await fromDocx(new Uint8Array(buf))).toJSON() as CMDoc;
}

async function docxInWorker(buf: ArrayBuffer): Promise<CMDoc> {
  const w = getWorker();
  if (!w) return docxOnMainThread(buf);
  const id = nextId++;
  try {
    return await new Promise<CMDoc>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, buf });
    });
  } catch {
    return docxOnMainThread(buf);
  }
}

/** In place: a boxed/emphasised space renders as an empty box - strip those
 *  marks from whitespace-only runs, leave everything else as CardMirror made it. */
function cleanWhitespaceMarks(node: unknown): void {
  const o = node as { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] };
  if (o.type === "text" && o.marks && !(o.text ?? "").trim()) {
    o.marks = o.marks.filter((m) => m.type !== "emphasis_mark" && m.type !== "bold");
  }
  if (Array.isArray(o.content)) o.content.forEach(cleanWhitespaceMarks);
}

/** Level of a CardMirror top-level node (pocket=1 … card/analytic=4). */
function cmLevel(n: { type: string }): number {
  return ({ pocket: 1, hat: 2, block: 3, card: 4, analytic_unit: 4, tag: 4 } as Record<string, number>)[n.type] ?? 5;
}

function cmLabel(n: { type: string; content?: unknown[] }): string {
  const flat = (node: unknown): string => {
    const o = node as { text?: string; content?: unknown[] };
    if (o.text) return o.text;
    return (o.content ?? []).map(flat).join("");
  };
  if ((n.type === "card" || n.type === "analytic_unit") && n.content?.length) return flat(n.content[0]);
  return flat(n);
}

/** The nodes for a heading (it and everything under it) or a single card,
 *  found by its label and level. [] when it isn't there. */
export function extractCMNodes(doc: CMDoc, label: string, level: number): unknown[] {
  const tops = (doc.content ?? []) as { type: string; content?: unknown[] }[];
  const target = label.trim();
  let start = -1;
  for (let i = 0; i < tops.length; i++) {
    if (cmLevel(tops[i]) === level && cmLabel(tops[i]).trim() === target) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  if (level >= 4) return [tops[start]];
  let end = start + 1;
  while (end < tops.length && cmLevel(tops[end]) > level) end++;
  return tops.slice(start, end);
}
