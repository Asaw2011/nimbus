<script lang="ts">
  // Argument-bank manager: view, edit, add, and remove the banked arguments the
  // ⌘J author-lookup draws from. Lets you fix wrong/partial entries by hand.
  import { store } from "$lib/model/round.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let query = $state("");
  let newTag = $state("");
  let newAuthor = $state("");
  let confirmClear = $state(false);

  // Index into the FULL bank, with the row's live values — so edits/deletes hit
  // the right entry even while a filter is applied.
  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return store.bank
      .map((a, i) => ({ a, i }))
      .filter(({ a }) =>
        !q ||
        a.tag.toLowerCase().includes(q) ||
        (a.author?.toLowerCase().includes(q) ?? false),
      );
  });

  function addNew() {
    if (!newTag.trim()) return;
    store.addArg(newTag, newAuthor);
    newTag = "";
    newAuthor = "";
  }
</script>

<div class="ab-backdrop" role="presentation" onclick={onclose}></div>
<div class="ab-modal" role="dialog" aria-label="Argument bank">
  <div class="ab-head">
    <span class="ab-title">Argument bank</span>
    <span class="ab-count">{store.bank.length} banked</span>
    <span class="ab-sp"></span>
    <button class="ab-x" onclick={onclose} title="Close">✕</button>
  </div>

  <div class="ab-tools">
    <input class="ab-search" placeholder="Filter…" bind:value={query} />
    {#if confirmClear}
      <button class="ab-danger" onclick={() => { store.clearBank(); confirmClear = false; }}>Confirm clear all</button>
      <button class="ab-btn" onclick={() => (confirmClear = false)}>Cancel</button>
    {:else}
      <button class="ab-btn" disabled={store.bank.length === 0} onclick={() => (confirmClear = true)}>Clear all</button>
    {/if}
  </div>

  <div class="ab-list">
    {#if rows.length === 0}
      <div class="ab-empty">
        {store.bank.length === 0
          ? "No arguments banked yet — import a doc (they bank automatically) or add one below."
          : "No matches for that filter."}
      </div>
    {/if}
    {#each rows as { a, i } (i)}
      <div class="ab-row" class:analytic={a.analytic}>
        <input
          class="ab-author"
          placeholder={a.analytic ? "—" : "author"}
          disabled={a.analytic}
          value={a.author ?? ""}
          onchange={(e) => store.updateArg(i, { author: e.currentTarget.value })}
        />
        <input
          class="ab-tag"
          value={a.tag}
          onchange={(e) => store.updateArg(i, { tag: e.currentTarget.value })}
        />
        {#if a.analytic}<span class="ab-kind">ANL</span>{/if}
        <button class="ab-del" title="Remove from bank" onclick={() => store.removeArg(i)}>✕</button>
      </div>
    {/each}
  </div>

  <div class="ab-add">
    <input class="ab-author" placeholder="author (optional)" bind:value={newAuthor}
      onkeydown={(e) => e.key === "Enter" && addNew()} />
    <input class="ab-tag" placeholder="new argument / tag…" bind:value={newTag}
      onkeydown={(e) => e.key === "Enter" && addNew()} />
    <button class="ab-btn add" disabled={!newTag.trim()} onclick={addNew}>+ Add</button>
  </div>
</div>

<style>
  .ab-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 60; }
  .ab-modal {
    position: fixed; z-index: 61; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(640px, 92vw); max-height: 80vh; display: flex; flex-direction: column;
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); overflow: hidden;
  }
  .ab-head { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .ab-title { font-weight: 700; font-size: 15px; }
  .ab-count { font-size: 12px; color: var(--text-dim); }
  .ab-sp { flex: 1; }
  .ab-x { background: none; border: none; color: var(--text-dim); font-size: 15px; cursor: pointer; }
  .ab-x:hover { color: var(--text); }
  .ab-tools { display: flex; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .ab-search { flex: 1; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
  .ab-list { overflow-y: auto; padding: 6px 10px; flex: 1; }
  .ab-empty { padding: 24px 12px; text-align: center; color: var(--text-dim); font-size: 13px; }
  .ab-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
  .ab-row.analytic .ab-tag { color: var(--pmd-color-analytic, #2e8b57); }
  .ab-author { width: 130px; flex-shrink: 0; padding: 4px 6px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--text); font-weight: 600; font-size: 12px; }
  .ab-tag { flex: 1; padding: 4px 6px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--text); font-size: 12px; }
  .ab-author:hover, .ab-tag:hover, .ab-author:focus, .ab-tag:focus { border-color: var(--border); background: var(--bg); outline: none; }
  .ab-kind { font-size: 9px; font-weight: 700; color: var(--pmd-color-analytic, #2e8b57); border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; }
  .ab-del { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 12px; padding: 0 4px; opacity: 0; }
  .ab-row:hover .ab-del { opacity: 1; }
  .ab-del:hover { color: var(--mark-dropped, #c0392b); }
  .ab-add { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); }
  .ab-add .ab-author, .ab-add .ab-tag { border-color: var(--border); background: var(--bg); }
  .ab-btn, .ab-danger { padding: 5px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); cursor: pointer; font-size: 12px; white-space: nowrap; }
  .ab-btn.add { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .ab-btn:disabled { opacity: 0.5; cursor: default; }
  .ab-danger { border-color: var(--mark-dropped, #c0392b); color: var(--mark-dropped, #c0392b); font-weight: 600; }
</style>
