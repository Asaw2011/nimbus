<script lang="ts">
  import { store } from "../model/round.svelte";
  import { sheetAccent } from "../model/types";
  import { exportRoundFile, exportRoundHtml } from "../model/export";
  import { saveToFile, saveAs, exportExcel, exportNimbus } from "../model/filedoc.svelte";
  // DOCX-IMPORT feature — to remove: delete this import + the marked section
  // below + the src/lib/docx folder, then `npm uninstall fflate`.
  import DocImport from "../docx/DocImport.svelte";

  let {
    onopensheet,
    onnewpage,
    onmovecursor,
  }: {
    onopensheet: (sheetId: string) => void;
    /** Open a freshly created page on its LABEL cell, ready to name it. */
    onnewpage: (sheetId: string) => void;
    /** Place the cursor on a given speech column across the flows. */
    onmovecursor: (col: number) => void;
  } = $props();

  const round = $derived(store.round);
  let renamingId = $state<string | null>(null);
  let renameText = $state("");
  /** How many pages a single "Add" click creates. */
  let addCount = $state(1);
  // window.confirm() is a no-op inside the Tauri webview — two-step confirm.
  let confirmingId = $state<string | null>(null);
  // Drag & drop reordering
  let draggingId = $state<string | null>(null);
  let dragOverIdx = $state<number | null>(null);

  function onDrop(targetIdx: number) {
    if (draggingId) store.reorderSheet(draggingId, targetIdx);
    draggingId = null;
    dragOverIdx = null;
  }

  function removeSheet(id: string) {
    if (confirmingId !== id) {
      confirmingId = id;
      setTimeout(() => {
        if (confirmingId === id) confirmingId = null;
      }, 3000);
      return;
    }
    confirmingId = null;
    store.deleteSheet(id);
  }

  // Off-case / Advantage pick only the KIND (start column + coloring). The pages
  // are created blank and you name them on the LABEL cell — no auto "Off 1"/"Adv 1".
  function addOffcase(count: number) {
    if (!store.round) return;
    let lastId = "";
    for (let i = 1; i <= count; i++) lastId = store.addSheet("", "offcase");
    if (lastId) onnewpage(lastId); // open the new page on its LABEL cell
  }

  function addAdvantages(count: number) {
    if (!store.round) return;
    let lastId = "";
    for (let i = 1; i <= count; i++) lastId = store.addSheet("", "case");
    if (lastId) onnewpage(lastId);
  }

  function addOverview() {
    if (!store.round) return;
    const existing = store.round.sheets.filter((s) => s.kind === "overview").length;
    const title = existing === 0 ? "Overview" : `Overview ${existing + 1}`;
    onnewpage(store.addSheet(title, "overview"));
  }

  function addCx() {
    if (!store.round) return;
    onnewpage(store.addSheet("CX", "cx"));
  }

  function startRename(id: string, current: string) {
    renamingId = id;
    renameText = current;
  }

  function commitRename() {
    if (renamingId && renameText.trim()) {
      store.renameSheet(renamingId, renameText.trim());
    }
    renamingId = null;
  }

  let exportStatus = $state("");

  async function doExport(kind: "html" | "file") {
    if (!store.round) return;
    const round = $state.snapshot(store.round);
    try {
      const path =
        kind === "html"
          ? await exportRoundHtml(round)
          : await exportRoundFile(round);
      exportStatus = `Exported to ${path}`;
    } catch (e) {
      exportStatus = `Export failed: ${e instanceof Error ? e.message : e}`;
    }
  }

  function setField(
    field: "name" | "tournament" | "opponent" | "judges" | "affTeam" | "negTeam",
    value: string,
  ) {
    store.mutate((r) => {
      r[field] = value;
    }, { coalesceText: true });
  }
</script>

{#if round}
  <div class="home">
    <header class="home-head">
      <input
        class="round-name"
        value={round.name}
        oninput={(e) => setField("name", e.currentTarget.value)}
        placeholder="Round name"
      />
      <div class="head-actions">
        <button class="btn primary" onclick={async () => { if (round && await saveToFile(round)) exportStatus = "Saved ✓"; }}>Save</button>
        <button class="btn" onclick={async () => { if (round && await saveAs(round)) exportStatus = "Saved ✓"; }}>Save As…</button>
      </div>
    </header>

    <div class="meta-grid">
      <input value={round.tournament} oninput={(e) => setField("tournament", e.currentTarget.value)} placeholder="Tournament" />
      <input value={round.judges} oninput={(e) => setField("judges", e.currentTarget.value)} placeholder="Judge(s)" />
      <input class="aff-team" value={round.affTeam} oninput={(e) => setField("affTeam", e.currentTarget.value)} placeholder="AFF — school & code" />
      <input class="neg-team" value={round.negTeam} oninput={(e) => setField("negTeam", e.currentTarget.value)} placeholder="NEG — school & code" />
    </div>
    {#if exportStatus}<p class="export-status">{exportStatus}</p>{/if}
    {#if round.filePath}<p class="export-status">Saved to {round.filePath}</p>{/if}

    <section>
      <div class="sheets-head">
        <h2>Sheets</h2>
        <div class="add-menu">
          <span class="add-label">Add</span>
          <select class="count-input" bind:value={addCount} title="How many to add at once">
            {#each Array.from({ length: 12 }, (_, i) => i + 1) as n (n)}
              <option value={n}>{n}</option>
            {/each}
          </select>
          <button class="chip" onclick={() => addAdvantages(Math.max(1, addCount))}>Advantage</button>
          <button class="chip" onclick={() => addOffcase(Math.max(1, addCount))}>Off-case</button>
          <button class="chip" onclick={addOverview}>Overview</button>
          <button class="chip" onclick={addCx}>CX</button>
        </div>
      </div>
      {#if round.template.speeches.length}
        <div class="cursor-row">
          <span class="add-label" title="Jump your cursor to a speech's column — it stays on that column as you switch flows">Cursor → speech</span>
          {#each round.template.speeches as sp, i (i)}
            <button
              class="chip speech"
              class:aff={sp.side === "aff"}
              class:neg={sp.side === "neg"}
              title="Place your cursor on the {sp.label} column across every flow"
              onclick={() => onmovecursor(i)}
            >{sp.abbr}</button>
          {/each}
        </div>
      {/if}
      {#if round.sheets.length === 0}
        <p class="hint-line">No pages yet — add one above, or import a speech doc below.</p>
      {/if}
      <div class="sheet-list">
        {#each round.sheets as s, i (s.id)}
          <div
            class="sheet-card"
            class:dragging={draggingId === s.id}
            class:drag-over={dragOverIdx === i && draggingId !== s.id}
            style="--stripe: {sheetAccent(s)}"
            draggable="true"
            role="listitem"
            ondragstart={(e) => {
              draggingId = s.id;
              e.dataTransfer?.setData("text/plain", s.id);
            }}
            ondragover={(e) => {
              e.preventDefault();
              dragOverIdx = i;
            }}
            ondragleave={() => dragOverIdx === i && (dragOverIdx = null)}
            ondrop={(e) => {
              e.preventDefault();
              onDrop(i);
            }}
            ondragend={() => {
              draggingId = null;
              dragOverIdx = null;
            }}
          >
            {#if renamingId === s.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="rename"
                bind:value={renameText}
                onblur={commitRename}
                onkeydown={(e) => e.key === "Enter" && commitRename()}
                autofocus
              />
            {:else}
              <span class="grip" title="Drag to reorder">⠿</span>
              <button class="open" onclick={() => onopensheet(s.id)}>
                <span class="num">{i + 1}</span>
                {s.title || "New sheet"}
              </button>
              <label class="swatch" title="Sheet color">
                <input
                  type="color"
                  value={s.color ?? "#888888"}
                  oninput={(e) => store.setSheetColor(s.id, e.currentTarget.value)}
                />
              </label>
              {#if s.color}
                <button class="icon" title="Reset to default color" onclick={() => store.setSheetColor(s.id, null)}>↺</button>
              {/if}
              <button class="icon" title="Rename" onclick={() => startRename(s.id, s.title)}>✎</button>
              <button
                class="icon danger"
                class:confirming={confirmingId === s.id}
                title="Delete sheet"
                onclick={() => removeSheet(s.id)}
              >{confirmingId === s.id ? "Delete?" : "×"}</button>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <div class="tools">
      <!-- DOCX-IMPORT feature (removable — see import comment above) -->
      <details class="tool">
        <summary>📄 Import speech doc (.docx)</summary>
        <div class="tool-body">
          <p class="hint-line">Drop in their .docx — each position becomes a sheet, card tags become rows.</p>
          <DocImport />
        </div>
      </details>
      <!-- /DOCX-IMPORT -->

      <details class="tool">
        <summary>📤 Export &amp; convert</summary>
        <div class="tool-body">
          <div class="setup-row">
            <button class="chip" onclick={async () => { if (round && await exportExcel(round)) exportStatus = "Saved as Excel (.xlsx)"; }}>⊞ Excel (.xlsx)</button>
            <button class="chip" onclick={async () => { if (round && await exportNimbus(round)) exportStatus = "Saved as Nimbus (.nimbus)"; }}>☁ Nimbus (.nimbus)</button>
            <button class="chip" onclick={() => doExport("html")}>Round report (HTML)</button>
          </div>
        </div>
      </details>
    </div>
  </div>
{/if}

<style>
  .home {
    flex: 1;
    overflow-y: auto;
    padding: 32px clamp(24px, 8vw, 96px);
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  .home {
    max-width: 760px;
  }
  .home-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .round-name {
    flex: 1;
    font-size: 24px;
    font-weight: 700;
    background: none;
    border: none;
    color: var(--text);
    outline: none;
    padding: 0;
  }
  .head-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .btn {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 7px;
    padding: 7px 16px;
    font-size: 13px;
    cursor: pointer;
  }
  .btn:hover {
    border-color: var(--accent);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .meta-grid input {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
  }
  .aff-team {
    box-shadow: inset 3px 0 0 var(--aff);
  }
  .neg-team {
    box-shadow: inset 3px 0 0 var(--neg);
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 0;
  }
  .sheets-head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .add-menu {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .add-label {
    font-size: 12px;
    color: var(--text-dim);
  }
  .count-input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 13px;
    cursor: pointer;
  }
  .setup-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tools {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tool {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
  }
  .tool > summary {
    cursor: pointer;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
    list-style: none;
    user-select: none;
  }
  .tool > summary::-webkit-details-marker {
    display: none;
  }
  .tool[open] > summary {
    border-bottom: 1px solid var(--border);
  }
  .tool-body {
    padding: 14px;
  }
  .chip {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 14px;
    padding: 4px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--accent);
  }
  .cursor-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .chip.speech {
    padding: 3px 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .chip.speech.aff { color: var(--aff); border-color: color-mix(in srgb, var(--aff) 40%, var(--border)); }
  .chip.speech.neg { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 40%, var(--border)); }
  .sheet-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 480px;
  }
  .sheet-card {
    display: flex;
    align-items: stretch;
    gap: 4px;
  }
  .sheet-card .open {
    box-shadow: inset 3px 0 0 var(--stripe);
  }
  .sheet-card.dragging {
    opacity: 0.4;
  }
  .sheet-card.drag-over {
    box-shadow: 0 -2px 0 var(--accent);
  }
  .grip {
    display: flex;
    align-items: center;
    color: var(--text-dim);
    cursor: grab;
    padding: 0 4px;
    font-size: 13px;
    user-select: none;
  }
  .swatch {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
    cursor: pointer;
  }
  .swatch input {
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
  }
  .export-status {
    font-size: 12px;
    color: var(--text-dim);
    margin: 6px 0 0;
    word-break: break-all;
  }
  .hint-line {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0 0 8px;
  }
  .open {
    flex: 1;
    text-align: left;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 9px 12px;
    font-size: 14px;
    cursor: pointer;
  }
  .open:hover {
    border-color: var(--accent);
  }
  .num {
    color: var(--text-dim);
    font-size: 11px;
    margin-right: 8px;
  }
  .icon {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    padding: 0 10px;
    cursor: pointer;
  }
  .icon.danger:hover {
    color: var(--mark-dropped);
    border-color: var(--mark-dropped);
  }
  .icon.danger.confirming {
    color: #fff;
    background: var(--mark-dropped);
    border-color: var(--mark-dropped);
    font-weight: 600;
  }
  .rename {
    flex: 1;
    background: var(--panel);
    border: 1px solid var(--accent);
    color: var(--text);
    border-radius: 4px;
    padding: 9px 12px;
    font-size: 14px;
  }
</style>
