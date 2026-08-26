<script lang="ts">
  import { onMount } from "svelte";
  import { quickCards, type QuickCard, type QuickCardFlow } from "./quick-cards.svelte";

  let {
    oncapture,
    oninsert,
    onclose,
  }: {
    oncapture: () => { contentJson: unknown; name: string; preview: string; flow?: QuickCardFlow } | null;
    oninsert: (json: unknown) => void;
    onclose: () => void;
  } = $props();

  let query = $state("");
  let searchEl = $state<HTMLInputElement>();
  let canAdd = $state(false);
  // Non-null while the "save selection" form is open.
  let draft = $state<{ contentJson: unknown; name: string; preview: string; tags: string; flow?: QuickCardFlow } | null>(null);

  const results = $derived(quickCards.match(query));

  onMount(() => {
    void quickCards.init();
    canAdd = !!oncapture();
    queueMicrotask(() => searchEl?.focus());
  });

  function startAdd() {
    const cap = oncapture();
    if (!cap) return;
    draft = { ...cap, tags: "" };
  }
  function saveDraft() {
    if (!draft || !draft.name.trim()) return;
    quickCards.add({
      name: draft.name.trim(),
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
      contentJson: draft.contentJson,
      preview: draft.preview,
      flow: draft.flow,
    });
    draft = null;
  }
  function insert(c: QuickCard) {
    oninsert(c.contentJson);
    onclose();
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (draft) draft = null;
      else onclose();
    } else if (e.key === "Enter" && !draft && results.length) {
      e.preventDefault();
      insert(results[0]);
    }
  }
</script>

<div class="qc-backdrop" role="presentation" onclick={onclose}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="qc" role="dialog" tabindex="-1" aria-label="Quick cards" onkeydown={onkey}>
  <div class="qc-head">
    <span class="qc-title">Quick Cards</span>
    <input bind:this={searchEl} bind:value={query} class="qc-search" placeholder="Search name, tag, or text…" spellcheck="false" />
    <button class="qc-add" onclick={startAdd} disabled={!canAdd}
      title={canAdd ? "Save the selected text as a reusable quick card" : "Select text in the doc first"}>＋ Save selection</button>
    <button class="qc-x" onclick={onclose} aria-label="Close">×</button>
  </div>

  {#if draft}
    <div class="qc-form">
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={draft.name} class="qc-input name" placeholder="Name" autofocus />
      <input bind:value={draft.tags} class="qc-input" placeholder="tags, comma-separated" />
      <button class="qc-save" onclick={saveDraft} disabled={!draft.name.trim()}>Save</button>
      <button class="qc-cancel" onclick={() => (draft = null)}>Cancel</button>
    </div>
  {/if}

  <div class="qc-list">
    {#if results.length === 0}
      <div class="qc-empty">
        {quickCards.cards.length
          ? "No matches."
          : "No quick cards yet. Select text in the doc, then “Save selection”."}
      </div>
    {:else}
      {#each results as c (c.id)}
        <div class="qc-item">
          <button class="qc-insert" onclick={() => insert(c)} title="Insert at cursor">
            <span class="qc-row">
              <span class="qc-name">{c.name}</span>
              {#each c.tags as t (t)}<span class="qc-tag">{t}</span>{/each}
            </span>
            <span class="qc-prev">{c.preview.slice(0, 90)}</span>
          </button>
          <button class="qc-del" onclick={() => quickCards.remove(c.id)} title="Delete" aria-label="Delete">×</button>
        </div>
      {/each}
    {/if}
  </div>
  <div class="qc-hint">↵ insert top result · esc close</div>
</div>

<style>
  .qc-backdrop { position: fixed; inset: 0; z-index: 44; }
  .qc {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 45;
    width: min(560px, 92%);
    max-height: 70%;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }
  .qc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .qc-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .qc-search {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 5px 9px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  .qc-search:focus { border-color: var(--accent); }
  .qc-add {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 12px;
    padding: 5px 9px;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
  }
  .qc-add:hover:not(:disabled) { border-color: var(--accent); }
  .qc-add:disabled { opacity: 0.45; cursor: default; }
  .qc-x { background: none; border: none; color: var(--text-dim); font-size: 20px; cursor: pointer; line-height: 1; }
  .qc-form {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .qc-input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 5px 9px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    flex: 1;
  }
  .qc-input.name { flex: 0 0 40%; }
  .qc-input:focus { border-color: var(--accent); }
  .qc-save, .qc-cancel {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .qc-save { background: var(--accent); color: #fff; border-color: var(--accent); }
  .qc-save:disabled { opacity: 0.5; cursor: default; }
  .qc-cancel { background: var(--bg); color: var(--text); }
  .qc-list { overflow-y: auto; padding: 4px; }
  .qc-empty { font-size: 13px; color: var(--text-dim); padding: 16px; text-align: center; }
  .qc-item { display: flex; align-items: stretch; gap: 4px; }
  .qc-insert {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 7px 9px;
    cursor: pointer;
    color: var(--text);
    font-family: inherit;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .qc-insert:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .qc-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .qc-name { font-weight: 600; font-size: 13px; }
  .qc-tag {
    font-size: 10px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-radius: 4px;
    padding: 0 5px;
  }
  .qc-prev {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .qc-del {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 16px;
    cursor: pointer;
    padding: 0 8px;
    flex-shrink: 0;
  }
  .qc-del:hover { color: var(--mark-dropped, #c0392b); }
  .qc-hint { font-size: 10px; color: var(--text-dim); padding: 5px 10px; border-top: 1px solid var(--border); }
</style>
