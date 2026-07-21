<script lang="ts">
  import { onMount } from "svelte";
  import type { RoundMeta, SpeechTemplate } from "../model/types";
  import { builtinTemplates } from "../model/templates";
  import { listRounds, loadRound, saveRound, deleteRound } from "../model/persist";
  import { loadBlob, loadBlobCached, saveBlob } from "../model/blobs";
  import { openFromFile } from "../model/filedoc.svelte";
  import { store, migrateLegacyRound } from "../model/round.svelte";
  import { uid } from "../model/types";
  import SettingsPanel from "./SettingsPanel.svelte";

  let { onopen }: { onopen: () => void } = $props();

  const LS_TEMPLATE = "debate-flow:last-template";
  const LS_FOLDERS = "debate-flow:folders";

  let rounds: RoundMeta[] = $state([]);
  let showSettings = $state(false);
  let confirmingId = $state<string | null>(null);
  /** Round card currently typing a new folder name. */
  let newFolderFor = $state<string | null>(null);
  let newFolderName = $state("");
  /** Inline round renaming on cards. */
  let renamingRound = $state<string | null>(null);
  let renameText = $state("");
  /** Folders exist independently of rounds so you can make them first. */
  let customFolders = $state<string[]>(
    loadBlobCached<string[]>("folders") ??
      JSON.parse(
        (typeof localStorage !== "undefined" && localStorage.getItem(LS_FOLDERS)) || "[]",
      ),
  );
  let addingFolder = $state(false);
  let folderInput = $state("");
  // Drag a round card into a folder section to move it there.
  let draggingRoundId = $state<string | null>(null);
  let dragOverFolder = $state<string | null>(null);

  async function dropOnFolder(tournament: string) {
    const id = draggingRoundId;
    draggingRoundId = null;
    dragOverFolder = null;
    if (id) await setFolder(id, tournament);
  }

  function saveFolders() {
    saveBlob("folders", $state.snapshot(customFolders));
  }

  function createFolder() {
    const n = folderInput.trim();
    if (n && !customFolders.includes(n)) {
      customFolders = [...customFolders, n];
      saveFolders();
    }
    addingFolder = false;
    folderInput = "";
  }

  function deleteFolder(name: string) {
    customFolders = customFolders.filter((f) => f !== name);
    saveFolders();
  }

  const templates = builtinTemplates();
  const savedIdx =
    Number(
      typeof localStorage !== "undefined" && localStorage.getItem(LS_TEMPLATE),
    ) || 0;
  let templateIdx = $state(
    savedIdx >= 0 && savedIdx < templates.length ? savedIdx : 0,
  );

  // Sections: Unfiled always first (holds the New Round card), then named
  // tournament folders (most recent first), then any empty custom folders.
  const groups = $derived.by(() => {
    const map = new Map<string, RoundMeta[]>();
    map.set("", []); // Unfiled always present so folders show even with 0 rounds
    for (const r of rounds) {
      const key = r.tournament.trim() || "";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    const unfiled: [string, RoundMeta[]] = ["", map.get("") ?? []];
    const named = [...map.entries()]
      .filter(([k]) => k !== "")
      .sort((a, b) => (b[1][0]?.updatedAt ?? 0) - (a[1][0]?.updatedAt ?? 0));
    const empty: Array<[string, RoundMeta[]]> = customFolders
      .filter((f) => !map.has(f))
      .map((f) => [f, []]);
    return [unfiled, ...named, ...empty];
  });
  const folderNames = $derived(
    [
      ...new Set([
        ...customFolders,
        ...rounds.map((r) => r.tournament.trim()).filter(Boolean),
      ]),
    ],
  );

  async function commitRoundRename(id: string) {
    const name = renameText.trim();
    renamingRound = null;
    if (!name) return;
    const round = await loadRound(id);
    if (!round) return;
    round.name = name;
    await saveRound(round);
    await refresh();
  }

  onMount(() => {
    void refresh();
    // Pull the authoritative on-disk folder list.
    void loadBlob<string[]>("folders").then((disk) => {
      if (disk) customFolders = disk;
      else if (customFolders.length) saveFolders();
    });
  });

  async function refresh() {
    rounds = await listRounds();
  }

  function createRound() {
    localStorage.setItem(LS_TEMPLATE, String(templateIdx));
    const template: SpeechTemplate = structuredClone(templates[templateIdx]);
    store.newRound(template, "New Round");
    onopen();
  }

  async function open(id: string) {
    const round = await loadRound(id);
    if (round) {
      store.loadRound(round);
      onopen();
    }
  }

  // window.confirm() is a no-op inside the Tauri webview — two-step confirm.
  async function remove(id: string) {
    if (confirmingId !== id) {
      confirmingId = id;
      setTimeout(() => {
        if (confirmingId === id) confirmingId = null;
      }, 3000);
      return;
    }
    confirmingId = null;
    await deleteRound(id);
    await refresh();
  }

  async function setFolder(id: string, value: string) {
    if (value === "__new__") {
      newFolderFor = id;
      newFolderName = "";
      return;
    }
    const round = await loadRound(id);
    if (!round) return;
    round.tournament = value;
    await saveRound(round);
    await refresh();
  }

  async function commitNewFolder(id: string) {
    const name = newFolderName.trim();
    newFolderFor = null;
    if (name) await setFolder(id, name);
  }

  let importStatus = $state("");

  /** Import a .flowround.json shared by another Flow user. */
  function doImportRound(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(String(reader.result ?? ""));
        if (!raw?.template?.speeches || !Array.isArray(raw.sheets)) {
          importStatus = "That doesn't look like a Flow round file.";
          return;
        }
        const round = migrateLegacyRound(raw);
        if (rounds.some((r) => r.id === round.id)) {
          // Already have a round with this id — import as a copy.
          round.id = uid();
          round.name = `${round.name} (imported)`;
        }
        round.updatedAt = Date.now();
        await saveRound(round);
        await refresh();
        importStatus = `Imported "${round.name}" ✓`;
      } catch {
        importStatus = "That file isn't valid JSON.";
      }
    };
    reader.readAsText(file);
    input.value = "";
  }

  async function openFlowFile() {
    const round = await openFromFile();
    if (round) {
      store.loadRound(round);
      onopen();
    }
  }

  function chipSide(kind: RoundMeta["sheets"][number]["kind"]): string {
    if (kind === "case") return "aff";
    if (kind === "offcase" || kind === "overview") return "neg";
    return "";
  }

  function fmtDate(t: number): string {
    return new Date(t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
</script>

{#snippet newRoundCard()}
  <div
    class="card new-card"
    role="button"
    tabindex="0"
    onclick={createRound}
    onkeydown={(e) => e.key === "Enter" && createRound()}
  >
    <span class="plus">+</span>
    <span>New Round</span>
    <select
      class="tmpl"
      bind:value={templateIdx}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      onchange={() => localStorage.setItem(LS_TEMPLATE, String(templateIdx))}
    >
      {#each templates as t, i (t.id)}
        <option value={i}>{t.name}</option>
      {/each}
    </select>
  </div>
{/snippet}

{#snippet roundCard(r: RoundMeta)}
  <div
    class="card round-card"
    class:card-dragging={draggingRoundId === r.id}
    role="button"
    tabindex="0"
    draggable="true"
    onclick={() => open(r.id)}
    onkeydown={(e) => e.key === "Enter" && open(r.id)}
    ondragstart={(e) => {
      draggingRoundId = r.id;
      e.dataTransfer?.setData("text/plain", r.id);
    }}
    ondragend={() => { draggingRoundId = null; dragOverFolder = null; }}
  >
    <button
      class="x"
      class:confirming={confirmingId === r.id}
      title="Delete round"
      onclick={(e) => {
        e.stopPropagation();
        remove(r.id);
      }}
    >{confirmingId === r.id ? "Delete?" : "×"}</button>
    {#if renamingRound === r.id}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename-input"
        bind:value={renameText}
        autofocus
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commitRoundRename(r.id);
          if (e.key === "Escape") renamingRound = null;
        }}
        onblur={() => commitRoundRename(r.id)}
      />
    {:else}
      <div class="rname">
        {r.name}
        <button
          class="rename-btn"
          title="Rename flow"
          onclick={(e) => {
            e.stopPropagation();
            renamingRound = r.id;
            renameText = r.name;
          }}
        >✎</button>
      </div>
    {/if}
    {#if newFolderFor === r.id}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="folder-input"
        placeholder="Folder name"
        bind:value={newFolderName}
        autofocus
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commitNewFolder(r.id);
          if (e.key === "Escape") newFolderFor = null;
        }}
        onblur={() => commitNewFolder(r.id)}
      />
    {:else}
      <select
        class="folder"
        value={r.tournament.trim()}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        onchange={(e) => setFolder(r.id, e.currentTarget.value)}
      >
        <option value="">Unfiled</option>
        {#each folderNames as f (f)}
          <option value={f}>{f}</option>
        {/each}
        <option value="__new__">+ New folder…</option>
      </select>
    {/if}
    <div class="chips">
      {#each r.sheets as s, i (i)}
        <span
          class="chip-tag {s.color ? '' : chipSide(s.kind)}"
          style={s.color ? `color: ${s.color}; border-color: ${s.color}` : ""}
        >{s.title || "(untitled)"}</span>
      {:else}
        <span class="chip-tag empty">no sheets yet</span>
      {/each}
    </div>
    <div class="date">{fmtDate(r.updatedAt)}</div>
  </div>
{/snippet}

<div class="dashboard">
  <div class="topbar">
    <div class="brand">
      <img class="logo" src="/logo.png" alt="Nimbus" />
      Nimbus
    </div>
    <div class="top-actions">
      {#if addingFolder}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="folder-new"
          placeholder="Folder name (e.g. Berkeley)"
          bind:value={folderInput}
          autofocus
          onkeydown={(e) => {
            if (e.key === "Enter") createFolder();
            if (e.key === "Escape") {
              addingFolder = false;
              folderInput = "";
            }
          }}
          onblur={createFolder}
        />
      {:else}
        <button class="top-btn" onclick={() => (addingFolder = true)}>+ Folder</button>
      {/if}
      <button class="top-btn" onclick={openFlowFile}>Open flow…</button>
      <label class="top-btn file-btn">
        Import Round
        <input type="file" accept=".json,.nimbus,application/json" onchange={doImportRound} />
      </label>
      <button class="top-btn" onclick={() => (showSettings = true)}>Settings</button>
      <button class="top-btn primary" onclick={createRound}>+ New Round</button>
    </div>
  </div>

  <div class="content">
    {#if importStatus}
      <p class="import-status">{importStatus}</p>
    {/if}
    {#each groups as [tournament, group], gi (tournament)}
      <section
        class="folder-section"
        class:dragging-active={!!draggingRoundId}
        class:drop-target={draggingRoundId && dragOverFolder === tournament}
        role="group"
        ondragover={(e) => { if (draggingRoundId) { e.preventDefault(); dragOverFolder = tournament; } }}
        ondragleave={() => { if (dragOverFolder === tournament) dragOverFolder = null; }}
        ondrop={(e) => { e.preventDefault(); dropOnFolder(tournament); }}
      >
        <h2 class="section">
          {(tournament || "UNFILED").toUpperCase()} ({group.length})
          {#if group.length === 0 && customFolders.includes(tournament)}
            <button class="folder-x" title="Remove empty folder" onclick={() => deleteFolder(tournament)}>×</button>
          {/if}
          {#if draggingRoundId}
            <span class="drop-hint">drop here to move</span>
          {/if}
        </h2>
        <div class="cards">
          {#each group as r (r.id)}
            {@render roundCard(r)}
          {/each}
          {#if gi === 0}
            {@render newRoundCard()}
          {/if}
          {#if draggingRoundId && group.length === 0}
            <div class="drop-placeholder">Drop here to move to {tournament || "Unfiled"}</div>
          {:else if group.length === 0 && tournament !== ""}
            <p class="empty-folder">Empty — drag a round here, or use the folder menu on a round card.</p>
          {/if}
        </div>
      </section>
    {/each}
  </div>
</div>

{#if showSettings}
  <SettingsPanel onclose={() => (showSettings = false)} />
{/if}

<style>
  .dashboard {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 18px;
    font-weight: 700;
  }
  .logo {
    width: 30px;
    height: 30px;
    object-fit: contain;
  }
  .top-actions {
    display: flex;
    gap: 8px;
  }
  .top-btn {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .top-btn:hover {
    border-color: var(--accent);
  }
  .top-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }
  .section {
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 600;
    margin: 18px 0 10px;
  }
  .section:first-child {
    margin-top: 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .card {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 16px;
    min-height: 120px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    text-align: left;
  }
  .card:hover {
    border-color: var(--accent);
  }
  .rname {
    font-size: 15px;
    font-weight: 700;
    padding-right: 40px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .rename-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
    opacity: 0;
    padding: 0 2px;
  }
  .card:hover .rename-btn {
    opacity: 1;
  }
  .rename-btn:hover {
    color: var(--accent);
  }
  .rename-input {
    background: var(--bg);
    border: 1px solid var(--accent);
    color: var(--text);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 14px;
    font-weight: 700;
    margin-right: 32px;
  }
  .folder-new {
    background: var(--bg);
    border: 1px solid var(--accent);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 13px;
    min-width: 200px;
  }
  .folder-x {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
    padding: 0 4px;
  }
  .folder-x:hover {
    color: var(--mark-dropped);
  }
  .empty-folder {
    color: var(--text-dim);
    font-size: 12px;
    font-style: italic;
    margin: 4px 0;
  }
  .folder-section {
    border-radius: 10px;
    padding: 2px 6px 6px;
    margin: 0 -6px;
    border: 2px dashed transparent;
    transition: border-color 0.1s, background 0.1s;
  }
  /* While dragging, every folder becomes a generous target you can't miss. */
  .folder-section.dragging-active {
    border-color: var(--border);
    padding-bottom: 16px;
    margin-bottom: 8px;
  }
  .folder-section.dragging-active .cards {
    min-height: 96px;
  }
  .folder-section.drop-target {
    border-color: var(--accent);
    border-style: solid;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .drop-placeholder {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 90px;
    border: 2px dashed var(--accent);
    border-radius: 10px;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .drop-hint {
    font-size: 10px;
    color: var(--accent);
    font-weight: 600;
    margin-left: 8px;
  }
  .card-dragging {
    opacity: 0.4;
  }
  .round-card {
    cursor: grab;
  }
  .file-btn {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }
  .file-btn input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .import-status {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0 0 10px;
  }
  .x {
    position: absolute;
    top: 10px;
    right: 10px;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 15px;
    cursor: pointer;
    border-radius: 4px;
    padding: 1px 6px;
  }
  .x:hover {
    color: var(--mark-dropped);
  }
  .x.confirming {
    background: var(--mark-dropped);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 3px 8px;
  }
  .folder,
  .folder-input {
    align-self: flex-start;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
    max-width: 60%;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .chip-tag {
    font-size: 11px;
    border-radius: 5px;
    padding: 2px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
  }
  .chip-tag.aff {
    color: var(--aff);
    border-color: color-mix(in srgb, var(--aff) 40%, transparent);
  }
  .chip-tag.neg {
    color: var(--neg);
    border-color: color-mix(in srgb, var(--neg) 40%, transparent);
  }
  .chip-tag.empty {
    opacity: 0.6;
    font-style: italic;
  }
  .date {
    margin-top: auto;
    font-size: 12px;
    color: var(--text-dim);
  }
  .new-card {
    border-style: dashed;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    gap: 6px;
  }
  .new-card:hover {
    color: var(--text);
  }
  .plus {
    font-size: 22px;
    line-height: 1;
  }
  .tmpl {
    margin-top: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
  }
</style>
