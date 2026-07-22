/**
 * Deterministic document repair for structural states ProseMirror never
 * produces locally but external content can: DOCX imports with irregular
 * tables, and merged documents from a sync layer. Pure function of the
 * doc — identical input yields identical repairs everywhere, and the
 * pass is idempotent (a repaired doc yields no further repair).
 *
 * Three passes, in order:
 *   1. prosemirror-tables `fixTables` — pads ragged rows and clamps
 *      colspan overflow so every row spans the same width.
 *   2. `excludes` sweep — text carrying both members of a mutually
 *      exclusive mark pair keeps the earlier-declared mark and drops the
 *      later one. ProseMirror enforces `excludes` in `Mark.addToSet`
 *      (local editing) but not on node construction, so externally built
 *      content can carry both.
 *   3. Container first-child invariant — a `card` must open with `tag`,
 *      an `analytic_unit` with `analytic` (their content expressions
 *      require it, but `NodeType.create` does not validate); an empty
 *      heading is inserted when missing. Heading `id` stamping is left
 *      to `stampMissingHeadingIds` at load: ids are random, and this
 *      pass must stay deterministic.
 */
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { fixTables } from 'prosemirror-tables';
import { schema } from './schema/index';

/** Resolution order for mutually-exclusive marks: on a text node that
 *  (post-merge) carries two marks the schema declares as `excludes`,
 *  the HIGHER-priority one is kept and the other dropped. A single
 *  priority per mark makes the resolution a TOTAL ORDER — it cannot
 *  form a cycle the way a hand-listed pairwise winner-table can, and a
 *  cycle would reintroduce order-dependent (non-converging) repair.
 *  Which pairs actually conflict is read from the schema itself
 *  (`type.excludes`), so this map only needs to rank the participants;
 *  a new exclusive mark is covered by adding its priority.
 *
 *  Order (2026-07-05, user): citation styling is the most structural,
 *  then emphasis, then underline; an explicit bold beats an explicit
 *  bold-off; superscript beats subscript. */
const MARK_PRIORITY: Readonly<Record<string, number>> = {
  cite_mark: 30,
  emphasis_mark: 20,
  underline_mark: 10,
  bold: 2,
  bold_off: 1,
  superscript: 2,
  subscript: 1,
};

/** Strip the lower-priority member of every present mutually-exclusive
 *  pair from `tr`. Mark-level and deterministic: every peer resolves to
 *  the same winner, so this is safe to run on ALL peers (unlike the
 *  structural repairs) — double-application converges under LWW. */
function sweepExclusiveMarks(tr: Transaction): void {
  tr.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const ranked = node.marks.filter((m) => m.type.name in MARK_PRIORITY);
    for (const m of ranked) {
      const outranked = ranked.some(
        (other) =>
          other !== m &&
          other.type.excludes(m.type) &&
          MARK_PRIORITY[other.type.name]! > MARK_PRIORITY[m.type.name]!,
      );
      if (outranked) tr.removeMark(pos, pos + node.nodeSize, m.type);
    }
    return true;
  });
}

/** Exclusive-marks resolution ONLY — no tables, no structural fixes.
 *  Session repair runs this on every peer (mark-level, converges),
 *  while the structural half stays leader-gated (see collab-repair). */
export function buildMarkRepairTr(state: EditorState): Transaction | null {
  const tr = state.tr;
  sweepExclusiveMarks(tr);
  return tr.steps.length ? tr : null;
}

/** Build the full repair transaction for `state` (tables + exclusive
 *  marks + container invariant), or null when nothing needs repair.
 *  Used by import, offline merge, and the session's leader. */
export function buildDocRepairTr(state: EditorState): Transaction | null {
  const tr = fixTables(state) ?? state.tr;

  // Mark sweep scans tr.doc so positions reflect any table fixes above;
  // removeMark never shifts positions, so one scan can batch all fixes.
  sweepExclusiveMarks(tr);

  // Insertions shift positions, so collect first and apply bottom-up.
  const inserts: Array<{ pos: number; type: 'tag' | 'analytic' }> = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'card' && node.firstChild?.type.name !== 'tag') {
      inserts.push({ pos: pos + 1, type: 'tag' });
    }
    if (node.type.name === 'analytic_unit' && node.firstChild?.type.name !== 'analytic') {
      inserts.push({ pos: pos + 1, type: 'analytic' });
    }
    return true;
  });
  inserts.sort((a, b) => b.pos - a.pos);
  for (const ins of inserts) {
    tr.insert(ins.pos, schema.nodes[ins.type]!.create());
  }

  return tr.steps.length ? tr : null;
}

/** Repair a standalone doc (no editor state), returning the repaired doc
 *  — or the same node when nothing needed repair. */
export function repairDoc(doc: PMNode): PMNode {
  const tr = buildDocRepairTr(EditorState.create({ doc }));
  return tr ? tr.doc : doc;
}
