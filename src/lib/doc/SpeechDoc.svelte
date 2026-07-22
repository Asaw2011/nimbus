<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorState, type Transaction } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { toggleMark, setBlockType, baseKeymap } from "prosemirror-commands";
  import { keymap } from "prosemirror-keymap";
  import { history, undo, redo } from "prosemirror-history";
  import { debateSchema } from "./schema";

  // Speech doc is in-memory only (session-scoped, exported to .docx on demand).
  // Loro CRDT is added in Phase 4 when partner collab is wired in.

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
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
        }),
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
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
    mounted = false;
  });

  // ── public API ────────────────────────────────────────────────

  export function appendCard(header: string, fullCard: string) {
    if (!view) return;
    const { state } = view;
    const end = state.doc.content.size;
    const nodes = [
      state.schema.nodes.block.create(
        { id: crypto.randomUUID() },
        header ? state.schema.text(header) : undefined,
      ),
      ...fullCard
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && l !== header)
        .map((line) => state.schema.nodes.card_body.create({}, state.schema.text(line))),
    ];
    view.dispatch(state.tr.insert(end, nodes).scrollIntoView());
  }

  export function appendBlocks(lines: string[]) {
    if (!view || lines.length === 0) return;
    const { state } = view;
    const end = state.doc.content.size;
    const nodes = lines.map((line) =>
      state.schema.nodes.block.create({ id: crypto.randomUUID() }, state.schema.text(line)),
    );
    view.dispatch(state.tr.insert(end, nodes).scrollIntoView());
  }

  export function insertAtCursor(header: string, fullCard: string) {
    if (!view) return;
    const { state } = view;
    const pos = state.selection.to;
    const nodes = [
      state.schema.nodes.block.create({ id: crypto.randomUUID() }, state.schema.text(header)),
      ...fullCard
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && l !== header)
        .map((line) => state.schema.nodes.card_body.create({}, state.schema.text(line))),
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
    const attrs = type !== "paragraph" ? { id: crypto.randomUUID() } : undefined;
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
  <div class="doc-toolbar">
    <div class="toolbar-group">
      <select
        class="heading-select"
        onchange={(e) => setHeading((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="paragraph">Body</option>
        <option value="pocket">Pocket</option>
        <option value="hat">Hat</option>
        <option value="block">Block</option>
        <option value="tag">Tag</option>
      </select>
    </div>
    <div class="toolbar-sep"></div>
    <div class="toolbar-group">
      <button class="tb-btn" class:active={isMarkActive("bold")}      onclick={() => runToggleMark("bold")}><b>B</b></button>
      <button class="tb-btn" class:active={isMarkActive("italic")}    onclick={() => runToggleMark("italic")}><i>I</i></button>
      <button class="tb-btn" class:active={isMarkActive("underline")} onclick={() => runToggleMark("underline")}><u>U</u></button>
    </div>
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
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .toolbar-group { display: flex; align-items: center; gap: 2px; }
  .toolbar-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
  .tb-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--text);
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 13px;
    cursor: pointer;
    min-width: 26px;
  }
  .tb-btn:hover { background: var(--bg); border-color: var(--border); }
  .tb-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .heading-select {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 12px;
  }
  .doc-label {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .doc-scroll {
    flex: 1;
    overflow-y: auto;
    background: #d8d8d8;
    padding: 24px 16px;
  }
  :global([data-theme="dark"]) .doc-scroll { background: #111; }
  .doc-page {
    max-width: 680px;
    margin: 0 auto;
    background: #fff;
    border-radius: 2px;
    padding: 48px 56px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    min-height: 900px;
  }
  :global([data-theme="dark"]) .doc-page {
    background: #1e1e1e;
    box-shadow: 0 2px 12px rgba(0,0,0,0.5);
  }
  :global(.ProseMirror) {
    outline: none;
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #111;
    min-height: 800px;
  }
  :global([data-theme="dark"]) :global(.ProseMirror) { color: #e8e8e8; }
  :global(.ProseMirror p) { margin: 0 0 6px; }
  :global(.pm-pocket) { font-size: 16pt; font-weight: 700; margin: 20px 0 6px; border-bottom: 2px solid #333; padding-bottom: 2px; }
  :global(.pm-hat)    { font-size: 13pt; font-weight: 700; margin: 14px 0 4px; color: #1a4fa8; }
  :global(.pm-block)  { font-size: 12pt; font-weight: 700; margin: 10px 0 2px; }
  :global(.pm-tag)    { font-size: 11pt; text-decoration: underline; margin: 4px 0 2px; }
  :global(.pm-card-body) { font-size: 10pt; color: #555; margin: 2px 0; line-height: 1.4; }
  :global([data-theme="dark"]) :global(.pm-hat) { color: #7fb5ff; }
  :global([data-theme="dark"]) :global(.pm-card-body) { color: #999; }
</style>
