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
  doc.descendants((node, pos, parent) => {
    if (node.isText && parent && BODY_NODES.has(parent.type.name)) {
      const isRead = node.marks.some((m) => READ_MARKS.has(m.type.name));
      const isSpace = (node.text ?? "").trim() === "";
      // Hide unread runs that carry actual text. Whitespace-only runs stay so
      // the spacing between read words is preserved.
      if (!isRead && !isSpace) {
        decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: "pmd-rm-hide" }));
        // Insert a real space where the hidden run was so read words never jam.
        decos.push(Decoration.widget(pos + node.nodeSize, spaceWidget, { side: 1, key: "sp" + pos }));
      }
    }
    return true;
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
