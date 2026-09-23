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
  import { smartKit, type Suggestion } from "./kit.svelte";

  let { onjump }: { onjump: (sheetId: string, row: number, col: number) => void } = $props();

  let open = $state(false);
  let tab = $state<"suggest" | "kit">("suggest");
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
    return smartKit.files.find((f) => f.key === key)?.name.replace(/\.docx$/i, "") ?? "";
  }

  /** "Solvency---AT: Say No---2NC" reads better without the speech marker. */
  function blockLabel(title: string): string {
    return title.replace(/\s*-{2,}\s*(1ac|2ac|1nc|2nc|1nr|2nr|1ar|2ar)\s*$/i, "");
  }
</script>

<div class="smart-anchor">
  {#if open}
    <div class="tray" role="dialog" aria-label="Smart blocks">
      <div class="tray-head">
        <button class:on={tab === "suggest"} onclick={() => (tab = "suggest")}>
          Suggestions{list.length ? ` (${list.length})` : ""}
        </button>
        <button class:on={tab === "kit"} onclick={() => (tab = "kit")}>
          Round kit{smartKit.files.length ? ` (${smartKit.files.length})` : ""}
        </button>
        <span class="lab">LAB</span>
        <button class="x" onclick={() => (open = false)} aria-label="Close">×</button>
      </div>

      {#if tab === "suggest"}
        <div class="body">
          {#if !smartKit.files.length}
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

          <div class="section">Files</div>
          {#each smartKit.files as f (f.key)}
            {@const p = smartKit.parsed[f.key]}
            <div class="file">
              <span class="fname" title={f.key}>{f.name.replace(/\.docx$/i, "")}</span>
              <span class="fmeta" class:err={!!p?.error}>
                {p ? (p.error ? p.error : `${p.blocks.length} blocks`) : "reading…"}
              </span>
              <label class="gen" title="Offer this file's blocks on every sheet (T, theory, framework)">
                <input type="checkbox" checked={!!f.general} onchange={(e) => smartKit.setGeneral(f.key, (e.currentTarget as HTMLInputElement).checked)} />
                every sheet
              </label>
              <button class="dismiss" onclick={() => smartKit.remove(f.key)} title="Remove from kit">×</button>
            </div>
          {:else}
            <p class="empty">No files yet. Add the exact files you want suggestions from — the newest midterms file, not all four.</p>
          {/each}
          <button class="add" onclick={addFiles}>+ Add files…</button>
          <input bind:this={fileInput} type="file" accept=".docx" multiple hidden onchange={onBrowserFiles} />

          {#if store.round?.sheets.length && smartKit.files.length}
            <div class="section">Which file each sheet uses</div>
            {#each store.round.sheets as sh (sh.id)}
              {@const auto = smartKit.autoLink(sh)}
              <div class="row">
                <span class="label sheetname" title={sh.title}>{sh.title || "Untitled"}</span>
                <select value={linkValue(sh.id)} onchange={(e) => onLink(sh.id, (e.currentTarget as HTMLSelectElement).value)}>
                  <option value="__auto">Auto: {auto ? fileName(auto) : "none found"}</option>
                  <option value="">No file</option>
                  {#each smartKit.files.filter((f) => !f.general) as f (f.key)}
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

  <button class="pill" class:has={list.length > 0} onclick={() => (open = !open)} title="Smart blocks (Lab)">
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
    width: min(380px, calc(100vw - 32px));
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
