<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { toggleMark, setBlockType, baseKeymap } from "prosemirror-commands";
  import { keymap } from "prosemirror-keymap";
  import { history, undo, redo } from "prosemirror-history";
  import type { DocNode } from "$lib/docx/parse";
  import { cardmirrorSchema as schema, nodesFromDocNode } from "$lib/cardmirror/adapter";
  import "$lib/cardmirror/cardmirror.css";

  let {
    onchange = null,
    initialDoc = null,
    onpopout = null,
    onexpand = null,
    expanded = false,
    poppedOut = false,
  }: {
    onchange?: ((json: unknown) => void) | null;
    initialDoc?: unknown;
    onpopout?: (() => void) | null;
    onexpand?: (() => void) | null;
    expanded?: boolean;
    poppedOut?: boolean;
  } = $props();

  let mountEl = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let mounted = false;

  // ── Heading outline (collapsible nav tree, like CardMirror) ──────
  interface OutlineItem { pos: number; level: number; text: string; }
  let outline = $state<OutlineItem[]>([]);
  let showOutline = $state(true);
  const HEADING_LEVEL: Record<string, number> = {
    pocket: 1, hat: 2, block: 3, card: 4, tag: 4, analytic: 4, analytic_unit: 4,
  };

  function rebuildOutline() {
    if (!view) return;
    const items: OutlineItem[] = [];
    view.state.doc.descendants((node, pos) => {
      const lvl = HEADING_LEVEL[node.type.name];
      if (lvl !== undefined) {
        // For a card, use its tag child's text as the label.
        let text = node.textContent.trim();
        if (node.type.name === "card") {
          const tag = node.firstChild;
          text = tag ? tag.textContent.trim() : "(card)";
        }
        if (node.type.name === "card") {
          items.push({ pos, level: lvl, text: text || "(card)" });
          return false; // don't descend into the card's tag again
        }
        items.push({ pos, level: lvl, text: text || "(untitled)" });
      }
      return undefined;
    });
    outline = items;
  }

  function scrollToPos(pos: number) {
    if (!view) return;
    const { state } = view;
    const clamped = Math.min(pos + 1, state.doc.content.size);
    try {
      const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(clamped)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    } catch { /* position no longer valid */ }
  }
  let applyingExternal = false;

  $effect(() => {
    if (!mountEl || mounted) return;
    mounted = true;

    const doc = initialDoc
      ? (() => {
          try { return schema.nodeFromJSON(initialDoc); } catch { return undefined; }
        })()
      : undefined;

    const state = EditorState.create({
      schema,
      doc,
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
        if (tr.docChanged) {
          rebuildOutline();
          if (!applyingExternal) onchange?.(view.state.doc.toJSON());
        }
      },
    });
    rebuildOutline();
    view.focus();
  });

  /** Serialise the current document to JSON (for pop-out handoff / persistence). */
  export function getDocJSON(): unknown {
    return view?.state.doc.toJSON() ?? null;
  }

  /** Replace the document from external JSON (pop-out sync) without echoing back. */
  export function setDocJSON(json: unknown) {
    if (!view || !json) return;
    try {
      const doc = schema.nodeFromJSON(json);
      applyingExternal = true;
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
      tr.setMeta("addToHistory", false);
      view.updateState(view.state.apply(tr));
      applyingExternal = false;
      rebuildOutline();
    } catch (err) {
      console.error("setDocJSON failed", err);
      applyingExternal = false;
    }
  }

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

  function setHighlight(color: string) {
    if (!view) return;
    const m = schema.marks.highlight;
    if (color === "none") {
      // Clear highlight in the selection.
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.removeMark(from, to, m));
    } else {
      // Force-apply the chosen colour (not toggle) so switching colours works.
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.addMark(from, to, m.create({ color })));
    }
    view.focus();
  }

  const HL_COLORS = [
    { name: "yellow", css: "#ffff00" },
    { name: "green", css: "#00ff00" },
    { name: "cyan", css: "#00ffff" },
    { name: "magenta", css: "#ff00ff" },
    { name: "blue", css: "#4d7bff" },
  ];
</script>

<div class="speech-doc pmd-document">
  <div class="doc-toolbar">
    <select class="heading-select" onchange={(e) => setBlock((e.currentTarget as HTMLSelectElement).value)}>
      <option value="paragraph">¶ Body</option>
      <option value="pocket">Pocket (H1)</option>
      <option value="hat">Hat (H2)</option>
      <option value="block">Block (H3)</option>
      <option value="cite_paragraph">Cite</option>
      <option value="card_body">Card Body</option>
      <option value="undertag">Undertag</option>
    </select>
    <div class="toolbar-sep"></div>
    <button class="tb-btn" class:active={markActive("bold")} onclick={() => mark("bold")} title="Bold (⌘B)"><b>B</b></button>
    <button class="tb-btn" class:active={markActive("italic")} onclick={() => mark("italic")} title="Italic (⌘I)"><i>I</i></button>
    <button class="tb-btn" class:active={markActive("underline_mark")} onclick={() => mark("underline_mark")} title="Underline — the cut"><u>U</u></button>
    <button class="tb-btn" class:active={markActive("emphasis_mark")} onclick={() => mark("emphasis_mark")} title="Emphasis — boxed power word"><span class="emph">E</span></button>
    <button class="tb-btn" class:active={markActive("strikethrough")} onclick={() => mark("strikethrough")} title="Strikethrough"><s>S</s></button>
    <div class="toolbar-sep"></div>
    <span class="hl-label" title="Highlight (spoken text)">Hl</span>
    {#each HL_COLORS as c}
      <button class="hl-swatch" style="background:{c.css}" onclick={() => setHighlight(c.name)} title="Highlight {c.name}"></button>
    {/each}
    <button class="hl-swatch clear" onclick={() => setHighlight("none")} title="Clear highlight">⌀</button>
    <div class="toolbar-sep"></div>
    {#if onexpand}
      <button class="tb-btn icon" onclick={onexpand} title={expanded ? "Collapse to side panel" : "Expand to fill"}>{expanded ? "⇥" : "⤢"}</button>
    {/if}
    {#if onpopout}
      <button class="tb-btn icon" onclick={onpopout} title={poppedOut ? "Dock back into app" : "Pop out into its own window"}>{poppedOut ? "⤓" : "⇱"}</button>
    {/if}
    <button class="tb-btn icon" class:active={showOutline} onclick={() => (showOutline = !showOutline)} title="Toggle outline">☰</button>
    <span class="doc-label">Speech Doc</span>
  </div>

  <div class="doc-body">
    {#if showOutline}
      <aside class="outline">
        <div class="outline-head">Outline</div>
        {#if outline.length === 0}
          <div class="outline-empty">No headings yet.</div>
        {:else}
          {#each outline as item (item.pos)}
            <button
              class="outline-item lvl{item.level}"
              onclick={() => scrollToPos(item.pos)}
              title={item.text}
            >{item.text}</button>
          {/each}
        {/if}
      </aside>
    {/if}
    <div class="doc-scroll">
      <div class="doc-page" bind:this={mountEl}></div>
    </div>
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
  .tb-btn.icon { min-width: 26px; font-size: 14px; }
  .hl-label { font-size: 11px; color: var(--text-dim); margin: 0 2px; }
  .hl-swatch {
    width: 18px;
    height: 18px;
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
  }
  .hl-swatch:hover { outline: 1.5px solid var(--accent); }
  .hl-swatch.clear {
    background: var(--bg) !important;
    color: var(--text-dim);
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
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
  .doc-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .outline {
    width: 200px;
    flex-shrink: 0;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--panel);
    padding: 6px 0;
  }
  .outline-head {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    font-weight: 700;
    padding: 4px 12px 6px;
  }
  .outline-empty { font-size: 12px; color: var(--text-dim); padding: 4px 12px; }
  .outline-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    padding: 3px 12px 3px 12px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 2px solid transparent;
  }
  .outline-item:hover { background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
  .outline-item.lvl1 { font-weight: 700; padding-left: 12px; }
  .outline-item.lvl2 { font-weight: 600; padding-left: 22px; }
  .outline-item.lvl3 { padding-left: 32px; }
  .outline-item.lvl4 { padding-left: 42px; color: var(--text-dim); }
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
