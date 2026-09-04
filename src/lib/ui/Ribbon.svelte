<script lang="ts">
  // Excel-style ribbon: the important actions as visible buttons, grouped and
  // labeled the way Word/Docs/Excel users already expect. Applies to the
  // selected block if one exists, else the current cell.

  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import { combosLabel } from "../model/keymap";
  import { prep, type PrepSide } from "../model/prep.svelte";

  let {
    spreadMode,
    onspread,
    onsendspeech = null,
    onsendcell = null,
    onremove = null,
    ondocbold = null,
    ondocitalic = null,
    ondoccolor = null,
    ondocfontsize = null,
  }: {
    spreadMode: "off" | "vertical" | "horizontal";
    onspread: (mode: "vertical" | "horizontal") => void;
    onsendspeech?: (() => void) | null;
    onsendcell?: (() => void) | null;
    onremove?: (() => void) | null;
    ondocbold?: (() => void) | null;
    ondocitalic?: (() => void) | null;
    ondoccolor?: ((hex: string | null) => void) | null;
    ondocfontsize?: ((delta: number) => void) | null;
  } = $props();

  const km = $derived(settings.keymap);
  const mac = settings.isMac;
  // When the speech doc is the surface you last edited, the Text controls act
  // on the doc instead of the flow grid.
  const onDoc = $derived(store.activeSurface === "doc");

  // How many cells are in the current range selection (0 or 1 = no range), so
  // the send button can say "Send Cell" vs "Send N Cells".
  const selCount = $derived.by(() => {
    const r = store.selRect;
    return r && store.hasMultiSelection ? (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1) : 0;
  });
  const sendCellLabel = $derived(selCount > 1 ? `Send ${selCount} Cells` : "Send Cell");

  function bumpFont(delta: number) {
    if (onDoc) { ondocfontsize?.(delta); return; } // resize the doc selection
    settings.fontSize = Math.max(10, Math.min(22, settings.fontSize + delta));
    settings.save();
  }

  function toggle(mark: "bold" | "italic") {
    if (onDoc) {
      if (mark === "bold") ondocbold?.();
      else ondocitalic?.();
      return;
    }
    store.applyToTargets((c) => {
      const m = (c.marks ??= {});
      m[mark] = !m[mark];
    });
  }

  function ink(color: string | null) {
    if (onDoc) { ondoccolor?.(color); return; }
    store.applyToTargets((c) => {
      const m = (c.marks ??= {});
      if (color) m.color = color;
      else delete m.color;
    });
  }

  function mark(kind: "dropped" | "starred") {
    store.applyToTargets((c) => {
      const m = (c.marks ??= {});
      m[kind] = !m[kind];
    });
  }

  function evidence(kind: "analytic" | "card") {
    store.applyToTargets((c) => {
      const m = (c.marks ??= {});
      m.evidence = m.evidence === kind ? undefined : kind;
    });
  }

  function insertRow(offset: 0 | 1) {
    const cur = store.cursor;
    if (!cur) return;
    store.insertRow(cur.row + offset);
    if (offset === 1) store.cursor = { row: cur.row + 1, col: cur.col };
  }

  function deleteRow() {
    const cur = store.cursor;
    if (cur) store.deleteRow(cur.row);
  }

  function extend() {
    const cur = store.cursor;
    if (cur) store.extendCell(cur.row, cur.col);
  }

  function reply() {
    const cur = store.cursor;
    if (cur) store.replyToCell(cur.row, cur.col);
  }

  /** Only meaningful on a round whose template actually has partner lanes. */
  const hasLanes = $derived(
    (store.round?.template.speeches ?? []).some((s) => !!s.laneGroup),
  );

  // ---- prep clocks ---------------------------------------------------------
  // Click the time to correct it by hand. That is the point of the field, not a
  // nicety: the common failure in a real round is nobody stopping the clock
  // when a team finishes prepping, and there is no way to recover that except
  // typing what it should say.
  const SIDES: PrepSide[] = ["aff", "neg"];
  let editingSide = $state<PrepSide | null>(null);
  let prepText = $state("");

  // Re-attach whenever the open round changes. A clock that was running when
  // the app closed is still running — its elapsed time is real wall time — so
  // this restarts the repaint pulse rather than the clock itself.
  $effect(() => {
    store.round?.id;
    prep.attach();
  });

  function startEditPrep(side: PrepSide) {
    // Freeze it first, or the number moves while you're typing over it.
    prep.pause(side);
    editingSide = side;
    prepText = prep.label(side);
  }
  function commitEditPrep() {
    if (!editingSide) return;
    const ms = prep.parse(prepText);
    if (ms !== null) prep.setRemainingMs(editingSide, ms);
    editingSide = null;
  }
</script>

<div class="ribbon" class:compact={settings.ribbonMode === "compact"}>
  <div class="group">
    <div class="controls">
      <button class="rb" title="Undo (⌘Z)" onclick={() => store.undo()}><span class="lbl">↶ Undo</span><span class="ico">↶</span></button>
      <button class="rb" title="Redo (⌘⇧Z)" onclick={() => store.redo()}><span class="lbl">↷ Redo</span><span class="ico">↷</span></button>
    </div>
    <div class="caption">Edit</div>
  </div>

  <div class="group">
    <div class="controls">
      <span class="stepper" title={onDoc ? "Selected text size (speech doc)" : "Text size"}>
        <button class="rb slim" onclick={() => bumpFont(-1)}>−</button>
        <span class="font-size">{onDoc ? store.docSelSize : settings.fontSize}</span>
        <button class="rb slim" onclick={() => bumpFont(1)}>+</button>
      </span>
      <button class="rb b" title="Bold (whole cell)" onclick={() => toggle("bold")}>B</button>
      <button class="rb i" title="Italic (whole cell)" onclick={() => toggle("italic")}>I</button>
      <label class="rb swatch" title="Custom text color — right-click clears it back to automatic ink" oncontextmenu={(e) => { e.preventDefault(); ink(null); }}>
        <span class="ink-a">A</span>
        <input type="color" oninput={(e) => ink(e.currentTarget.value)} />
      </label>
    </div>
    <div class="caption">Text</div>
  </div>

  <div class="group">
    <div class="controls">
      <button class="rb" title="Insert a row above this one ({combosLabel(km.insertRowAbove, mac)})" onclick={() => insertRow(0)}><span class="lbl">+ Above</span><span class="ico">＋↑</span></button>
      <button class="rb" title="Insert a row below this one ({combosLabel(km.insertRowBelow, mac)})" onclick={() => insertRow(1)}><span class="lbl">+ Below</span><span class="ico">＋↓</span></button>
      <button class="rb" title="Delete this row ({combosLabel(km.deleteRow, mac)})" onclick={deleteRow}><span class="lbl">− Delete</span><span class="ico">✕</span></button>
    </div>
    <div class="caption">Rows</div>
  </div>

  <div class="group">
    <div class="controls">
      <button class="rb dropped" title="They dropped this argument ({combosLabel(km.markDropped, mac)})" onclick={() => mark("dropped")}><span class="lbl">Dropped</span><span class="ico">⊘</span></button>
      <button class="rb star" title="Must answer in your next speech ({combosLabel(km.markStarred, mac)})" onclick={() => mark("starred")}><span class="lbl">★ Star</span><span class="ico">★</span></button>
      <button class="rb analytic" title="This is an analytic — no card ({combosLabel(km.markAnalytic, mac)})" onclick={() => evidence("analytic")}><span class="lbl">Analytic</span><span class="ico">An</span></button>
      <button class="rb card" title="This is a carded argument ({combosLabel(km.markCard, mac)})" onclick={() => evidence("card")}><span class="lbl">Card</span><span class="ico">Cd</span></button>
      <button class="rb extend" title="Extend this argument into your next speech ({combosLabel(km.extendArg, mac)})" onclick={extend}><span class="lbl">➜ Extend</span><span class="ico">➜</span></button>
      <button class="rb reply" title="Answer this argument — jumps to your reply and links it, so sending to the doc writes “AT: this argument” ({combosLabel(km.replyToArg, mac)})" onclick={reply}><span class="lbl">↩ Answer</span><span class="ico">↩</span></button>
      {#if hasLanes}
        <button
          class="rb lanetoggle"
          class:on={store.hidePartnerLane}
          title={store.hidePartnerLane
            ? "Show your partner's lane again"
            : "Hide your partner's lane — view only, it changes nothing you send to the doc"}
          onclick={() => (store.hidePartnerLane = !store.hidePartnerLane)}
        ><span class="lbl">{store.hidePartnerLane ? "Show partner" : "Hide partner"}</span><span class="ico">⇤</span></button>
      {/if}
      {#if onsendspeech}
        <button class="rb send-doc" title="Send the ENTIRE ROW (every card in this speech) to the doc in flow order — mirrors the flow and de-dupes. ({combosLabel(km.sendRowToDoc, mac)})" onclick={onsendspeech}><span class="lbl">↕ Send Entire Row</span><span class="ico">↕</span></button>
      {/if}
      {#if onsendcell}
        <button class="rb send-cell" title="Send the selected cell(s) to the doc AT THE CURSOR. Select a range first to send multiple cells. ({combosLabel(km.sendCellsToDoc, mac)})" onclick={onsendcell}><span class="lbl">⌖ {sendCellLabel}</span><span class="ico">⌖</span></button>
      {/if}
      {#if onremove}
        <button class="rb remove" title="Clear this cell and remove its card from the doc ({combosLabel(km.removeFromDoc, mac)})" onclick={onremove}><span class="lbl">✕ Remove</span><span class="ico">✕</span></button>
      {/if}
    </div>
    <div class="caption">Debate</div>
  </div>

  <div class="group">
    <div class="controls">
      <button class="rb" class:on={spreadMode === "vertical"} title="See several flows stacked, columns aligned ({combosLabel(km.toggleSpread, mac)})" onclick={() => onspread("vertical")}><span class="lbl">▤ Stack</span><span class="ico">▤</span></button>
      <button class="rb" class:on={spreadMode === "horizontal"} title="See several flows next to each other" onclick={() => onspread("horizontal")}><span class="lbl">◫ Split</span><span class="ico">◫</span></button>
      <span class="zoom-ctl">
        <button class="rb zoom-btn" title="Zoom out ({combosLabel(km.zoomOut, mac)})" onclick={() => settings.zoomOut()}>−</button>
        <button class="rb zoom-pct" title="Reset zoom ({combosLabel(km.zoomReset, mac)})" onclick={() => settings.zoomReset()}>{Math.round(settings.zoom * 100)}%</button>
        <button class="rb zoom-btn" title="Zoom in ({combosLabel(km.zoomIn, mac)})" onclick={() => settings.zoomIn()}>+</button>
      </span>
    </div>
    <div class="caption">View</div>
  </div>

  <span class="ribbon-spacer"></span>

  <!-- Prep clocks, pinned to the right end in BOTH densities so they never
       shift as the conditional buttons (partner lane, send, remove) come and
       go. Each team's clock: click the time to correct it, the button to
       start/stop, right-click to reset to a full allotment. -->
  <div class="prep-group">
    {#each SIDES as side (side)}
      <div class="prep" class:aff={side === "aff"} class:neg={side === "neg"} class:live={prep.running(side)} class:spent={prep.spent(side)}>
        <span class="prep-tag">{side === "aff" ? "AFF" : "NEG"}</span>
        {#if editingSide === side}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="prep-time prep-edit"
            bind:value={prepText}
            autofocus
            onblur={commitEditPrep}
            onkeydown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); commitEditPrep(); }
              else if (e.key === "Escape") { editingSide = null; }
            }}
          />
        {:else}
          <button
            class="prep-time"
            title="{side === 'aff' ? 'Aff' : 'Neg'} prep remaining — click to correct it by hand"
            onclick={() => startEditPrep(side)}
          >{prep.label(side)}</button>
        {/if}
        <button
          class="prep-go"
          title={prep.running(side)
            ? `Stop ${side === "aff" ? "aff" : "neg"} prep`
            : prep.spent(side)
              ? "No prep left — right-click to reset"
              : `Start ${side === "aff" ? "aff" : "neg"} prep (stops the other team's clock)`}
          disabled={prep.spent(side) && !prep.running(side)}
          onclick={() => prep.toggle(side)}
          oncontextmenu={(e) => { e.preventDefault(); prep.reset(side); }}
        >{prep.running(side) ? "⏸" : "▶"}</button>
      </div>
    {/each}
  </div>

  <button
    class="rb density-toggle"
    title={settings.ribbonMode === "full"
      ? "Condense the toolbar — fits a splitscreen half"
      : "Expand the toolbar to full width"}
    onclick={() => {
      settings.ribbonMode = settings.ribbonMode === "full" ? "compact" : "full";
      settings.save();
    }}
  >{settings.ribbonMode === "full" ? "⇥⇤" : "⇤⇥"}</button>
</div>

<style>
  /* One bar, two densities, ONE height. `full` fills the window; `compact`
     fits a splitscreen half. Both are icon-only and both are 46px tall, so
     switching never reflows the grid underneath.

     ⚠ `overflow: hidden`, not `auto`. The old bar scrolled horizontally, which
     is the thing being fixed — a toolbar you have to scroll is a toolbar whose
     right-hand buttons you never find. Everything here is sized so it fits;
     if a future button breaks that, the fix is to shrink the set, not to bring
     the scrollbar back. */
  .ribbon {
    --rb-size: 32px;   /* icon button box — scaled down in compact */
    --rb-font: 16px;
    --rb-gap: 3px;
    display: flex;
    align-items: center;
    gap: var(--rb-gap);
    height: 46px;
    box-sizing: border-box;
    padding: 0 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    flex-shrink: 0;
  }
  /* Compact is sized against a real target, not by eye: half of a 1366 laptop
     is 683px, and that is the splitscreen case this mode exists for. */
  .ribbon.compact {
    --rb-size: 22px;
    --rb-font: 12px;
    --rb-gap: 0px;
    padding: 0 4px;
  }
  .ribbon.compact .rb { padding: 0 2px; }
  /* The two multi-part readouts (text size −13+, zoom −70%+) are ~150px of the
     bar between them, which is the difference between "narrower" and "about
     half". Compact is the space-saving mode, so they go here too, not only at
     narrow widths. Zoom keeps its keybinds and pinch; text size is in Settings. */
  .ribbon.compact .zoom-ctl,
  .ribbon.compact .stepper { display: none; }
  /* Narrower still — a 1280 screen's half, or a dragged-in window. The bar
     clips rather than scrolls, so it has to keep shrinking or buttons become
     unreachable. The side TAG goes first: the clocks are already colour-coded
     aff-blue and neg-red, so the letters are the redundant part. */
  /* ⚠ These narrow-width steps apply to BOTH densities, not just compact. The
     bar clips instead of scrolling, so a full-mode bar in a 640px window would
     silently lose its right-hand buttons — worse than the scrollbar this
     replaced. Below these widths there is no room for full mode anyway, so it
     degrades into the same thing rather than breaking. */
  /* ⚠ Each selector is repeated at `.ribbon.compact` specificity. A media query
     adds NO specificity, so a bare `.ribbon` rule here loses to the
     `.ribbon.compact` block above it and compact would come out LARGER than
     full at the same width — which is exactly what happened. */
  @media (max-width: 720px) {
    .ribbon, .ribbon.compact { --rb-size: 20px; --rb-font: 11px; padding: 0 2px; }
    .ribbon .group, .ribbon.compact .group { padding: 0 1px; }
    .ribbon .prep-tag { display: none; }
    .ribbon .prep-time, .ribbon.compact .prep-time { min-width: 26px; }
    .ribbon .prep, .ribbon.compact .prep { padding: 0 1px 0 3px; }
    .ribbon .prep-group, .ribbon.compact .prep-group { padding-left: 3px; gap: 2px; }
    /* Measured: 24 buttons plus two clocks need ~794px here, and a 1366 laptop's
       splitscreen half is 683. The two multi-part READOUTS are what gets cut —
       together they are ~150px, and both have another way in: zoom has its
       keybinds and pinch-zoom, text size is in Settings. Cutting actual debate
       actions instead would be the wrong trade. */
    .ribbon .zoom-ctl,
    .ribbon .stepper { display: none; }
  }
  /* A 1280 laptop's splitscreen half is 640, which the step above only just
     clears. One more notch keeps real headroom there. */
  @media (max-width: 660px) {
    .ribbon, .ribbon.compact { --rb-size: 19px; --rb-font: 10.5px; --rb-gap: 0px; }
    .ribbon .group, .ribbon.compact .group { padding: 0; }
    .ribbon .prep-time, .ribbon.compact .prep-time { min-width: 24px; }
  }
  /* Every labeled button carries a full-text .lbl and a single-glyph .ico.
     The bar is icon-only in both densities now, so .lbl is always hidden and
     .ico always shown — the wording survives in each button's `title`, which
     is where it was already duplicated. Kept as two spans rather than deleting
     the labels so bringing text back is a CSS change, not a rewrite. */
  .lbl { display: none; }
  .ico { display: inline; }
  /* Group captions (EDIT / TEXT / ROWS / …) stacked under the controls and are
     what made the bar tall enough to need two rows. Icon-only has no room for
     them; the group separators carry the grouping instead. */
  .caption { display: none; }
  .ribbon-spacer { flex: 1; min-width: 4px; }
  .group {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0 6px;
    border-right: 1px solid var(--border);
  }
  .ribbon.compact .group { padding: 0 3px; }
  .group:first-child {
    padding-left: 0;
  }
  .group:last-child {
    border-right: none;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .zoom-ctl {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    gap: 1px;
  }
  .zoom-btn { min-width: 22px; padding: 2px 4px; }
  .zoom-pct { min-width: 42px; padding: 2px 4px; font-variant-numeric: tabular-nums; }
  .caption {
    text-align: center;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    padding: 2px 0 1px;
    user-select: none;
  }
  /* A square box scaled off the bar's own --rb-size, so an icon fills the bar's
     height in full mode and shrinks as one piece in compact. */
  .rb {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text);
    border-radius: 5px;
    height: var(--rb-size);
    min-width: var(--rb-size);
    padding: 0 4px;
    font-size: var(--rb-font);
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .rb:hover {
    background: color-mix(in srgb, var(--accent) 12%, var(--panel));
    border-color: var(--border);
  }

  /* ---- prep clocks ---- */
  .prep-group {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 8px;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }
  .ribbon.compact .prep-group { gap: 3px; padding-left: 5px; }
  .prep {
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--rb-size);
    padding: 0 4px 0 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }
  .ribbon.compact .prep { padding: 0 2px 0 4px; }
  /* Each clock wears its own side's colour, the same blue/red the flow uses, so
     you can tell them apart without reading the tag. */
  .prep.aff { border-color: color-mix(in srgb, var(--aff, #1a6fd4) 45%, var(--border)); }
  .prep.neg { border-color: color-mix(in srgb, var(--neg, #c8442a) 45%, var(--border)); }
  /* A running clock is the one thing on this bar you must be able to spot from
     across a room mid-round, so it gets a filled wash, not a border tint. */
  .prep.live.aff { background: color-mix(in srgb, var(--aff, #1a6fd4) 16%, var(--bg)); }
  .prep.live.neg { background: color-mix(in srgb, var(--neg, #c8442a) 16%, var(--bg)); }
  .prep.spent { opacity: 0.55; }
  .prep-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    user-select: none;
  }
  .ribbon.compact .prep-tag { font-size: 8px; }
  .prep.aff .prep-tag { color: var(--aff, #1a6fd4); }
  .prep.neg .prep-tag { color: var(--neg, #c8442a); }
  /* Tabular figures: without them the digits change width as the clock counts
     and the whole bar twitches once a second. */
  .prep-time {
    background: transparent;
    border: none;
    color: var(--text);
    font-size: calc(var(--rb-font) - 1px);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 0 3px;
    min-width: 40px;
    text-align: center;
    cursor: text;
  }
  .ribbon.compact .prep-time { min-width: 33px; padding: 0 1px; }
  .prep-time:hover { text-decoration: underline dotted; }
  .prep-edit {
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--panel);
    outline: none;
    cursor: text;
  }
  .prep-edit:hover { text-decoration: none; }
  .prep-go {
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: calc(var(--rb-font) - 3px);
    line-height: 1;
    padding: 2px;
    cursor: pointer;
    border-radius: 4px;
  }
  .prep-go:hover:not(:disabled) { color: var(--text); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .prep-go:disabled { opacity: 0.4; cursor: default; }
  .density-toggle { flex-shrink: 0; margin-left: 4px; }
  .rb.on {
    background: var(--accent);
    color: #fff;
  }
  .rb.slim {
    min-width: 22px;
    padding: 0 4px;
    font-size: 14px;
  }
  .rb.b {
    font-weight: 800;
    min-width: 26px;
  }
  .rb.i {
    font-style: italic;
    font-family: Georgia, serif;
    min-width: 26px;
  }
  .rb.dropped {
    color: var(--mark-dropped);
  }
  .rb.star {
    color: var(--mark-star);
  }
  .rb.analytic {
    color: var(--analytic);
  }
  .rb.card {
    color: var(--card);
  }
  .rb.extend {
    color: var(--accent);
  }
  .rb.send-doc {
    color: var(--analytic);
    border-color: var(--analytic);
  }
  .rb.send-cell {
    color: var(--accent);
    border-color: var(--accent);
  }
  .rb.remove {
    color: var(--mark-dropped);
    border-color: var(--mark-dropped);
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0 2px;
  }
  .font-size {
    font-size: 12px;
    color: var(--text);
    min-width: 18px;
    text-align: center;
  }
  .swatch {
    position: relative;
    overflow: hidden;
    min-width: 26px;
  }
  .ink-a {
    font-weight: 700;
    border-bottom: 3px solid var(--accent);
    line-height: 1.1;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
