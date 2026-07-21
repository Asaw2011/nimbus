<script lang="ts">
  import { store } from "../model/round.svelte";
  import { sheetAccent } from "../model/types";
  import { exportRoundFile, exportRoundHtml } from "../model/export";
  import { saveToFile, saveAs } from "../model/filedoc.svelte";
  // DOCX-IMPORT feature — to remove: delete this import + the marked section
  // below + the src/lib/docx folder, then `npm uninstall fflate`.
  import DocImport from "../docx/DocImport.svelte";
  // COLLAB feature — to remove: delete this import + the marked section below
  // + the src/lib/collab folder, then `npm uninstall trystero`.
  import CollabPanel from "../collab/CollabPanel.svelte";

  let { onopensheet }: { onopensheet: (sheetId: string) => void } = $props();

  const round = $derived(store.round);
  let renamingId = $state<string | null>(null);
  let renameText = $state("");
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

  function addOffcase(count: number) {
    if (!store.round) return;
    const existing = store.round.sheets.filter((s) => s.kind === "offcase").length;
    let lastId = "";
    for (let i = 1; i <= count; i++) {
      lastId = store.addSheet(`Off ${existing + i}`, "offcase");
    }
    if (count === 1 && lastId) startRename(lastId, `Off ${existing + 1}`);
  }

  function addAdvantages(count: number) {
    if (!store.round) return;
    const existing = store.round.sheets.filter((s) => s.kind === "case").length;
    let lastId = "";
    for (let i = 1; i <= count; i++) {
      lastId = store.addSheet(`Adv ${existing + i}`, "case");
    }
    if (count === 1 && lastId) startRename(lastId, `Adv ${existing + 1}`);
  }

  function addOverview() {
    if (!store.round) return;
    const existing = store.round.sheets.filter((s) => s.kind === "overview").length;
    const title = existing === 0 ? "Overview" : `Overview ${existing + 1}`;
    startRename(store.addSheet(title, "overview"), title);
  }

  function addCx() {
    if (!store.round) return;
    store.addSheet("CX", "cx");
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
    <section class="info">
      <input
        class="round-name"
        value={round.name}
        oninput={(e) => setField("name", e.currentTarget.value)}
        placeholder="Round name"
      />
      <div class="fields">
        <input
          value={round.tournament}
          oninput={(e) => setField("tournament", e.currentTarget.value)}
          placeholder="Tournament"
        />
        <input
          value={round.judges}
          oninput={(e) => setField("judges", e.currentTarget.value)}
          placeholder="Judges"
        />
      </div>
      <div class="fields">
        <input
          class="team aff-team"
          value={round.affTeam}
          oninput={(e) => setField("affTeam", e.currentTarget.value)}
          placeholder="AFF — school & code"
        />
        <input
          class="team neg-team"
          value={round.negTeam}
          oninput={(e) => setField("negTeam", e.currentTarget.value)}
          placeholder="NEG — school & code"
        />
      </div>
    </section>

    <section>
      <h2>Create pages</h2>
      <div class="setup-row">
        <span class="setup-label">Advantages</span>
        {#each [1, 2, 3, 4] as n (n)}
          <button class="chip" onclick={() => addAdvantages(n)}>+{n}</button>
        {/each}
      </div>
      <div class="setup-row">
        <span class="setup-label">Off-case</span>
        {#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
          <button class="chip" onclick={() => addOffcase(n)}>+{n}</button>
        {/each}
      </div>
      <div class="setup-row">
        <span class="setup-label">Other</span>
        <button class="chip" onclick={addOverview}>+ overview page</button>
        <button class="chip" onclick={addCx}>+ CX page</button>
      </div>
    </section>

    <!-- COLLAB feature (removable — see import comment above) -->
    <section>
      <h2>Partner flowing</h2>
      <p class="hint-line">
        Flow the same round live with your partner — exchange codes once,
        then everything syncs in real time.
      </p>
      <CollabPanel />
    </section>
    <!-- /COLLAB -->

    <!-- DOCX-IMPORT feature (removable — see import comment above) -->
    <section>
      <h2>Import speech doc</h2>
      <p class="hint-line">
        Drop in their .docx (email chain / SpeechDrop) — each position becomes
        a sheet, card tags become rows.
      </p>
      <DocImport />
    </section>
    <!-- /DOCX-IMPORT -->

    <section>
      <h2>Save &amp; export</h2>
      <div class="setup-row">
        <button class="chip" onclick={async () => { if (round && await saveToFile(round)) exportStatus = round.filePath ? `Saved to ${round.filePath}` : "Saved"; }}>
          Save
        </button>
        <button class="chip" onclick={async () => { if (round && await saveAs(round)) exportStatus = round.filePath ? `Saved to ${round.filePath}` : "Saved"; }}>
          Save As…
        </button>
        <button class="chip" onclick={() => doExport("html")}>Round report (HTML)</button>
        <button class="chip" onclick={() => doExport("file")}>Share file (.nimbus)</button>
      </div>
      {#if round?.filePath}
        <p class="export-status">File: {round.filePath}</p>
      {/if}
      {#if exportStatus}
        <p class="export-status">{exportStatus}</p>
      {/if}
    </section>

    <section>
      <h2>Sheets</h2>
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
                {s.title || "(untitled)"}
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
  .round-name {
    font-size: 22px;
    font-weight: 700;
    background: none;
    border: none;
    color: var(--text);
    width: 100%;
    outline: none;
    padding: 0 0 6px;
  }
  .fields {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .fields {
    margin-top: 8px;
  }
  .team {
    flex: 1;
    min-width: 200px;
  }
  .aff-team {
    box-shadow: inset 3px 0 0 var(--aff);
  }
  .neg-team {
    box-shadow: inset 3px 0 0 var(--neg);
  }
  .fields input {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 13px;
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 0 0 10px;
  }
  .setup-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .setup-label {
    font-size: 13px;
    color: var(--text-dim);
    width: 70px;
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
