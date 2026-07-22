<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorState, type Transaction } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { toggleMark, setBlockType, baseKeymap } from "prosemirror-commands";
  import { keymap } from "prosemirror-keymap";
  import { history, undo, redo } from "prosemirror-history";
  import type { DocNode, DocRun } from "$lib/docx/parse";
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

  // Build a ProseMirror text node from a styled run, applying the right marks.
  function runToText(run: DocRun) {
    if (!run.text) return null;
    const marks = [];
    if (run.hl) marks.push(debateSchema.marks.highlight.create({ color: run.hl }));
    if (run.b) marks.push(debateSchema.marks.bold.create());
    if (run.u) marks.push(debateSchema.marks.underline.create());
    if (run.sm) marks.push(debateSchema.marks.condensed.create());
    return debateSchema.text(run.text, marks);
  }

  // Turn each body paragraph's runs into a card_body node with rich formatting.
  function bodyParasToNodes(runsList: DocRun[][]): ReturnType<typeof debateSchema.nodes.card_body.create>[] {
    const out: ReturnType<typeof debateSchema.nodes.card_body.create>[] = [];
    for (const runs of runsList) {
      const textNodes = runs.map(runToText).filter((n) => n !== null);
      if (textNodes.length > 0) {
        out.push(debateSchema.nodes.card_body.create({}, textNodes));
      }
    }
    return out;
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

    const headingType = (level: number) =>
      level <= 1 ? sc.nodes.pocket : level === 2 ? sc.nodes.hat : level === 3 ? sc.nodes.block : sc.nodes.tag;

    // Recursively emit heading + its rich body + descendants, preserving the
    // Pocket/Hat/Block/Tag hierarchy and all card formatting.
    const emit = (n: DocNode) => {
      const ht = headingType(n.level);
      nodes.push(ht.create({ id: crypto.randomUUID() }, makeText(n.text)));
      // This heading's own body paragraphs (cite + evidence), richly styled
      nodes.push(...bodyParasToNodes(n.bodyRuns ?? []));
      for (const child of n.children) emit(child);
    };

    emit(node);
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
    font-size: 11.5pt;
    font-weight: 700;
    margin: 18px 0 0;
    color: #111;
    padding-top: 10px;
    border-top: 1.5px solid #ddd;
  }
  :global(.pm-block:first-child) { border-top: none; margin-top: 0; padding-top: 0; }
  :global([data-theme="dark"]) :global(.pm-block) { color: #e8e8e8; border-top-color: #333; }

  :global(.pm-tag) {
    font-size: 10.5pt;
    font-weight: 400;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    margin: 3px 0 2px;
    color: #1a1a1a;
    display: block;
  }
  :global([data-theme="dark"]) :global(.pm-tag) { color: #d4d4d4; }

  /* Evidence text — the card body. Read (highlighted/underlined) text is
     full-size black; unread context shrinks to small grey (Condensed). */
  :global(.pm-card-body) {
    font-size: 11pt;
    color: #111;
    margin: 0 0 3px;
    line-height: 1.4;
  }
  :global([data-theme="dark"]) :global(.pm-card-body) { color: #e0e0e0; }

  /* Highlight = spoken/read-aloud — real highlighter colour behind black text */
  :global(.pm-hl) {
    color: #000;
    border-radius: 1px;
    padding: 0 0.5px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  /* Condensed = unread context — tiny grey */
  :global(.pm-condensed) {
    font-size: 7.5pt;
    color: #999;
  }
  :global([data-theme="dark"]) :global(.pm-condensed) { color: #777; }

  /* Underline (the cut) + bold (emphasis power words) */
  :global(.pm-card-body u) { text-decoration: underline; text-decoration-thickness: 1px; }
  :global(.pm-card-body strong) { font-weight: 700; }

  :global(.ProseMirror p) { margin: 3px 0 6px; }
  :global(.ProseMirror p:last-child) { margin-bottom: 0; }
  :global(.ProseMirror p:empty::before) { content: '\200B'; }
</style>
