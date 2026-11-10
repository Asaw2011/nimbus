<script lang="ts">
  // Judges: search every judge you've had and read back what you wrote on
  // their ballots. Read-only - opening a round goes through the normal path.
  import { onMount } from "svelte";
  import { collectJudges, judgeKey, type JudgeEntry, type JudgeRound } from "../model/judges";

  let { onclose, onopenround }: {
    onclose: () => void;
    onopenround: (r: JudgeRound) => void;
  } = $props();

  let judges = $state<JudgeEntry[]>([]);
  let loading = $state(true);
  let query = $state("");
  let openKey = $state<string | null>(null);
  let input = $state<HTMLInputElement | null>(null);

  onMount(async () => {
    input?.focus();
    try {
      judges = await collectJudges();
    } finally {
      loading = false;
    }
  });

  // Name match first; a query that names no judge also searches your notes
  // ("talked fast", "hates the K").
  const shown = $derived.by(() => {
    const q = judgeKey(query);
    if (!q) return judges;
    const byName = judges.filter((j) => judgeKey(j.name).includes(q));
    if (byName.length) return byName;
    const lq = query.trim().toLowerCase();
    return judges.filter((j) => j.rounds.some((r) => r.notes.toLowerCase().includes(lq)));
  });
  // One match: open it straight away.
  const expanded = $derived(shown.length === 1 ? judgeKey(shown[0].name) : openKey);

  function when(t: number): string {
    return t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  }
  function noted(j: JudgeEntry): number {
    return j.rounds.filter((r) => r.notes).length;
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />
<div class="backdrop" role="presentation" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="Judges" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <div>
        <h1>Judges</h1>
        <p class="sub">Every judge you've had, and what you wrote on their ballots.</p>
      </div>
      <button class="close" onclick={onclose} aria-label="Close">×</button>
    </div>
    <div class="search">
      <input bind:this={input} bind:value={query} placeholder="Search a judge's name (or something you wrote about them)" />
    </div>
    <div class="list">
      {#if loading}
        <p class="empty">Reading your flows…</p>
      {:else if !judges.length}
        <p class="empty">No judges yet. Fill in <b>Judges</b> on a round's home page, and add a ballot under <b>Judge decision</b> to keep notes on them.</p>
      {:else if !shown.length}
        <p class="empty">No judge matches "{query}".</p>
      {:else}
        {#each shown as j (judgeKey(j.name))}
          {@const k = judgeKey(j.name)}
          <div class="judge" class:open={expanded === k}>
            <button class="jhead" onclick={() => (openKey = openKey === k ? null : k)}>
              <span class="jname">{j.name}</span>
              <span class="jmeta">{j.rounds.length} round{j.rounds.length === 1 ? "" : "s"}{noted(j) ? ` · ${noted(j)} with notes` : ""}</span>
            </button>
            {#if expanded === k}
              <div class="rounds">
                {#each j.rounds as r, i (i)}
                  <div class="round">
                    <div class="rtop">
                      <button class="rname" title="Open this flow" onclick={() => onopenround(r)}>{r.roundName}</button>
                      <span class="rmeta">{[r.tournament, r.opponent && `vs ${r.opponent}`, when(r.when)].filter(Boolean).join(" · ")}</span>
                      {#if r.result}<span class="result" class:won={r.result.includes("won")} class:lost={r.result.includes("lost")}>{r.result}</span>{/if}
                    </div>
                    {#if r.notes}
                      <div class="notes">{r.notes}</div>
                    {:else}
                      <div class="nonotes">No notes on this round.</div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
    padding: 24px;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    width: min(760px, 96vw);
    height: min(720px, 92vh);
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    color: var(--text);
  }
  .head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 8px; }
  h1 { margin: 0; font-size: 20px; }
  .sub { margin: 4px 0 0; color: var(--text-dim); font-size: 13px; }
  .close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 24px;
    cursor: pointer;
    line-height: 1;
  }
  .search { padding: 4px 20px 12px; }
  .search input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .search input:focus { outline: none; border-color: var(--accent); }
  .list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 20px 20px; }
  .empty { color: var(--text-dim); font-size: 13px; }
  .judge { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px; background: var(--bg); }
  .judge.open { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
  .jhead {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    background: none;
    border: none;
    padding: 10px 12px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .jname { font-weight: 700; font-size: 14px; }
  .jmeta { margin-left: auto; color: var(--text-dim); font-size: 12px; white-space: nowrap; }
  .rounds { padding: 0 12px 10px; display: flex; flex-direction: column; gap: 10px; }
  .round { border-top: 1px solid var(--border); padding-top: 8px; }
  .rtop { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
  .rname {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  .rname:hover { text-decoration: underline; }
  .rmeta { color: var(--text-dim); font-size: 12px; }
  .result { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); }
  .result.won { color: #2e8b57; border-color: #2e8b57; }
  .result.lost { color: #d1453b; border-color: #d1453b; }
  .notes { margin-top: 6px; font-size: 13px; white-space: pre-wrap; line-height: 1.45; }
  .nonotes { margin-top: 4px; font-size: 12px; color: var(--text-dim); font-style: italic; }
</style>
