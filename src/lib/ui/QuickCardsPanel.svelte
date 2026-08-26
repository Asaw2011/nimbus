<script lang="ts">
  // Flow-side Quick Cards panel: browse your saved snippets and DRAG them onto
  // the flow grid (or click to drop into the current cell). Shares the same
  // library as the speech doc's Quick Cards palette.
  import { onMount } from "svelte";
  import { quickCards, type QuickCard } from "../doc/quick-cards.svelte";
  import { store } from "../model/round.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let query = $state("");
  const results = $derived(quickCards.match(query));

  onMount(() => void quickCards.init());

  function onDragStart(e: DragEvent, card: QuickCard) {
    if (!e.dataTransfer) return;
    // Structured payload → the grid builds the same cell a real card would.
    if (card.flow) e.dataTransfer.setData("text/nimbus-quickcard", JSON.stringify(card.flow));
    // Plain-text fallback for any drop target that only knows nimbus-block.
    e.dataTransfer.setData("text/nimbus-block", JSON.stringify({ header: card.preview, fullCard: card.preview }));
    e.dataTransfer.effectAllowed = "copy";
  }

  // Click drops the card into the current cell (a shortcut to dragging).
  function drop(card: QuickCard) {
    const c = store.cursor;
    if (!c || !store.activeSheetId) return;
    if (card.flow) store.setCellFromFlow(c.row, c.col, card.flow);
    else store.setCell(c.row, c.col, card.preview);
  }
</script>

<div class="qcp-backdrop" role="presentation" onclick={onclose}></div>
<div class="qcp" role="dialog" aria-label="Quick cards">
  <div class="qcp-head">
    <span class="qcp-title">Quick Cards</span>
    <button class="qcp-x" onclick={onclose} aria-label="Close">×</button>
  </div>
  <input class="qcp-search" bind:value={query} placeholder="Search…" spellcheck="false" />
  <p class="qcp-hint">Drag a card onto the flow, or click to drop it in the current cell.</p>
  <div class="qcp-list">
    {#if results.length === 0}
      <div class="qcp-empty">
        {quickCards.cards.length
          ? "No matches."
          : "No quick cards yet. In the speech doc, select text and Save selection (★ Quick)."}
      </div>
    {:else}
      {#each results as c (c.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="qcp-item"
          draggable="true"
          title="Drag onto the flow, or click to drop in the current cell"
          ondragstart={(e) => onDragStart(e, c)}
          onclick={() => drop(c)}
        >
          <span class="qcp-grip">⋮⋮</span>
          <div class="qcp-body">
            <span class="qcp-row">
              <span class="qcp-name">{c.name}</span>
              {#each c.tags as t (t)}<span class="qcp-tag">{t}</span>{/each}
            </span>
            <span class="qcp-prev">{c.preview.slice(0, 90)}</span>
          </div>
          <button
            class="qcp-del"
            title="Delete quick card"
            aria-label="Delete"
            onclick={(e) => { e.stopPropagation(); quickCards.remove(c.id); }}
            ondragstart={(e) => e.preventDefault()}
          >×</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .qcp-backdrop { position: fixed; inset: 0; z-index: 39; }
  .qcp {
    position: fixed;
    top: 46px;
    right: 12px;
    z-index: 40;
    width: 340px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }
  .qcp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px;
  }
  .qcp-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .qcp-x { background: none; border: none; color: var(--text-dim); font-size: 20px; cursor: pointer; line-height: 1; }
  .qcp-search {
    margin: 0 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 5px 9px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  .qcp-search:focus { border-color: var(--accent); }
  .qcp-hint { font-size: 11px; color: var(--text-dim); margin: 6px 12px; }
  .qcp-list { overflow-y: auto; padding: 0 6px 8px; }
  .qcp-empty { font-size: 12.5px; color: var(--text-dim); padding: 14px; text-align: center; line-height: 1.5; }
  .qcp-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 7px 8px;
    border-radius: 7px;
    cursor: grab;
    border: 1px solid transparent;
  }
  .qcp-item:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); border-color: var(--border); }
  .qcp-item:active { cursor: grabbing; }
  .qcp-grip { color: var(--text-dim); font-size: 12px; line-height: 1.4; user-select: none; flex-shrink: 0; }
  .qcp-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .qcp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .qcp-name { font-weight: 600; font-size: 13px; }
  .qcp-tag {
    font-size: 10px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-radius: 4px;
    padding: 0 5px;
  }
  .qcp-prev {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .qcp-del {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
  }
  .qcp-item:hover .qcp-del { opacity: 1; }
  .qcp-del:hover { color: var(--mark-dropped, #c0392b); }
</style>
