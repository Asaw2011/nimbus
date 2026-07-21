<script lang="ts">
  import { onMount } from "svelte";
  import type { RoundMeta, SpeechTemplate } from "../model/types";
  import { builtinTemplates } from "../model/templates";
  import { listRounds, loadRound, saveRound, deleteRound } from "../model/persist";
  import { openFromFile, convertFlowFile, openPath } from "../model/filedoc.svelte";
  import { tournaments, type Tournament, type FlowFile } from "../model/tournaments.svelte";
  import { store } from "../model/round.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";
  // SCOUTING feature — to remove: delete this import + the marked card + view
  // block below, and the src/lib/scouting folder.
  import ScoutingView from "../scouting/ScoutingView.svelte";

  let { onopen }: { onopen: () => void } = $props();

  const LS_TEMPLATE = "debate-flow:last-template";

  let rounds: RoundMeta[] = $state([]); // app-data flows not yet in a folder
  let flowsByTourney = $state<Record<string, FlowFile[]>>({});
  let showSettings = $state(false);
  let showScouting = $state(false);
  let converting = $state(false);
  let status = $state("");

  const templates = builtinTemplates();
  const savedIdx = Number(
    typeof localStorage !== "undefined" && localStorage.getItem(LS_TEMPLATE),
  ) || 0;
  let templateIdx = $state(savedIdx >= 0 && savedIdx < templates.length ? savedIdx : 0);

  // New-tournament inline input
  let creatingTourney = $state(false);
  let tourneyName = $state("");
  // Rename tournament inline
  let renamingTourney = $state<string | null>(null);
  let renameTourneyText = $state("");

  // Drag state — move a flow file (or an unfiled round) into a tournament
  let draggingFlow = $state<FlowFile | null>(null);
  let draggingRoundId = $state<string | null>(null);
  let dragOver = $state<string | null>(null);
  // Two-step delete confirms
  let confirmDelete = $state<string | null>(null);
  // Inline rename (keyed by file path or round id)
  let renamingKey = $state<string | null>(null);
  let renameText = $state("");

  function startRename(key: string, current: string) {
    renamingKey = key;
    renameText = current;
  }

  async function commitRenameFlow(file: FlowFile) {
    const name = renameText.trim();
    renamingKey = null;
    if (name && name !== file.name) {
      await tournaments.renameFlow(file, name);
      await reloadFlows();
    }
  }

  async function commitRenameRound(id: string) {
    const name = renameText.trim();
    renamingKey = null;
    if (!name) return;
    const round = await loadRound(id);
    if (round) {
      round.name = name;
      await saveRound(round);
      rounds = await listRounds();
    }
  }

  onMount(async () => {
    rounds = await listRounds();
    await tournaments.init();
    await reloadFlows();
  });

  async function reloadFlows() {
    const map: Record<string, FlowFile[]> = {};
    for (const t of tournaments.list) map[t.id] = await tournaments.flows(t);
    flowsByTourney = map;
  }

  // ---- create / open flows -------------------------------------------------

  function createRound() {
    localStorage.setItem(LS_TEMPLATE, String(templateIdx));
    store.newRound(structuredClone(templates[templateIdx]) as SpeechTemplate, "New Round");
    onopen();
  }

  async function openFlowFile() {
    const round = await openFromFile();
    if (round) {
      store.loadRound(round);
      onopen();
    }
  }

  async function openAppRound(id: string) {
    const round = await loadRound(id);
    if (round) {
      store.loadRound(round);
      onopen();
    }
  }

  async function openFlow(file: FlowFile) {
    const round = await openPath(file.path);
    if (round) {
      store.loadRound(round);
      onopen();
    }
  }

  async function convert() {
    converting = true;
    try {
      const msg = await convertFlowFile();
      if (msg) status = msg;
    } finally {
      converting = false;
    }
  }

  // ---- tournaments ---------------------------------------------------------

  async function newTournament() {
    const name = tourneyName.trim();
    creatingTourney = false;
    tourneyName = "";
    if (!name) return;
    const t = await tournaments.createInPicked(name);
    if (t) await reloadFlows();
  }

  async function linkFolder() {
    const t = await tournaments.linkExisting();
    if (t) await reloadFlows();
  }

  async function newFlowInTournament(t: Tournament) {
    store.newRound(structuredClone(templates[templateIdx]) as SpeechTemplate, "New Flow");
    if (store.round) {
      const path = await tournaments.saveRoundInto(t, store.round);
      store.mutate((r) => (r.filePath = path));
    }
    onopen();
  }

  function commitRenameTourney() {
    if (renamingTourney && renameTourneyText.trim()) {
      tournaments.rename(renamingTourney, renameTourneyText.trim());
    }
    renamingTourney = null;
  }

  // ---- drag & drop ---------------------------------------------------------

  async function dropOn(t: Tournament) {
    const flow = draggingFlow;
    const roundId = draggingRoundId;
    draggingFlow = null;
    draggingRoundId = null;
    dragOver = null;
    if (flow) {
      await tournaments.moveFlow(flow, t);
    } else if (roundId) {
      // Move an unfiled app-data round into the folder as a real file.
      const round = await loadRound(roundId);
      if (round) {
        await tournaments.saveRoundInto(t, round);
        await deleteRound(roundId);
        rounds = await listRounds();
      }
    }
    await reloadFlows();
  }

  async function removeFlow(file: FlowFile) {
    if (confirmDelete !== file.path) {
      confirmDelete = file.path;
      setTimeout(() => confirmDelete === file.path && (confirmDelete = null), 3000);
      return;
    }
    confirmDelete = null;
    await tournaments.deleteFlow(file);
    await reloadFlows();
  }

  async function removeRound(id: string) {
    if (confirmDelete !== id) {
      confirmDelete = id;
      setTimeout(() => confirmDelete === id && (confirmDelete = null), 3000);
      return;
    }
    confirmDelete = null;
    await deleteRound(id);
    rounds = await listRounds();
  }

  function fmtDate(t: number): string {
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
</script>

<div class="dashboard">
  <div class="topbar">
    <div class="brand">
      <img class="logo" src="/logo.png" alt="Nimbus" />
      Nimbus
    </div>
    <button class="top-btn" onclick={() => (showSettings = true)}>Settings</button>
  </div>

  <div class="content">
    <!-- action cards -->
    <div class="actions">
      <button class="action-card" onclick={createRound}>
        <div class="ac-title">New flow</div>
        <div class="ac-desc">Start flowing a fresh round.</div>
        <select
          class="ac-select"
          bind:value={templateIdx}
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          onchange={() => localStorage.setItem(LS_TEMPLATE, String(templateIdx))}
        >
          {#each templates as t, i (t.id)}
            <option value={i}>{t.name}</option>
          {/each}
        </select>
      </button>
      <button class="action-card" onclick={openFlowFile}>
        <div class="ac-title">Open…</div>
        <div class="ac-desc">Open a saved .nimbus or Excel flow from your Mac.</div>
      </button>
      <button class="action-card" onclick={convert} disabled={converting}>
        <div class="ac-title">{converting ? "Converting…" : "Convert"}</div>
        <div class="ac-desc">Switch a flow between .nimbus and Excel, either direction.</div>
      </button>
      <!-- SCOUTING card (removable) -->
      <button class="action-card" onclick={() => (showScouting = true)}>
        <div class="ac-title">🔎 Scouting</div>
        <div class="ac-desc">Opponent position &amp; card bank — upload their docs, browse by school.</div>
      </button>
    </div>

    {#if status}<p class="status">{status}</p>{/if}

    <!-- tournaments -->
    <div class="tourney-head">
      <h2 class="section">TOURNAMENTS</h2>
      {#if creatingTourney}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="tourney-input"
          placeholder="Tournament name (a folder is made on your Mac)"
          bind:value={tourneyName}
          autofocus
          onkeydown={(e) => { if (e.key === 'Enter') newTournament(); if (e.key === 'Escape') { creatingTourney = false; tourneyName = ''; } }}
          onblur={newTournament}
        />
      {:else}
        <button class="mini-btn" onclick={() => (creatingTourney = true)}>+ New tournament</button>
        <button class="mini-btn" onclick={linkFolder}>Link a folder…</button>
      {/if}
    </div>

    {#each tournaments.list as t (t.id)}
      <section
        class="tourney"
        class:drop-target={(draggingFlow || draggingRoundId) && dragOver === t.id}
        class:drag-live={!!(draggingFlow || draggingRoundId)}
        role="group"
        ondragover={(e) => { if (draggingFlow || draggingRoundId) { e.preventDefault(); dragOver = t.id; } }}
        ondragleave={() => dragOver === t.id && (dragOver = null)}
        ondrop={(e) => { e.preventDefault(); dropOn(t); }}
      >
        <div class="tourney-title">
          <span class="folder-icon">📁</span>
          {#if renamingTourney === t.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="rename" bind:value={renameTourneyText} autofocus
              onblur={commitRenameTourney}
              onkeydown={(e) => { if (e.key==='Enter') commitRenameTourney(); if (e.key==='Escape') renamingTourney=null; }} />
          {:else}
            <span class="tname">{t.name}</span>
            <button class="icon" title="Rename" onclick={() => { renamingTourney = t.id; renameTourneyText = t.name; }}>✎</button>
            <button class="icon" title="Remove from Nimbus (keeps the folder)" onclick={() => tournaments.unlink(t.id)}>unlink</button>
          {/if}
        </div>
        <div class="cards">
          {#each flowsByTourney[t.id] ?? [] as file (file.path)}
            <div
              class="card flow-card"
              class:card-dragging={draggingFlow?.path === file.path}
              role="button"
              tabindex="0"
              draggable="true"
              onclick={() => openFlow(file)}
              onkeydown={(e) => e.key === 'Enter' && openFlow(file)}
              ondragstart={(e) => { draggingFlow = file; e.dataTransfer?.setData('text/plain', file.path); }}
              ondragend={() => { draggingFlow = null; dragOver = null; }}
            >
              <button class="x" class:confirming={confirmDelete === file.path}
                onclick={(e) => { e.stopPropagation(); removeFlow(file); }}
                title="Delete flow">{confirmDelete === file.path ? 'Delete?' : '×'}</button>
              {#if renamingKey === file.path}
                <!-- svelte-ignore a11y_autofocus -->
                <input class="rename-input" bind:value={renameText} autofocus
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRenameFlow(file); if (e.key === 'Escape') renamingKey = null; }}
                  onblur={() => commitRenameFlow(file)} />
              {:else}
                <div class="fname">
                  {file.name}
                  <button class="rename-btn" title="Rename flow"
                    onclick={(e) => { e.stopPropagation(); startRename(file.path, file.name); }}>✎</button>
                </div>
              {/if}
              <span class="ext-badge {file.ext}">{file.ext === 'xlsx' ? 'Excel' : 'Nimbus'}</span>
              <div class="date">{fmtDate(file.modified)}</div>
            </div>
          {/each}
          <button class="card add-flow" onclick={() => newFlowInTournament(t)}>
            <span class="plus">+</span> New flow here
          </button>
        </div>
      </section>
    {/each}

    {#if tournaments.list.length === 0 && !creatingTourney}
      <p class="empty-hint">No tournaments yet — click <b>+ New tournament</b> to make a folder on your Mac, then add flows into it.</p>
    {/if}

    <!-- unfiled app-data flows -->
    {#if rounds.length > 0}
      <h2 class="section">NOT IN A TOURNAMENT</h2>
      <p class="empty-hint">Drag any of these onto a tournament above to file it there.</p>
      <div class="cards">
        {#each rounds as r (r.id)}
          <div
            class="card round-card"
            class:card-dragging={draggingRoundId === r.id}
            role="button"
            tabindex="0"
            draggable="true"
            onclick={() => openAppRound(r.id)}
            onkeydown={(e) => e.key === 'Enter' && openAppRound(r.id)}
            ondragstart={(e) => { draggingRoundId = r.id; e.dataTransfer?.setData('text/plain', r.id); }}
            ondragend={() => { draggingRoundId = null; dragOver = null; }}
          >
            <button class="x" class:confirming={confirmDelete === r.id}
              onclick={(e) => { e.stopPropagation(); removeRound(r.id); }}
              title="Delete round">{confirmDelete === r.id ? 'Delete?' : '×'}</button>
            {#if renamingKey === r.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="rename-input" bind:value={renameText} autofocus
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRenameRound(r.id); if (e.key === 'Escape') renamingKey = null; }}
                onblur={() => commitRenameRound(r.id)} />
            {:else}
              <div class="fname">
                {r.name}
                <button class="rename-btn" title="Rename flow"
                  onclick={(e) => { e.stopPropagation(); startRename(r.id, r.name); }}>✎</button>
              </div>
            {/if}
            <div class="chips">
              {#each r.sheets.slice(0, 6) as s, i (i)}
                <span class="chip-tag">{s.title || '(untitled)'}</span>
              {/each}
            </div>
            <div class="date">{fmtDate(r.updatedAt)}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if showSettings}
  <SettingsPanel onclose={() => (showSettings = false)} />
{/if}

<!-- SCOUTING view (removable) -->
{#if showScouting}
  <div class="scout-overlay">
    <ScoutingView
      onexit={() => (showScouting = false)}
      onopenflow={async (path) => {
        const round = await openPath(path);
        if (round) { store.loadRound(round); showScouting = false; onopen(); }
      }}
    />
  </div>
{/if}

<style>
  .scout-overlay { position: fixed; inset: 0; z-index: 40; background: var(--bg); }
  .dashboard { height: 100vh; display: flex; flex-direction: column; }
  .topbar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 24px; border-bottom: 1px solid var(--border); background: var(--panel);
  }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
  .logo { width: 30px; height: 30px; object-fit: contain; }
  .top-btn {
    background: var(--panel); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 7px 14px; font-size: 13px; cursor: pointer;
  }
  .top-btn:hover { border-color: var(--accent); }
  .content { flex: 1; overflow-y: auto; padding: 24px; }

  .actions { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; }
  .action-card {
    text-align: left; background: var(--panel); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px 22px; width: 260px; min-height: 108px;
    cursor: pointer; display: flex; flex-direction: column; gap: 4px;
    transition: border-color 0.1s, box-shadow 0.1s;
  }
  .action-card:hover { border-color: var(--accent); box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .action-card:disabled { opacity: 0.55; cursor: default; }
  .ac-title { font-size: 18px; font-weight: 700; color: var(--text); }
  .ac-desc { font-size: 13px; color: var(--text-dim); line-height: 1.35; }
  .ac-select {
    margin-top: 8px; align-self: flex-start; background: var(--bg);
    border: 1px solid var(--border); color: var(--text); border-radius: 6px;
    padding: 3px 8px; font-size: 12px;
  }

  .section {
    font-size: 12px; letter-spacing: 0.08em; color: var(--text-dim);
    font-weight: 600; margin: 18px 0 10px;
  }
  .tourney-head { display: flex; align-items: center; gap: 10px; }
  .mini-btn {
    background: var(--panel); border: 1px solid var(--border); color: var(--accent);
    border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .mini-btn:hover { background: color-mix(in srgb, var(--accent) 10%, var(--panel)); }
  .tourney-input, .tourney-input:focus {
    background: var(--bg); border: 1px solid var(--accent); color: var(--text);
    border-radius: 6px; padding: 5px 10px; font-size: 13px; min-width: 320px;
  }

  .tourney {
    border: 2px dashed transparent; border-radius: 12px; padding: 4px 8px 8px;
    margin: 0 -8px 8px;
  }
  .tourney.drag-live { border-color: var(--border); }
  .tourney.drop-target { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .tourney-title { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-weight: 700; }
  .folder-icon { font-size: 15px; }
  .tname { font-size: 15px; }
  .icon {
    background: none; border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 4px; font-size: 11px; padding: 1px 6px; cursor: pointer;
  }
  .icon:hover { color: var(--text); border-color: var(--accent); }
  .rename, .rename:focus {
    background: var(--bg); border: 1px solid var(--accent); color: var(--text);
    border-radius: 4px; padding: 3px 8px; font-size: 14px;
  }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .card {
    position: relative; border: 1px solid var(--border); border-radius: 8px;
    background: var(--panel); padding: 14px 16px; min-height: 96px; cursor: pointer;
    display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; text-align: left;
  }
  .card:hover { border-color: var(--accent); }
  .card-dragging { opacity: 0.4; }
  .flow-card { cursor: grab; }
  .round-card { cursor: grab; }
  .fname { font-size: 15px; font-weight: 700; padding-right: 34px; display: flex; align-items: center; gap: 6px; }
  .rename-btn {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    font-size: 12px; opacity: 0; padding: 0 2px;
  }
  .card:hover .rename-btn { opacity: 1; }
  .rename-btn:hover { color: var(--accent); }
  .rename-input {
    background: var(--bg); border: 1px solid var(--accent); color: var(--text);
    border-radius: 4px; padding: 4px 8px; font-size: 14px; font-weight: 700;
    margin-right: 30px; width: calc(100% - 40px);
  }
  .x {
    position: absolute; top: 8px; right: 8px; background: none; border: none;
    color: var(--text-dim); font-size: 15px; cursor: pointer; border-radius: 4px; padding: 1px 6px;
  }
  .x:hover { color: var(--mark-dropped); }
  .x.confirming { background: var(--mark-dropped); color: #fff; font-size: 12px; font-weight: 600; padding: 3px 8px; }
  .ext-badge {
    align-self: flex-start; font-size: 10px; font-weight: 600; border-radius: 4px;
    padding: 1px 7px; border: 1px solid var(--border); color: var(--text-dim);
  }
  .ext-badge.nimbus { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .ext-badge.xlsx { color: #1e8e4a; border-color: color-mix(in srgb, #1e8e4a 40%, transparent); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip-tag {
    font-size: 11px; border-radius: 5px; padding: 2px 8px;
    background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
  }
  .date { margin-top: auto; font-size: 12px; color: var(--text-dim); }
  .add-flow {
    border-style: dashed; align-items: center; justify-content: center;
    color: var(--text-dim); flex-direction: row; gap: 6px; font-size: 13px;
  }
  .add-flow:hover { color: var(--text); }
  .plus { font-size: 18px; }
  .empty-hint { color: var(--text-dim); font-size: 12px; font-style: italic; margin: 4px 0 10px; }
  .status { font-size: 12px; color: var(--text-dim); margin: 0 0 10px; }
</style>
