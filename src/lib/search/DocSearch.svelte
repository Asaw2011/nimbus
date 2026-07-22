<script lang="ts">
  import { fileIndex, relativeTime, type LibFile } from "./file-index.svelte";
  import { parseDocx, type DocNode } from "$lib/docx/parse";
  import { store } from "$lib/model/round.svelte";
  import { invoke } from "@tauri-apps/api/core";

  let { onclose, onappenddoc = null, docOnly = false }: {
    onclose: () => void;
    onappenddoc?: ((node: DocNode) => void) | null;
    docOnly?: boolean;
  } = $props();

  // ── state machine ──────────────────────────────────────────────
  let mode = $state<"files" | "within">("files");
  let query = $state("");
  let prevQuery = $state(""); // restored when pressing Esc from within-file
  let selectedIdx = $state(0);
  let chip = $state<"all" | 1 | 2 | 3 | 4>("all");

  // Within-file state
  let divedFile = $state<LibFile | null>(null);
  let divedNodes = $state<DocNode[]>([]);
  let parsing = $state(false);
  let parseError = $state("");

  // Parse cache: avoid re-parsing the same file during a session
  const parseCache = new Map<string, DocNode[]>();

  let inputEl = $state<HTMLInputElement>();

  $effect(() => {
    // Focus input whenever we open or switch modes
    inputEl?.focus();
  });

  // ── file list results ──────────────────────────────────────────
  const fileResults = $derived(fileIndex.search(query, 200));

  // ── within-file results ────────────────────────────────────────
  const withinResults = $derived.by(() => {
    if (mode !== "within") return [];
    const flat = flattenNodes(divedNodes, chip);
    if (!query.trim()) return flat.slice(0, 200);
    return flat
      .map((n) => ({ n, s: fileIndex.score(query, n.text) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 200)
      .map(({ n }) => n);
  });

  // Reset selection when results change
  $effect(() => {
    fileResults; withinResults; // track
    selectedIdx = 0;
  });

  const activeResults = $derived(mode === "files" ? fileResults : withinResults);

  // ── flatten nodes by chip filter ───────────────────────────────
  function flattenNodes(roots: DocNode[], filter: "all" | 1 | 2 | 3 | 4): DocNode[] {
    const out: DocNode[] = [];
    function walk(nodes: DocNode[]) {
      for (const n of nodes) {
        if (filter === "all" || n.level === filter) out.push(n);
        walk(n.children);
      }
    }
    walk(roots);
    return out;
  }

  // ── dive into a file ──────────────────────────────────────────
  async function diveInto(file: LibFile) {
    if (parseCache.has(file.path)) {
      divedFile = file;
      divedNodes = parseCache.get(file.path)!;
      prevQuery = query;
      query = "";
      mode = "within";
      selectedIdx = 0;
      return;
    }

    parsing = true;
    parseError = "";
    try {
      // Skip Word lock files defensively
      if (file.name.startsWith("~$")) throw new Error("Word lock file");
      const bytes = await invoke<number[]>("read_binary_file", { path: file.path });
      const buf = new Uint8Array(bytes).buffer;
      const parsed = parseDocx(buf);
      parseCache.set(file.path, parsed.nodes);
      divedFile = file;
      divedNodes = parsed.nodes;
      prevQuery = query;
      query = "";
      mode = "within";
      selectedIdx = 0;
    } catch (err) {
      parseError = `Could not read "${file.name}": ${err instanceof Error ? err.message : err}`;
    } finally {
      parsing = false;
    }
  }

  function backToFiles() {
    mode = "files";
    query = prevQuery;
    divedFile = null;
    divedNodes = [];
    parseError = "";
    selectedIdx = 0;
  }

  // ── insert into focused flow cell ─────────────────────────────
  function insertSelected() {
    const item = activeResults[selectedIdx];
    if (!item) return;

    if (mode === "files") {
      // On a file: dive in instead of inserting
      void diveInto(item as LibFile);
      return;
    }

    // In within-file mode: insert block header into the active flow cell,
    // and append full card to the speech doc if it's open.
    const node = item as DocNode;

    // In the pop-out doc window there's no flow grid — insert only into the doc.
    if (!docOnly && store.round && store.cursor && store.activeSheetId) {
      const { row, col } = store.cursor;
      store.mutate((r) => {
        const sheet = r.sheets.find((s) => s.id === store.activeSheetId);
        if (!sheet) return;
        while (sheet.rows.length <= row) {
          const nCols = r.template.speeches.length;
          sheet.rows.push({
            id: crypto.randomUUID(),
            cells: Array.from({ length: nCols }, () => ({ text: "" })),
          });
        }
        sheet.rows[row].cells[col].text = node.text;
      });
    }

    // Append the rich card to the speech doc (routed to whichever window shows it)
    onappenddoc?.(node);

    onclose();
  }

  // ── keyboard ──────────────────────────────────────────────────
  function onkeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "within") backToFiles();
      else onclose();
      return;
    }
    if (mod && e.key === "k") {
      e.preventDefault();
      onclose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, activeResults.length - 1);
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (mode === "files") {
        const file = fileResults[selectedIdx] as LibFile | undefined;
        if (file) void diveInto(file);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      insertSelected();
      return;
    }
  }

  let listEl = $state<HTMLElement>();

  function scrollSelectedIntoView() {
    // Let DOM update first
    requestAnimationFrame(() => {
      listEl?.children[selectedIdx]?.scrollIntoView({ block: "nearest" });
    });
  }

  // ── chip helpers ──────────────────────────────────────────────
  const CHIP_LABELS: Record<string, string> = {
    all: "ALL", "1": "POC", "2": "HAT", "3": "BLK", "4": "CARD",
  };
  const LEVEL_COLORS: Record<number, string> = {
    1: "var(--accent)", 2: "#e09b3d", 3: "var(--neg)", 4: "var(--text-dim)",
  };

  function nodeChipLabel(level: number): string {
    return ["", "POC", "HAT", "BLK", "CARD"][level] ?? "";
  }

  /** Flatten a node's text + body + children into a full card string for the doc. */
  function buildFullCard(node: DocNode): string {
    const lines: string[] = [node.text, ...node.body];
    function walk(ns: DocNode[]) {
      for (const n of ns) {
        lines.push(n.text);
        lines.push(...n.body);
        walk(n.children);
      }
    }
    walk(node.children);
    return lines.filter(Boolean).join("\n");
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onmousedown={(e) => { if (e.target === e.currentTarget) onclose(); }} onkeydown={onkeydown} role="presentation">
  <div class="panel" role="dialog" aria-label="Doc Search">

    <!-- Header -->
    <div class="search-bar">
      <span class="icon">🔍</span>
      <input
        bind:this={inputEl}
        bind:value={query}
        placeholder={mode === "files" ? "Search files…" : "Filter blocks…"}
        class="search-input"
        spellcheck="false"
        autocomplete="off"
      />
      {#if mode === "within" && divedFile}
        <button class="back-btn" onclick={backToFiles} title="Back to files (Esc)">
          ← {divedFile.name}
        </button>
      {/if}
      <button class="close-btn" onclick={onclose}>✕</button>
    </div>

    <!-- Chip filter (within-file only) -->
    {#if mode === "within"}
      <div class="chips">
        {#each (["all", 1, 2, 3, 4] as const) as c}
          <button
            class="chip"
            class:active={chip === c}
            onclick={() => { chip = c; selectedIdx = 0; }}
          >{CHIP_LABELS[String(c)]}</button>
        {/each}
      </div>
    {/if}

    <!-- Results -->
    <div class="results" bind:this={listEl}>
      {#if parseError}
        <div class="parse-error">{parseError}</div>
      {:else if parsing}
        <div class="empty">Parsing file…</div>
      {:else if mode === "files"}
        {#if fileIndex.files.length === 0}
          <div class="empty">
            {#if fileIndex.scanning}
              Scanning library…
            {:else}
              No files indexed. Add a folder in Settings → Search Library.
            {/if}
          </div>
        {:else if fileResults.length === 0}
          <div class="empty">No files match "{query}"</div>
        {:else}
          {#each fileResults as file, i (file.path)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="row file-row"
              class:selected={i === selectedIdx}
              onclick={() => { selectedIdx = i; void diveInto(file); }}
              onmouseenter={() => { selectedIdx = i; }}
            >
              <span class="file-icon">📄</span>
              <span class="file-name">{file.name}</span>
              <span class="file-meta">{relativeTime(file.mtime)}</span>
              <span class="tab-hint">Tab →</span>
            </div>
          {/each}
        {/if}
      {:else}
        <!-- Within-file results -->
        {#if withinResults.length === 0}
          <div class="empty">{query ? `No blocks match "${query}"` : "No blocks found."}</div>
        {:else}
          {#each withinResults as node, i (i)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="row node-row"
              class:selected={i === selectedIdx}
              style="--indent: {(node.level - 1) * 14}px; --lvl-color: {LEVEL_COLORS[node.level] ?? 'var(--text)'}"
              draggable="true"
              ondragstart={(e) => {
                const full = buildFullCard(node);
                // Include the full node so the drop can render the rich card
                // (highlighting/underline/emphasis) in the speech doc.
                e.dataTransfer?.setData(
                  "text/nimbus-block",
                  JSON.stringify({ header: node.text, fullCard: full, node }),
                );
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
              }}
              onclick={() => { selectedIdx = i; insertSelected(); }}
              onmouseenter={() => { selectedIdx = i; }}
            >
              <span class="node-chip">{nodeChipLabel(node.level)}</span>
              <span class="node-text">{node.text}</span>
            </div>
          {/each}
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    <div class="footer">
      {#if mode === "files"}
        <span>{fileResults.length} of {fileIndex.files.length} files</span>
      {:else}
        <span>{withinResults.length} result{withinResults.length === 1 ? "" : "s"}</span>
        <span class="footer-sep">·</span>
        <span>↑↓ navigate</span>
        <span class="footer-sep">·</span>
        <span>↵ insert into cell</span>
        <span class="footer-sep">·</span>
        <span>Esc back</span>
      {/if}
      {#if fileIndex.scanning}
        <span class="scanning-dot">⟳</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: min(640px, 92vw);
    max-height: 68vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .icon {
    font-size: 14px;
    opacity: 0.6;
    flex-shrink: 0;
  }
  .search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text);
    font-size: 14px;
    outline: none;
    min-width: 0;
  }
  .search-input::placeholder {
    color: var(--text-dim);
  }
  .back-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 5px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .back-btn:hover { color: var(--text); }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 4px;
    flex-shrink: 0;
  }
  .close-btn:hover { color: var(--text); }

  .chips {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .chip {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    letter-spacing: 0.04em;
  }
  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .chip:hover:not(.active) { color: var(--text); }

  .results {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }
  .empty {
    padding: 20px 16px;
    color: var(--text-dim);
    font-size: 13px;
    text-align: center;
  }
  .parse-error {
    padding: 12px 16px;
    color: var(--mark-dropped);
    font-size: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  .row.selected {
    background: color-mix(in srgb, var(--accent) 15%, var(--panel));
  }
  .row:hover:not(.selected) {
    background: color-mix(in srgb, var(--text) 5%, var(--panel));
  }

  /* File rows */
  .file-icon { font-size: 13px; flex-shrink: 0; }
  .file-name { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-meta { color: var(--text-dim); font-size: 11px; flex-shrink: 0; }
  .tab-hint { color: var(--text-dim); font-size: 11px; flex-shrink: 0; }
  .row.selected .tab-hint { color: var(--accent); }

  /* Node rows */
  .node-row { padding-left: calc(12px + var(--indent)); }
  .node-chip {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: var(--lvl-color);
    flex-shrink: 0;
    width: 30px;
    opacity: 0.85;
  }
  .node-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .footer-sep { opacity: 0.4; }
  .scanning-dot {
    margin-left: auto;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
