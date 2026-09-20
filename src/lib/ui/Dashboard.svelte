<script lang="ts">
  import { onMount } from "svelte";
  import type { Round, RoundMeta, Side, SpeechTemplate } from "../model/types";
  import { builtinTemplates, splitForSide, splitTargetFor } from "../model/templates";
  import { listRounds, loadRound, saveRound, deleteRound } from "../model/persist";
  import { openFromFile, convertFlowFile, openPath } from "../model/filedoc.svelte";
  import { tournaments, type Tournament, type FlowFile } from "../model/tournaments.svelte";
  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";
  import Manual from "./Manual.svelte";
  import Icon from "./Icon.svelte";
  import { APP_VERSION } from "../model/minversion";

  let { onopen }: { onopen: () => void } = $props();

  const version = APP_VERSION;
  let showManual = $state(false);

  // The default flow library: a folder auto-created in Documents where every new
  // flow is saved and kept in sync, so flows are organized on disk with no
  // "Save As" step (like ebb). Registered as a tournament so it shows in the UI.
  const LIBRARY_NAME = "Nimbus Flows";
  let homeTourney = $state<Tournament | null>(null);

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

  const LS_SIDE = "debate-flow:last-side";

  const templates = builtinTemplates();
  // The default speech format lives in settings (disk-backed), so whatever you
  // pick here is the primary option next time — no re-selecting Policy each run.
  function defaultTpl(): SpeechTemplate {
    const i = settings.defaultTemplate;
    const base = (templates[i] ?? templates[0]) as SpeechTemplate;
    const overrides = settings.templateAbbrs[i] ?? [];
    const tpl = structuredClone(base) as SpeechTemplate;
    tpl.speeches.forEach((sp, j) => {
      const o = overrides[j]?.trim();
      if (o) sp.abbr = o;
    });
    return tpl;
  }

  // Which side you're flowing from, chosen HERE because it decides how many
  // columns the round has — every sheet stores a start-column index, so the
  // count can't change once sheets exist. "neutral" is solo flowing and is the
  // default: picking a side is opting IN to partner lanes.
  const savedSide = typeof localStorage !== "undefined" ? localStorage.getItem(LS_SIDE) : null;
  let mySide = $state<Side>(
    savedSide === "aff" || savedSide === "neg" ? savedSide : "neutral",
  );
  /** The template as the round will actually be created — the chosen format's
   *  speech renames applied by `defaultTpl()`, then lanes split in. Also tells
   *  the UI whether this format HAS a splittable speech. */
  const pickedTemplate = $derived.by(() => splitForSide(defaultTpl(), mySide));
  const splitLabel = $derived.by(() => {
    if (mySide === "neutral") return "";
    const tpl = defaultTpl();
    const at = splitTargetFor(tpl, mySide);
    const sp = tpl.speeches[at];
    return sp ? `${sp.abbr} splits into two lanes` : "nothing to split in this format";
  });

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
    // Collapse pre-existing tournaments; the default library (added next) is
    // left out of this list, so it opens expanded.
    collapsed = tournaments.list.map((t) => t.id);
    await ensureDefaultLibrary();
    await reloadFlows();
  });

  /** Create (once) the default "Nimbus Flows" folder in Documents and register
   *  it, so every new flow auto-saves there. Idempotent: reuses it if already
   *  registered, and only seeds examples when the folder is empty. */
  async function ensureDefaultLibrary() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const docs = await invoke<string>("documents_dir");
      const sep = docs.includes("\\") ? "\\" : "/";
      const libPath = docs.replace(/[\\/]+$/, "") + sep + LIBRARY_NAME;
      const already = tournaments.list.find((t) => normPath(t.path) === normPath(libPath));
      if (already) { homeTourney = already; return; }
      await invoke("create_dir", { path: libPath });
      const t = tournaments.addLibrary(LIBRARY_NAME, libPath);
      homeTourney = t;
      // Seed a couple of example flows the very first time, so the folder shows
      // populated. Skipped if the folder already holds flows.
      const existing = await tournaments.flows(t);
      if (existing.length === 0) {
        await tournaments.saveRoundInto(t, exampleRound("Example flow 1"));
        await tournaments.saveRoundInto(t, exampleRound("Example flow 2"));
      }
    } catch (e) {
      console.warn("default library setup failed", e);
    }
  }

  /** A minimal, self-contained round for seeding examples (no open-round side
   *  effects — mirrors store.newRound's shape). */
  function exampleRound(name: string): Round {
    return {
      id: Math.random().toString(36).slice(2, 12),
      name,
      tournament: "",
      opponent: "",
      judges: "",
      affTeam: "",
      negTeam: "",
      template: structuredClone(pickedTemplate) as SpeechTemplate,
      sheets: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Round;
  }

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

  async function createRound() {
    // Save straight into the default library folder so every flow is organized
    // on disk and auto-saved (no "Save As" step) — same path as "+ New flow" in
    // a tournament. Falls back to an app-data-only round if there's no library
    // (e.g. the browser build).
    if (homeTourney && "__TAURI_INTERNALS__" in window) {
      const name = await tournaments.uniqueFlowName(homeTourney, "New Round");
      store.newRound(structuredClone(pickedTemplate) as SpeechTemplate, name, mySide);
      if (store.round) {
        try {
          const path = await tournaments.saveRoundInto(homeTourney, store.round);
          store.mutate((r) => (r.filePath = path));
        } catch (e) {
          console.warn("couldn't save new flow into the library", e);
        }
      }
    } else {
      store.newRound(structuredClone(pickedTemplate) as SpeechTemplate, "New Round", mySide);
    }
    onopen();
  }

  async function openFlowFile() {
    const round = await openFromFile();
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
    store.newRound(structuredClone(pickedTemplate) as SpeechTemplate, name, mySide);
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

  /** Short relative time for recency: "4h ago", "3d ago", else a date. */
  function timeAgo(t: number): string {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
    return fmtDate(t);
  }

  // Single-key shortcuts, echoing the key badges shown in the menu. Ignored
  // while typing (inline renames, tournament name) or with a modifier held.
  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
    switch (e.key.toLowerCase()) {
      case "n": e.preventDefault(); createRound(); break;
      case "o": e.preventDefault(); void openFlowFile(); break;
      case "c": if (!converting) { e.preventDefault(); void convert(); } break;
      case "s": e.preventDefault(); showSettings = true; break;
      case "?": e.preventDefault(); showManual = true; break;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="dashboard">
  <div class="content">
    <!-- hero -->
    <header class="hero">
      <div class="logo-stage">
        <img class="logo" src="/logo.png" alt="Nimbus" />
        <div class="rain" aria-hidden="true">
          {#each Array(7) as _, i (i)}
            <span></span>
          {/each}
        </div>
      </div>
      <h1 class="wordmark">Nimbus</h1>
      <p class="version">Version {version}</p>
    </header>

    <div class="panel">
      <!-- New flow: the primary action, then quick secondary actions -->
      <div class="newcard">
        <div class="newcard-accent" aria-hidden="true"></div>
        <div class="newcard-title">New flow</div>
        <label class="frow">
          <span class="frow-label">Format</span>
          <select
            class="field"
            value={settings.defaultTemplate}
            aria-label="Format for the new flow"
            onchange={(e) => settings.setDefaultTemplate(Number(e.currentTarget.value))}
          >
            {#each templates as t, i (t.id)}
              <option value={i}>{t.name}</option>
            {/each}
          </select>
        </label>
        <label class="frow">
          <span class="frow-label">Side</span>
          <select
            class="field"
            bind:value={mySide}
            aria-label="Which side you are flowing"
            title={splitLabel || "Flow this round on your own"}
            onchange={() => localStorage.setItem(LS_SIDE, mySide)}
          >
            <option value="neutral">Flowing solo</option>
            <option value="aff">With a partner · Aff</option>
            <option value="neg">With a partner · Neg</option>
          </select>
        </label>
        {#if splitLabel}<div class="ac-note">{splitLabel}</div>{/if}
        <button class="start" onclick={createRound}>Start flowing</button>
      </div>

      <div class="quick">
        <button class="quick-btn" onclick={openFlowFile}>Open a flow</button>
        <button class="quick-btn" onclick={convert} disabled={converting}>{converting ? "Converting…" : "Convert"}</button>
        <button class="quick-btn" onclick={() => (showSettings = true)}>Settings</button>
        <button class="quick-btn" onclick={() => (showManual = true)}>Help</button>
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
        class="folder"
        class:open={!collapsed.includes(t.id)}
        class:drop-target={(draggingFlow || draggingRoundId) && dragOver === t.id}
        class:drag-live={!!(draggingFlow || draggingRoundId)}
        role="group"
        ondragover={(e) => { if (draggingFlow || draggingRoundId) { e.preventDefault(); dragOver = t.id; } }}
        ondragleave={() => dragOver === t.id && (dragOver = null)}
        ondrop={(e) => { e.preventDefault(); dropOn(t); }}
      >
        {#if renamingTourney === t.id}
          <div class="folder-head">
            <span class="folder-ic"><Icon name="folder" size="16" /></span>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="rename" bind:value={renameTourneyText} autofocus
              onblur={commitRenameTourney}
              onkeydown={(e) => { if (e.key==='Enter') commitRenameTourney(); if (e.key==='Escape') renamingTourney=null; }} />
          </div>
        {:else}
          <div class="folder-head">
            <button
              class="disclose"
              aria-expanded={!collapsed.includes(t.id)}
              title={collapsed.includes(t.id) ? 'Show flows' : 'Collapse'}
              onclick={() => toggleCollapsed(t.id)}
            >
              <span class="chev"><Icon name="chevron" size="14" /></span>
              <span class="folder-ic"><Icon name="folder" size="16" /></span>
              <span class="tname">{t.name}</span>
              <!-- Count the rows actually shown, not raw files: two copies of
                   one flow are one flow. -->
              <span class="count">{rowsFor(t).length}</span>
            </button>
            <span class="t-sp"></span>
            <div class="folder-actions">
              <button class="act-btn" title="Rename tournament" onclick={() => { renamingTourney = t.id; renameTourneyText = t.name; }}><Icon name="pencil" size="13" /></button>
              <button class="act-btn" title="Remove from Nimbus (keeps the folder on your Mac)" onclick={() => tournaments.unlink(t.id)}>Unlink</button>
            </div>
            <button class="folder-new" title="New flow in this tournament" onclick={() => newFlowInTournament(t)}><Icon name="plus" size="13" /> New flow</button>
          </div>
        {/if}
        {#if !collapsed.includes(t.id)}
          <div class="folder-body">
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
                <span class="row-ic"><Icon name="doc" size="15" /></span>
                {#if renamingKey === file.path}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="rename-input" bind:value={renameText} autofocus
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRenameFlow(file); if (e.key === 'Escape') renamingKey = null; }}
                    onblur={() => commitRenameFlow(file)} />
                {:else}
                  <span class="rname">{flowTitle(file)}</span>
                  <button class="rename-btn" title="Rename flow"
                    onclick={(e) => { e.stopPropagation(); startRename(file.path, flowTitle(file)); }}><Icon name="pencil" size="13" /></button>
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
              <p class="empty-hint row-empty">Empty. Drag a flow here, or press New flow.</p>
            {/if}
          </div>
        {/if}
      </section>
    {/each}

    <!-- unfiled app-data flows (anything already filed shows in its tournament) -->
    {#if unfiled.length > 0}
      <h2 class="section">RECENT FLOWS</h2>
      <div class="flow-rows">
        {#each unfiled as r (r.id)}
          <div
            class="flow-row"
            class:card-dragging={draggingRoundId === r.id}
            role="button"
            tabindex="0"
            draggable="true"
            onclick={() => openAppRound(r.id)}
            onkeydown={(e) => e.key === 'Enter' && openAppRound(r.id)}
            ondragstart={(e) => { draggingRoundId = r.id; e.dataTransfer?.setData('text/plain', r.id); }}
            ondragend={() => { draggingRoundId = null; dragOver = null; }}
          >
            <span class="row-ic"><Icon name="doc" size="15" /></span>
            {#if renamingKey === r.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="rename-input" bind:value={renameText} autofocus
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRenameRound(r.id); if (e.key === 'Escape') renamingKey = null; }}
                onblur={() => commitRenameRound(r.id)} />
            {:else}
              <span class="rname">{r.name}</span>
              <button class="rename-btn" title="Rename flow"
                onclick={(e) => { e.stopPropagation(); startRename(r.id, r.name); }}><Icon name="pencil" size="13" /></button>
            {/if}
            <span class="row-sp"></span>
            <span class="rdate">{timeAgo(r.updatedAt)}</span>
            <button class="x row-x" class:confirming={confirmDelete === r.id}
              onclick={(e) => { e.stopPropagation(); removeRound(r.id); }}
              title="Delete round">{confirmDelete === r.id ? 'Delete?' : '×'}</button>
          </div>
        {/each}
      </div>
    {/if}
    </div>
  </div>
</div>

{#if showSettings}
  <SettingsPanel onclose={() => (showSettings = false)} />
{/if}

{#if showManual}
  <Manual onclose={() => (showManual = false)} />
{/if}

<style>
  .dashboard { height: 100vh; position: relative; overflow: hidden; background: var(--bg); }

  .content {
    height: 100%; overflow-y: auto; padding: 0 24px 40px;
    display: flex; flex-direction: column; align-items: center;
  }
  .content > * { width: 100%; max-width: 600px; }

  /* ---- hero: compact cloud with a constant rain loop underneath ---- */
  .hero {
    display: flex; flex-direction: column; align-items: center;
    padding: 34px 0 20px;
  }
  .logo-stage { position: relative; width: 130px; height: 122px; display: grid; place-items: start center; }
  .logo { width: 118px; height: 118px; object-fit: contain; }
  /* Rain: seven thin drops falling on a loop just below the cloud. Each is
     staggered by its index so they don't fall in lockstep. */
  .rain {
    position: absolute; left: 50%; top: 90px; transform: translateX(-50%);
    width: 62px; height: 32px; overflow: hidden; pointer-events: none;
  }
  .rain span {
    position: absolute; top: -8px;
    width: 2px; height: 9px; border-radius: 1px;
    background: linear-gradient(var(--accent), transparent);
    opacity: 0;
    animation: nimbus-rain 1.5s linear infinite;
  }
  /* Straight-down fall. Delays and durations are deliberately NON-monotonic so
     the drops don't march across in a diagonal wave — it reads as real rain. */
  .rain span:nth-child(1) { left: 5px;  animation-delay: -0.15s; animation-duration: 1.5s; }
  .rain span:nth-child(2) { left: 14px; animation-delay: -0.95s; animation-duration: 1.3s; }
  .rain span:nth-child(3) { left: 23px; animation-delay: -0.45s; animation-duration: 1.7s; }
  .rain span:nth-child(4) { left: 31px; animation-delay: -1.25s; animation-duration: 1.4s; }
  .rain span:nth-child(5) { left: 39px; animation-delay: -0.65s; animation-duration: 1.6s; }
  .rain span:nth-child(6) { left: 48px; animation-delay: -0.25s; animation-duration: 1.35s; }
  .rain span:nth-child(7) { left: 57px; animation-delay: -1.05s; animation-duration: 1.55s; }
  @keyframes nimbus-rain {
    0%   { transform: translateY(-6px); opacity: 0; }
    18%  { opacity: 0.9; }
    100% { transform: translateY(32px); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .rain span { animation: none; opacity: 0; } }
  .wordmark {
    margin: 8px 0 0; font-size: 34px; font-weight: 800; letter-spacing: -0.02em;
    color: var(--text); line-height: 1;
  }
  .version { margin: 8px 0 0; font-size: 12px; letter-spacing: 0.03em; color: var(--text-dim); }

  /* A hairline under the hero starts the "one surface, separated by rules"
     rhythm that makes the whole screen read as a single system. */
  .panel { border-top: 1px solid var(--border); padding-top: 26px; margin-top: 6px; }

  /* ---- Unified surface language: every block (New flow card, quick pills,
     flow lists) shares the same border, radius, and one restrained shadow, so
     nothing floats above the rest. ---- */
  .newcard {
    position: relative; overflow: hidden;
    display: flex; flex-direction: column; gap: 12px;
    padding: 22px 22px 20px; background: var(--panel);
    border: 1px solid var(--border); border-radius: 14px;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 6%, transparent);
  }
  .newcard-accent {
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: var(--accent);
  }
  .newcard-title { font-size: 16px; font-weight: 700; color: var(--text); }
  .frow { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .frow-label { font-size: 13px; color: var(--text-dim); font-weight: 500; }
  .field {
    flex: 1; max-width: 260px;
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 9px; padding: 9px 11px; font-size: 13px; font-family: inherit; cursor: pointer;
    transition: border-color 0.12s;
  }
  .field:hover { border-color: var(--accent); }
  .ac-note { font-size: 11.5px; color: var(--text-dim); font-style: italic; }
  .start {
    margin-top: 4px; width: 100%; padding: 11px; border: none; border-radius: 10px;
    background: var(--accent); color: #fff; font-size: 14.5px; font-weight: 650;
    font-family: inherit; cursor: pointer; transition: filter 0.12s;
  }
  .start:hover { filter: brightness(1.05); }

  /* Secondary actions: quiet pills under the card, same surface language. */
  .quick { display: flex; gap: 10px; margin-top: 14px; }
  .quick-btn {
    flex: 1; background: var(--panel); border: 1px solid var(--border); color: var(--text);
    border-radius: 12px; padding: 11px 12px; font-size: 13px; font-weight: 600;
    font-family: inherit; cursor: pointer;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 6%, transparent);
    transition: border-color 0.12s, background 0.12s;
  }
  .quick-btn:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--panel)); }
  .quick-btn:disabled { opacity: 0.55; cursor: default; }

  .ext-badge {
    align-self: flex-start; font-size: 10px; font-weight: 600; border-radius: 4px;
    padding: 1px 7px; border: 1px solid var(--border); color: var(--text-dim);
  }
  .ext-badge.nimbus { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .ext-badge.xlsx { color: #1e8e4a; border-color: color-mix(in srgb, #1e8e4a 40%, transparent); }

  .section {
    font-size: 11.5px; letter-spacing: 0.09em; color: var(--text-dim);
    font-weight: 700; margin: 36px 0 14px; text-transform: uppercase;
  }
  /* The section heading shares this flex row with the buttons, so its own top
     margin would offset it and float the buttons above the label. Put the
     spacing on the row and zero the heading's margin inside it. */
  .tourney-head { display: flex; align-items: center; gap: 10px; margin: 36px 0 14px; }
  .tourney-head .section { margin: 0; }
  .mini-btn {
    background: var(--panel); border: 1px solid var(--border); color: var(--accent);
    border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .mini-btn:hover { background: color-mix(in srgb, var(--accent) 10%, var(--panel)); }
  .tourney-input, .tourney-input:focus {
    background: var(--bg); border: 1px solid var(--accent); color: var(--text);
    border-radius: 6px; padding: 5px 10px; font-size: 13px; min-width: 320px;
  }

  /* ---- Tournament = one cohesive folder card: a clickable header bar, and a
     body of flow rows that opens beneath it. Same surface language as
     everything else. ---- */
  .folder {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; overflow: hidden; margin-bottom: 10px;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 6%, transparent);
    transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
  }
  .folder.drag-live { border-style: dashed; }
  .folder.drop-target {
    border-color: var(--accent); border-style: solid;
    background: color-mix(in srgb, var(--accent) 8%, var(--panel));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .folder-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
  .disclose {
    display: flex; align-items: center; gap: 9px; min-width: 0;
    background: none; border: none; color: var(--text); font: inherit;
    cursor: pointer; padding: 5px 7px; border-radius: 8px; text-align: left;
    transition: background 0.12s;
  }
  .disclose:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
  .chev { display: inline-flex; color: var(--text-dim); transition: transform 0.15s ease; }
  .folder.open .chev { transform: rotate(90deg); }
  .folder-ic { display: inline-flex; color: var(--accent); flex-shrink: 0; }
  .tname { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count {
    font-size: 11px; font-weight: 600; color: var(--text-dim);
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 9px; padding: 0 7px; min-width: 18px; text-align: center; flex-shrink: 0;
  }
  .t-sp { flex: 1; }
  /* Rename/Unlink stay out of the way until you hover the folder. */
  .folder-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.12s; }
  .folder:hover .folder-actions, .folder:focus-within .folder-actions { opacity: 1; }
  .act-btn {
    display: inline-flex; align-items: center; gap: 4px;
    background: none; border: 1px solid transparent; color: var(--text-dim);
    border-radius: 7px; padding: 4px 8px; font-size: 12px; font-family: inherit; cursor: pointer;
  }
  .act-btn:hover { color: var(--text); background: var(--bg); border-color: var(--border); }
  .folder-new {
    display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel));
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    color: var(--accent); border-radius: 8px; padding: 5px 10px;
    font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
    transition: background 0.12s;
  }
  .folder-new:hover { background: color-mix(in srgb, var(--accent) 18%, var(--panel)); }
  .folder-body { border-top: 1px solid var(--border); }

  /* Flows sit on their own surface card with hairline dividers, so the list
     reads as a defined block that lifts off the page instead of floating
     text. Hover highlights the whole row like a selected band. */
  .flow-rows {
    display: flex; flex-direction: column; margin-bottom: 6px;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; overflow: hidden;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 6%, transparent);
  }
  .flow-row {
    display: flex; align-items: center; gap: 10px; cursor: grab;
    padding: 13px 16px; border-bottom: 1px solid var(--grid-line);
    font-size: 14px; min-height: 50px; box-sizing: border-box;
    transition: background 0.1s;
  }
  .flow-row:last-child { border-bottom: none; }
  .flow-row:hover { background: color-mix(in srgb, var(--accent) 8%, var(--panel)); }
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
  .row-empty { margin: 0; padding: 14px 16px; }
  .rename, .rename:focus {
    flex: 1; min-width: 0;
    background: var(--bg); border: 1px solid var(--accent); color: var(--text);
    border-radius: 6px; padding: 5px 9px; font-size: 14px; font-weight: 700;
  }

  .card-dragging { opacity: 0.4; }
  .rename-btn {
    display: inline-flex; align-items: center;
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    font-size: 12px; opacity: 0; padding: 0 2px;
  }
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
  .empty-hint { color: var(--text-dim); font-size: 12px; font-style: italic; margin: 4px 0 10px; }
  .status { font-size: 12px; color: var(--text-dim); margin: 0 0 10px; }
</style>
