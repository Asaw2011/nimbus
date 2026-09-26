// CardMirror native files (.cmir) - read into the same heading tree a .docx
// parses to, so the Ctrl+K library and the smart-blocks kit treat both alike.
//
// A .cmir is a JSON envelope `{ format: "cardmirror-doc", formatVersion, doc }`
// whose `doc` is ProseMirror doc JSON in CardMirror's schema - gzip-compressed
// on disk (magic 1F 8B), or plain JSON in older files (begins with `{`). See
// CardMirror's src/native/index.ts.
//
// ⚠ Read as RAW JSON, never through `schema.nodeFromJSON`: that throws on any
// node or mark type the vendored schema doesn't know, so a file written by a
// newer CardMirror would stop opening. Walking the JSON only needs the handful
// of types that carry structure; anything unknown is still read for its text.

import { gunzipSync, strFromU8 } from "fflate";
import { parseDocx, extractHeadings, type DocNode, type DocRun, type ParsedDoc } from "./parse";

const FORMAT_ID = "cardmirror-doc";

export interface PMJson {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PMJson[];
}

/** One paragraph of the doc in reading order - what a docx `w:p` is. */
interface Para {
  /** 1–4 for a heading, null for body text. */
  level: number | null;
  analytic: boolean;
  runs: DocRun[];
}

const HEADING_LEVEL: Record<string, number> = { pocket: 1, hat: 2, block: 3, tag: 4 };

/** Wrapper nodes whose children are ordinary doc-level blocks (live zones). */
const CONTAINERS = new Set(["doc", "transclusion_ref", "self_ref"]);

/** True for a .cmir by its bytes: a .docx is a zip and starts with "PK". */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** The PM doc JSON inside a .cmir. Throws a readable error for anything else. */
export function readCmirDoc(buf: ArrayBuffer): PMJson {
  const bytes = new Uint8Array(buf);
  if (!bytes.length) throw new Error("The file is empty (is it still downloading?)");
  let file: { format?: unknown; doc?: unknown };
  try {
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    file = JSON.parse(strFromU8(raw));
  } catch {
    throw new Error("Not a CardMirror file");
  }
  if (!file || file.format !== FORMAT_ID || typeof file.doc !== "object" || !file.doc) {
    throw new Error("Not a CardMirror file");
  }
  return file.doc as PMJson;
}

/**
 * The doc's top-level blocks with live zones unwrapped - CardMirror keeps a
 * zone's snapshot inside it, and to anything reading the doc those are just
 * more blocks in place. What Ctrl+K cuts a card or block out of.
 */
export function cmirTopLevel(doc: PMJson): PMJson[] {
  const out: PMJson[] = [];
  const walk = (ns: PMJson[] | undefined) => {
    for (const n of ns ?? []) {
      if (CONTAINERS.has(n.type)) walk(n.content);
      else out.push(n);
    }
  };
  walk(doc.content);
  return out;
}

/** A paragraph's inline content → runs. The inverse of the adapter's marks. */
function runsOf(p: PMJson): DocRun[] {
  const runs: DocRun[] = [];
  for (const c of p.content ?? []) {
    if (c.type === "hard_break") {
      runs.push({ text: " " });
      continue;
    }
    if (c.type !== "text" || !c.text) continue;
    const run: DocRun = { text: c.text };
    for (const m of c.marks ?? []) {
      switch (m.type) {
        case "highlight":
          if (typeof m.attrs?.color === "string") run.hl = m.attrs.color;
          break;
        case "underline_mark":
        case "underline_direct":
          run.u = true;
          break;
        case "emphasis_mark":
          run.emph = true;
          break;
        case "cite_mark":
          run.cite = true;
          break;
        case "bold":
          run.b = true;
          break;
        case "italic":
          run.i = true;
          break;
        case "font_size": {
          const hp = Number(m.attrs?.halfPoints);
          if (Number.isFinite(hp)) run.sz = hp;
          break;
        }
      }
    }
    // After every mark is read - marks come in any order. Same rule as parseDocx.
    if (run.sz !== undefined && run.sz <= 16 && !run.u && !run.hl && !run.cite && !run.emph) run.sm = true;
    runs.push(run);
  }
  return runs;
}

const hasInline = (n: PMJson) => (n.content ?? []).some((c) => c.type === "text" || c.type === "hard_break");

/** Flatten the doc into paragraphs in reading order, like a docx's `w:p`s. */
function paragraphs(doc: PMJson): Para[] {
  const out: Para[] = [];
  const body = (n: PMJson) => out.push({ level: null, analytic: false, runs: runsOf(n) });
  // A card's or analytic's body: paragraphs, and tables cell by cell (a docx
  // table's paragraphs are body paragraphs too).
  const bodyBlock = (n: PMJson) => {
    if (n.type === "table" || !hasInline(n)) {
      for (const c of n.content ?? []) bodyBlock(c);
    } else body(n);
  };
  const block = (n: PMJson) => {
    const level = HEADING_LEVEL[n.type];
    if (level) {
      out.push({ level, analytic: false, runs: runsOf(n) });
      return;
    }
    switch (n.type) {
      case "analytic":
        out.push({ level: 4, analytic: true, runs: runsOf(n) });
        return;
      case "card":
      case "analytic_unit": {
        const [head, ...rest] = n.content ?? [];
        if (head) block(head);
        rest.forEach(bodyBlock);
        return;
      }
    }
    if (CONTAINERS.has(n.type) || !hasInline(n)) (n.content ?? []).forEach(block);
    else body(n);
  };
  block(doc);
  return out;
}

/** Parse a .cmir into the heading tree - the same shape `parseDocx` returns. */
export function parseCmir(buf: ArrayBuffer): ParsedDoc {
  const roots: DocNode[] = [];
  const stack: DocNode[] = [];
  let paragraphCount = 0;
  let headingCount = 0;
  for (const p of paragraphs(readCmirDoc(buf))) {
    paragraphCount++;
    const text = p.runs.map((r) => r.text).join("");
    if (!text.trim()) continue;
    if (p.level === null) {
      const top = stack[stack.length - 1];
      if (top) {
        top.body.push(text.trim());
        top.bodyRuns.push(p.runs);
      }
      continue;
    }
    headingCount++;
    const node: DocNode = {
      level: p.level,
      text: text.trim(),
      runs: p.runs,
      children: [],
      body: [],
      bodyRuns: [],
      ...(p.analytic ? { isAnalytic: true } : {}),
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= p.level) stack.pop();
    (stack[stack.length - 1]?.children ?? roots).push(node);
    stack.push(node);
  }
  return { nodes: roots, paragraphCount, headingCount };
}

/** Headings only, for the content index - the .cmir twin of `extractHeadings`. */
export function extractCmirHeadings(buf: ArrayBuffer): Array<{ text: string; level: number; analytic: boolean }> {
  const out: Array<{ text: string; level: number; analytic: boolean }> = [];
  for (const p of paragraphs(readCmirDoc(buf))) {
    if (p.level === null) continue;
    const text = p.runs.map((r) => r.text).join("").trim();
    if (text) out.push({ text, level: p.level, analytic: p.analytic });
  }
  return out;
}

/** Parse either kind of speech doc, told apart by its bytes, not its name. */
export function parseSpeechDoc(buf: ArrayBuffer): ParsedDoc {
  return isZip(new Uint8Array(buf)) ? parseDocx(buf) : parseCmir(buf);
}

/** `extractHeadings` for either kind of speech doc. */
export function extractSpeechDocHeadings(buf: ArrayBuffer): Array<{ text: string; level: number; analytic: boolean }> {
  return isZip(new Uint8Array(buf)) ? extractHeadings(buf) : extractCmirHeadings(buf);
}

/** File extensions the library and the kit read as speech docs. */
export const SPEECH_DOC_EXT = /\.(docx|cmir)$/i;
