<script lang="ts">
  // Excel-style ribbon: the important actions as visible buttons, grouped and
  // labeled the way Word/Docs/Excel users already expect. Applies to the
  // selected block if one exists, else the current cell.

  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import { combosLabel } from "../model/keymap";

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

  function cycleRibbonMode() {
    const order = ["full", "icons", "slim"] as const;
    const i = order.indexOf(settings.ribbonMode);
    settings.ribbonMode = order[(i + 1) % order.length];
    settings.save();
  }
</script>

<div class="ribbon" class:mode-icons={settings.ribbonMode === "icons"} class:mode-slim={settings.ribbonMode === "slim"}>
  <div class="group">
    <div class="controls">
      <button class="rb" title="Undo (⌘Z)" onclick={() => store.undo()}>↶ Undo</button>
      <button class="rb" title="Redo (⌘⇧Z)" onclick={() => store.redo()}>↷ Redo</button>
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
      <button class="rb" title="Insert a row above this one ({combosLabel(km.insertRowAbove, mac)})" onclick={() => insertRow(0)}>+ Above</button>
      <button class="rb" title="Insert a row below this one ({combosLabel(km.insertRowBelow, mac)})" onclick={() => insertRow(1)}>+ Below</button>
      <button class="rb" title="Delete this row ({combosLabel(km.deleteRow, mac)})" onclick={deleteRow}>− Delete</button>
    </div>
    <div class="caption">Rows</div>
  </div>

  <div class="group">
    <div class="controls">
      <button class="rb dropped" title="They dropped this argument ({combosLabel(km.markDropped, mac)})" onclick={() => mark("dropped")}>Dropped</button>
      <button class="rb star" title="Must answer in your next speech ({combosLabel(km.markStarred, mac)})" onclick={() => mark("starred")}>★ Star</button>
      <button class="rb analytic" title="This is an analytic — no card ({combosLabel(km.markAnalytic, mac)})" onclick={() => evidence("analytic")}>Analytic</button>
      <button class="rb card" title="This is a carded argument ({combosLabel(km.markCard, mac)})" onclick={() => evidence("card")}>Card</button>
      <button class="rb extend" title="Extend this argument into your next speech ({combosLabel(km.extendArg, mac)})" onclick={extend}>➜ Extend</button>
      {#if onsendspeech}
        <button class="rb send-doc" title="Send the ENTIRE ROW (every card in this speech) to the doc in flow order — mirrors the flow and de-dupes." onclick={onsendspeech}>↕ Send Entire Row</button>
      {/if}
      {#if onsendcell}
        <button class="rb send-cell" title="Send the selected cell(s) to the doc AT THE CURSOR. Select a range first to send multiple cells." onclick={onsendcell}>⌖ {sendCellLabel}</button>
      {/if}
      {#if onremove}
        <button class="rb remove" title="Clear this cell and remove its card from the doc" onclick={onremove}>✕ Remove</button>
      {/if}
    </div>
    <div class="caption">Debate</div>
  </div>

  <div class="group">
    <div class="controls">
      <button class="rb" class:on={spreadMode === "vertical"} title="See several flows stacked, columns aligned ({combosLabel(km.toggleSpread, mac)})" onclick={() => onspread("vertical")}>▤ Stack</button>
      <button class="rb" class:on={spreadMode === "horizontal"} title="See several flows next to each other" onclick={() => onspread("horizontal")}>◫ Split</button>
      <span class="zoom-ctl">
        <button class="rb zoom-btn" title="Zoom out ({combosLabel(km.zoomOut, mac)})" onclick={() => settings.zoomOut()}>−</button>
        <button class="rb zoom-pct" title="Reset zoom ({combosLabel(km.zoomReset, mac)})" onclick={() => settings.zoomReset()}>{Math.round(settings.zoom * 100)}%</button>
        <button class="rb zoom-btn" title="Zoom in ({combosLabel(km.zoomIn, mac)})" onclick={() => settings.zoomIn()}>+</button>
      </span>
    </div>
    <div class="caption">View</div>
  </div>

  <button
    class="rb ribbon-density"
    title={"Ribbon density: " + settings.ribbonMode + " — click to cycle (full → icons → slim)"}
    onclick={cycleRibbonMode}
  >{settings.ribbonMode === "full" ? "⤢" : settings.ribbonMode === "icons" ? "⤡" : "⇔"}</button>
</div>

<style>
  .ribbon {
    display: flex;
    align-items: stretch;
    padding: 4px 8px 2px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0 10px;
    border-right: 1px solid var(--border);
  }
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
  .rb {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text);
    border-radius: 5px;
    height: 26px;
    padding: 0 8px;
    font-size: 12px;
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

  /* ── Ribbon density modes ─────────────────────────────────────── */
  .ribbon-density {
    margin-left: auto; /* push to the far right */
    align-self: center;
    min-width: 30px;
    color: var(--text-dim);
    flex-shrink: 0;
  }
  /* slim — labels kept (legible), captions gone, min height, groups spread */
  .ribbon.mode-slim { align-items: center; }
  .ribbon.mode-slim .caption { display: none; }
  .ribbon.mode-slim .group { flex: 1; justify-content: center; }
  .ribbon.mode-slim .rb { height: 24px; }
  /* icons — captions gone + compact sizing (dense) */
  .ribbon.mode-icons { align-items: center; }
  .ribbon.mode-icons .caption { display: none; }
  .ribbon.mode-icons .group { padding: 0 6px; }
  .ribbon.mode-icons .controls { gap: 2px; }
  .ribbon.mode-icons .rb { height: 24px; padding: 0 5px; font-size: 11px; }
</style>
