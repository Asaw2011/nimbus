// In-document find (⌘F). A plugin that highlights every occurrence of the
// query and tracks the "current" match; the component drives navigation by
// dispatching {query, index} metas and reading back the match list to scroll.

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export interface Match { from: number; to: number; }

interface SearchState {
  matches: Match[];
  index: number;
  query: string;
  decos: DecorationSet;
}

export const searchKey = new PluginKey<SearchState>("docSearch");

/** Case-insensitive plain-text matches, with real document positions. */
export function findMatches(state: EditorState, query: string): Match[] {
  const matches: Match[] = [];
  const q = query.toLowerCase();
  if (!q.trim()) return matches;
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let i = text.indexOf(q);
    while (i !== -1) {
      matches.push({ from: pos + i, to: pos + i + q.length });
      i = text.indexOf(q, i + q.length);
    }
  });
  return matches;
}

function decoSet(state: EditorState, matches: Match[], index: number): DecorationSet {
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === index ? "doc-find current" : "doc-find",
    }),
  );
  return DecorationSet.create(state.doc, decos);
}

const EMPTY: SearchState = {
  matches: [],
  index: 0,
  query: "",
  decos: DecorationSet.empty,
};

export function searchPlugin() {
  return new Plugin<SearchState>({
    key: searchKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _old, newState) {
        const meta = tr.getMeta(searchKey) as { query: string; index: number } | undefined;
        if (meta) {
          const matches = findMatches(newState, meta.query);
          const index = matches.length
            ? ((meta.index % matches.length) + matches.length) % matches.length
            : 0;
          return { matches, index, query: meta.query, decos: decoSet(newState, matches, index) };
        }
        // Keep matches fresh as the doc changes under an open search.
        if (tr.docChanged && prev.query) {
          const matches = findMatches(newState, prev.query);
          const index = matches.length ? Math.min(prev.index, matches.length - 1) : 0;
          return { matches, index, query: prev.query, decos: decoSet(newState, matches, index) };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return searchKey.getState(state)?.decos;
      },
    },
  });
}
