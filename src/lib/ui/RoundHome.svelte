<script lang="ts">
  import { store } from "../model/round.svelte";
  import { sheetAccent, uid, type Ballot } from "../model/types";
  import { exportRoundFile, exportRoundHtml } from "../model/export";
  import { saveToFile, saveAs, exportExcel, exportNimbus, renameFileToMatchTitle } from "../model/filedoc.svelte";
  // DOCX-IMPORT feature — to remove: delete this import + the marked section
  // below + the src/lib/docx folder, then `npm uninstall fflate`.
  import DocImport from "../docx/DocImport.svelte";

  let { onopensheet }: { onopensheet: (sheetId: string) => void } = $props();

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

  // ---- RFD (reason for decision) -----------------------------------------
  // Post-round record only: nothing here is read by the flowing path, and `rfd`
  // stays absent entirely until the first ballot is added, so old saves and
  // rounds you never scored keep exactly the shape they had.
  function addBallot() {
    store.mutate((r) => {
      if (!r.rfd) r.rfd = { ballots: [], notes: "" };
      // First ballot seeds the judge name from the round's judge list; on a
      // panel the rest are blank because that field holds all of them at once.
      const judge = r.rfd.ballots.length === 0 ? (r.judges ?? "").trim() : "";
      const b: Ballot = { id: uid(), judge, winner: "", reason: "", feedback: "", points: "" };
      r.rfd.ballots = [...r.rfd.ballots, b];
    });
  }
  function setBallot(id: string, field: keyof Ballot, value: string, coalesce = true) {
    store.mutate((r) => {
      if (!r.rfd) return;
      r.rfd.ballots = r.rfd.ballots.map((b) => (b.id === id ? { ...b, [field]: value } : b));
    }, coalesce ? { coalesceText: true } : undefined);
  }
  function removeBallot(id: string) {
    store.mutate((r) => {
      if (!r.rfd) return;
      r.rfd.ballots = r.rfd.ballots.filter((b) => b.id !== id);
    });
  }
  function setRfdNotes(value: string) {
    store.mutate((r) => {
      if (!r.rfd) r.rfd = { ballots: [], notes: "" };
      r.rfd.notes = value;
    }, { coalesceText: true });
  }

  // "AFF (school) wins 2–1" style summary from the ballots that have a vote.
  // Undecided ballots are ignored, so a half-filled panel still reads sensibly.
  const rfdResult = $derived.by(() => {
    const bs = round?.rfd?.ballots ?? [];
    const decided = bs.filter((b) => b.winner);
    if (!decided.length) return "";
    const aff = decided.filter((b) => b.winner === "aff").length;
    const neg = decided.filter((b) => b.winner === "neg").length;
    if (aff === neg) return `Split ${aff}–${neg}`;
    const side = aff > neg ? "AFF" : "NEG";
    const team = (side === "AFF" ? round?.affTeam : round?.negTeam)?.trim();
    const score = decided.length > 1 ? ` ${Math.max(aff, neg)}–${Math.min(aff, neg)}` : "";
    return `${side}${team ? ` (${team})` : ""} wins${score}`;
  });
</script>

{#if round}
  <div class="home">
    <header class="home-head">
      <!-- The title is the source of truth for what this flow is called, so on
           commit the file on disk is renamed to match and the dashboard picks
           the new name up. Done on blur/Enter, never per keystroke — renaming a
           file once per character would be madness. -->
      <input
        class="round-name"
        value={round.name}
        oninput={(e) => setField("name", e.currentTarget.value)}
        onblur={() => void renameFileToMatchTitle(store.round)}
        onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
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
      <input class="aff-team" value={round.affTeam} oninput={(e) => setField("affTeam", e.currentTarget.value)} placeholder="Aff school & code" />
      <input class="neg-team" value={round.negTeam} oninput={(e) => setField("negTeam", e.currentTarget.value)} placeholder="Neg school & code" />
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
      {#if round.sheets.length === 0}
        <p class="hint-line">No pages yet. Add one above, or import a speech doc below.</p>
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

    <section class="rfd">
      <div class="sheets-head">
        <h2>Result &amp; feedback</h2>
        {#if rfdResult}<span class="rfd-badge">{rfdResult}</span>{/if}
      </div>
      {#if !round.rfd || round.rfd.ballots.length === 0}
        <p class="hint-line">Record how the round came out: who voted, why, and any feedback. It saves with the flow.</p>
      {/if}

      {#each round.rfd?.ballots ?? [] as b (b.id)}
        <div class="ballot">
          <div class="ballot-top">
            <input
              class="ballot-judge"
              value={b.judge}
              placeholder="Judge"
              oninput={(e) => setBallot(b.id, "judge", e.currentTarget.value)}
            />
            <div class="vote">
              <button
                class="vote-btn aff"
                class:on={b.winner === "aff"}
                title="This judge voted AFF"
                onclick={() => setBallot(b.id, "winner", b.winner === "aff" ? "" : "aff", false)}
              >AFF</button>
              <button
                class="vote-btn neg"
                class:on={b.winner === "neg"}
                title="This judge voted NEG"
                onclick={() => setBallot(b.id, "winner", b.winner === "neg" ? "" : "neg", false)}
              >NEG</button>
            </div>
            <button class="icon danger" title="Remove ballot" onclick={() => removeBallot(b.id)}>×</button>
          </div>
          <textarea
            class="ballot-reason"
            value={b.reason}
            placeholder="Reason for decision: why did they vote this way?"
            oninput={(e) => setBallot(b.id, "reason", e.currentTarget.value)}
          ></textarea>
          <textarea
            class="ballot-feedback"
            value={b.feedback}
            placeholder="Feedback / advice for next time"
            oninput={(e) => setBallot(b.id, "feedback", e.currentTarget.value)}
          ></textarea>
          <input
            class="ballot-points"
            value={b.points}
            placeholder="Speaker points (e.g. 1A 28.5 · 2A 29)"
            oninput={(e) => setBallot(b.id, "points", e.currentTarget.value)}
          />
        </div>
      {/each}

      <div class="setup-row">
        <button class="chip" onclick={addBallot}>＋ Add ballot{round.rfd && round.rfd.ballots.length ? " (panel)" : ""}</button>
      </div>
      {#if round.rfd && round.rfd.ballots.length}
        <textarea
          class="rfd-notes"
          value={round.rfd?.notes ?? ""}
          placeholder="Other notes about the round…"
          oninput={(e) => setRfdNotes(e.currentTarget.value)}
        ></textarea>
      {/if}
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
    margin: 0 auto;
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
  .rfd {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rfd-badge {
    font-size: 12px;
    font-weight: 700;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .ballot {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 10px;
  }
  .ballot-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ballot-judge {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 9px;
    font-size: 13px;
    font-weight: 600;
  }
  .vote {
    display: flex;
    gap: 4px;
  }
  .vote-btn {
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-dim);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  /* Uses the same --aff/--neg the grid does, so a custom side color carries. */
  .vote-btn.aff.on {
    background: var(--aff);
    border-color: var(--aff);
    color: #fff;
  }
  .vote-btn.neg.on {
    background: var(--neg);
    border-color: var(--neg);
    color: #fff;
  }
  .ballot textarea,
  .ballot-points,
  .rfd-notes {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
  }
  .ballot-reason { min-height: 60px; }
  .ballot-feedback { min-height: 44px; }
  .rfd-notes { min-height: 44px; }
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
