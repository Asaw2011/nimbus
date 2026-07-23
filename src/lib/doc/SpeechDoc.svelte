<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { toggleMark, setBlockType, baseKeymap } from "prosemirror-commands";
  import { keymap } from "prosemirror-keymap";
  import { history, undo, redo } from "prosemirror-history";
  import { Fragment, type Node as PMNode } from "prosemirror-model";
  import type { DocNode } from "$lib/docx/parse";
  import { cardmirrorSchema as schema, nodesFromDocNode } from "$lib/cardmirror/adapter";
  import { readModePlugin, readModeKey } from "./readMode";
  import { settings } from "$lib/model/settings.svelte";
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
  let collapsedOutline = $state<Set<number>>(new Set());

  // Visible outline honouring collapsed ancestors, with a hasKids flag.
  const visibleOutline = $derived.by(() => {
    const res: (OutlineItem & { hasKids: boolean })[] = [];
    let hideLevel = Infinity;
    outline.forEach((it, i) => {
      if (it.level > hideLevel) return; // hidden under a collapsed ancestor
      hideLevel = Infinity;
      const next = outline[i + 1];
      const hasKids = !!next && next.level > it.level;
      res.push({ ...it, hasKids });
      if (collapsedOutline.has(it.pos)) hideLevel = it.level;
    });
    return res;
  });

  function toggleOutline(pos: number) {
    const next = new Set(collapsedOutline);
    if (next.has(pos)) next.delete(pos); else next.add(pos);
    collapsedOutline = next;
  }
  // Collapse the whole outline to a given level (Pocket=1 / Hat=2 / Block=3).
  function collapseOutlineTo(level: number) {
    const next = new Set<number>();
    outline.forEach((it, i) => {
      const child = outline[i + 1];
      if (it.level >= level && child && child.level > it.level) next.add(it.pos);
    });
    collapsedOutline = next;
  }
  const HEADING_LEVEL: Record<string, number> = {
    pocket: 1, hat: 2, block: 3, card: 4, tag: 4, analytic: 4, analytic_unit: 4,
  };

  function rebuildOutline() {
    if (!view) return;
    const items: OutlineItem[] = [];
    view.state.doc.descendants((node, pos) => {
      const lvl = HEADING_LEVEL[node.type.name];
      if (lvl !== undefined) {
        // A card / analytic_unit is a wrapper whose first child is the heading
        // (tag / analytic). Use that child's text and DON'T descend — otherwise
        // the inner heading (also level 4) would push a second, doubled item.
        if (node.type.name === "card" || node.type.name === "analytic_unit") {
          const head = node.firstChild;
          const text = head ? head.textContent.trim() : "";
          items.push({ pos, level: lvl, text: text || "(untitled)" });
          return false;
        }
        const text = node.textContent.trim();
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
        readModePlugin(),
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        // Style shortcuts: ⌘1 Pocket, ⌘2 Hat, ⌘3 Block, ⌘4 Tag, ⌘5 Analytic,
        // ⌘6 Undertag, ⌘0 Body.
        keymap({
          "Mod-1": () => (setBlock("pocket"), true),
          "Mod-2": () => (setBlock("hat"), true),
          "Mod-3": () => (setBlock("block"), true),
          "Mod-4": () => (setBlock("tag"), true),
          "Mod-5": () => (setBlock("analytic"), true),
          "Mod-6": () => (setBlock("undertag"), true),
          "Mod-0": () => (setBlock("paragraph"), true),
        }),
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

  /** Remove the first top-level card/heading whose label matches `text`. */
  export function removeByText(text: string) {
    if (!view || !text.trim()) return;
    const target = text.trim();
    const { state } = view;
    let foundPos = -1;
    let foundSize = 0;
    state.doc.forEach((node, offset) => {
      if (foundPos >= 0) return;
      const label =
        node.type.name === "card" || node.type.name === "analytic_unit"
          ? node.firstChild?.textContent ?? ""
          : node.textContent;
      if (label.trim() === target) { foundPos = offset; foundSize = node.nodeSize; }
    });
    if (foundPos >= 0) view.dispatch(state.tr.delete(foundPos, foundPos + foundSize));
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
    if (type === "analytic") { makeAnalytic(); return; }
    if (type === "tag") { makeCard(); return; }
    const nt = schema.nodes[type];
    if (nt) setBlockType(nt)(view.state, view.dispatch);
    view.focus();
  }

  // Tag lives inside a card — wrap the current line in a card > tag.
  function makeCard() {
    if (!view) return;
    const { state } = view;
    const pos = state.selection.$from;
    const text = pos.parent.textContent;
    const tag = schema.nodes.tag.create(
      { id: crypto.randomUUID() },
      text ? [schema.text(text)] : undefined,
    );
    const card = schema.nodes.card.create(null, [tag]);
    const from = pos.before();
    const to = pos.after();
    const tr = state.tr.replaceWith(from, to, card);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  // Analytic lives inside an analytic_unit — the plain setBlockType can't create
  // one. Wrap the current line in an analytic_unit > analytic so you can type it.
  function makeAnalytic() {
    if (!view) return;
    const { state } = view;
    const pos = state.selection.$from;
    const para = pos.parent;
    const text = para.textContent;
    const heading = schema.nodes.analytic.create(
      { id: crypto.randomUUID() },
      text ? [schema.text(text)] : undefined,
    );
    const unit = schema.nodes.analytic_unit.create(null, [heading]);
    const from = pos.before();
    const to = pos.after();
    const tr = state.tr.replaceWith(from, to, unit);
    // Put the cursor inside the analytic heading.
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
    view.dispatch(tr.scrollIntoView());
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

  let readMode = $state(false);
  let sendStatus = $state("");

  // Drop analytics (own analysis) before export: whole analytic_units, and
  // any analytic heading inside a card. Mirrors CardMirror's stripAnalytics.
  function stripAnalytics(doc: PMNode): PMNode {
    const out: PMNode[] = [];
    doc.forEach((child) => {
      if (child.type.name === "analytic_unit") return;
      if (child.type.name === "card") {
        const kids: PMNode[] = [];
        child.forEach((c) => { if (c.type.name !== "analytic") kids.push(c); });
        out.push(child.copy(Fragment.fromArray(kids)));
      } else {
        out.push(child);
      }
    });
    return schema.node("doc", null, Fragment.fromArray(out));
  }

  /** Empty the whole document (for a clean re-send). */
  export function clearDoc() {
    if (!view) return;
    const empty = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, empty.content));
  }

  function toggleReadMode() {
    readMode = !readMode;
    if (view) {
      view.dispatch(view.state.tr.setMeta(readModeKey, { on: readMode }));
    }
  }

  async function sendDoc() {
    if (!view) return;
    try {
      // Export with CardMirror's own toDocx so the file round-trips into
      // CardMirror perfectly. Analytics are the flow-er's own analysis —
      // stripped from the sent doc (like CardMirror's includeAnalytics:false).
      const { toDocx } = await import("$lib/cardmirror");
      const bytes = await toDocx(stripAnalytics(view.state.doc));
      if ("__TAURI_INTERNALS__" in window) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          defaultPath: "Speech.docx",
          filters: [{ name: "Word Document", extensions: ["docx"] }],
        });
        if (!path) return;
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
      } else {
        const blob = new Blob([bytes as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "Speech.docx"; a.click();
        URL.revokeObjectURL(url);
      }
      sendStatus = "Saved ✓";
    } catch (err) {
      sendStatus = "Export failed";
      console.error(err);
    }
    setTimeout(() => (sendStatus = ""), 2500);
  }

  /** Insert CardMirror-schema nodes (from fromDocx) directly at the doc end. */
  // A whitespace-only text run must never carry a *visible* character mark
  // (emphasis box / cite / underline) — it renders as an empty box or a stray
  // "_ _" gap. Strip those marks from blank runs before insert; keep highlight
  // (a highlighted space is invisible and harmless, and preserves spacing).
  function stripBlankRunMarks(node: unknown): void {
    const o = node as { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] };
    if (o.type === "text" && o.marks && !(o.text ?? "").trim()) {
      o.marks = o.marks.filter(
        (m) => m.type !== "emphasis_mark" && m.type !== "cite_mark" &&
               m.type !== "underline_mark" && m.type !== "bold",
      );
    }
    if (Array.isArray(o.content)) o.content.forEach(stripBlankRunMarks);
  }

  export function appendCMNodes(jsonNodes: unknown[]) {
    if (!view || jsonNodes.length === 0) return;
    try {
      jsonNodes.forEach(stripBlankRunMarks);
      const nodes = jsonNodes.map((j) => schema.nodeFromJSON(j));
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, nodes).scrollIntoView());
    } catch (err) {
      console.error("appendCMNodes failed", err);
    }
  }
</script>

<div
  class="speech-doc pmd-document"
  class:pmd-read-mode={readMode}
  class:pmd-emphasis-box={settings.docTypography.emphasisBox}
  class:pmd-emphasis-bold={settings.docTypography.emphasisBold}
  class:pmd-emphasis-italic={settings.docTypography.emphasisItalic}
  style="--pmd-emphasis-box-size: {settings.docTypography.emphasisBoxSize}pt"
>
  <div class="doc-toolbar">
    <select class="heading-select" onchange={(e) => setBlock((e.currentTarget as HTMLSelectElement).value)}>
      <option value="paragraph">¶ Body · ⌘0</option>
      <option value="pocket">Pocket · ⌘1</option>
      <option value="hat">Hat · ⌘2</option>
      <option value="block">Block · ⌘3</option>
      <option value="tag">Tag · ⌘4</option>
      <option value="analytic">Analytic · ⌘5</option>
      <option value="undertag">Undertag · ⌘6</option>
      <option value="cite_paragraph">Cite</option>
      <option value="card_body">Card Body</option>
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
    <button class="tb-btn read" class:active={readMode} onclick={toggleReadMode} title="Read mode — show only the read-aloud text">Read</button>
    <button class="tb-btn" onclick={clearDoc} title="Clear the whole document">Clear</button>
    <button class="tb-btn send" onclick={sendDoc} title="Export / send as .docx">Send</button>
    {#if sendStatus}<span class="send-status">{sendStatus}</span>{/if}
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
        <div class="outline-head">
          <span>Outline</span>
          <span class="outline-levels">
            <button title="Collapse to Pocket" onclick={() => collapseOutlineTo(1)}>P</button>
            <button title="Collapse to Hat" onclick={() => collapseOutlineTo(2)}>H</button>
            <button title="Collapse to Block" onclick={() => collapseOutlineTo(3)}>B</button>
            <button title="Expand all" onclick={() => (collapsedOutline = new Set())}>⊞</button>
          </span>
        </div>
        {#if outline.length === 0}
          <div class="outline-empty">No headings yet.</div>
        {:else}
          {#each visibleOutline as item (item.pos)}
            <div class="outline-row lvl{item.level}">
              {#if item.hasKids}
                <button class="outline-arrow" onclick={() => toggleOutline(item.pos)}>{collapsedOutline.has(item.pos) ? "▸" : "▾"}</button>
              {:else}
                <span class="outline-arrow ghost"></span>
              {/if}
              <button class="outline-item" onclick={() => scrollToPos(item.pos)} title={item.text}>{item.text}</button>
            </div>
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
  .tb-btn.read, .tb-btn.send { font-size: 12px; min-width: auto; padding: 3px 10px; }
  .tb-btn.read.active { background: #2e8b57; border-color: #2e8b57; color: #fff; }
  .tb-btn.send { color: var(--accent); border-color: var(--accent); }
  .send-status { font-size: 11px; color: var(--text-dim); }
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    font-weight: 700;
    padding: 4px 8px 6px 12px;
  }
  .outline-levels { display: flex; gap: 2px; }
  .outline-levels button {
    background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 4px; width: 18px; height: 18px; font-size: 10px; cursor: pointer; padding: 0;
  }
  .outline-levels button:hover { color: var(--text); border-color: var(--accent); }
  .outline-empty { font-size: 12px; color: var(--text-dim); padding: 4px 12px; }
  .outline-row { display: flex; align-items: center; }
  .outline-row.lvl1 { padding-left: 4px; }
  .outline-row.lvl2 { padding-left: 14px; }
  .outline-row.lvl3 { padding-left: 24px; }
  .outline-row.lvl4 { padding-left: 34px; }
  .outline-arrow {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    width: 14px; font-size: 9px; padding: 0; flex-shrink: 0;
  }
  .outline-arrow.ghost { cursor: default; }
  .outline-item {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    padding: 3px 8px 3px 2px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .outline-item:hover { background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
  .outline-row.lvl1 .outline-item { font-weight: 700; }
  .outline-row.lvl2 .outline-item { font-weight: 600; }
  .outline-row.lvl4 .outline-item { color: var(--text-dim); }
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
