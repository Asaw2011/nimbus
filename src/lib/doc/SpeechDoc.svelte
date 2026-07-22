<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorState, type Transaction } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { toggleMark, setBlockType, baseKeymap } from "prosemirror-commands";
  import { keymap } from "prosemirror-keymap";
  import { history, undo, redo } from "prosemirror-history";
  import type { DocNode } from "$lib/docx/parse";
  import { debateSchema } from "./schema";

  let mountEl = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let mounted = false;

  $effect(() => {
    if (!mountEl || mounted) return;
    mounted = true;

    const state = EditorState.create({
      schema: debateSchema,
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

    // Focus the doc so the cursor is visible immediately
    view.focus();
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
    mounted = false;
  });

  // ── helpers ───────────────────────────────────────────────────

  function makeText(s: string) {
    return s ? debateSchema.text(s) : undefined;
  }

  function insertNodes(nodes: ReturnType<typeof debateSchema.nodes.block.create>[]) {
    if (!view || nodes.length === 0) return;
    const { state } = view;
    const end = state.doc.content.size;
    view.dispatch(state.tr.insert(end, nodes).scrollIntoView());
  }

  // ── public API ────────────────────────────────────────────────

  /**
   * Structured insert from DocSearch: preserves the Verbatim hierarchy
   * block (bold) → tag (underlined) → cite → card body (evidence text).
   */
  export function appendNode(node: DocNode) {
    if (!view) return;
    const sc = debateSchema;
    const nodes: ReturnType<typeof sc.nodes.block.create>[] = [];

    // Block heading (bold argument label)
    nodes.push(sc.nodes.block.create({ id: crypto.randomUUID() }, makeText(node.text)));

    // Body lines directly under the block (overviews, analytics)
    for (const line of node.body) {
      if (line.trim()) nodes.push(sc.nodes.paragraph.create({}, makeText(line)));
    }

    // Children: H4 tag headings → each becomes tag + its body lines
    for (const child of node.children) {
      nodes.push(sc.nodes.tag.create({ id: crypto.randomUUID() }, makeText(child.text)));
      for (const line of child.body) {
        if (line.trim()) nodes.push(sc.nodes.card_body.create({}, makeText(line)));
      }
      // Deeper nesting (rare, treat as card body)
      for (const grandchild of child.children) {
        if (grandchild.text) nodes.push(sc.nodes.card_body.create({}, makeText(grandchild.text)));
        for (const line of grandchild.body) {
          if (line.trim()) nodes.push(sc.nodes.card_body.create({}, makeText(line)));
        }
      }
    }

    insertNodes(nodes);
  }

  /**
   * Simple string insert (used by "→ Doc" ribbon button and drag bridge).
   * First non-header line becomes the tag, rest become card body.
   */
  export function appendCard(header: string, fullCard: string) {
    if (!view) return;
    const sc = debateSchema;
    const lines = fullCard.split("\n").map(l => l.trim()).filter(l => l && l !== header);
    const nodes: ReturnType<typeof sc.nodes.block.create>[] = [
      sc.nodes.block.create({ id: crypto.randomUUID() }, makeText(header)),
    ];
    if (lines.length > 0) {
      // First line = tag (underlined cite/heading)
      nodes.push(sc.nodes.tag.create({ id: crypto.randomUUID() }, makeText(lines[0])));
      // Rest = card body (evidence text)
      for (const line of lines.slice(1)) {
        nodes.push(sc.nodes.card_body.create({}, makeText(line)));
      }
    }
    insertNodes(nodes);
  }

  export function appendBlocks(lines: string[]) {
    if (!view || lines.length === 0) return;
    insertNodes(lines.map(line =>
      debateSchema.nodes.block.create({ id: crypto.randomUUID() }, makeText(line)),
    ));
  }

  export function insertAtCursor(header: string, fullCard: string) {
    if (!view) return;
    const { state } = view;
    const pos = state.selection.to;
    const sc = debateSchema;
    const lines = fullCard.split("\n").map(l => l.trim()).filter(l => l && l !== header);
    const nodes = [
      sc.nodes.block.create({ id: crypto.randomUUID() }, makeText(header)),
      ...(lines.length > 0 ? [sc.nodes.tag.create({ id: crypto.randomUUID() }, makeText(lines[0]))] : []),
      ...lines.slice(1).map(line => sc.nodes.card_body.create({}, makeText(line))),
    ];
    view.dispatch(state.tr.insert(pos, nodes).scrollIntoView());
  }

  // ── toolbar ───────────────────────────────────────────────────

  function runToggleMark(markName: string) {
    if (!view) return;
    const mark = debateSchema.marks[markName];
    if (mark) toggleMark(mark)(view.state, view.dispatch);
    view.focus();
  }

  function setHeading(type: string) {
    if (!view) return;
    const nodeType = debateSchema.nodes[type];
    if (!nodeType) return;
    const attrs = type !== "paragraph" && type !== "card_body" ? { id: crypto.randomUUID() } : undefined;
    setBlockType(nodeType, attrs)(view.state, view.dispatch);
    view.focus();
  }

  function isMarkActive(markName: string): boolean {
    if (!view) return false;
    const mark = debateSchema.marks[markName];
    if (!mark) return false;
    const sel = view.state.selection;
    if (sel.empty) return !!mark.isInSet(view.state.storedMarks ?? sel.$from.marks());
    return view.state.doc.rangeHasMark(sel.from, sel.to, mark);
  }
</script>

<div class="speech-doc">
  <!-- Toolbar -->
  <div class="doc-toolbar">
    <div class="toolbar-group">
      <select class="heading-select" onchange={(e) => setHeading((e.currentTarget as HTMLSelectElement).value)}>
        <option value="paragraph">¶ Body</option>
        <option value="pocket">H1 Pocket</option>
        <option value="hat">H2 Hat</option>
        <option value="block">H3 Block</option>
        <option value="tag">H4 Tag</option>
        <option value="card_body">Evidence</option>
      </select>
    </div>
    <div class="toolbar-sep"></div>
    <div class="toolbar-group">
      <button class="tb-btn" class:active={isMarkActive("bold")}      onclick={() => runToggleMark("bold")} title="Bold (⌘B)"><b>B</b></button>
      <button class="tb-btn" class:active={isMarkActive("italic")}    onclick={() => runToggleMark("italic")} title="Italic (⌘I)"><i>I</i></button>
      <button class="tb-btn" class:active={isMarkActive("underline")} onclick={() => runToggleMark("underline")} title="Underline (⌘U)"><u>U</u></button>
    </div>
    <span class="doc-label">Speech Doc</span>
  </div>

  <!-- Page -->
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

  /* ── Toolbar ── */
  .doc-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .toolbar-group { display: flex; align-items: center; gap: 3px; }
  .toolbar-sep { width: 1px; height: 18px; background: var(--border); margin: 0 5px; }
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

  /* ── Page ── */
  .doc-scroll {
    flex: 1;
    overflow-y: auto;
    background: #c8c8c8;
    padding: 20px 12px;
  }
  :global([data-theme="dark"]) .doc-scroll { background: #0e0e0e; }

  .doc-page {
    max-width: 700px;
    margin: 0 auto;
    background: #fff;
    padding: 44px 52px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.25);
    min-height: 900px;
    border-radius: 1px;
  }
  :global([data-theme="dark"]) .doc-page {
    background: #1c1c1c;
    box-shadow: 0 2px 16px rgba(0,0,0,0.6);
  }

  /* ── ProseMirror base ── */
  :global(.ProseMirror) {
    outline: none;
    font-family: "Calibri", "Segoe UI", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #1a1a1a;
    caret-color: #1a6fd4;
    min-height: 800px;
    word-break: break-word;
  }
  :global([data-theme="dark"]) :global(.ProseMirror) {
    color: #e4e4e4;
    caret-color: #4a9eff;
  }

  /* Visible text cursor */
  :global(.ProseMirror:focus) { outline: none; }

  /* Selection highlight */
  :global(.ProseMirror ::selection) {
    background: rgba(26, 111, 212, 0.25);
  }
  :global([data-theme="dark"]) :global(.ProseMirror ::selection) {
    background: rgba(74, 158, 255, 0.3);
  }

  /* ── Heading styles (CardMirror-like) ── */
  :global(.pm-pocket) {
    font-size: 15pt;
    font-weight: 700;
    margin: 22px 0 4px;
    color: #111;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 2px solid #222;
    padding-bottom: 3px;
  }
  :global([data-theme="dark"]) :global(.pm-pocket) { color: #eee; border-color: #555; }

  :global(.pm-hat) {
    font-size: 12pt;
    font-weight: 700;
    margin: 16px 0 3px;
    color: #1a4fa8;
  }
  :global([data-theme="dark"]) :global(.pm-hat) { color: #7fb5ff; }

  :global(.pm-block) {
    font-size: 11pt;
    font-weight: 700;
    margin: 12px 0 2px;
    color: #111;
  }
  :global([data-theme="dark"]) :global(.pm-block) { color: #e8e8e8; }

  :global(.pm-tag) {
    font-size: 10.5pt;
    font-weight: 400;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    margin: 3px 0 1px;
    color: #1a1a1a;
  }
  :global([data-theme="dark"]) :global(.pm-tag) { color: #d4d4d4; }

  :global(.pm-card-body) {
    font-size: 9.5pt;
    color: #3a3a3a;
    margin: 0;
    line-height: 1.35;
    padding-left: 8px;
  }
  :global([data-theme="dark"]) :global(.pm-card-body) { color: #aaa; }

  :global(.ProseMirror p) { margin: 2px 0 6px; }
  :global(.ProseMirror p:empty::before) {
    content: '\200B'; /* zero-width space keeps empty paragraphs visible */
  }
</style>
