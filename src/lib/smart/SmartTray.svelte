<script lang="ts">
  // Smart blocks tray (LAB). Collapsed it is one small pill in the corner of
  // the flow; open it shows suggestions and the round kit.
  //
  // ⚠ It never takes a keystroke from the grid and never inserts on its own —
  // every insert is a click. Tab-to-accept, which does touch cell key
  // handling, is deliberately a later step.
  import { untrack } from "svelte";
  import { store } from "$lib/model/round.svelte";
  import { laneAbbr } from "$lib/model/types";
  import type { DocNode } from "$lib/docx/parse";
  import { smartKit, type KitFile, type Suggestion } from "./kit.svelte";
  import { cardsUnder } from "./match";

  let { onjump }: { onjump: (sheetId: string, row: number, col: number) => void } = $props();

  let open = $state(false);
  let tab = $state<"suggest" | "overviews" | "file" | "kit">("suggest");
  /** A file is being dragged over the tray or the pill. */
  let dropping = $state(false);
  /** File tab: search text, and the rows folded shut (per file). */
  let fileQuery = $state("");
  let folded = $state<Set<string>>(new Set());
  /** File tab level filter, as in Ctrl+K: a level shows the tree down to it
   *  (HAT = pockets + hats), and while searching only that level matches. */
  let level = $state<"all" | 1 | 2 | 3 | 4>("all");
  const LEVELS: { id: "all" | 1 | 2 | 3 | 4; label: string }[] = [
    { id: "all", label: "ALL" },
    { id: 1, label: "POC" },
    { id: 2, label: "HAT" },
    { id: 3, label: "BLK" },
    { id: 4, label: "CARD" },
  ];
  let foldedFor = "";
  /** Brief "Inserted" confirmation on the row just used. */
  let flashed = $state("");
  let list = $state.raw<Suggestion[]>([]);
  let fileInput = $state<HTMLInputElement>();
  /** When each suggestion first appeared, so the newest sit at the top. */
  const firstSeen = new Map<string, number>();

  $effect(() => {
    void smartKit.attach(store.round?.id);
  });

  // Recompute from the round itself, a beat after it settles. Reading these
  // here is what subscribes: `updatedAt` moves on every edit, local or remote.
  $effect(() => {
    void store.round?.updatedAt;
    void store.round?.mySide;
    void store.laneHere;
    void smartKit.parsed;
    void smartKit.files;
    void smartKit.library;
    void smartKit.links;
    void smartKit.side;
    void smartKit.dismissed;
    const t = setTimeout(() => untrack(recompute), 250);
    return () => clearTimeout(t);
  });

  function recompute() {
    const round = store.round;
    if (!round) {
      list = [];
      return;
    }
    const now = Date.now();
    const next = smartKit.suggestions(round, store.laneHere);
    for (const s of next) if (!firstSeen.has(s.key)) firstSeen.set(s.key, now);
    list = next.sort((a, b) => (firstSeen.get(b.key) ?? 0) - (firstSeen.get(a.key) ?? 0));
  }

  const speeches = $derived(store.round?.template.speeches ?? []);
  const side = $derived(store.round ? smartKit.mySide(store.round) : undefined);
  const roundHasSide = $derived(store.round?.mySide === "aff" || store.round?.mySide === "neg");

  async function addFiles() {
    if ("__TAURI_INTERNALS__" in window) {
      const { open: pick } = await import("@tauri-apps/plugin-dialog");
      const picked = await pick({ multiple: true, filters: [{ name: "Word", extensions: ["docx"] }] });
      if (!picked) return;
      await smartKit.addPaths(Array.isArray(picked) ? picked : [picked]);
    } else {
      fileInput?.click();
    }
  }

  async function onBrowserFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    for (const f of Array.from(input.files ?? [])) smartKit.addBytes(f.name, await f.arrayBuffer());
    input.value = "";
  }

  function linkValue(sheetId: string): string {
    return sheetId in smartKit.links ? smartKit.links[sheetId] : "__auto";
  }

  function onLink(sheetId: string, v: string) {
    smartKit.setLink(sheetId, v === "__auto" ? null : v);
  }

  function fileName(key: string | null): string {
    return smartKit.all.find((f) => f.key === key)?.name.replace(/\.docx$/i, "") ?? "";
  }

  // ---- dropping files onto the tray ----------------------------------------
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    dropping = true;
  }

  async function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropping = false;
    open = true;
    tab = "kit";
    await smartKit.addDropped(Array.from(e.dataTransfer?.files ?? []));
  }

  // ---- Overviews + File: both follow the sheet on screen --------------------
  const sheet = $derived(store.activeSheet);
  const sheetFile = $derived(sheet ? smartKit.fileFor(sheet) : null);
  const overviews = $derived(sheet ? smartKit.overviewsFor(sheet) : []);
  /** File tab: show the whole file instead of just this sheet's section. */
  let wholeFile = $state(false);
  const fileRoots = $derived(
    sheetFile ? (sheetFile.scope && !wholeFile ? [sheetFile.scope] : sheetFile.roots) : [],
  );

  interface TreeRow {
    node: DocNode;
    key: string;
    depth: number;
    hasKids: boolean;
  }

  /**
   * The File tab's rows — the same tree Ctrl+K shows inside a file: every
   * heading and card, foldable, and while searching only matching branches
   * (with their ancestors) stay.
   */
  const treeRows = $derived.by<TreeRow[]>(() => {
    const f = sheetFile;
    if (!f) return [];
    const q = fileQuery.trim().toLowerCase();
    let keep: Set<string> | null = null;
    if (q) {
      const k = new Set<string>();
      const find = (ns: DocNode[], prefix: string, up: string[]) =>
        ns.forEach((n, i) => {
          const key = prefix + i;
          const levelOk = level === "all" || n.level === level;
          if (levelOk && n.text.toLowerCase().includes(q)) [key, ...up].forEach((x) => k.add(x));
          find(n.children, key + ".", [...up, key]);
        });
      find(fileRoots, "", []);
      keep = k;
    }
    // Without a search, a level caps how deep the tree goes.
    const cap = !keep && level !== "all" ? level : Infinity;
    const out: TreeRow[] = [];
    const walk = (ns: DocNode[], depth: number, prefix: string) =>
      ns.forEach((n, i) => {
        const key = prefix + i;
        if (keep && !keep.has(key)) return;
        if (n.level > cap) return;
        const capped = n.level >= cap;
        out.push({ node: n, key, depth, hasKids: n.children.length > 0 && !capped });
        if (n.children.length && !capped && (keep || !folded.has(key))) walk(n.children, depth + 1, key + ".");
      });
    walk(fileRoots, 0, "");
    return out.slice(0, 600);
  });

  // A different file or section (another sheet, a re-link) starts unfolded,
  // unsearched, and on just its section. Fold keys are positions in the tree
  // shown, so they must not carry over to a different tree.
  $effect(() => {
    const k = `${sheetFile?.key ?? ""}|${sheetFile?.scope?.text ?? ""}`;
    untrack(() => {
      if (k === foldedFor) return;
      foldedFor = k;
      folded = new Set();
      fileQuery = "";
      wholeFile = false;
    });
  });

  function toggleWholeFile() {
    wholeFile = !wholeFile;
    folded = new Set();
  }

  function foldAll() {
    const next = new Set<string>();
    const walk = (ns: DocNode[], prefix: string) =>
      ns.forEach((n, i) => {
        const key = prefix + i;
        if (n.children.length) {
          next.add(key);
          walk(n.children, key + ".");
        }
      });
    walk(fileRoots, "");
    folded = next;
  }

  function toggleFold(key: string) {
    const next = new Set(folded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    folded = next;
  }

  function chipOf(n: DocNode): { label: string; cls: string } {
    if (n.isAnalytic) return { label: "ANL", cls: "c-anl" };
    return (
      [
        { label: "", cls: "" },
        { label: "POC", cls: "c-poc" },
        { label: "HAT", cls: "c-hat" },
        { label: "BLK", cls: "c-blk" },
      ][n.level] ?? { label: "CARD", cls: "c-card" }
    );
  }

  /** Same drag payload as a Ctrl+K row, so the grid's existing drop builds the cell. */
  function dragBlock(e: DragEvent, node: DocNode) {
    const lines: string[] = [];
    const walk = (n: DocNode) => {
      lines.push(n.text, ...n.body);
      n.children.forEach(walk);
    };
    walk(node);
    e.dataTransfer?.setData(
      "text/nimbus-block",
      JSON.stringify({ header: node.text, fullCard: lines.filter(Boolean).join("\n"), node }),
    );
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  }

  function grab(node: DocNode, id: string) {
    if (!smartKit.insertAtCursor(node)) return;
    flashed = id;
    setTimeout(() => {
      if (flashed === id) flashed = "";
    }, 900);
  }

  const canInsert = $derived(!!store.cursor && !!store.activeSheetId);

  /** "Solvency---AT: Say No---2NC" reads better without the speech marker. */
  function blockLabel(title: string): string {
    return title.replace(/\s*-{2,}\s*(1ac|2ac|1nc|2nc|1nr|2nr|1ar|2ar)\s*$/i, "");
  }
</script>

<div class="smart-anchor">
  {#if open}
    <div
      class="tray"
      class:dropping
      role="dialog"
      tabindex="-1"
      aria-label="Smart blocks"
      ondragover={onDragOver}
      ondragleave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dropping = false;
      }}
      ondrop={onDrop}
    >
      <div class="tray-head">
        <button class:on={tab === "suggest"} onclick={() => (tab = "suggest")}>
          Suggestions{list.length ? ` (${list.length})` : ""}
        </button>
        <button class:on={tab === "overviews"} onclick={() => (tab = "overviews")}>Overviews</button>
        <button class:on={tab === "file"} onclick={() => (tab = "file")}>File</button>
        <button class:on={tab === "kit"} onclick={() => (tab = "kit")}>
          Kit{smartKit.all.length ? ` (${smartKit.all.length})` : ""}
        </button>
        <span class="lab">LAB</span>
        <button class="x" onclick={() => (open = false)} aria-label="Close">×</button>
      </div>

      {#if tab === "suggest"}
        <div class="body">
          {#if !smartKit.all.length}
            <p class="empty">Add your files for this round in <b>Round kit</b>, and blocks that answer what the other team says will show up here.</p>
          {:else if !side}
            <p class="empty">Pick which side you're on in <b>Round kit</b>.</p>
          {:else if !list.length}
            <p class="empty">No suggestions right now. They appear when the other team's argument matches a block in your kit and your answer cell is still empty.</p>
          {:else}
            {#each list as s (s.key)}
              <div class="sug">
                <div class="sug-head">
                  <button class="where" onclick={() => onjump(s.sheetId, s.row, s.toCol)} title="Go to this row">
                    <span class="sheet">{s.sheetTitle || "Untitled"}</span>
                    <span class="speech">{laneAbbr(speeches[s.fromCol], store.laneHere)}</span>
                    <span class="said">“{s.said}”</span>
                  </button>
                  <button class="dismiss" onclick={() => smartKit.dismiss(s)} title="Not this one">×</button>
                </div>
                {#each s.matches as m, i (m.block.id)}
                  <div class="match">
                    <span class="btitle" title={[...m.block.trail, m.block.title].join(" › ")}>{blockLabel(m.block.title)}</span>
                    <span class="count">{m.block.cardCount} {m.block.cardCount === 1 ? "card" : "cards"}</span>
                    <button class="insert" onclick={() => smartKit.insert(s, m, i)}>
                      Insert → {laneAbbr(speeches[s.toCol], store.laneHere)}
                    </button>
                  </div>
                {/each}
              </div>
            {/each}
          {/if}
        </div>
      {:else if tab === "overviews" || tab === "file"}
        <div class="body">
          {#if !sheet}
            <p class="empty">Open a sheet to see its file.</p>
          {:else if !sheetFile}
            <p class="empty">
              <b>{sheet.title || "This sheet"}</b> isn't linked to a file in your kit. Add its file, or pick one under <b>Kit</b>.
            </p>
          {:else}
            <div class="from">
              <span>{sheet.title || "Untitled"}</span>
              <span class="dim">from</span>
              <span class="fromfile" title={sheetFile.key}>
                {sheetFile.name.replace(/\.docx$/i, "")}{#if sheetFile.scope}<span class="dim"> › </span>{sheetFile.scope.text}{/if}
              </span>
              {#if sheetFile.scope && tab === "file"}
                <button class="mini" onclick={toggleWholeFile} title="Only this sheet's section is used for suggestions either way">
                  {wholeFile ? "Just this section" : "Whole file"}
                </button>
              {/if}
            </div>
            {#if !canInsert}
              <p class="hint">Click a cell first, then click a block to put it there — or drag it onto any cell.</p>
            {/if}

            {#if tab === "overviews"}
              {#each overviews as o, i (i)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="ov"
                  class:flash={flashed === `ov${i}`}
                  role="button"
                  tabindex="0"
                  draggable="true"
                  ondragstart={(e) => dragBlock(e, o.node)}
                  onclick={() => grab(o.node, `ov${i}`)}
                  title="Click to put in the selected cell · drag onto any cell"
                >
                  <span class="ovsec">{o.section}</span>
                  <span class="ovblock">{o.node.text}</span>
                  <span class="count">{flashed === `ov${i}` ? "Inserted" : `${o.cardCount} ${o.cardCount === 1 ? "card" : "cards"}`}</span>
                </div>
              {:else}
                <p class="empty">
                  No overviews found. Nimbus looks for sections with a heading named <b>Main</b> and takes the first block under each one
                  — and when you're aff, the first block of each advantage in a 2AC file's <b>CASE</b> section.
                </p>
              {/each}
            {:else}
              <input class="search" type="search" placeholder="Search this file…" bind:value={fileQuery} />
              <div class="levels">
                {#each LEVELS as l (l.id)}
                  <button class="lvl" class:on={level === l.id} onclick={() => (level = l.id)}>{l.label}</button>
                {/each}
                <span class="spacer"></span>
                <button class="mini" onclick={foldAll} title="Collapse all">⊟</button>
                <button class="mini" onclick={() => (folded = new Set())} title="Expand all">⊞</button>
              </div>
              {#each treeRows as r (r.key)}
                {@const c = chipOf(r.node)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="trow"
                  class:flash={flashed === r.key}
                  style="padding-left: {4 + r.depth * 14}px"
                  role="button"
                  tabindex="0"
                  draggable="true"
                  ondragstart={(e) => dragBlock(e, r.node)}
                  onclick={() => grab(r.node, r.key)}
                >
                  {#if r.hasKids}
                    <button
                      class="arrow"
                      onclick={(e) => {
                        e.stopPropagation();
                        toggleFold(r.key);
                      }}>{folded.has(r.key) && !fileQuery ? "▸" : "▾"}</button
                    >
                  {:else}
                    <span class="arrow"></span>
                  {/if}
                  <span class="typechip {c.cls}">{c.label}</span>
                  <span class="ttext">{r.node.text}</span>
                  {#if flashed === r.key}
                    <span class="count">Inserted</span>
                  {:else if r.node.level === 3 && !r.node.isAnalytic}
                    <span class="count">{cardsUnder(r.node).length}</span>
                  {/if}
                </div>
              {:else}
                <p class="empty">{fileQuery ? `No matches for "${fileQuery}"` : "No headings in this file."}</p>
              {/each}
            {/if}
          {/if}
        </div>
      {:else}
        <div class="body">
          {#if !roundHasSide}
            <div class="row">
              <span class="label">You're</span>
              <div class="seg">
                <button class:on={smartKit.side === "aff"} onclick={() => smartKit.setSide("aff")}>Aff</button>
                <button class:on={smartKit.side === "neg"} onclick={() => smartKit.setSide("neg")}>Neg</button>
              </div>
            </div>
          {/if}

          {#snippet fileRow(f: KitFile, pinned: boolean)}
            {@const p = smartKit.parsed[f.key]}
            <div class="file">
              <button
                class="pin"
                class:on={pinned}
                onclick={() => (pinned ? smartKit.unpin(f.key) : smartKit.pin(f.key))}
                title={pinned ? "In every round — click to keep it in this round only" : "Keep this file in every round"}
              >📌</button>
              <span class="fname" title={f.key.startsWith("copy:") ? "Not found in your Doc Search library, so Nimbus keeps a copy made when you dropped it. Drop it again to update it." : f.key}>
                {f.name.replace(/\.docx$/i, "")}
                {#if f.key.startsWith("copy:")}<span class="copytag">copy</span>{/if}
                {#if !f.general && smartKit.isCaseNeg(f.key)}<span class="copytag casetag" title="Used on every aff (case) sheet">case neg</span>{/if}
                {#if !f.general && smartKit.isTwoAC(f.key)}<span class="copytag casetag" title="When you're aff: its CASE section is used on every aff sheet, and each off-case sheet uses its own section">2AC</span>{/if}
              </span>
              <span class="fmeta" class:err={!!p?.error}>
                {p ? (p.error ? p.error : `${p.blocks.length} blocks`) : "reading…"}
              </span>
              <label class="gen" title="Offer this file's blocks on every sheet (T, theory, framework)">
                <input type="checkbox" checked={!!f.general} onchange={(e) => smartKit.setGeneral(f.key, (e.currentTarget as HTMLInputElement).checked)} />
                every sheet
              </label>
              <button
                class="dismiss"
                onclick={() => smartKit.remove(f.key)}
                title={pinned ? "Remove from the library (every round)" : "Remove from this round"}
              >×</button>
            </div>
          {/snippet}

          <div class="section">Library · in every round</div>
          {#each smartKit.library as f (f.key)}
            {@render fileRow(f, true)}
          {:else}
            <p class="empty">Pin 📌 a file below to keep it in every round — T, theory, framework, your case neg.</p>
          {/each}

          <div class="section">This round</div>
          {#each smartKit.files.filter((f) => !smartKit.inLibrary(f.key)) as f (f.key)}
            {@render fileRow(f, false)}
          {:else}
            <p class="empty">No files yet. Add the exact files you want suggestions from — the newest midterms file, not all four.</p>
          {/each}
          <div class="dropzone">
            <button class="add" onclick={addFiles}>+ Add files…</button>
            <span class="dim">or drop .docx files anywhere on this panel</span>
          </div>
          <input bind:this={fileInput} type="file" accept=".docx" multiple hidden onchange={onBrowserFiles} />

          {#if store.round?.sheets.length && smartKit.all.length}
            <div class="section">Which file each sheet uses</div>
            {#each store.round.sheets as sh (sh.id)}
              {@const auto = smartKit.autoLink(sh)}
              {@const autoScope = auto ? smartKit.scopeFor(sh, auto) : null}
              {@const caseFiles = [...smartKit.caseNegsFor(sh), ...smartKit.twoACsFor(sh)].filter((k) => k !== auto)}
              <div class="row">
                <span class="label sheetname" title={sh.title}>{sh.title || "Untitled"}</span>
                <select value={linkValue(sh.id)} onchange={(e) => onLink(sh.id, (e.currentTarget as HTMLSelectElement).value)}>
                  <option value="__auto">
                    Auto: {auto ? fileName(auto) + (autoScope ? ` › ${autoScope.text}` : "") : caseFiles.length ? "" : "none found"}{auto && caseFiles.length ? " + " : ""}{caseFiles.length ? caseFiles.map((k) => fileName(k)).join(", ") : ""}
                  </option>
                  <option value="">No file</option>
                  {#each smartKit.all.filter((f) => !f.general) as f (f.key)}
                    <option value={f.key}>{f.name.replace(/\.docx$/i, "")}</option>
                  {/each}
                </select>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <button
    class="pill"
    class:has={list.length > 0}
    class:dropping
    onclick={() => (open = !open)}
    ondragover={onDragOver}
    ondragleave={() => (dropping = false)}
    ondrop={onDrop}
    title="Smart blocks (Lab) — drop .docx files here to add them to the round kit"
  >
    ✦ {list.length ? `${list.length} suggestion${list.length === 1 ? "" : "s"}` : "Smart blocks"}
  </button>
</div>

<style>
  /* A zero-height anchor at the bottom of the flow pane: the tray hangs up
     from it, so nothing else in the pane moves or reflows. */
  .smart-anchor {
    position: relative;
    height: 0;
    flex: none;
  }
  .pill,
  .tray {
    position: absolute;
    right: 12px;
    z-index: 30;
    font-size: 12px;
  }
  .pill {
    bottom: 10px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text-dim);
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  }
  .pill.has {
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  .tray {
    bottom: 42px;
    width: min(420px, calc(100vw - 32px));
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    overflow: hidden;
  }
  .tray-head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-bottom: 1px solid var(--border);
  }
  .tray-head button {
    border: none;
    background: none;
    color: var(--text-dim);
    padding: 4px 8px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
  }
  .tray-head button.on {
    color: var(--text);
    background: var(--cell-bg);
    font-weight: 600;
  }
  .lab {
    margin-left: auto;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 0 4px;
  }
  .tray-head .x {
    font-size: 16px;
    line-height: 1;
  }
  .body {
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .empty {
    margin: 4px 2px;
    color: var(--text-dim);
    line-height: 1.4;
  }
  .sug {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px;
    background: var(--cell-bg);
  }
  .sug-head {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  .where {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: none;
    background: none;
    color: var(--text);
    padding: 0;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: baseline;
  }
  .sheet {
    font-weight: 600;
  }
  .speech {
    color: var(--text-dim);
    font-size: 11px;
  }
  .said {
    flex-basis: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
  }
  .dismiss {
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }
  .match {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 5px;
  }
  .btitle {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  .insert,
  .add {
    border: 1px solid var(--accent);
    color: var(--accent);
    background: none;
    border-radius: 5px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
    white-space: nowrap;
  }
  .insert:hover,
  .add:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .add {
    align-self: flex-start;
    font-size: 12px;
    padding: 3px 10px;
  }
  .section {
    margin-top: 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }
  .file,
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fname,
  .sheetname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fmeta {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  .fmeta.err {
    color: var(--neg);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gen {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  .label {
    color: var(--text-dim);
  }
  select {
    max-width: 200px;
    font-size: 12px;
    background: var(--cell-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .tray.dropping,
  .pill.dropping {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }
  .dropzone {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
  .copytag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 3px;
    margin-left: 4px;
  }
  .pin {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
    opacity: 0.3;
    filter: grayscale(1);
  }
  .pin.on,
  .pin:hover {
    opacity: 1;
    filter: none;
  }
  .casetag {
    color: var(--aff);
    border-color: var(--aff);
  }
  .from {
    display: flex;
    gap: 5px;
    align-items: baseline;
    font-weight: 600;
    min-width: 0;
  }
  .fromfile {
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .ov,
  .trow {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 5px;
    cursor: pointer;
  }
  .ov {
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--cell-bg);
  }
  .trow {
    padding-top: 3px;
    padding-bottom: 3px;
    padding-right: 4px;
  }
  .ov:hover,
  .trow:hover {
    background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  }
  .ov.flash,
  .trow.flash {
    background: color-mix(in srgb, var(--accent) 25%, var(--panel));
  }
  .ovsec {
    font-weight: 600;
    white-space: nowrap;
  }
  .ovblock,
  .ttext {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ovblock {
    color: var(--text-dim);
  }
  .search {
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--cell-bg);
    color: var(--text);
  }
  /* Same look as Ctrl+K's level chips. */
  .levels {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }
  .lvl,
  .mini {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 5px;
    cursor: pointer;
  }
  .lvl {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  .lvl.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .mini {
    padding: 1px 6px;
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .arrow {
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    width: 14px;
    font-size: 10px;
    padding: 0;
    flex-shrink: 0;
  }
  /* Same chip colours as Ctrl+K's file view, so the two read alike. */
  .typechip {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #fff;
    border-radius: 4px;
    padding: 1px 5px;
    flex-shrink: 0;
    min-width: 30px;
    text-align: center;
  }
  .c-poc { background: #6b52d1; }
  .c-hat { background: #8a63d2; }
  .c-blk { background: #c0392b; }
  .c-card { background: #2e8b57; }
  .c-anl { background: #b8860b; }
  .seg button {
    border: 1px solid var(--border);
    background: none;
    color: var(--text-dim);
    border-radius: 4px;
    padding: 2px 10px;
    cursor: pointer;
  }
  .seg button.on {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
</style>
