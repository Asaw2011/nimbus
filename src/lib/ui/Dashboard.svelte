<script lang="ts">
  import { onMount } from "svelte";
  import type { RoundMeta, SpeechTemplate } from "../model/types";
  import { builtinTemplates } from "../model/templates";
  import { listRounds, loadRound, saveRound, deleteRound } from "../model/persist";
  import { openFromFile, convertFlowFile, openPath } from "../model/filedoc.svelte";
  import { tournaments, type Tournament, type FlowFile } from "../model/tournaments.svelte";
  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";

  let { onopen }: { onopen: () => void } = $props();

  let rounds: RoundMeta[] = $state([]); // every flow in app data
  let flowsByTourney = $state<Record<string, FlowFile[]>>({});
  /** Tournaments folded down to just their name. Session-only (nothing is
   *  persisted) and seeded with every existing tournament on mount, so opening
   *  the app always shows a short, scannable list. A tournament you create or
   *  link during the session is left expanded — you just made it to put flows
   *  in it. */
  let collapsed = $state<string[]>([]);
  let showSettings = $state(false);
  let converting = $state(false);
  let status = $state("");

  const templates = builtinTemplates();
  // The default speech format lives in settings (disk-backed), so whatever you
  // pick here is the primary option next time — no re-selecting Policy each run.
  const defaultTpl = () => templates[settings.defaultTemplate] ?? templates[0];

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
    if (!name || name === flowTitle(file)) return;
    // A rejection here used to escape as an unhandled promise: the mirror was
    // never re-pointed and the list was never reloaded, leaving the dashboard
    // showing a file path that no longer existed. Always finish the bookkeeping,
    // and tell the user when a rename didn't work instead of failing silently.
    try {
      const to = await tournaments.renameFlow(file, name);
      if (to) await repointMirror(file.path, to, name);
    } catch (e) {
      status = `Couldn't rename "${file.name}": ${e instanceof Error ? e.message : e}`;
    } finally {
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
    collapsed = tournaments.list.map((t) => t.id);
    await reloadFlows();
  });

  async function reloadFlows() {
    const map: Record<string, FlowFile[]> = {};
    for (const t of tournaments.list) map[t.id] = await tournaments.flows(t);
    flowsByTourney = map;
  }

  // ---- one flow, one card --------------------------------------------------
  //
  // A flow filed in a tournament used to render TWICE: once from the folder
  // listing, and again under "not in a tournament". Opening one is what creates
  // the second copy — openPath() mirrors every flow it opens into app data (so
  // the autosave heartbeat has something to write to), and listRounds() returns
  // all of app data with no filtering. Matching the two by path collapses them
  // back into a single card, shown where the file actually lives.

  /** Separator- and case-normalized, so an app-data `filePath` compares equal to
   *  the same file as reported by `list_flows`. */
  function normPath(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase();
  }

  /** App-data rounds that have a file, keyed by that file's path. */
  const roundsByPath = $derived(
    new Map(
      rounds.filter((r) => r.filePath).map((r) => [normPath(r.filePath!), r]),
    ),
  );

  /** Paths we actually listed inside a tournament folder this reload. Keyed off
   *  the real listing rather than "is this under a tournament's path" on
   *  purpose: if the file is gone from disk, its app-data round drops back into
   *  the unfiled list instead of disappearing from the dashboard entirely. */
  const filedPaths = $derived(
    new Set(Object.values(flowsByTourney).flat().map((f) => normPath(f.path))),
  );

  /** Tournament folders as normalized path prefixes. */
  const tourneyRoots = $derived(
    tournaments.list.map((t) => normPath(t.path).replace(/\/+$/, "") + "/"),
  );

  /** The genuinely unfiled flows — no file at all, or a file that lives outside
   *  every linked tournament folder. The prefix test is a belt-and-braces
   *  companion to the exact-path match: a flow anywhere under a tournament's
   *  tree belongs to that tournament, so it must never also be listed here. */
  const unfiled = $derived(
    rounds.filter((r) => {
      if (!r.filePath) return true;
      const p = normPath(r.filePath);
      if (filedPaths.has(p)) return false;
      return !tourneyRoots.some((root) => p.startsWith(root));
    }),
  );

  /**
   * The rows to show for one tournament: its files, with copies of the SAME flow
   * collapsed into one.
   *
   * "+ New flow" writes into the tournament root; a later Save As into a
   * per-round subfolder leaves the original behind. Both files are the same
   * round, so the dashboard showed one flow twice. Prefer the copy the round
   * actually points at (that's the live one), else the most recently modified,
   * and hand back the rest as `dupes` so nothing is hidden without a trace.
   */
  function rowsFor(t: Tournament): Array<{ file: FlowFile; dupes: FlowFile[] }> {
    const files = flowsByTourney[t.id] ?? [];
    const live = new Set(
      rounds.filter((r) => r.filePath).map((r) => normPath(r.filePath!)),
    );
    const groups = new Map<string, FlowFile[]>();
    for (const f of files) {
      // Same flow ⇒ same file name. Cheap, and correct for the copy-left-behind
      // case; reading every file to compare round ids would cost megabytes per
      // dashboard render.
      const key = `${f.name.trim().toLowerCase()}.${f.ext}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    const out: Array<{ file: FlowFile; dupes: FlowFile[] }> = [];
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => {
        const al = live.has(normPath(a.path)) ? 1 : 0;
        const bl = live.has(normPath(b.path)) ? 1 : 0;
        if (al !== bl) return bl - al;
        return b.modified - a.modified;
      });
      out.push({ file: sorted[0], dupes: sorted.slice(1) });
    }
    return out.sort((a, b) => b.file.modified - a.file.modified);
  }

  /**
   * Open a flow listed in a tournament folder.
   *
   * "Which copy is newer" is decided inside `openPath`, by comparing the two
   * rounds' own `updatedAt` values — NOT here against `file.modified`. The
   * filesystem mtime is not a usable signal: Dropbox rewrites it on sync, and a
   * rename rewrites the file (bumping mtime to now) while leaving the content
   * as stale as it was. Trusting mtime is what let a freshly renamed, stale file
   * look newer than the up-to-date autosave and overwrite it.
   */
  async function openTournamentFlow(file: FlowFile) {
    await openFlow(file);
  }

  /**
   * Keep the app-data mirror pointing at its file after the file moves or is
   * renamed. Without this the mirror still holds the old path, stops matching
   * anything in the folder listing, and the flow starts rendering twice again —
   * once in its tournament, once as "not in a tournament".
   */
  async function repointMirror(oldPath: string, newPath: string, newName?: string) {
    const meta = roundsByPath.get(normPath(oldPath));
    if (!meta) return;
    const round = await loadRound(meta.id);
    if (!round) return;
    round.filePath = newPath;
    if (newName) round.name = newName;
    await saveRound(round);
    rounds = await listRounds();
  }

  /**
   * What a filed flow is CALLED.
   *
   * `round.name` is the single source of truth for a flow's title; the filename
   * is just where it happens to live. The dashboard used to render the filename,
   * so a flow renamed from its round home page still showed its old title here
   * and the two silently drifted. Fall back to the filename only for a file we
   * have never opened and so have no round for.
   */
  function flowTitle(file: FlowFile): string {
    return roundsByPath.get(normPath(file.path))?.name?.trim() || file.name;
  }

  function toggleCollapsed(id: string) {
    collapsed = collapsed.includes(id)
      ? collapsed.filter((x) => x !== id)
      : [...collapsed, id];
  }

  // ---- create / open flows -------------------------------------------------

  function createRound() {
    store.newRound(structuredClone(defaultTpl()) as SpeechTemplate, "New Round");
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
    // Resolve the title BEFORE the round exists. "New Flow" is a guaranteed
    // collision the second time round, and the title has to match the file it
    // gets written to — autosave renames the file to follow round.name, so a
    // round still called "New Flow" would rename itself back on top of the
    // first one's file.
    const name = await tournaments.uniqueFlowName(t, "New Flow");
    store.newRound(structuredClone(defaultTpl()) as SpeechTemplate, name);
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
      const to = await tournaments.moveFlow(flow, t);
      if (to) await repointMirror(flow.path, to);
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
    // Delete the app-data mirror too. They are one flow as far as the dashboard
    // is concerned, so leaving the mirror behind would make "Delete" look like
    // it moved the flow to "not in a tournament" rather than removing it.
    const meta = roundsByPath.get(normPath(file.path));
    await tournaments.deleteFlow(file);
    if (meta) {
      await deleteRound(meta.id);
      rounds = await listRounds();
    }
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
          value={settings.defaultTemplate}
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          onchange={(e) => settings.setDefaultTemplate(Number(e.currentTarget.value))}
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
          {#if renamingTourney === t.id}
            <span class="folder-icon">📁</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="rename" bind:value={renameTourneyText} autofocus
              onblur={commitRenameTourney}
              onkeydown={(e) => { if (e.key==='Enter') commitRenameTourney(); if (e.key==='Escape') renamingTourney=null; }} />
          {:else}
            <button
              class="disclose"
              aria-expanded={!collapsed.includes(t.id)}
              title={collapsed.includes(t.id) ? 'Show flows' : 'Collapse to just the name'}
              onclick={() => toggleCollapsed(t.id)}
            >
              <span class="caret">{collapsed.includes(t.id) ? '▸' : '▾'}</span>
              <span class="folder-icon">📁</span>
              <span class="tname">{t.name}</span>
              <!-- Count the rows actually shown, not raw files: two copies of
                   one flow are one flow. -->
              <span class="count">{rowsFor(t).length}</span>
            </button>
            <button class="icon" title="Rename" onclick={() => { renamingTourney = t.id; renameTourneyText = t.name; }}>✎</button>
            <button class="icon" title="Remove from Nimbus (keeps the folder)" onclick={() => tournaments.unlink(t.id)}>unlink</button>
            <span class="t-sp"></span>
            <button class="mini-btn" onclick={() => newFlowInTournament(t)}>+ New flow</button>
          {/if}
        </div>
        {#if !collapsed.includes(t.id)}
          <div class="flow-rows">
            {#each rowsFor(t) as { file, dupes } (file.path)}
              <div
                class="flow-row"
                class:card-dragging={draggingFlow?.path === file.path}
                role="button"
                tabindex="0"
                draggable="true"
                onclick={() => openTournamentFlow(file)}
                onkeydown={(e) => e.key === 'Enter' && openTournamentFlow(file)}
                ondragstart={(e) => { draggingFlow = file; e.dataTransfer?.setData('text/plain', file.path); }}
                ondragend={() => { draggingFlow = null; dragOver = null; }}
              >
                {#if renamingKey === file.path}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="rename-input" bind:value={renameText} autofocus
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRenameFlow(file); if (e.key === 'Escape') renamingKey = null; }}
                    onblur={() => commitRenameFlow(file)} />
                {:else}
                  <span class="rname">{flowTitle(file)}</span>
                  <button class="rename-btn" title="Rename flow"
                    onclick={(e) => { e.stopPropagation(); startRename(file.path, flowTitle(file)); }}>✎</button>
                {/if}
                {#if file.rel}
                  <span class="rel-badge" title="In sub-folder: {file.rel}">{file.rel}</span>
                {/if}
                {#if dupes.length > 0}
                  <span
                    class="dupe-badge"
                    title="This flow also exists at:&#10;{dupes.map((d) => d.path).join('\n')}&#10;&#10;Showing the live copy. The others are older leftovers — delete them in Finder/Explorer if you don't want them."
                  >{dupes.length + 1} copies</span>
                {/if}
                <span class="row-sp"></span>
                <span class="ext-badge {file.ext}">{file.ext === 'xlsx' ? 'Excel' : 'Nimbus'}</span>
                <span class="rdate">{fmtDate(file.modified)}</span>
                <button class="x row-x" class:confirming={confirmDelete === file.path}
                  onclick={(e) => { e.stopPropagation(); removeFlow(file); }}
                  title="Delete flow">{confirmDelete === file.path ? 'Delete?' : '×'}</button>
              </div>
            {/each}
            {#if rowsFor(t).length === 0}
              <p class="empty-hint row-empty">No flows here yet. Drag one in, or use New flow.</p>
            {/if}
          </div>
        {/if}
      </section>
    {/each}

    {#if tournaments.list.length === 0 && !creatingTourney}
      <p class="empty-hint">No tournaments yet. Use New tournament to make a folder, then add flows to it.</p>
    {/if}

    <!-- unfiled app-data flows (anything already filed shows in its tournament) -->
    {#if unfiled.length > 0}
      <h2 class="section">NOT IN A TOURNAMENT</h2>
      <p class="empty-hint">Drag any of these onto a tournament above to file it there.</p>
      <div class="cards">
        {#each unfiled as r (r.id)}
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

<style>
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
  .t-sp { flex: 1; }
  /* The whole name is the collapse control — a 12px caret is a poor target. */
  .disclose {
    display: flex; align-items: center; gap: 8px; background: none; border: none;
    color: var(--text); font: inherit; cursor: pointer; padding: 2px 4px;
    border-radius: 6px; text-align: left;
  }
  .disclose:hover { background: color-mix(in srgb, var(--text) 7%, transparent); }
  .caret { font-size: 10px; color: var(--text-dim); width: 10px; }
  .count {
    font-size: 11px; font-weight: 600; color: var(--text-dim);
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 9px; padding: 0 7px; min-width: 18px; text-align: center;
  }

  /* One line per flow. The old card grid was 162px per flow, so a tournament
     with a handful of rounds filled the page on its own. */
  .flow-rows { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
  .flow-row {
    display: flex; align-items: center; gap: 8px; cursor: grab;
    padding: 5px 8px; border-radius: 6px; border: 1px solid transparent;
    font-size: 13px; min-height: 30px; box-sizing: border-box;
  }
  .flow-row:hover { background: var(--panel); border-color: var(--border); }
  .rname { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row-sp { flex: 1; }
  .rdate { font-size: 12px; color: var(--text-dim); white-space: nowrap; }
  .rel-badge {
    font-size: 10px; color: var(--text-dim); background: var(--bg);
    border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px;
    max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dupe-badge {
    font-size: 10px; font-weight: 600; border-radius: 4px; padding: 1px 6px; cursor: help;
    color: var(--mark-dropped);
    border: 1px solid color-mix(in srgb, var(--mark-dropped) 45%, transparent);
  }
  .row-x { position: static; opacity: 0; }
  .flow-row:hover .row-x, .row-x.confirming { opacity: 1; }
  .flow-row:hover .rename-btn { opacity: 1; }
  .flow-row .rename-input { margin-right: 0; width: auto; flex: 1; font-size: 13px; }
  .row-empty { margin: 2px 0 4px 8px; }
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
  .empty-hint { color: var(--text-dim); font-size: 12px; font-style: italic; margin: 4px 0 10px; }
  .status { font-size: 12px; color: var(--text-dim); margin: 0 0 10px; }
</style>
