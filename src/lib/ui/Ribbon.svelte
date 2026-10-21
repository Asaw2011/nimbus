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

  // Row edits and doc sends each live behind one "▾" menu instead of several
  // always-on buttons - the biggest declutter of the bar.
  let rowMenuOpen = $state(false);
  let sendMenuOpen = $state(false);

  function insertRow(offset: 0 | 1) {
    rowMenuOpen = false;
    const cur = store.cursor;
    if (!cur) return;
    store.insertRow(cur.row + offset);
    if (offset === 1) store.cursor = { row: cur.row + 1, col: cur.col };
  }

  function deleteRow() {
    rowMenuOpen = false;
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

  // ---- prep clocks ---------------------------------------------------------
  // Click the time to correct it by hand. That is the point of the field, not a
  // nicety: the common failure in a real round is nobody stopping the clock
  // when a team finishes prepping, and there is no way to recover that except
  // typing what it should say.
  const SIDES: PrepSide[] = ["aff", "neg"];
  let editingSide = $state<PrepSide | null>(null);
  let prepText = $state("");

  // Re-attach whenever the open round changes. A clock that was running when
  // the app closed is still running - its elapsed time is real wall time - so
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

<!-- One bar. Button area wraps to a second line when the pane gets narrow
     (split screen, the speech doc open, or both) instead of shrinking the
     buttons until they're unreadable. Prep clocks + density toggle sit in a
     fixed aside on the right so they never get stranded on a wrapped line. -->
<div class="ribbon-wrap" data-tour="ribbon">
<div class="ribbon" class:compact={settings.ribbonMode === "compact"}>
  <div class="ribbon-buttons">
    <!-- Edit -->
    <div class="rgroup">
      <button class="rb" title="Undo (⌘Z)" onclick={() => store.undo()}>Undo</button>
      <button class="rb" title="Redo (⌘⇧Z)" onclick={() => store.redo()}>Redo</button>
    </div>

    <span class="toolbar-sep"></span>

    <!-- Text -->
    <div class="rgroup">
      <span class="stepper" title={onDoc ? "Selected text size (speech doc)" : "Text size"}>
        <button class="rb slim" onclick={() => bumpFont(-1)}>−</button>
        <span class="font-size">{onDoc ? store.docSelSize : settings.fontSize}</span>
        <button class="rb slim" onclick={() => bumpFont(1)}>+</button>
      </span>
      <button class="rb b" title="Bold (whole cell)" onclick={() => toggle("bold")}>B</button>
      <button class="rb i" title="Italic (whole cell)" onclick={() => toggle("italic")}>I</button>
      <label class="rb swatch" title="Custom text color - right-click clears it back to automatic ink" oncontextmenu={(e) => { e.preventDefault(); ink(null); }}>
        <span class="ink-a">A</span>
        <input type="color" oninput={(e) => ink(e.currentTarget.value)} />
      </label>
    </div>

    <span class="toolbar-sep"></span>

    <!-- Rows -->
    <div class="rgroup">
      <div class="row-menu-wrap">
        <button class="rb" class:on={rowMenuOpen} title="Insert or delete rows" onclick={() => (rowMenuOpen = !rowMenuOpen)}>Row ▾</button>
        {#if rowMenuOpen}
          <button class="row-menu-backdrop" aria-label="Close menu" onclick={() => (rowMenuOpen = false)}></button>
          <div class="row-menu-pop">
            <button onclick={() => insertRow(0)}>Insert Above <kbd>{combosLabel(km.insertRowAbove, mac)}</kbd></button>
            <button onclick={() => insertRow(1)}>Insert Below <kbd>{combosLabel(km.insertRowBelow, mac)}</kbd></button>
            <button class="danger" onclick={deleteRow}>Delete Row <kbd>{combosLabel(km.deleteRow, mac)}</kbd></button>
          </div>
        {/if}
      </div>
    </div>

    <span class="toolbar-sep"></span>

    <!-- Debate -->
    <div class="rgroup">
      <!-- ⚠ onmousedown preventDefault on the mark buttons: without it, pressing
           the button blurs the cell or answer tile you were typing in, so the
           mark lands on the whole cell instead of the tile. -->
      <button class="rb" data-tour="drop" title="They dropped this argument ({combosLabel(km.markDropped, mac)})" onmousedown={(e) => e.preventDefault()} onclick={() => mark("dropped")}>Dropped</button>
      <button class="rb" title="Must answer in your next speech ({combosLabel(km.markStarred, mac)})" onmousedown={(e) => e.preventDefault()} onclick={() => mark("starred")}>Star</button>
      <button class="rb" title="This is an analytic - no card ({combosLabel(km.markAnalytic, mac)})" onmousedown={(e) => e.preventDefault()} onclick={() => evidence("analytic")}>Analytic</button>
      <button class="rb" data-tour="evidence" title="This is a carded argument ({combosLabel(km.markCard, mac)})" onmousedown={(e) => e.preventDefault()} onclick={() => evidence("card")}>Card</button>
      <button class="rb" title="Extend this argument into your next speech ({combosLabel(km.extendArg, mac)})" onclick={extend}>Extend</button>
      <button class="rb" title="Answer this argument - jumps to your reply and links it, so sending to the doc writes “AT: this argument” ({combosLabel(km.replyToArg, mac)})" onclick={reply}>Answer</button>
      {#if onsendspeech || onsendcell || onremove}
        <div class="row-menu-wrap">
          <button class="rb" class:on={sendMenuOpen} data-tour="send" title="Send cards to the speech doc, or remove them" onclick={() => (sendMenuOpen = !sendMenuOpen)}>Send ▾</button>
          {#if sendMenuOpen}
            <button class="row-menu-backdrop" aria-label="Close menu" onclick={() => (sendMenuOpen = false)}></button>
            <div class="row-menu-pop">
              {#if onsendcell}
                <button onclick={() => { sendMenuOpen = false; onsendcell?.(); }} title="Send the selected cell(s) to the doc at the cursor">{sendCellLabel} <kbd>{combosLabel(km.sendCellsToDoc, mac)}</kbd></button>
              {/if}
              {#if onsendspeech}
                <button onclick={() => { sendMenuOpen = false; onsendspeech?.(); }} title="Send the whole row (every card in this speech) in flow order">Send entire row <kbd>{combosLabel(km.sendRowToDoc, mac)}</kbd></button>
              {/if}
              {#if onremove}
                <button class="danger" onclick={() => { sendMenuOpen = false; onremove?.(); }} title="Clear this cell and remove its card from the doc">Remove from doc <kbd>{combosLabel(km.removeFromDoc, mac)}</kbd></button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <span class="toolbar-sep"></span>

    <!-- View -->
    <div class="rgroup">
      <button class="rb" data-tour="spread" class:on={spreadMode === "vertical"} title="See several flows stacked, columns aligned ({combosLabel(km.toggleSpread, mac)})" onclick={() => onspread("vertical")}>Stack</button>
      <button class="rb" class:on={spreadMode === "horizontal"} title="See several flows next to each other" onclick={() => onspread("horizontal")}>Split</button>
      <span class="zoom-ctl">
        <button class="rb zoom-btn" title="Zoom out ({combosLabel(km.zoomOut, mac)})" onclick={() => settings.zoomOut()}>−</button>
        <button class="rb zoom-pct" title="Reset zoom ({combosLabel(km.zoomReset, mac)})" onclick={() => settings.zoomReset()}>{Math.round(settings.zoom * 100)}%</button>
        <button class="rb zoom-btn" title="Zoom in ({combosLabel(km.zoomIn, mac)})" onclick={() => settings.zoomIn()}>+</button>
      </span>
    </div>
  </div>

  <!-- Right-side aside: prep clocks + density toggle. Never wraps or shrinks. -->
  <div class="ribbon-aside">
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
              title="{side === 'aff' ? 'Aff' : 'Neg'} prep remaining - click to correct it by hand"
              onclick={() => startEditPrep(side)}
            >{prep.label(side)}</button>
          {/if}
          <button
            class="prep-go"
            title={prep.running(side)
              ? `Stop ${side === "aff" ? "aff" : "neg"} prep`
              : prep.spent(side)
                ? "No prep left - right-click to reset"
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
        ? "Condense the toolbar - fits a splitscreen half"
        : "Expand the toolbar to full width"}
      onclick={() => {
        settings.ribbonMode = settings.ribbonMode === "full" ? "compact" : "full";
        settings.save();
      }}
    >{settings.ribbonMode === "full" ? "Compact" : "Full"}</button>
  </div>
</div>
</div>

<style>
  .ribbon-wrap {
    flex-shrink: 0;
    container-type: inline-size;
    container-name: simplebar;
  }
  /* ⚠ NEVER CLIPS (Adam). It used to be one row with `overflow: hidden`, and
     on a smaller screen the right-hand buttons were cut off where nobody could
     reach them. Now the bar spreads its buttons across the whole width, and
     when they truly don't fit they WRAP onto a second row. */
  .ribbon {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    box-sizing: border-box;
    padding: 4px 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  /* Buttons take every pixel left of the clocks and spread across it; the
     size steps at the bottom shrink them as the bar narrows, and only past
     the last step do they wrap. */
  .ribbon-buttons {
    flex: 1 1 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 4px 4px;
    min-width: 0;
  }
  .rgroup {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .toolbar-sep {
    width: 1px;
    align-self: center;
    height: 24px;
    background: var(--border);
    margin: 0 3px;
  }
  /* One shared button look - same height + min-width so the bar reads evenly.
     No per-action colors; only state differs. */
  .rb {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    height: 30px;
    box-sizing: border-box;
    min-width: 34px;
    padding: 0 11px;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .rb:hover { border-color: var(--accent); }
  .rb:active { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  /* Toggled (Stack / Split / Row menu open): the one filled state. */
  .rb.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .rb.b { font-weight: 800; }
  .rb.i { font-style: italic; font-family: Georgia, serif; }

  /* Compact: smaller buttons + tighter gaps, and the two wide readouts drop out
     (zoom keeps its keybinds + pinch; text size lives in Settings). */
  .ribbon.compact { min-height: 38px; padding: 3px 6px; gap: 3px 6px; }
  .ribbon.compact .rb { height: 26px; min-width: 28px; padding: 0 8px; font-size: 11px; }
  .ribbon.compact .ribbon-buttons { gap: 2px; }
  .ribbon.compact .rgroup { gap: 2px; }
  .ribbon.compact .toolbar-sep { margin: 0 2px; }
  .ribbon.compact .zoom-ctl,
  .ribbon.compact .stepper { display: none; }

  /* The text-size stepper and the zoom control are both pills: one bordered box
     with seamless −/value/+ inside, so they match each other and sit the same
     height as the plain buttons (instead of three separate little boxes). */
  .stepper,
  .zoom-ctl {
    display: inline-flex;
    align-items: center;
    height: 30px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 2px;
    gap: 1px;
  }
  .stepper .rb,
  .zoom-ctl .rb {
    background: transparent;
    border-color: transparent;
    height: 26px;
    min-width: 24px;
    padding: 0 7px;
  }
  .stepper .rb:hover,
  .zoom-ctl .rb:hover {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: transparent;
  }
  .zoom-pct { min-width: 46px; font-variant-numeric: tabular-nums; }
  .font-size {
    font-size: 13px;
    color: var(--text);
    min-width: 22px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .swatch {
    position: relative;
    overflow: hidden;
    min-width: 30px;
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

  /* ---- Row ▾ dropdown ---- */
  .row-menu-wrap { position: relative; }
  .row-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: transparent;
    border: none;
    cursor: default;
  }
  .row-menu-pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 41;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  }
  .row-menu-pop button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .row-menu-pop button:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .row-menu-pop button.danger:hover {
    background: color-mix(in srgb, var(--mark-dropped) 16%, transparent);
    color: var(--mark-dropped);
  }
  .row-menu-pop kbd {
    font-size: 11px;
    color: var(--text-dim);
    font-family: inherit;
  }

  /* ---- right aside: prep clocks + density ---- */
  .ribbon-aside {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
    margin-left: auto;
    padding-left: 8px;
    border-left: 1px solid var(--border);
  }
  .prep-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .prep {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px 2px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }
  /* Each clock wears its own side's colour, the same blue/red the flow uses. */
  .prep.aff { border-color: color-mix(in srgb, var(--aff, #1a6fd4) 45%, var(--border)); }
  .prep.neg { border-color: color-mix(in srgb, var(--neg, #c8442a) 45%, var(--border)); }
  /* A running clock gets a filled wash so you can spot it across a room. */
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
  .prep.aff .prep-tag { color: var(--aff, #1a6fd4); }
  .prep.neg .prep-tag { color: var(--neg, #c8442a); }
  /* Tabular figures so the digits don't twitch the bar once a second. */
  .prep-time {
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 0 3px;
    min-width: 40px;
    text-align: center;
    cursor: text;
  }
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
    font-size: 11px;
    line-height: 1;
    padding: 2px;
    cursor: pointer;
    border-radius: 4px;
  }
  .prep-go:hover:not(:disabled) { color: var(--text); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .prep-go:disabled { opacity: 0.4; cursor: default; }
  .density-toggle { color: var(--text-dim); }

  /* ---- size steps (last, so they win; repeated at .compact specificity since
     a container query adds none). Shrink before anything wraps. ---- */
  @container simplebar (max-width: 1500px) {
    .ribbon .rb, .ribbon.compact .rb { padding: 0 7px; font-size: 12.5px; }
    .ribbon .toolbar-sep, .ribbon.compact .toolbar-sep { margin: 0 1px; }
  }
  @container simplebar (max-width: 1250px) {
    .ribbon .rb, .ribbon.compact .rb { height: 27px; min-width: 26px; padding: 0 5px; font-size: 12px; }
    .ribbon .stepper, .ribbon .zoom-ctl { display: none; }
    .ribbon .toolbar-sep, .ribbon.compact .toolbar-sep { display: none; }
    .ribbon .prep-tag { display: none; }
  }
  @container simplebar (max-width: 950px) {
    .ribbon .rb, .ribbon.compact .rb { height: 25px; min-width: 22px; padding: 0 4px; font-size: 11px; }
    .ribbon .rgroup, .ribbon.compact .rgroup { gap: 2px; }
    .ribbon, .ribbon.compact { padding: 3px 4px; gap: 4px; }
  }
  @container simplebar (max-width: 720px) {
    .ribbon .rb, .ribbon.compact .rb { height: 23px; min-width: 20px; padding: 0 3px; font-size: 10px; border-radius: 4px; }
  }
</style>
