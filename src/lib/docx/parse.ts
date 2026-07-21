// DOCX-IMPORT feature (self-contained; delete this folder + the marked block
// in RoundHome.svelte + `npm uninstall fflate` to remove it entirely).
//
// Parses debate speech docs. A .docx is a zip; word/document.xml holds
// paragraphs whose Heading1–4 styles follow the Verbatim conventions the
// whole activity uses: H1 = Pocket, H2 = Hat, H3 = Block, H4 = card tag.

import { unzipSync, strFromU8 } from "fflate";

export interface DocNode {
  /** 1–4 = Heading level (Pocket/Hat/Block/Tag) */
  level: number;
  text: string;
  children: DocNode[];
  /** Non-heading paragraphs under this heading (card body/cite) */
  body: string[];
}

export interface ParsedDoc {
  nodes: DocNode[];
  paragraphCount: number;
  headingCount: number;
}

const HEADING_RE = /^Heading([1-6])$/i;

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
  for (const p of paragraphs) {
    paragraphCount++;
    const text = paragraphText(p);
    if (!text.trim()) continue;

    const level = headingLevel(p);
    if (level === null) {
      // Body text belongs to the deepest open heading.
      stack[stack.length - 1]?.body.push(text.trim());
      continue;
    }
    headingCount++;
    const node: DocNode = { level, text: text.trim(), children: [], body: [] };
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
        const m = attr.value.match(HEADING_RE);
        if (m) return Number(m[1]);
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
