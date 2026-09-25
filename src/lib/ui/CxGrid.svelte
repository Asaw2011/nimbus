<script lang="ts">
  // Cross-examination flow. A CX period is just questions and answers, so this
  // sheet is a plain two-column table: "Question asked" on the left, "Answer" on
  // the right - nothing to do with the speech columns the rest of the flow uses.
  //
  // A CX sheet is an ORDINARY sheet underneath: every row still carries a full
  // width of cells, so inserts, undo, autosave and partner sync all work exactly
  // as they do everywhere else. This view only ever shows and edits the first
  // two cells of each row - cell 0 the question, cell 1 the answer.
  import type { Sheet, Speech } from "../model/types";
  import { makeRow } from "../model/types";
  import { store } from "../model/round.svelte";

  let {
    sheet,
    spread = false,
    onopen,
  }: {
    sheet: Sheet;
    spread?: boolean;
    /** Opens another sheet. Without it (the spread view) the speech bar only
     *  shows which speech this is, and can't switch. */
    onopen?: (sheetId: string) => void;
  } = $props();

  // ---- which speech this cross-ex is ---------------------------------------
  //
  // Each cross-ex period is its own sheet, named "<speech> CX". The speech is
  // read back from the TITLE, which is the one sheet property the partner sync
  // already carries, so the label reaches a partner (even one on an older
  // build, who just sees a sheet called "1AC CX") with no protocol change.

  interface CxOption {
    name: string;
    side: Speech["side"];
  }

  /** The speeches that get cross-examined: every speech before the first
   *  rebuttal, a partner-lane split counted once. Policy gives 1AC 1NC 2AC 2NC,
   *  LD gives AC NC. A format with no rebuttals offers all its speeches. */
  const options = $derived.by<CxOption[]>(() => {
    const speeches = store.round?.template.speeches ?? [];
    const isRebuttal = (s: Speech) =>
      /rebuttal/i.test(s.label) || /^(1AR|2AR|1NR|2NR|NR|AR)$|\bReb\b/i.test(s.abbr);
    const firstReb = speeches.findIndex(isRebuttal);
    const pool = firstReb > 0 ? speeches.slice(0, firstReb) : speeches;
    const seen = new Set<string>();
    const out: CxOption[] = [];
    for (const s of pool) {
      if (s.laneGroup && seen.has(s.laneGroup)) continue;
      if (s.laneGroup) seen.add(s.laneGroup);
      // A lane's stored abbr carries " · You"/" · Partner"; the speech is the part before it.
      let name = s.laneGroup ? s.abbr.split(" · ")[0] : s.abbr;
      // The neg block's cross-ex is the 2NC's, nobody calls it "Neg Block CX".
      if (/^2NC\b/i.test(s.label)) name = "2NC";
      out.push({ name, side: s.side });
    }
    return out;
  });

  function speechOf(title: string): CxOption | null {
    const t = title.trim().toLowerCase();
    for (const o of options) {
      const n = o.name.toLowerCase();
      if (t === n || t.startsWith(`${n} cx`) || t.startsWith(`${n} cross`)) return o;
      if (o.name === "2NC" && t.startsWith("neg block")) return o;
    }
    return null;
  }

  const current = $derived(speechOf(sheet.title));
  const sideName = (s: Speech["side"]) => (s === "aff" ? "Aff" : s === "neg" ? "Neg" : "");
  /** In a cross-ex, the OTHER side asks and the speaker answers. */
  const asker = $derived(current ? sideName(current.side === "aff" ? "neg" : current.side === "neg" ? "aff" : current.side) : "");
  const answerer = $derived(current ? sideName(current.side) : "");

  /**
   * Switch to a speech's cross-ex. A page that isn't labelled yet (a fresh
   * "Cross-ex" sheet) takes the label; otherwise go to that speech's page,
   * making it the first time.
   */
  function pick(o: CxOption) {
    if (current?.name === o.name) return;
    if (!current) {
      store.renameSheet(sheet.id, `${o.name} CX`);
      return;
    }
    if (!onopen) return;
    const existing = store.round?.sheets.find(
      (s) => s.kind === "cx" && s.id !== sheet.id && speechOf(s.title)?.name === o.name,
    );
    onopen(existing ? existing.id : store.addSheet(`${o.name} CX`, "cx"));
  }

  /** Question lives in cell 0, answer in cell 1. */
  const Q = 0;
  const A = 1;

  let scroller = $state<HTMLDivElement>();

  const rowText = (r: number, c: number) => sheet.rows[r]?.cells[c]?.text ?? "";
  const rowHasText = (r: number) => !!(rowText(r, Q).trim() || rowText(r, A).trim());

  // Keep a few blank rows under the last used one, and at least a viewport's
  // worth to start - the same "unlimited paper" feel as the main grid.
  $effect(() => {
    void sheet.rows.length;
    const rows = sheet.rows;
    let lastUsed = -1;
    for (let i = 0; i < rows.length; i++) if (rowHasText(i)) lastUsed = i;
    const viewportRows = scroller ? Math.ceil(scroller.clientHeight / 34) : 16;
    store.ensureRows(Math.max(lastUsed + 3, viewportRows), sheet);
  });

  function write(r: number, c: number, text: string) {
    store.mutate(
      (round) => {
        const s = round.sheets.find((x) => x.id === sheet.id);
        if (!s) return;
        while (s.rows.length <= r) s.rows.push(makeRow(store.nCols));
        s.rows[r].cells[c].text = text;
      },
      { coalesceText: true },
    );
  }

  function autosize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function oninput(e: Event, r: number, c: number) {
    const el = e.currentTarget as HTMLTextAreaElement;
    autosize(el);
    write(r, c, el.value);
  }

  // Enter moves along: from a question to its answer, from an answer to the next
  // question. Shift+Enter still inserts a real newline inside the box.
  function onkeydown(e: KeyboardEvent, r: number, c: number) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const target = c === Q ? `[data-cx="${r}-${A}"]` : `[data-cx="${r + 1}-${Q}"]`;
      if (c === A) store.ensureRows(r + 1, sheet);
      requestAnimationFrame(() =>
        scroller?.querySelector<HTMLTextAreaElement>(target)?.focus(),
      );
    }
  }

  // Keep the box in sync with the stored text WITHOUT stealing the caret: only
  // rewrite a box the user isn't currently typing in, so a partner's edit lands
  // but your own typing is never disturbed.
  function cxcell(el: HTMLTextAreaElement, text: string) {
    el.value = text;
    autosize(el);
    return {
      update(next: string) {
        if (document.activeElement !== el && el.value !== next) {
          el.value = next;
          autosize(el);
        }
      },
    };
  }
</script>

<div class="cx-wrap" class:spread>
  {#if options.length}
    <div class="cx-top" class:unset={!current}>
      <span class="cx-of">Cross-ex of</span>
      {#if onopen}
        <div class="cx-seg" role="tablist" aria-label="Which speech is being cross-examined">
          {#each options as o (o.name)}
            <button
              class="cx-sp"
              class:on={current?.name === o.name}
              role="tab"
              aria-selected={current?.name === o.name}
              title={current
                ? current.name === o.name
                  ? `This page is the ${o.name} cross-ex`
                  : `Go to the ${o.name} cross-ex (made the first time)`
                : `Label this page as the ${o.name} cross-ex`}
              onclick={() => pick(o)}
            >{o.name}</button>
          {/each}
        </div>
      {:else}
        <span class="cx-sp on static">{current?.name ?? "?"}</span>
      {/if}
      <span class="cx-who">
        {#if current}
          {asker ? `${asker} asks, ${answerer} answers` : ""}
        {:else}
          Pick the speech being cross-examined
        {/if}
      </span>
    </div>
  {/if}
  <div class="cx-scroll" bind:this={scroller}>
    <div class="cx-head">
      <div class="cx-h q">Question{asker ? ` (${asker})` : " asked"}</div>
      <div class="cx-h a">Answer{answerer ? ` (${answerer})` : ""}</div>
    </div>
    {#each sheet.rows as row, r (row.id)}
      <div class="cx-row">
        <span class="cx-num">{r + 1}</span>
        <textarea
          class="cx-cell q"
          rows="1"
          data-cx="{r}-{Q}"
          placeholder={r === 0 ? "Question…" : ""}
          use:cxcell={row.cells[Q]?.text ?? ""}
          oninput={(e) => oninput(e, r, Q)}
          onkeydown={(e) => onkeydown(e, r, Q)}
        ></textarea>
        <textarea
          class="cx-cell a"
          rows="1"
          data-cx="{r}-{A}"
          placeholder={r === 0 ? "Answer…" : ""}
          use:cxcell={row.cells[A]?.text ?? ""}
          oninput={(e) => oninput(e, r, A)}
          onkeydown={(e) => onkeydown(e, r, A)}
        ></textarea>
      </div>
    {/each}
  </div>
</div>

<style>
  .cx-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .cx-scroll {
    flex: 1;
    overflow: auto;
  }
  /* The speech bar: part of the cross-ex page itself, not the app's top bar.
     Compact, but big enough that which cross-ex you're on is never in doubt. */
  .cx-top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .cx-top.unset {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  }
  .cx-of {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .cx-seg {
    display: flex;
    gap: 4px;
  }
  .cx-sp {
    min-width: 52px;
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .cx-sp:hover {
    border-color: var(--accent);
  }
  .cx-sp.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast, #fff);
  }
  .cx-sp.static {
    cursor: default;
    display: inline-block;
    text-align: center;
  }
  .cx-who {
    font-size: 12px;
    color: var(--text-dim);
  }
  .cx-top.unset .cx-who {
    color: var(--text);
    font-weight: 600;
  }
  /* The number gutter has no header cell, so the labels start at column 2. */
  .cx-head {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) minmax(0, 1.25fr);
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .cx-h {
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    text-align: center;
    border-right: 1px solid var(--grid-line);
  }
  .cx-h.q {
    grid-column: 2;
  }
  .cx-h.a {
    grid-column: 3;
  }
  .cx-row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) minmax(0, 1.25fr);
    align-items: stretch;
    border-bottom: 1px solid var(--grid-line);
  }
  .cx-num {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8px;
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0.55;
    border-right: 1px solid var(--grid-line);
    user-select: none;
  }
  .cx-cell {
    box-sizing: border-box;
    width: 100%;
    min-height: 30px;
    resize: none;
    overflow: hidden;
    padding: 6px 10px;
    border: none;
    border-right: 1px solid var(--grid-line);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
  }
  .cx-cell::placeholder {
    color: var(--text-dim);
    opacity: 0.6;
  }
  .cx-cell:focus {
    outline: none;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .cx-cell.q {
    color: var(--neg, #c0392b);
  }
</style>
