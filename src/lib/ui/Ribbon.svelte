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
  }: {
    spreadMode: "off" | "vertical" | "horizontal";
    onspread: (mode: "vertical" | "horizontal") => void;
    onsendspeech?: (() => void) | null;
    onsendcell?: (() => void) | null;
  } = $props();

  const km = $derived(settings.keymap);
  const mac = settings.isMac;

  const FONTS = [
    { label: "System", value: "" },
    { label: "Calibri", value: "Calibri, sans-serif" },
    { label: "Arial", value: "Arial, sans-serif" },
    { label: "Georgia", value: "Georgia, serif" },
    { label: "Times", value: "'Times New Roman', serif" },
    { label: "Mono", value: "ui-monospace, Menlo, monospace" },
  ];

  function bumpFont(delta: number) {
    settings.fontSize = Math.max(10, Math.min(22, settings.fontSize + delta));
    settings.save();
  }

  function toggle(mark: "bold" | "italic") {
    store.applyToTargets((c) => {
      const m = (c.marks ??= {});
      m[mark] = !m[mark];
    });
  }

  function ink(color: string | null) {
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
</script>

<div class="ribbon">
  <div class="group">
    <div class="controls">
      <button class="rb" title="Undo (⌘Z)" onclick={() => store.undo()}>↶ Undo</button>
      <button class="rb" title="Redo (⌘⇧Z)" onclick={() => store.redo()}>↷ Redo</button>
    </div>
    <div class="caption">Edit</div>
  </div>

  <div class="group">
    <div class="controls">
      <select
        class="font-select"
        title="Font"
        value={settings.fontFamily}
        onchange={(e) => { settings.fontFamily = e.currentTarget.value; settings.save(); }}
      >
        {#each FONTS as f (f.label)}
          <option value={f.value}>{f.label}</option>
        {/each}
      </select>
      <span class="stepper" title="Text size">
        <button class="rb slim" onclick={() => bumpFont(-1)}>−</button>
        <span class="font-size">{settings.fontSize}</span>
        <button class="rb slim" onclick={() => bumpFont(1)}>+</button>
      </span>
      <button class="rb b" title="Bold (whole cell)" onclick={() => toggle("bold")}>B</button>
      <button class="rb i" title="Italic (whole cell)" onclick={() => toggle("italic")}>I</button>
      <label class="rb swatch" title="Custom text color for this cell/selection">
        <span class="ink-a">A</span>
        <input type="color" oninput={(e) => ink(e.currentTarget.value)} />
      </label>
      <button
        class="rb"
        title="Remove the custom color — back to automatic ink (blue aff / red neg / analytic / card)"
        onclick={() => ink(null)}
      >Auto color</button>
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
        <button class="rb send-doc" title="Build the whole speech: send every card in this column to the Speech Doc" onclick={onsendspeech}>Send to Doc</button>
      {/if}
      {#if onsendcell}
        <button class="rb send-cell" title="Send just this cell's card to the doc at the cursor" onclick={onsendcell}>Cell → Doc</button>
      {/if}
    </div>
    <div class="caption">Debate</div>
  </div>

  <div class="group">
    <div class="controls">
      <button class="rb" class:on={spreadMode === "vertical"} title="See several flows stacked, columns aligned ({combosLabel(km.toggleSpread, mac)})" onclick={() => onspread("vertical")}>▤ Stack</button>
      <button class="rb" class:on={spreadMode === "horizontal"} title="See several flows next to each other" onclick={() => onspread("horizontal")}>◫ Split</button>
    </div>
    <div class="caption">View</div>
  </div>
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
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0 2px;
  }
  .font-select {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 5px;
    height: 26px;
    font-size: 12px;
    max-width: 92px;
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
