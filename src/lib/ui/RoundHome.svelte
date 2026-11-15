<script lang="ts">
  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import { sheetAccent } from "../model/types";
  import { saveToFile, saveAs, renameFileToMatchTitle } from "../model/filedoc.svelte";
  // DOCX-IMPORT feature - to remove: delete this import + the marked section
  // below + the src/lib/docx folder, then `npm uninstall fflate`.
  import DocImport from "../docx/DocImport.svelte";
  import { formatOf, pageNames } from "../model/turns";

  let { onopensheet, onopenrfd }: { onopensheet: (sheetId: string) => void; onopenrfd: () => void } = $props();

  const round = $derived(store.round);

  // "Try the sample" belongs to the user's first flow only. The first flow is
  // claimed once something is done in it (a brand-new flow you back out of
  // isn't kept, so it can't be the one); until then a new user still sees it.
  const showSample = $derived(
    settings.sampleFlowId === "" || (!!round && settings.sampleFlowId === round.id),
  );
  $effect(() => {
    // Read updatedAt FIRST: `store.untouched` isn't reactive, so this stamp
    // (bumped by every edit) is what re-runs the check - behind a short-circuit
    // it would never be tracked.
    const stamp = round?.updatedAt;
    if (stamp && round && settings.sampleFlowId === "" && !store.untouched) {
      settings.sampleFlowId = round.id;
      settings.save();
    }
  });
  /** What this event calls its pages: Advantage/Off-case, LD's Contention, PF's Pro/Con. */
  const names = $derived(pageNames(formatOf(round?.template)));
  let renamingId = $state<string | null>(null);
  let renameText = $state("");
  /** How many pages a single "Add" click creates. */
  let addCount = $state(1);
  // window.confirm() is a no-op inside the Tauri webview - two-step confirm.
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
    for (let i = 1; i <= count; i++) {
      store.addSheet(names.offTitle(existing + i), "offcase");
    }
  }

  function addAdvantages(count: number) {
    if (!store.round) return;
    const existing = store.round.sheets.filter((s) => s.kind === "case").length;
    for (let i = 1; i <= count; i++) {
      store.addSheet(names.caseTitle(existing + i), "case");
    }
  }

  function addOverview() {
    if (!store.round) return;
    const existing = store.round.sheets.filter((s) => s.kind === "overview").length;
    const title = existing === 0 ? "Overview" : `Overview ${existing + 1}`;
    store.addSheet(title, "overview");
  }

  function addCx() {
    if (!store.round) return;
    // One CX page per round (its speech bar holds every speech's cross-ex), so
    // a second click opens it instead of adding another unlabeled "CX".
    const existing = store.round.sheets.find((s) => s.kind === "cx");
    if (existing) onopensheet(existing.id);
    else store.addSheet("CX", "cx");
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

  function setField(
    field: "name" | "tournament" | "opponent" | "judges" | "affTeam" | "negTeam",
    value: string,
  ) {
    store.mutate((r) => {
      r[field] = value;
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
  <div class="home-wrap">
  <!-- RFD, pinned to the window's right edge just under the toolbar. Opens the
       RFD panel beside the flow (FlowView), so the decision is typed with the
       flow in view. -->
  <button class="btn rfd-btn" onclick={onopenrfd}>
    {round.rfd && round.rfd.ballots.length ? (rfdResult ? `RFD · ${rfdResult}` : "Open RFD") : "＋ Add RFD"}
  </button>
  <div class="home">
    <header class="home-head">
      <!-- The title is the source of truth for what this flow is called, so on
           commit the file on disk is renamed to match and the dashboard picks
           the new name up. Done on blur/Enter, never per keystroke - renaming a
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

    {#if exportStatus}<p class="export-status">{exportStatus}</p>{/if}

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
          <button class="chip aff" onclick={() => addAdvantages(Math.max(1, addCount))}>{names.caseLabel}</button>
          <button class="chip neg" onclick={() => addOffcase(Math.max(1, addCount))}>{names.offLabel}</button>
          <button class="chip" onclick={addOverview}>Overview</button>
          <button class="chip" onclick={addCx}>{formatOf(round?.template) === "pf" ? "Crossfire" : "CX"}</button>
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
      <!-- DOCX-IMPORT feature (removable - see import comment above) -->
      <!-- Just the button - no box, heading or blurb - at the foot of the page. -->
      <DocImport sample={showSample} />
      <!-- /DOCX-IMPORT -->
    </div>
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
    gap: 40px;
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
  .home-wrap {
    flex: 1; min-height: 0; position: relative;
    display: flex; flex-direction: column;
  }
  .rfd-btn {
    position: absolute; top: 14px; right: 18px; z-index: 2;
    padding: 5px 13px; font-size: 13px; font-weight: 600;
    color: var(--text);
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
  .tools {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
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
  /* Advantage / Off-case chips wear their side's color (the same --aff/--neg
     the grid uses), so the choice reads before you click. Overview and CX stay
     neutral grey. */
  .chip.aff {
    color: var(--aff);
    border-color: color-mix(in srgb, var(--aff) 45%, var(--border));
    background: color-mix(in srgb, var(--aff) 10%, var(--panel));
  }
  .chip.neg {
    color: var(--neg);
    border-color: color-mix(in srgb, var(--neg) 45%, var(--border));
    background: color-mix(in srgb, var(--neg) 10%, var(--panel));
  }
  .chip.aff:hover { border-color: var(--aff); }
  .chip.neg:hover { border-color: var(--neg); }
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
