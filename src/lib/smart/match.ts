// Smart blocks — matching (LAB). Pure functions, no store, no I/O.
//
// Two questions, both answered from the Verbatim heading tree `parseDocx`
// already builds:
//
//  1. Which kit FILE does a sheet belong to? Real files are one position each
//     ("CP---India---Rory", "DA_Midterms (Mahedhar, MBA)"), so a sheet titled
//     "India CP" links to one file and only that file's blocks are suggested.
//     That is what keeps two CPs' "AT: Perm" blocks apart.
//  2. Which BLOCKS answer what the opponent just said? Blocks are the headings
//     that hold cards ("Solvency---AT: Say No---2NC", "Perm: Do Both---2NC"),
//     compared by canonical tokens with the "---2NC"/"AT:"/"Ext" noise removed.
//
// ⚠ Deliberately no AI here. It is fast, offline, free, and cannot invent a
// block that doesn't exist. Where it misses is what the local log is for.

import type { DocNode } from "$lib/docx/parse";

export interface KitBlock {
  /** Stable within one parse: `${file}#${n}`. */
  id: string;
  /** The kit file this block came from (its path). */
  file: string;
  /** The heading text exactly as written. */
  title: string;
  /** Ancestor headings, outermost first ("Uniqueness", "Answers"). */
  trail: string[];
  /** The same ancestors as nodes — how a block is scoped to one section. */
  anc: DocNode[];
  node: DocNode;
  cardCount: number;
  tokens: string[];
  /**
   * Just what the block ANSWERS — the part after its last "AT:"/"A2" ("Humanism
   * K---AT: Permutation---2NC" → perm). The prefix is context, and scoring only
   * the whole title let it drown the answer. Same as `tokens` when there is no
   * "AT:".
   */
  core: string[];
  /** Headed as an answer ("AT:", "A2", "Perm:"), which is what we want most. */
  answer: boolean;
  /** Old / extension-only material — still offered, ranked lower. */
  weak: boolean;
}

export interface BlockMatch {
  block: KitBlock;
  score: number;
}

// ---- tokens -----------------------------------------------------------------

const SPEECH = /^(1ac|2ac|1nc|2nc|1nr|2nr|1ar|2ar|nc|nr|ac|ar|cx)$/;

const STOP = new Set([
  "at", "a2", "ans", "answer", "answers", "to", "the", "a", "an", "of", "and",
  "or", "in", "on", "for", "is", "are", "be", "will", "it", "its", "that",
  "this", "with", "by", "vs", "v", "ext", "exts", "extension", "extensions",
  "card", "cards", "block", "blocks", "main", "new", "old", "frontline",
]);

/** Spellings debaters use interchangeably, folded to one token. */
const CANON: Record<string, string> = {
  uniqueness: "uq", u: "uq", uq: "uq",
  solvency: "solv", solve: "solv", solves: "solv", solv: "solv",
  permutation: "perm", perm: "perm",
  democrats: "dem", democrat: "dem", dems: "dem", dem: "dem",
  republicans: "gop", republican: "gop", reps: "gop", gop: "gop",
  hegemony: "heg", heg: "heg",
  economy: "econ", economic: "econ", econ: "econ",
  counterplan: "cp", cp: "cp",
  disadvantage: "da", disad: "da", da: "da",
  topicality: "t",
  kritik: "k",
  impacts: "impact", impact: "impact",
  links: "link", link: "link",
  il: "internal",
  conditionality: "condo", condo: "condo",
  politics: "ptx", ptx: "ptx",
  midterms: "midterm", midterm: "midterm",
  nuclear: "nuke", nukes: "nuke",
  federal: "usfg", usfg: "usfg", fg: "usfg",
};

/** Opposites count as a partial match: "dome bad" should still find "Dome Good". */
const OPPOSITE: Record<string, string> = {
  good: "bad", bad: "good", true: "false", false: "true", high: "low",
  low: "high", up: "down", down: "up", win: "lose", lose: "win",
  strong: "weak", weak: "strong", yes: "no", no: "yes",
};

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Canonical content tokens. Speech markers, years and filler are dropped. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw) || SPEECH.test(raw) || /^\d+$/.test(raw)) continue;
    const w = CANON[raw] ?? CANON[stem(raw)] ?? stem(raw);
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

// ---- blocks -------------------------------------------------------------------

const isCard = (n: DocNode) => n.isAnalytic || n.level >= 4;

/** Every card/analytic beneath a heading — the same walk Doc Search inserts with. */
export function cardsUnder(node: DocNode): DocNode[] {
  const out: DocNode[] = [];
  const walk = (ns: DocNode[]) => {
    for (const n of ns) {
      if (isCard(n)) out.push(n);
      else walk(n.children);
    }
  };
  walk(node.children);
  return out;
}

/**
 * The answerable blocks in one file: every heading that directly holds cards.
 *
 * ⚠ 1AC/1NC shells are left out. They are what you READ, not what you answer
 * with — "OFF---1NC" is the midterms shell, and suggesting it in reply to the
 * 2AC would be wrong every time.
 */
export function indexBlocks(file: string, roots: DocNode[]): KitBlock[] {
  const out: KitBlock[] = [];
  const walk = (ns: DocNode[], anc: DocNode[]) => {
    const trail = anc.map((a) => a.text);
    for (const n of ns) {
      if (isCard(n)) continue;
      if (n.children.some(isCard)) {
        const lower = n.text.toLowerCase();
        const shell = /(^|[^a-z0-9])(1nc|1ac)([^a-z0-9]|$)/.test(lower);
        if (!shell) {
          out.push({
            id: `${file}#${out.length}`,
            file,
            title: n.text,
            trail,
            anc,
            node: n,
            cardCount: cardsUnder(n).length,
            tokens: tokens(n.text),
            core: coreTokens(n.text),
            answer: /(^|[^a-z])(at|a2)\b|perm/i.test(n.text),
            weak: /(^|[^a-z])(old|ext)([^a-z]|$)/i.test(n.text),
          });
        }
      }
      walk(n.children, [...anc, n]);
    }
  };
  walk(roots, []);
  return out;
}

function coreTokens(title: string): string[] {
  const m = title.match(/.*(?:^|[^a-z0-9])(?:at|a2)\s*[:\-–—]?\s*(.+)$/i);
  const core = m ? tokens(m[1]) : [];
  return core.length ? core : tokens(title);
}

/** How well a block's token list answers the query's; 0 when it doesn't. */
function scoreAgainst(q: string[], b: string[]): number {
  if (!b.length) return 0;
  let hit = 0;
  let exact = 0;
  for (const t of q) {
    if (b.includes(t)) {
      hit += 1;
      exact += 1;
    } else if (OPPOSITE[t] && b.includes(OPPOSITE[t])) {
      hit += 0.75;
    }
  }
  if (!exact) return 0; // an opposite alone ("bad") is not a topic match
  // The last term is how much of what they SAID the block covers — without it
  // a one-word block ("UQ---2NR") ties with "AT: UQ Overwhelms".
  return 0.5 * (hit / Math.min(q.length, b.length)) + 0.25 * (hit / b.length) + 0.25 * (hit / q.length);
}

/**
 * Blocks that could answer `said`, best first.
 *
 * Score is mostly overlap measured against the SHORTER side (so a whole tagline
 * still finds a three-word block), blended with how much of the block was
 * matched (so "Perm: Do Both" beats "Perm: Do CP" for "perm do both") and how
 * much of the query was. Answer-shaped blocks get a small lift; OLD/Ext ones a
 * small drop.
 */
export function matchBlocks(said: string, blocks: KitBlock[], limit = 3): BlockMatch[] {
  const q = tokens(said);
  if (!q.length) return [];
  const out: BlockMatch[] = [];
  for (const block of blocks) {
    let score = Math.max(scoreAgainst(q, block.tokens), scoreAgainst(q, block.core));
    if (!score) continue;
    // Named EXACTLY what they said ("States CP" → "States CP---2AC"): that is
    // the frontline, and it must beat "States CP---AT: UCF", whose answer
    // lift would otherwise put it on top.
    if (block.tokens.length === q.length && q.every((t) => block.tokens.includes(t))) score += 0.2;
    if (block.answer) score += 0.1;
    if (block.weak) score *= 0.75;
    if (score >= 0.45) out.push({ block, score });
  }
  out.sort((a, b) => b.score - a.score || a.block.title.length - b.block.title.length);
  return out.slice(0, limit);
}

// ---- sheet → file -------------------------------------------------------------

/** Words that say what KIND of position something is, not WHICH one. */
const KIND = new Set(["cp", "da", "k", "t", "adv", "advantage", "case", "off", "neg", "aff", "file"]);

/**
 * The section of a multi-position file a sheet belongs to — "Public Option CP"
 * → `CP---Public Option` in an aff master file — or null.
 *
 * Only pockets and hats are candidates (where positions live), with the same
 * "more than a kind marker" rule as file linking. A tie goes to the DEEPER
 * heading: `CP---Process` beats its parent `Counterplans---Process`.
 */
export function guessSection(sheetTitle: string, roots: DocNode[]): DocNode | null {
  const s = tokens(sheetTitle);
  if (!s.length) return null;
  let best: DocNode | null = null;
  let bestScore = 0;
  const walk = (ns: DocNode[]) => {
    for (const n of ns) {
      if (isCard(n) || n.level > 2) continue;
      const ht = tokens(n.text);
      const shared = s.filter((t) => ht.includes(t));
      if (shared.some((t) => !KIND.has(t))) {
        const score = shared.length / Math.min(s.length, ht.length);
        if (score > bestScore || (score === bestScore && best && n.level > best.level)) {
          bestScore = score;
          best = n;
        }
      }
      walk(n.children);
    }
  };
  walk(roots);
  return bestScore >= 0.5 ? best : null;
}

/**
 * The kit file a sheet most likely belongs to, or null.
 *
 * Compared against the file NAME and its first heading ("CP---India"). At least
 * one shared word has to be more than a kind marker — every CP file shares
 * "cp" with every CP sheet, and that alone must not link them.
 */
export function guessFileForSheet(
  sheetTitle: string,
  files: Array<{ key: string; name: string; firstHeading: string }>,
): string | null {
  const s = tokens(sheetTitle);
  if (!s.length) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const f of files) {
    const ft = tokens(`${f.name.replace(/\.docx$/i, "")} ${f.firstHeading}`);
    const shared = s.filter((t) => ft.includes(t));
    if (!shared.some((t) => !KIND.has(t))) continue;
    const score = shared.length / Math.min(s.length, ft.length);
    if (score > bestScore) {
      bestScore = score;
      best = f.key;
    }
  }
  return bestScore >= 0.5 ? best : null;
}
