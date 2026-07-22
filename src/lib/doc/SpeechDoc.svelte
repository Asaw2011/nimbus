<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorState, type Transaction } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { toggleMark, setBlockType, baseKeymap } from "prosemirror-commands";
  import { keymap } from "prosemirror-keymap";
  import { history, undo, redo } from "prosemirror-history";
  import type { DocNode } from "$lib/docx/parse";
  import { cardmirrorSchema as schema, nodesFromDocNode } from "$lib/cardmirror/adapter";
  import "$lib/cardmirror/cardmirror.css";

  let mountEl = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let mounted = false;

  $effect(() => {
    if (!mountEl || mounted) return;
    mounted = true;

    const state = EditorState.create({
      schema,
      plugins: [
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        keymap(baseKeymap),
      ],
    });

    view = new EditorView(mountEl, {
      state,
      dispatchTransaction(tr: Transaction) {
        if (!view) return;
        view.updateState(view.state.apply(tr));
      },
    });
    view.focus();
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
    mounted = false;
  });

  // ── inserting ──────────────────────────────────────────────────

  function insertAtEnd(nodes: ReturnType<typeof schema.nodes.card.create>[]) {
    if (!view || nodes.length === 0) return;
    const { state } = view;
    view.dispatch(state.tr.insert(state.doc.content.size, nodes).scrollIntoView());
  }

  /** Rich insert from Doc Search / drag — full CardMirror card structure. */
  export function appendNode(node: DocNode) {
    try {
      insertAtEnd(nodesFromDocNode(node));
    } catch (err) {
      console.error("appendNode failed, falling back to plain text", err);
      // Fallback: flatten to a plain card so the insert never silently fails.
      const lines: string[] = [];
      const walk = (n: DocNode) => {
        n.body.forEach((l) => lines.push(l));
        n.children.forEach(walk);
      };
      walk(node);
      appendCard(node.text, lines.join("\n"));
    }
  }

  /** Plain-string card (from the "→ Doc" ribbon button / cell text). */
  export function appendCard(header: string, fullCard: string) {
    if (!view) return;
    const lines = fullCard.split("\n").map((l) => l.trim()).filter((l) => l && l !== header);
    const tag = schema.nodes.tag.create(null, header ? [schema.text(header)] : []);
    const bodies = lines.map((line) => schema.nodes.card_body.create(null, [schema.text(line)]));
    insertAtEnd([schema.nodes.card.create(null, [tag, ...bodies])]);
  }

  export function appendBlocks(lines: string[]) {
    const nodes = lines
      .filter((l) => l.trim())
      .map((line) => schema.nodes.block.create(null, [schema.text(line)]));
    insertAtEnd(nodes);
  }

  export function insertAtCursor(header: string, fullCard: string) {
    if (!view) return;
    const lines = fullCard.split("\n").map((l) => l.trim()).filter((l) => l && l !== header);
    const tag = schema.nodes.tag.create(null, header ? [schema.text(header)] : []);
    const bodies = lines.map((line) => schema.nodes.card_body.create(null, [schema.text(line)]));
    const card = schema.nodes.card.create(null, [tag, ...bodies]);
    view.dispatch(view.state.tr.replaceSelectionWith(card).scrollIntoView());
  }

  // ── toolbar ────────────────────────────────────────────────────

  function mark(name: string, attrs?: Record<string, unknown>) {
    if (!view) return;
    const m = schema.marks[name];
    if (m) toggleMark(m, attrs)(view.state, view.dispatch);
    view.focus();
  }

  function setBlock(type: string) {
    if (!view) return;
    const nt = schema.nodes[type];
    if (nt) setBlockType(nt)(view.state, view.dispatch);
    view.focus();
  }

  function markActive(name: string): boolean {
    if (!view) return false;
    const m = schema.marks[name];
    if (!m) return false;
    const sel = view.state.selection;
    if (sel.empty) return !!m.isInSet(view.state.storedMarks ?? sel.$from.marks());
    return view.state.doc.rangeHasMark(sel.from, sel.to, m);
  }
</script>

<div class="speech-doc pmd-document">
  <div class="doc-toolbar">
    <select class="heading-select" onchange={(e) => setBlock((e.currentTarget as HTMLSelectElement).value)}>
      <option value="paragraph">¶ Body</option>
      <option value="pocket">Pocket</option>
      <option value="hat">Hat</option>
      <option value="block">Block</option>
      <option value="analytic">Analytic</option>
    </select>
    <div class="toolbar-sep"></div>
    <button class="tb-btn" class:active={markActive("bold")} onclick={() => mark("bold")} title="Bold"><b>B</b></button>
    <button class="tb-btn" class:active={markActive("italic")} onclick={() => mark("italic")} title="Italic"><i>I</i></button>
    <button class="tb-btn" class:active={markActive("underline_mark")} onclick={() => mark("underline_mark")} title="Underline (cut)"><u>U</u></button>
    <button class="tb-btn" class:active={markActive("emphasis_mark")} onclick={() => mark("emphasis_mark")} title="Emphasis (box)"><span class="emph">E</span></button>
    <button class="tb-btn hl" class:active={markActive("highlight")} onclick={() => mark("highlight", { color: "yellow" })} title="Highlight (spoken)">H</button>
    <span class="doc-label">Speech Doc</span>
  </div>

  <div class="doc-scroll">
    <div class="doc-page" bind:this={mountEl}></div>
  </div>
</div>

<style>
  .speech-doc {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    border-left: 1px solid var(--border);
    overflow: hidden;
  }
  .doc-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .toolbar-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
  .tb-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--text);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 13px;
    cursor: pointer;
    min-width: 28px;
    font-family: inherit;
  }
  .tb-btn:hover { background: var(--bg); border-color: var(--border); }
  .tb-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tb-btn .emph { border: 1px solid currentColor; border-radius: 2px; padding: 0 2px; font-weight: 700; font-size: 11px; }
  .tb-btn.hl { background: #ffff66; color: #000; }
  .tb-btn.hl.active { outline: 2px solid var(--accent); }
  .heading-select {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .doc-label {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .doc-scroll {
    flex: 1;
    overflow-y: auto;
    background: #c8c8c8;
    padding: 20px 12px;
  }
  :global([data-theme="dark"]) .doc-scroll { background: #0e0e0e; }
  .doc-page {
    max-width: 720px;
    margin: 0 auto;
    background: #fff;
    padding: 40px 48px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.25);
    min-height: 900px;
  }
  :global([data-theme="dark"]) .doc-page { background: #1c1c1c; box-shadow: 0 2px 16px rgba(0,0,0,0.6); }
  .doc-page :global(.ProseMirror) { min-height: 820px; caret-color: #1a6fd4; }
  :global([data-theme="dark"]) .doc-page :global(.ProseMirror) { caret-color: #4a9eff; }
</style>
