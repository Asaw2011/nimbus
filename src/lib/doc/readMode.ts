// Read-mode plugin (CardMirror's approach). When on, every run inside a card
// body / cite paragraph that has NO "read" marker — highlight (spoken),
// underline (the cut), emphasis, or cite — is decorated hidden. What's left is
// exactly the read-aloud text, flowing inline. Robust regardless of font size.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export const readModeKey = new PluginKey<ReadState>("readMode");

interface ReadState {
  on: boolean;
  decos: DecorationSet;
}

// Marks that mean "this text is read aloud". Read mode shows ONLY the
// highlighted (spoken) text — not underlined-only or emphasized-only runs.
// The cite line (cite_mark) stays so you can read the source.
const READ_MARKS = new Set(["highlight", "cite_mark"]);
// Only hide runs inside these evidence containers (never headings).
const BODY_NODES = new Set(["card_body", "cite_paragraph"]);

function spaceWidget(): HTMLElement {
  const s = document.createElement("span");
  s.textContent = " ";
  s.className = "pmd-rm-sep";
  return s;
}

function buildDecos(doc: PMNode, on: boolean): DecorationSet {
  if (!on) return DecorationSet.empty;
  const decos: Decoration[] = [];
  // Walk each evidence body and decide, run by run, what's read aloud. A run is
  // SHOWN only if it carries a read marker (highlight / cite) AND has a real
  // (non-whitespace) character — a highlighted space renders as an empty box or
  // "_" dash otherwise. Everything else is hidden. To keep the shown words from
  // jamming together we drop exactly ONE space where a hidden GROUP was, not one
  // per hidden run (that produced huge gaps through long stretches of cut text).
  doc.descendants((node, pos) => {
    if (!BODY_NODES.has(node.type.name)) return true;
    let childPos = pos + 1; // first inline child position
    let pendingGap = false; // a hidden run since the last shown word
    let anyShown = false; // did this body contribute any read-aloud word?
    node.forEach((child) => {
      const from = childPos;
      childPos += child.nodeSize;
      if (!child.isText) return;
      const isRead = child.marks.some((m) => READ_MARKS.has(m.type.name));
      const blank = !child.text || child.text.trim() === "";
      if (isRead && !blank) {
        anyShown = true;
        // Shown word. If hidden content preceded it, insert one separating space.
        if (pendingGap) {
          decos.push(Decoration.widget(from, spaceWidget, { side: -1, key: "sp" + from }));
          pendingGap = false;
        }
      } else {
        decos.push(Decoration.inline(from, from + child.nodeSize, { class: "pmd-rm-hide" }));
        pendingGap = true;
      }
    });
    // A body with no read-aloud word must be fully removed — otherwise its
    // `::after` spacer (white-space: pre, non-collapsing) stacks with its
    // neighbours' into a large gap between the words that survive.
    if (!anyShown) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "pmd-rm-hide" }));
    }
    return false; // handled this body's inline content
  });
  return DecorationSet.create(doc, decos);
}

export function readModePlugin() {
  return new Plugin<ReadState>({
    key: readModeKey,
    state: {
      init: () => ({ on: false, decos: DecorationSet.empty }),
      apply(tr, prev) {
        const meta = tr.getMeta(readModeKey) as { on?: boolean } | undefined;
        const on = typeof meta?.on === "boolean" ? meta.on : prev.on;
        if (meta || (on && tr.docChanged)) {
          return { on, decos: buildDecos(tr.doc, on) };
        }
        return { on, decos: on ? prev.decos.map(tr.mapping, tr.doc) : prev.decos };
      },
    },
    props: {
      decorations(state) {
        return readModeKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
  });
}
