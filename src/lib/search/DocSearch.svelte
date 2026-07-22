<script lang="ts">
  import { fileIndex, relativeTime, type LibFile } from "./file-index.svelte";
  import { parseDocx, nodeChip, type DocNode } from "$lib/docx/parse";
  import { store } from "$lib/model/round.svelte";
  import { invoke } from "@tauri-apps/api/core";

  let { onclose, onappenddoc = null, onappendcm = null, docOnly = false }: {
    onclose: () => void;
    onappenddoc?: ((node: DocNode) => void) | null;
    onappendcm?: ((jsonNodes: unknown[]) => void) | null;
    docOnly?: boolean;
  } = $props();

  // CardMirror doc per file (fromDocx) — the exact card structure to insert.
  const cmDocCache = new Map<string, unknown>();

  /** Parse a file with CardMirror's own fromDocx and cache the PM doc JSON. */
  async function getCMDocJSON(file: LibFile): Promise<{ type: string; content?: unknown[] } | null> {
    if (cmDocCache.has(file.path)) return cmDocCache.get(file.path) as never;
    try {
      const bytes = await invoke<number[]>("read_binary_file", { path: file.path });
      const { fromDocx } = await import("$lib/cardmirror");
      const doc = await fromDocx(new Uint8Array(bytes));
      const json = doc.toJSON();
      // Clean up empty-box artifacts (emphasis/bold on whitespace-only runs);
      // otherwise preserve CardMirror's exact styles.
      cleanWhitespaceMarks(json);
      cmDocCache.set(file.path, json);
      return json as never;
    } catch (err) {
      console.error("fromDocx failed", err);
      return null;
    }
  }

  // In-place: strip emphasis/bold marks from whitespace-only text runs — a
  // boxed/emphasised space renders as an empty box. Everything else is left as
  // CardMirror produced it.
  function cleanWhitespaceMarks(node: unknown): void {
    const o = node as { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] };
    if (o.type === "text" && o.marks && !(o.text ?? "").trim()) {
      o.marks = o.marks.filter((m) => m.type !== "emphasis_mark" && m.type !== "bold");
    }
    if (Array.isArray(o.content)) o.content.forEach(cleanWhitespaceMarks);
  }

  // Level of a CardMirror top-level node (pocket=1 … card/analytic=4).
  function cmLevel(n: { type: string }): number {
    return { pocket: 1, hat: 2, block: 3, card: 4, analytic_unit: 4, tag: 4 }[n.type] ?? 5;
  }
  function cmLabel(n: { type: string; content?: { textContent?: string } }): string {
    // For a card/analytic_unit the label is the first child's text; else the node's text.
    const flat = (node: unknown): string => {
      const o = node as { text?: string; content?: unknown[] };
      if (o.text) return o.text;
      return (o.content ?? []).map(flat).join("");
    };
    const o = n as { type: string; content?: unknown[] };
    if ((n.type === "card" || n.type === "analytic_unit") && o.content?.length) return flat(o.content[0]);
    return flat(n);
  }

  /** Extract the JSON node range for the selected heading label from a CM doc. */
  function extractCMNodes(cmJson: { content?: unknown[] }, label: string, level: number): unknown[] {
    const tops = (cmJson.content ?? []) as { type: string }[];
    const target = label.trim();
    let start = -1;
    for (let i = 0; i < tops.length; i++) {
      if (cmLevel(tops[i]) === level && cmLabel(tops[i]).trim() === target) { start = i; break; }
    }
    if (start < 0) return [];
    // A card/analytic (level 4) is a single node; a heading owns following
    // deeper nodes until the next same-or-higher heading.
    if (level >= 4) return [tops[start]];
    let end = start + 1;
    while (end < tops.length && cmLevel(tops[end]) > level) end++;
    return tops.slice(start, end);
  }

  // ── state ──────────────────────────────────────────────────────
  let mode = $state<"files" | "within">("files");
  let query = $state("");
  let prevQuery = $state("");
  let selectedIdx = $state(0);
  let chip = $state<"all" | 1 | 2 | 3 | 4 | "body">("all");

  let divedFile = $state<LibFile | null>(null);
  let divedNodes = $state<DocNode[]>([]);
  let parsing = $state(false);
  let parseError = $state("");
  const parseCache = new Map<string, DocNode[]>();

  // Collapsed node keys (path-based) in the tree.
  let collapsed = $state<Set<string>>(new Set());

  let inputEl = $state<HTMLInputElement>();
  $effect(() => { inputEl?.focus(); });

  // ── file list ──────────────────────────────────────────────────
  const fileResults = $derived(fileIndex.search(query, 200));

  // ── tree rows (within-file) ────────────────────────────────────
  interface Row { node: DocNode; depth: number; key: string; hasKids: boolean; }

  // The set of node keys that match the query (plus their ancestors), so the
  // tree filters like Halcyon: matching branches stay, everything else hides.
  function computeMatchSet(): Set<string> | null {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const keep = new Set<string>();
    const walk = (nodes: DocNode[], prefix: string, ancestors: string[]) => {
      nodes.forEach((n, i) => {
        const key = prefix + i;
        const chipOk = chip === "all" || chip === "body" || n.level === chip;
        const hit = chipOk && n.text.toLowerCase().includes(q);
        if (hit) { keep.add(key); ancestors.forEach((a) => keep.add(a)); }
        walk(n.children, key + ".", [...ancestors, key]);
      });
    };
    walk(divedNodes, "", []);
    return keep;
  }

  const rows = $derived.by<Row[]>(() => {
    if (mode !== "within") return [];
    const matchSet = computeMatchSet();
    // A numeric chip caps the depth: "HAT" shows Pockets + Hats only, not the
    // Blocks/Tags beneath them (collapse to that level).
    const capLevel = typeof chip === "number" ? chip : Infinity;
    const out: Row[] = [];
    const walk = (nodes: DocNode[], depth: number, prefix: string) => {
      nodes.forEach((n, i) => {
        const key = prefix + i;
        if (matchSet) {
          if (!matchSet.has(key)) return;
        } else if (n.level > capLevel) {
          return; // deeper than the chosen level — hidden
        }
        const capReached = !matchSet && n.level >= capLevel;
        const hasKids = n.children.length > 0;
        out.push({ node: n, depth, key, hasKids: hasKids && !capReached });
        const isCollapsed = collapsed.has(key) && !matchSet;
        if (hasKids && !isCollapsed && !capReached) walk(n.children, depth + 1, key + ".");
      });
    };
    walk(divedNodes, 0, "");
    return out.slice(0, 400);
  });

  $effect(() => { rows; fileResults; if (selectedIdx >= activeLen()) selectedIdx = 0; });
  function activeLen() { return mode === "files" ? fileResults.length : rows.length; }

  // ── dive into a file ──────────────────────────────────────────
  async function diveInto(file: LibFile) {
    if (parseCache.has(file.path)) {
      setDived(file, parseCache.get(file.path)!);
      return;
    }
    parsing = true; parseError = "";
    try {
      if (file.name.startsWith("~$")) throw new Error("Word lock file");
      const bytes = await invoke<number[]>("read_binary_file", { path: file.path });
      const parsed = parseDocx(new Uint8Array(bytes).buffer);
      parseCache.set(file.path, parsed.nodes);
      setDived(file, parsed.nodes);
    } catch (err) {
      parseError = `Could not read "${file.name}": ${err instanceof Error ? err.message : err}`;
    } finally {
      parsing = false;
    }
  }
  function setDived(file: LibFile, nodes: DocNode[]) {
    divedFile = file; divedNodes = nodes;
    prevQuery = query; query = ""; mode = "within"; selectedIdx = 0;
    collapsed = new Set();
  }
  function backToFiles() {
    mode = "files"; query = prevQuery; divedFile = null; divedNodes = [];
    parseError = ""; selectedIdx = 0;
  }

  // ── insert ────────────────────────────────────────────────────
  async function insertNode(node: DocNode) {
    // Flow cell gets the header text (fast, from the lightweight parse).
    if (!docOnly && store.round && store.cursor && store.activeSheetId) {
      const { row, col } = store.cursor;
      store.mutate((r) => {
        const sheet = r.sheets.find((s) => s.id === store.activeSheetId);
        if (!sheet) return;
        while (sheet.rows.length <= row) {
          const nCols = r.template.speeches.length;
          sheet.rows.push({ id: crypto.randomUUID(), cells: Array.from({ length: nCols }, () => ({ text: "" })) });
        }
        const cell = sheet.rows[row].cells[col];
        cell.text = node.text;
        cell.chip = nodeChip(node);
        cell.card = node;
      });
    }
    // Speech doc gets the EXACT CardMirror card via fromDocx.
    if (divedFile && onappendcm) {
      const cm = await getCMDocJSON(divedFile);
      if (cm) {
        const nodes = extractCMNodes(cm as never, node.text, node.level);
        if (nodes.length) { onappendcm(nodes); return; }
      }
    }
    onappenddoc?.(node); // fallback to the approximate adapter
  }

  function activateSelected() {
    if (mode === "files") {
      const f = fileResults[selectedIdx];
      if (f) void diveInto(f);
    } else {
      const r = rows[selectedIdx];
      if (r) { insertNode(r.node); onclose(); }
    }
  }

  // ── collapse helpers ──────────────────────────────────────────
  function toggle(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    collapsed = next;
  }
  function collapseAll() {
    // Collapse every node that has children.
    const next = new Set<string>();
    const walk = (nodes: DocNode[], prefix: string) => {
      nodes.forEach((n, i) => {
        const key = prefix + i;
        if (n.children.length) { next.add(key); walk(n.children, key + "."); }
      });
    };
    walk(divedNodes, "");
    collapsed = next;
  }
  function expandAll() { collapsed = new Set(); }

  // ── keyboard ──────────────────────────────────────────────────
  function onkeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") { e.preventDefault(); if (mode === "within") backToFiles(); else onclose(); return; }
    if (mod && e.key === "k") { e.preventDefault(); onclose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, activeLen() - 1); scrollSel(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); scrollSel(); return; }
    if (mode === "within" && e.key === "ArrowRight") {
      e.preventDefault();
      const r = rows[selectedIdx];
      if (r?.hasKids && collapsed.has(r.key)) toggle(r.key);
      return;
    }
    if (mode === "within" && e.key === "ArrowLeft") {
      e.preventDefault();
      const r = rows[selectedIdx];
      if (r?.hasKids && !collapsed.has(r.key)) toggle(r.key);
      return;
    }
    if (e.key === "Tab" && mode === "files") {
      e.preventDefault();
      const f = fileResults[selectedIdx]; if (f) void diveInto(f);
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); activateSelected(); return; }
  }

  let listEl = $state<HTMLElement>();
  function scrollSel() {
    requestAnimationFrame(() => listEl?.children[selectedIdx]?.scrollIntoView({ block: "nearest" }));
  }

  // ── chips ─────────────────────────────────────────────────────
  const CHIPS: { id: "all" | 1 | 2 | 3 | 4 | "body"; label: string }[] = [
    { id: "all", label: "ALL" }, { id: 1, label: "POC" }, { id: 2, label: "HAT" },
    { id: 3, label: "BLK" }, { id: 4, label: "TAG" }, { id: "body", label: "BODY" },
  ];
  function chipFor(level: number): { label: string; cls: string } {
    return [
      { label: "", cls: "" },
      { label: "POC", cls: "c-poc" },
      { label: "HAT", cls: "c-hat" },
      { label: "BLK", cls: "c-blk" },
      { label: "TAG", cls: "c-tag" },
    ][level] ?? { label: "TAG", cls: "c-tag" };
  }

  // ── panel drag (move the whole panel) ─────────────────────────
  let px = $state(0), py = $state(0), dragging = false, dx = 0, dy = 0;
  function startDrag(e: PointerEvent) {
    dragging = true; dx = e.clientX - px; dy = e.clientY - py;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent) { if (dragging) { px = e.clientX - dx; py = e.clientY - dy; } }
  function endDrag() { dragging = false; }

  // ── build full card for drag payload ──────────────────────────
  function buildFullCard(node: DocNode): string {
    const lines: string[] = [node.text, ...node.body];
    const walk = (ns: DocNode[]) => { for (const n of ns) { lines.push(n.text); lines.push(...n.body); walk(n.children); } };
    walk(node.children);
    return lines.filter(Boolean).join("\n");
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ds-panel" style="transform: translate({px}px, {py}px)" onkeydown={onkeydown} onpointermove={moveDrag} onpointerup={endDrag} role="dialog" aria-label="Doc Search" tabindex="-1">
  <!-- Header (drag handle) -->
  <div class="ds-header" onpointerdown={startDrag}>
    <div class="ds-title">
      <span class="ds-name">Doc Search</span>
      <span class="ds-hint">· drag to move</span>
    </div>
    <button class="ds-x" onpointerdown={(e) => e.stopPropagation()} onclick={onclose}>✕</button>
  </div>
  {#if mode === "within" && divedFile}
    <div class="ds-sub">In: {divedFile.name}</div>
  {/if}

  <!-- Chips (within-file) -->
  {#if mode === "within"}
    <div class="ds-chips">
      {#each CHIPS as c}
        <button class="ds-chip" class:on={chip === c.id} onclick={() => { chip = c.id; selectedIdx = 0; }}>{c.label}</button>
      {/each}
      <span class="ds-spacer"></span>
      <button class="ds-mini" onclick={collapseAll} title="Collapse all">⊟</button>
      <button class="ds-mini" onclick={expandAll} title="Expand all">⊞</button>
    </div>
  {/if}

  <!-- Search input -->
  <input
    bind:this={inputEl}
    bind:value={query}
    class="ds-input"
    placeholder={mode === "files" ? "🔍  Find a file by name…" : "🔍  Filter blocks / cards / tags…"}
    spellcheck="false"
    autocomplete="off"
  />

  <!-- Results -->
  <div class="ds-list" bind:this={listEl}>
    {#if parseError}
      <div class="ds-msg err">{parseError}</div>
    {:else if parsing}
      <div class="ds-msg">Parsing…</div>
    {:else if mode === "files"}
      {#if fileIndex.files.length === 0}
        <div class="ds-msg">{fileIndex.scanning ? "Scanning library…" : "No files. Add a folder in Settings → Search Library."}</div>
      {:else if fileResults.length === 0}
        <div class="ds-msg">No files match "{query}"</div>
      {:else}
        {#each fileResults as file, i (file.path)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="ds-file" class:sel={i === selectedIdx}
            onclick={() => { selectedIdx = i; void diveInto(file); }}
            onmouseenter={() => (selectedIdx = i)}>
            <span class="ds-fileicon">📄</span>
            <span class="ds-filename">{file.name}</span>
            <span class="ds-filemeta">{relativeTime(file.mtime)}</span>
            <span class="ds-tab">Tab ›</span>
          </div>
        {/each}
      {/if}
    {:else}
      {#if rows.length === 0}
        <div class="ds-msg">{query ? `No matches for "${query}"` : "No headings found."}</div>
      {:else}
        {#each rows as r, i (r.key)}
          {@const ci = chipFor(r.node.level)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="ds-row" class:sel={i === selectedIdx}
            style="padding-left: {8 + r.depth * 16}px"
            draggable="true"
            ondragstart={(e) => {
              e.dataTransfer?.setData("text/nimbus-block", JSON.stringify({ header: r.node.text, fullCard: buildFullCard(r.node), node: r.node }));
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
            }}
            onclick={() => { selectedIdx = i; insertNode(r.node); onclose(); }}
            onmouseenter={() => (selectedIdx = i)}>
            {#if r.hasKids}
              <button class="ds-arrow" onclick={(e) => { e.stopPropagation(); toggle(r.key); }}>{collapsed.has(r.key) ? "▸" : "▾"}</button>
            {:else}
              <span class="ds-arrow ghost"></span>
            {/if}
            <span class="ds-typechip {ci.cls}">{ci.label}</span>
            <span class="ds-rowtext">{r.node.text}</span>
          </div>
        {/each}
      {/if}
    {/if}
  </div>

  <!-- Footer -->
  <div class="ds-footer">
    {#if mode === "within"}
      <button class="ds-back" onclick={backToFiles}>‹ Back to files</button>
    {:else}
      <span class="ds-count">{fileResults.length} of {fileIndex.files.length}</span>
    {/if}
    <span class="ds-keys">↑↓ nav · →← expand · ↵ insert</span>
    {#if mode === "within"}
      <button class="ds-insert" onclick={activateSelected}>Insert</button>
    {/if}
  </div>
</div>

<style>
  .ds-panel {
    position: fixed;
    top: 64px;
    right: 20px;
    width: 440px;
    max-height: 78vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.35);
    z-index: 200;
    overflow: hidden;
    font-size: 13px;
  }
  .ds-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 4px;
    cursor: grab;
  }
  .ds-header:active { cursor: grabbing; }
  .ds-title { display: flex; align-items: baseline; gap: 6px; }
  .ds-name { font-weight: 700; font-size: 14px; }
  .ds-hint { font-size: 11px; color: var(--text-dim); }
  .ds-x { background: none; border: none; color: var(--text-dim); font-size: 14px; cursor: pointer; }
  .ds-x:hover { color: var(--text); }
  .ds-sub { font-size: 11px; color: var(--text-dim); padding: 0 12px 6px; }

  .ds-chips { display: flex; align-items: center; gap: 3px; padding: 4px 12px; flex-wrap: wrap; }
  .ds-chip {
    background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 5px; padding: 2px 8px; font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: 0.03em;
  }
  .ds-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .ds-spacer { flex: 1; }
  .ds-mini { background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); border-radius: 5px; padding: 1px 6px; cursor: pointer; font-size: 12px; }
  .ds-mini:hover { color: var(--text); }

  .ds-input {
    margin: 4px 12px 8px;
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 7px 10px; font-size: 13px; outline: none;
  }
  .ds-input:focus { border-color: var(--accent); }

  .ds-list { overflow-y: auto; flex: 1; padding: 2px 0; }
  .ds-msg { padding: 16px; color: var(--text-dim); text-align: center; }
  .ds-msg.err { color: var(--mark-dropped); }

  .ds-file { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; }
  .ds-file.sel { background: color-mix(in srgb, var(--accent) 15%, var(--panel)); }
  .ds-file:hover:not(.sel) { background: color-mix(in srgb, var(--text) 5%, var(--panel)); }
  .ds-filename { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds-filemeta { font-size: 11px; color: var(--text-dim); }
  .ds-tab { font-size: 11px; color: var(--text-dim); }
  .ds-file.sel .ds-tab { color: var(--accent); }

  .ds-row { display: flex; align-items: center; gap: 6px; padding: 4px 12px 4px 8px; cursor: pointer; }
  .ds-row.sel { background: color-mix(in srgb, var(--accent) 15%, var(--panel)); }
  .ds-row:hover:not(.sel) { background: color-mix(in srgb, var(--text) 5%, var(--panel)); }
  .ds-arrow { background: none; border: none; color: var(--text-dim); cursor: pointer; width: 14px; font-size: 10px; padding: 0; flex-shrink: 0; }
  .ds-arrow.ghost { cursor: default; }
  .ds-typechip {
    font-size: 9px; font-weight: 800; letter-spacing: 0.04em; color: #fff;
    border-radius: 4px; padding: 1px 5px; flex-shrink: 0; min-width: 30px; text-align: center;
  }
  .c-poc { background: #6b52d1; }
  .c-hat { background: #8a63d2; }
  .c-blk { background: #c0392b; }
  .c-tag { background: #2e8b57; }
  .ds-rowtext { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .ds-footer {
    display: flex; align-items: center; gap: 8px; padding: 7px 12px;
    border-top: 1px solid var(--border); font-size: 11px; color: var(--text-dim);
  }
  .ds-back { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 12px; padding: 0; }
  .ds-back:hover { color: var(--text); }
  .ds-keys { flex: 1; text-align: center; }
  .ds-insert {
    background: var(--accent); border: none; color: #fff; border-radius: 6px;
    padding: 4px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
</style>
