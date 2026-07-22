// Adapter: convert Nimbus's parsed .docx tree (DocNode/DocRun) into a
// CardMirror-schema ProseMirror document, so cards render exactly like
// CardMirror (highlight = spoken, underline = cut, emphasis = boxed,
// small = unread condensed).

import type { Node as PMNode, Mark } from "prosemirror-model";
import { schema } from "./schema/index";
import type { DocNode, DocRun } from "$lib/docx/parse";

const DEFAULT_BODY_HALFPOINTS = 22; // 11pt

/** Marks for a card-body run: full formatting incl. condensed font size.
 *  cite / emphasis / underline are MUTUALLY EXCLUSIVE in CardMirror's schema
 *  (a character has one named style), so pick one by precedence — otherwise the
 *  schema silently drops the excluded mark and styling comes out inconsistent.
 *  Emphasis renders bold + underline + box via CSS, so it subsumes underline. */
function bodyMarks(run: DocRun): Mark[] {
  const marks: Mark[] = [];
  if (run.hl) marks.push(schema.marks.highlight.create({ color: run.hl }));
  if (run.cite) marks.push(schema.marks.cite_mark.create());
  else if (run.b) marks.push(schema.marks.emphasis_mark.create());
  else if (run.u) marks.push(schema.marks.underline_mark.create());
  if (run.i) marks.push(schema.marks.italic.create());
  // Shrink explicitly-small (unread) runs via a font_size mark.
  if (run.sm && run.sz && run.sz < DEFAULT_BODY_HALFPOINTS) {
    marks.push(schema.marks.font_size.create({ halfPoints: run.sz }));
  }
  return marks;
}

/** Marks for a heading run: underline + highlight only (headings are uniform). */
function headingMarks(run: DocRun): Mark[] {
  const marks: Mark[] = [];
  if (run.hl) marks.push(schema.marks.highlight.create({ color: run.hl }));
  if (run.u) marks.push(schema.marks.underline_mark.create());
  return marks;
}

function inlineFrom(runs: DocRun[], marksFor: (r: DocRun) => Mark[]): PMNode[] {
  const out: PMNode[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    out.push(schema.text(run.text, marksFor(run)));
  }
  return out;
}

/** Heading inline content, falling back to plain text if the node has no runs. */
function headingInline(node: DocNode): PMNode[] {
  const runs = node.runs?.length ? node.runs : [{ text: node.text }];
  const inline = inlineFrom(runs, headingMarks);
  return inline.length ? inline : node.text ? [schema.text(node.text)] : [];
}

/** Each body paragraph → a card_body node (or cite_paragraph if it's the cite). */
function bodyNodes(node: DocNode): PMNode[] {
  const out: PMNode[] = [];
  for (const runs of node.bodyRuns ?? []) {
    const inline = inlineFrom(runs, bodyMarks);
    if (!inline.length) continue;
    // A paragraph whose runs carry the cite style is the cite line.
    const isCite = runs.some((r) => r.cite && r.text.trim());
    const type = isCite ? schema.nodes.cite_paragraph : schema.nodes.card_body;
    out.push(type.create(null, inline));
  }
  return out;
}

function emit(node: DocNode, out: PMNode[]): void {
  if (node.isAnalytic) {
    // Analytic → CardMirror analytic_unit: analytic heading + its body.
    const heading = schema.nodes.analytic.create({ id: crypto.randomUUID() }, headingInline(node));
    const bodies = bodyNodes(node);
    out.push(schema.nodes.analytic_unit.create(null, [heading, ...bodies]));
  } else if (node.level >= 4) {
    // Tag → a proper CardMirror card: tag heading + card body paragraphs.
    const tag = schema.nodes.tag.create(null, headingInline(node));
    const bodies = bodyNodes(node);
    out.push(schema.nodes.card.create(null, [tag, ...bodies]));
  } else {
    const type = node.level <= 1 ? "pocket" : node.level === 2 ? "hat" : "block";
    out.push(schema.nodes[type].create(null, headingInline(node)));
    // A heading's own body (overviews under a block/hat) → card_body at doc level.
    out.push(...bodyNodes(node));
  }
  for (const child of node.children) emit(child, out);
}

/** Build the top-level CardMirror nodes for one imported section. */
export function nodesFromDocNode(node: DocNode): PMNode[] {
  const out: PMNode[] = [];
  emit(node, out);
  return out;
}

export { schema as cardmirrorSchema };
