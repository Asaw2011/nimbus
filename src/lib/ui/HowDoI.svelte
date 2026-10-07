<script lang="ts">
  // "How do I…?" - search the app in plain words. Each answer explains what a
  // thing is and how to do it, shows its shortcut from YOUR keymap, and can
  // open it for you. The full keybind list lives at the bottom, where the old
  // Keys panel used to be.
  import { settings } from "../model/settings.svelte";
  import { ACTION_LABELS, combosLabel } from "../model/keymap";
  import { HOWTOS, searchHowTos, type HowRun, type HowTo } from "./howdoi";
  import { askAi, helpContext } from "./askAi";

  let {
    onclose,
    onrun,
    onmanual,
  }: {
    onclose: () => void;
    /** Open something; `keyLabel` is its shortcut, shown as a tip afterwards. */
    onrun: (run: HowRun, keyLabel: string) => void;
    onmanual: (section: string) => void;
  } = $props();

  const mac = settings.isMac;
  const km = $derived(settings.keymap);

  let query = $state("");
  let sel = $state(0);
  let showKeys = $state(false);
  let input = $state<HTMLInputElement>();

  const popular = HOWTOS.filter((h) => h.popular);

  // ---- AI answer (optional; the search below always works without it) ----
  let ai = $state<{ q: string; state: "loading" | "done" | "fail"; answer: string; ids: string[]; note: string } | null>(null);
  const FAIL_NOTE: Record<string, string> = {
    daily: "AI help has used today's free answers - here's the search instead. It's back tomorrow.",
    user: "You've used your AI questions for today - here's the search instead.",
    offline: "AI help needs the internet - here's the search instead.",
    signin: "AI help isn't available right now - here's the search instead.",
    off: "AI help isn't available right now - here's the search instead.",
    error: "AI help couldn't answer that - here's the search instead.",
  };
  async function ask() {
    const q = query.trim();
    if (!q || ai?.state === "loading") return;
    ai = { q, state: "loading", answer: "", ids: [], note: "" };
    const r = await askAi(q, helpContext(km, mac));
    if (ai?.q !== q) return; // the user typed something else meanwhile
    ai = r.ok
      ? { q, state: "done", answer: r.answer, ids: r.ids, note: "" }
      : { q, state: "fail", answer: "", ids: [], note: FAIL_NOTE[r.why] };
    sel = 0;
  }

  /** The entries the AI pointed at come first, then the keyword matches. */
  const results = $derived.by(() => {
    if (!query.trim()) return popular;
    const found = searchHowTos(query);
    if (ai?.state !== "done" || ai.q !== query.trim()) return found;
    const linked = ai.ids.map((id) => HOWTOS.find((h) => h.id === id)).filter((h): h is HowTo => !!h);
    return [...linked, ...found.filter((h) => !linked.includes(h))];
  });
  // A new search starts at its best answer. (An AI answer only shows while the
  // box still holds the question it answered.)
  $effect(() => {
    void query;
    sel = 0;
  });
  $effect(() => {
    input?.focus();
  });

  function keyOf(h: HowTo): string {
    return h.keys?.length ? combosLabel(km[h.keys[0]], mac) : "";
  }

  function run(h: HowTo) {
    if (!h.run) return;
    onrun(h.run, keyOf(h));
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (showKeys) showKeys = false;
      else onclose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      sel = Math.min(sel + 1, results.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Enter asks; once answered, Enter does what the top answer offers.
      if (query.trim() && !(ai?.state === "done" && ai.q === query.trim())) {
        void ask();
        return;
      }
      const h = results[sel];
      if (h?.run) run(h);
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="howdoi" role="dialog" aria-label="How do I" tabindex="-1" {onkeydown}>
  <div class="head">
    <h3>How do I…?</h3>
    <button class="x" onclick={onclose} aria-label="Close">×</button>
  </div>

  {#if showKeys}
    <button class="link back" onclick={() => (showKeys = false)}>← Back to search</button>
    <table>
      <tbody>
        <tr><td><kbd>↵</kbd> / <kbd>↑↓</kbd></td><td>Move down / up a row</td></tr>
        <tr><td><kbd>Tab</kbd> / <kbd>⇧Tab</kbd></td><td>Next / previous speech</td></tr>
        <tr><td><kbd>⇧↵</kbd></td><td>New line inside a cell</td></tr>
        <tr><td><kbd>{combosLabel(km.insertRowBelow, mac)}</kbd></td><td>Insert row below</td></tr>
        <tr><td><kbd>{combosLabel(km.insertRowAbove, mac)}</kbd></td><td>Insert row above</td></tr>
        <tr><td><kbd>{combosLabel(km.insertRow3Below, mac)}</kbd></td><td>Insert 3 rows below</td></tr>
        <tr><td><kbd>{combosLabel(km.insertRow3Above, mac)}</kbd></td><td>Insert 3 rows above</td></tr>
        <tr><td><kbd>{combosLabel(km.deleteRow, mac)}</kbd></td><td>Delete row</td></tr>
        <tr><td><kbd>{combosLabel(km.clearCell, mac)}</kbd></td><td>Delete cell (row stays)</td></tr>
        <tr><td><kbd>{combosLabel(km.jumpFilledUp, mac)}</kbd></td><td>Jump to filled cell above</td></tr>
        <tr><td><kbd>{combosLabel(km.jumpFilledDown, mac)}</kbd></td><td>Jump to filled cell below</td></tr>
        <tr><td><kbd>{combosLabel(km.extendArg, mac)}</kbd></td><td>Extend argument → next speech</td></tr>
        <tr><td><kbd>{combosLabel(km.replyToArg, mac)}</kbd></td><td>Answer argument → your reply, linked for “AT:”</td></tr>
        <tr><td><kbd>{combosLabel(km.markDropped, mac)}</kbd></td><td>Mark dropped</td></tr>
        <tr><td><kbd>{combosLabel(km.markStarred, mac)}</kbd></td><td>Star (must answer)</td></tr>
        <tr><td><kbd>{combosLabel(km.markAnalytic, mac)}</kbd></td><td>Mark analytic (ink color)</td></tr>
        <tr><td><kbd>{combosLabel(km.markCard, mac)}</kbd></td><td>Mark card (ink color)</td></tr>
        <tr><td><kbd>{combosLabel(km.sendCellsToDoc, mac)}</kbd></td><td>Send cell(s) to the speech doc</td></tr>
        <tr><td><kbd>{combosLabel(km.sendRowToDoc, mac)}</kbd></td><td>Send the whole speech to the doc</td></tr>
        <tr><td><kbd>{mac ? "⌘" : "Ctrl"}1–9</kbd></td><td>Jump to sheet</td></tr>
        <tr><td><kbd>{combosLabel(km.prevSheet, mac)}</kbd> / <kbd>{combosLabel(km.nextSheet, mac)}</kbd></td><td>Previous / next sheet</td></tr>
        <tr><td><kbd>{combosLabel(km.moveSheetLeft, mac)}</kbd> / <kbd>{combosLabel(km.moveSheetRight, mac)}</kbd></td><td>Move sheet left / right</td></tr>
        <tr><td><kbd>{mac ? "⌘" : "Ctrl"}C</kbd> / <kbd>{mac ? "⌘" : "Ctrl"}V</kbd></td><td>Copy / paste cells (Excel-style)</td></tr>
        <tr><td><kbd>{combosLabel(km.openDocSearch, mac)}</kbd></td><td>Doc Search (search prep files)</td></tr>
        <tr><td><kbd>{combosLabel(km.toggleDoc, mac)}</kbd></td><td>Speech doc</td></tr>
        <tr><td><kbd>{combosLabel(km.toggleSpread, mac)}</kbd></td><td>Spread view (tabs toggle sheets)</td></tr>
        <tr><td><kbd>{combosLabel(km.toggleTimer, mac)}</kbd></td><td>Timer (stopwatch + countdown)</td></tr>
        <tr><td><kbd>{combosLabel(km.goHome, mac)}</kbd></td><td>Round home</td></tr>
        <tr><td><kbd>{combosLabel(km.newSheet, mac)}</kbd></td><td>New sheet</td></tr>
        <tr><td><kbd>{combosLabel(km.openSettings, mac)}</kbd></td><td>Settings</td></tr>
        <tr><td><kbd>{combosLabel(km.toggleHelp, mac)}</kbd></td><td>This panel</td></tr>
        <tr><td><kbd>trigger + space</kbd></td><td>Expand abbreviation (t/ → Turn:)</td></tr>
      </tbody>
    </table>
    <p class="dim">Change any of these in Settings → Keyboard.</p>
  {:else}
    <input
      bind:this={input}
      bind:value={query}
      class="q"
      placeholder="Ask anything about Nimbus, or type a word - e.g. drop, send to doc"
      spellcheck="false"
    />
    {#if query.trim()}
      {#if ai && ai.q === query.trim() && ai.state !== "fail"}
        <div class="ai" aria-live="polite">
          <div class="ai-label">✦ AI answer</div>
          {#if ai.state === "loading"}
            <p class="ai-text dim">Thinking…</p>
          {:else}
            <p class="ai-text">{ai.answer}</p>
            <p class="ai-foot">From Nimbus's own help - check the steps below.</p>
          {/if}
        </div>
      {:else if ai && ai.q === query.trim() && ai.state === "fail"}
        <p class="ai-note">{ai.note}</p>
      {:else}
        <button class="ask" onclick={ask}>✦ Ask AI <span class="dim">(Enter)</span></button>
      {/if}
    {/if}
    <div class="list">
      {#if !query.trim()}<div class="group">Popular</div>{/if}
      {#each results as h, i (h.id)}
        <div class="item" class:open={i === sel}>
          <button class="title" onclick={() => (sel = i)}>{h.title}</button>
          {#if i === sel}
            <p class="body">{h.body}</p>
            {#if h.steps?.length}
              <ol>
                {#each h.steps as s, j (j)}<li>{s}</li>{/each}
              </ol>
            {/if}
            {#if h.keys?.length || h.fixedKey}
              <div class="keys">
                {#each h.keys ?? [] as a (a)}
                  <span class="key"><kbd>{combosLabel(km[a], mac)}</kbd> {ACTION_LABELS[a]}</span>
                {/each}
                {#if h.fixedKey}<span class="key"><kbd>{h.fixedKey}</kbd></span>{/if}
              </div>
            {/if}
            <div class="acts">
              {#if h.run}<button class="do" onclick={() => run(h)}>{h.runLabel ?? "Do it"}</button>{/if}
              {#if h.manual}<button class="link" onclick={() => onmanual(h.manual!)}>More in the Manual →</button>{/if}
            </div>
          {/if}
        </div>
      {:else}
        <p class="none">
          Nothing matched. Try other words, or
          <button class="link" onclick={() => onmanual("start")}>open the Manual</button>.
        </p>
      {/each}
    </div>
    <button class="link allkeys" onclick={() => (showKeys = true)}>⌨ All keyboard shortcuts</button>
  {/if}
</div>

<style>
  .howdoi {
    position: fixed;
    right: 12px;
    top: 52px;
    width: min(440px, calc(100vw - 24px));
    max-height: calc(100vh - 70px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    z-index: 30;
    font-size: 13px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
    outline: none;
  }
  .head {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
  }
  h3 {
    margin: 0;
    flex: 1;
    font-size: 15px;
  }
  .x {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 18px;
    cursor: pointer;
  }
  .q {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    margin-bottom: 8px;
  }
  .q:focus {
    border-color: var(--accent);
    outline: none;
  }
  .ask {
    align-self: flex-start;
    background: none;
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    color: var(--accent);
    border-radius: 7px;
    padding: 5px 10px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 8px;
  }
  .ai {
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    background: color-mix(in srgb, var(--accent) 7%, var(--panel));
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 8px;
  }
  .ai-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .ai-text {
    margin: 0;
    line-height: 1.45;
    white-space: pre-line;
  }
  .ai-foot {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .ai-note {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .list {
    overflow-y: auto;
    min-height: 0;
    flex: 1;
  }
  .group {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 2px 0 4px;
  }
  .item {
    border-radius: 7px;
    padding: 2px 6px;
  }
  .item.open {
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    padding: 6px 8px 8px;
    margin: 2px 0;
  }
  .title {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 4px 0;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .body {
    margin: 2px 0 6px;
    line-height: 1.45;
    color: var(--text);
  }
  ol {
    margin: 0 0 6px;
    padding-left: 20px;
    line-height: 1.45;
    color: var(--text-dim);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 4px 0 6px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .do {
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: 6px;
    padding: 5px 12px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .none {
    color: var(--text-dim);
  }
  .allkeys {
    margin-top: 8px;
    align-self: flex-start;
  }
  .back {
    align-self: flex-start;
    margin-bottom: 8px;
  }
  table {
    font-size: 12px;
  }
  td {
    padding: 2px 8px 2px 0;
    color: var(--text-dim);
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
  }
  kbd {
    background: var(--kbd-bg);
    border: 1px solid var(--kbd-border);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
    white-space: nowrap;
  }
</style>
