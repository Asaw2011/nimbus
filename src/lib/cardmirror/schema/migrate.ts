/**
 * Load-time document migrations.
 *
 * These run on `parseNative` (see `native/index.ts`) right after a doc is
 * deserialized, so older `.cmir` files are repaired in place before they reach
 * the editor. Each migration is a pure `doc -> doc` walk that returns the same
 * node when nothing changed (so callers can skip a no-op dispatch).
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { schema } from './index';

/**
 * Split any `analytic` that sits INSIDE a card out into its own trailing
 * `analytic_unit`.
 *
 * `analytic` used to be legal card content (the "cite-slot" alternative). It no
 * longer is — an analytic anchors its own `analytic_unit` — so older docs (and
 * `.docx` imports that put an Analytic paragraph under a tag) can contain
 * `card[ tag, …, analytic, … ]`, which is now schema-invalid. This rewrites such
 * a card the same way pasting an analytic into a card does: the tag and the
 * children BEFORE the first analytic stay in the card; each analytic becomes the
 * head of a new `analytic_unit` that absorbs the children that follow it, up to
 * the next analytic. Several in-card analytics yield several units.
 *
 *   card[ tag, body, analytic A1, body, cite, analytic A2, body ]
 *     ->
 *   card[ tag, body ]
 *   analytic_unit[ analytic A1, body, cite ]
 *   analytic_unit[ analytic A2, body ]
 *
 * All card-content types (`card_body`/`undertag`/`cite_paragraph`/`table`) are
 * also valid `analytic_unit` content, so the absorbed children pass through
 * unchanged. Heading ids (tag + analytics) are preserved.
 *
 * Cards live only at the doc root, so a doc-level walk suffices.
 */
export function splitInCardAnalytics(doc: PMNode): PMNode {
  let changed = false;
  const out: PMNode[] = [];
  doc.forEach((child) => {
    if (child.type.name === 'card' && cardHasAnalytic(child)) {
      changed = true;
      out.push(...splitCardOnAnalytics(child));
    } else {
      out.push(child);
    }
  });
  if (!changed) return doc;
  return doc.type.create(doc.attrs, Fragment.fromArray(out), doc.marks);
}

/**
 * Flatten any zones nested INSIDE a live zone. A `transclusion_ref` is live only
 * in the document it was created in; a zone nested inside another (possible in
 * docs saved before this invariant, or synced from such a peer) is unwrapped to
 * its plain snapshot while the top-level zone stays live. Mirrors the create /
 * refresh flatten so old docs heal on load. (Zones only ever appear at the doc
 * root or inside another zone, so a doc-level walk that recurses into zone
 * content is complete.)
 */
export function flattenNestedZones(doc: PMNode): PMNode {
  let changed = false;
  const out: PMNode[] = [];
  doc.forEach((child) => {
    if (child.type.name === 'transclusion_ref') {
      const flat = unwrapZonesIn(child.content);
      if (flat !== child.content) {
        changed = true;
        out.push(child.type.create(child.attrs, flat, child.marks));
      } else {
        out.push(child);
      }
    } else {
      out.push(child);
    }
  });
  if (!changed) return doc;
  return doc.type.create(doc.attrs, Fragment.fromArray(out), doc.marks);
}

/**
 * Drop any live zone that carries NO content. An empty `transclusion_ref`
 * renders invisibly (no cards, and the rail only shows on hover) yet is still a
 * real node — counted by "refresh all" and re-filled by a refresh, so it reads
 * as a phantom zone that materialises out of nowhere. These arise when a zone's
 * cards are all deleted in place; heal them on load. (Zones live at the doc
 * root; any nested one is unwrapped by flattenNestedZones first.)
 */
export function dropEmptyZones(doc: PMNode): PMNode {
  let changed = false;
  const out: PMNode[] = [];
  doc.forEach((child) => {
    if (child.type.name === 'transclusion_ref' && child.content.size === 0) {
      changed = true; // drop the empty zone entirely
      return;
    }
    out.push(child);
  });
  return changed ? doc.type.create(doc.attrs, Fragment.fromArray(out), doc.marks) : doc;
}

/** Recursively replace every `transclusion_ref` in a fragment with its content
 *  (any depth). Returns the same fragment when there was nothing to unwrap. */
function unwrapZonesIn(frag: Fragment): Fragment {
  let changed = false;
  const out: PMNode[] = [];
  frag.forEach((child) => {
    const inner = child.content.size ? unwrapZonesIn(child.content) : child.content;
    const node = inner === child.content ? child : child.type.create(child.attrs, inner, child.marks);
    if (node.type.name === 'transclusion_ref') {
      changed = true;
      node.content.forEach((c) => out.push(c));
    } else {
      if (node !== child) changed = true;
      out.push(node);
    }
  });
  return changed ? Fragment.fromArray(out) : frag;
}

/**
 * Marks an inline image may carry. Everything else is visual
 * typography that cannot render on a replaced element without
 * artifacts — an inline mark span's height comes from font metrics,
 * not from its image child, so e.g. the emphasis box borders a
 * text-height band straight through the image — and is meaningless
 * beyond the editor: `emitImageRun` writes no run styling, so Word
 * shows nothing either way. `comment_range` stays because comment
 * spans must be continuous across an inline image (the exporter's
 * range reconciliation depends on it); `link` is functional, not
 * visual.
 *
 * The named-style normalizer enforces the same set on live
 * transactions; this module enforces it at load.
 */
export const IMAGE_ALLOWED_MARKS: ReadonlySet<string> = new Set([
  'comment_range',
  'link',
]);

/** Strip disallowed marks (see `IMAGE_ALLOWED_MARKS`) from every
 *  inline image. Same-node return when nothing changed. */
export function stripImageVisualMarks(doc: PMNode): PMNode {
  function walk(node: PMNode): PMNode {
    if (node.type.name === 'image') {
      const kept = node.marks.filter((m) => IMAGE_ALLOWED_MARKS.has(m.type.name));
      return kept.length === node.marks.length ? node : node.mark(kept);
    }
    if (node.isText || node.childCount === 0) return node;
    let changed = false;
    const out: PMNode[] = [];
    node.forEach((child) => {
      const w = walk(child);
      if (w !== child) changed = true;
      out.push(w);
    });
    return changed
      ? node.type.create(node.attrs, Fragment.fromArray(out), node.marks)
      : node;
  }
  return walk(doc);
}

function cardHasAnalytic(card: PMNode): boolean {
  let found = false;
  card.forEach((c) => {
    if (c.type.name === 'analytic') found = true;
  });
  return found;
}

function splitCardOnAnalytics(card: PMNode): PMNode[] {
  const kids: PMNode[] = [];
  card.forEach((c) => kids.push(c));

  const result: PMNode[] = [];
  let i = 0;

  // Children before the first analytic (the tag is always first) stay in the
  // card — all are still valid card content.
  const cardChildren: PMNode[] = [];
  while (i < kids.length && kids[i]!.type.name !== 'analytic') {
    cardChildren.push(kids[i]!);
    i++;
  }
  result.push(card.type.create(card.attrs, Fragment.fromArray(cardChildren), card.marks));

  // Each analytic heads a new unit, absorbing the children that follow it up to
  // the next analytic (or the end of the card).
  while (i < kids.length) {
    const unitChildren: PMNode[] = [kids[i]!]; // the analytic head
    i++;
    while (i < kids.length && kids[i]!.type.name !== 'analytic') {
      unitChildren.push(kids[i]!);
      i++;
    }
    result.push(
      schema.nodes['analytic_unit']!.create(null, Fragment.fromArray(unitChildren)),
    );
  }

  return result;
}
