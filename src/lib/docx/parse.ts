// DOCX-IMPORT feature (self-contained; delete this folder + the marked block
// in RoundHome.svelte + `npm uninstall fflate` to remove it entirely).
//
// Parses debate speech docs. A .docx is a zip; word/document.xml holds
// paragraphs whose Heading1–4 styles follow the Verbatim conventions the
// whole activity uses: H1 = Pocket, H2 = Hat, H3 = Block, H4 = card tag.

import { unzipSync, strFromU8 } from "fflate";

/**
 * A single formatting run inside a card body paragraph. Debate cards are
 * defined by their run-level formatting — the highlighted words are what's
 * read aloud, underlined words are the "cut", bold words are emphasis, and
 * tiny (≤8pt) words are unread context. Flattening this to plain text (the
 * old behaviour) destroys the card. We preserve it.
 */
export interface DocRun {
  text: string;
  /** Underlined (the cut) */
  u?: boolean;
  /** Bold / Emphasis (power words) */
  b?: boolean;
  /** Highlight colour as a CSS value (the spoken/read-aloud portion) */
  hl?: string;
  /** Small / condensed unread context (≤8pt, no highlight/underline) */
  sm?: boolean;
}

export interface DocNode {
  /** 1–4 = Heading level (Pocket/Hat/Block/Tag) */
  level: number;
  text: string;
  children: DocNode[];
  /** Non-heading paragraphs under this heading, as plain text (card body/cite) */
  body: string[];
  /** Same paragraphs, but with run-level formatting preserved. */
  bodyRuns: DocRun[][];
}

export interface ParsedDoc {
  nodes: DocNode[];
  paragraphCount: number;
  headingCount: number;
}

// Word highlight names → CSS colours (the actual highlighter colours debaters
// use). Shading fills (w:shd) come through as raw hex.
const HIGHLIGHT_CSS: Record<string, string> = {
  yellow: "#fff35c",
  green: "#7bff7b",
  cyan: "#68e5ff",
  magenta: "#ff7bec",
  blue: "#8ab6ff",
  red: "#ff8080",
  darkyellow: "#d8c200",
  darkgreen: "#57c257",
  darkcyan: "#4fb8cc",
  darkblue: "#6f9de0",
  darkred: "#e06666",
  darkmagenta: "#d06fbf",
  lightgray: "#d9d9d9",
  darkgray: "#b0b0b0",
};

function firstChild(el: Element | null, local: string): Element | null {
  if (!el) return null;
  for (const child of Array.from(el.children)) {
    if (child.localName === local) return child;
  }
  return null;
}

function attrVal(el: Element | null, local: string): string | null {
  if (!el) return null;
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === local) return attr.value;
  }
  return null;
}

/** Extract the styled runs of a paragraph, preserving card formatting. */
function extractRuns(p: Element): DocRun[] {
  const runs: DocRun[] = [];
  const rEls = p.getElementsByTagNameNS("*", "r");
  for (const r of Array.from(rEls)) {
    let text = "";
    for (const t of Array.from(r.getElementsByTagNameNS("*", "t"))) {
      text += t.textContent ?? "";
    }
    if (r.getElementsByTagNameNS("*", "tab").length) text += "\t";
    if (!text) continue;

    const run: DocRun = { text };
    const rPr = firstChild(r, "rPr");
    if (rPr) {
      const rStyle = (attrVal(firstChild(rPr, "rStyle"), "val") ?? "").toLowerCase();

      // Underline: direct w:u (not "none") or an underline character style
      const uEl = firstChild(rPr, "u");
      const uVal = attrVal(uEl, "val");
      const hasU = (!!uEl && uVal !== "none") || rStyle.includes("underline");

      // Bold / emphasis: direct w:b (not off) or emphasis/cite character styles
      const bEl = firstChild(rPr, "b");
      const bVal = attrVal(bEl, "val");
      const hasB =
        (!!bEl && bVal !== "0" && bVal !== "false") ||
        rStyle === "emphasis" ||
        rStyle.includes("cite") ||
        rStyle.includes("13ptbold");

      // Highlight (spoken) — w:highlight name or w:shd fill
      const hlVal = attrVal(firstChild(rPr, "highlight"), "val");
      const shdFill = attrVal(firstChild(rPr, "shd"), "fill");
      let hl: string | undefined;
      if (hlVal && hlVal !== "none") {
        hl = HIGHLIGHT_CSS[hlVal.toLowerCase()] ?? hlVal;
      } else if (shdFill && shdFill !== "auto" && shdFill.toUpperCase() !== "FFFFFF") {
        hl = "#" + shdFill;
      }

      // Font size (half-points). ≤16 (8pt) with no highlight/underline = unread.
      const szVal = attrVal(firstChild(rPr, "sz"), "val");
      const sz = szVal ? parseInt(szVal, 10) : undefined;

      if (hasU) run.u = true;
      if (hasB) run.b = true;
      if (hl) run.hl = hl;
      if (sz !== undefined && sz <= 16 && !hasU && !hl) run.sm = true;
    }
    runs.push(run);
  }
  return runs;
}

const HEADING_RE = /^Heading([1-6])$/i;

// Verbatim (and most debate-doc templates) use custom paragraph styles instead
// of Word's built-in Heading1-4. Map style name → hierarchy level so these docs
// parse the same way standard heading docs do.
const VERBATIM_STYLE_LEVEL: Record<string, number> = {
  pocket: 1,
  hat: 2,
  block: 3,
  tag: 4,
  // common variants found in the wild
  "pocket heading": 1,
  "hat heading": 2,
  "block heading": 3,
  "tag heading": 4,
  pocketheading: 1,
  hatheading: 2,
  blockheading: 3,
  tagheading: 4,
};

export function parseDocx(buf: ArrayBuffer): ParsedDoc {
  const files = unzipSync(new Uint8Array(buf));
  const docXml = files["word/document.xml"];
  if (!docXml) throw new Error("No word/document.xml — is this a .docx?");
  const xml = new DOMParser().parseFromString(strFromU8(docXml), "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("Couldn't parse the document XML.");
  }

  const roots: DocNode[] = [];
  const stack: DocNode[] = [];
  let paragraphCount = 0;
  let headingCount = 0;

  const paragraphs = xml.getElementsByTagNameNS("*", "p");
  for (const p of Array.from(paragraphs)) {
    paragraphCount++;
    const text = paragraphText(p);
    if (!text.trim()) continue;

    const level = headingLevel(p);
    if (level === null) {
      // Body text belongs to the deepest open heading — keep both the plain
      // text (for the flow) and the styled runs (for the speech doc).
      const top = stack[stack.length - 1];
      if (top) {
        top.body.push(text.trim());
        top.bodyRuns.push(extractRuns(p));
      }
      continue;
    }
    headingCount++;
    const node: DocNode = { level, text: text.trim(), children: [], body: [], bodyRuns: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    (stack[stack.length - 1]?.children ?? roots).push(node);
    stack.push(node);
  }

  return { nodes: roots, paragraphCount, headingCount };
}

function headingLevel(p: Element): number | null {
  const styles = p.getElementsByTagNameNS("*", "pStyle");
  for (const s of styles) {
    for (const attr of s.attributes) {
      if (attr.localName === "val") {
        // Standard Word headings (Heading1–6)
        const m = attr.value.match(HEADING_RE);
        if (m) return Number(m[1]);
        // Verbatim / debate-doc custom styles (Pocket, Hat, Block, Tag)
        const verbatim = VERBATIM_STYLE_LEVEL[attr.value.toLowerCase().trim()];
        if (verbatim) return verbatim;
      }
    }
  }
  return null;
}

function paragraphText(p: Element): string {
  let out = "";
  for (const t of p.getElementsByTagNameNS("*", "t")) {
    out += t.textContent ?? "";
  }
  return out;
}

/** Flatten a top-level node into flowable lines (its heading descendants, in order). */
export function flowLines(node: DocNode): string[] {
  const lines: string[] = [];
  const walk = (n: DocNode) => {
    for (const child of n.children) {
      lines.push(child.text);
      walk(child);
    }
  };
  walk(node);
  return lines;
}

// ---- matching answer docs to existing sheets ------------------------------
// A 2AC doc says "AT: Cap K" / "A2 Econ DA" — strip the answer prefixes and
// fuzzy-match against existing sheet titles so answers land on the right flow.

const ANSWER_PREFIX_RE =
  /\b(at|a2|ans(wers?)? ?(to)?|1ar|2ac|2nr|nr|nc)\b[:.\s—–-]*/gi;

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(ANSWER_PREFIX_RE, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-matching sheet id for a doc section title, or null if nothing is
 * close enough. Token overlap with a substring bonus.
 */
export function guessTargetSheet(
  title: string,
  sheets: Array<{ id: string; title: string }>,
): string | null {
  const n = normalizeTitle(title);
  if (!n) return null;
  const nTokens = new Set(n.split(" "));
  let bestId: string | null = null;
  let bestScore = 0;
  for (const sheet of sheets) {
    const s = normalizeTitle(sheet.title);
    if (!s) continue;
    const sTokens = new Set(s.split(" "));
    let overlap = 0;
    for (const t of nTokens) if (sTokens.has(t)) overlap++;
    let score = overlap / Math.max(1, Math.min(nTokens.size, sTokens.size));
    if (n.includes(s) || s.includes(n)) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestId = sheet.id;
    }
  }
  return bestScore >= 0.5 ? bestId : null;
}
