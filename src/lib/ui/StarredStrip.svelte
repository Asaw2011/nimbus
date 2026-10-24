<script lang="ts">
  // stars from the OTHER pages, so a must-answer on one flow doesn't get lost
  // while you're on another. click to jump there, x to unstar.
  import { store } from "../model/round.svelte";
  import type { Cell } from "../model/types";

  let {
    hereId,
    bottom = false,
    onjump,
  }: { hereId: string | null; bottom?: boolean; onjump: (sheetId: string, row: number, col: number) => void } = $props();

  type Star = { key: string; sheetId: string; page: string; row: number; col: number; speech: string; text: string; cell: Cell };

  const stars = $derived.by(() => {
    const r = store.round;
    if (!r) return [] as Star[];
    const speeches = r.template.speeches;
    const out: Star[] = [];
    for (const s of r.sheets) {
      if (s.id === hereId) continue;
      s.rows.forEach((row, ri) => {
        row.cells.forEach((cell, ci) => {
          if (cell.marks?.starred) {
            out.push({ key: `${s.id}:${row.id}:${ci}`, sheetId: s.id, page: s.title || "(untitled)", row: ri, col: ci, speech: speeches[ci]?.abbr ?? "", text: cell.text, cell });
          }
          // block parts carry their own answer tiles, those can be starred too
          for (const it of cell.items ?? []) {
            for (const [sid, a] of Object.entries(it.answers ?? {})) {
              if (!a.marks?.starred) continue;
              const col = speeches.findIndex((sp) => sp.id === sid);
              out.push({ key: `${s.id}:${it.id}:${sid}`, sheetId: s.id, page: s.title || "(untitled)", row: ri, col: col < 0 ? ci : col, speech: speeches[col]?.abbr ?? "", text: a.text, cell: a });
            }
          }
        });
      });
    }
    return out;
  });

  let open = $state(true);

  function unstar(st: Star) {
    store.mutate(() => {
      if (st.cell.marks) st.cell.marks.starred = false;
    });
  }
</script>

{#if stars.length}
  <div class="starred" class:bottom role="region" aria-label="Starred on other pages">
    <button class="toggle" onclick={() => (open = !open)} title={open ? "Hide starred arguments" : "Show starred arguments"}>
      <span class="star">★</span> {stars.length} starred on other pages <span class="caret">{open ? "▾" : "▸"}</span>
    </button>
    {#if open}
      <div class="chips">
        {#each stars as st (st.key)}
          <span class="chip">
            <button class="go" onclick={() => onjump(st.sheetId, st.row, st.col)} title="Go to it: {st.page}{st.speech ? ` · ${st.speech}` : ''}">
              <b>{st.page}</b>{#if st.speech}<span class="sp">{st.speech}</span>{/if}
              <span class="txt">{st.text.trim() || "(empty cell)"}</span>
            </button>
            <button class="x" onclick={() => unstar(st)} title="Unstar">×</button>
          </span>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .starred {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    background: color-mix(in srgb, #e3a008 9%, var(--panel));
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-width: 0;
    font-size: 12px;
  }
  .starred.bottom {
    border-bottom: none;
    border-top: 1px solid var(--border);
  }
  .toggle {
    background: none;
    border: none;
    padding: 2px 0;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .star { color: #e3a008; }
  .caret { color: var(--text-dim); }
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    min-width: 0;
    scrollbar-width: thin;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    max-width: 320px;
    border: 1px solid color-mix(in srgb, #e3a008 45%, var(--border));
    border-radius: 999px;
    background: var(--panel);
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    background: none;
    border: none;
    padding: 2px 4px 2px 10px;
    font: inherit;
    color: var(--text);
    cursor: pointer;
  }
  .go:hover .txt { text-decoration: underline; }
  .go b { font-weight: 600; white-space: nowrap; }
  .sp { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
  .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .x {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0 8px 0 2px;
    font-size: 14px;
    line-height: 1;
  }
  .x:hover { color: var(--text); }
</style>
