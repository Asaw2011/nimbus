<script lang="ts">
  // The in-app manual: a scrollable reference covering every feature. Opened
  // from the top bar (📖) or the welcome tutorial. Pure content — no app state.
  import { settings } from "../model/settings.svelte";
  import { combosLabel } from "../model/keymap";

  let { onclose }: { onclose: () => void } = $props();
  const mac = settings.isMac;
  const km = $derived(settings.keymap);
  const mod = mac ? "⌘" : "Ctrl";

  const SECTIONS = [
    { id: "start", label: "Getting started" },
    { id: "grid", label: "The flow grid" },
    { id: "sheets", label: "Sheets & positions" },
    { id: "marks", label: "Marks & colors" },
    { id: "spread", label: "Spread view" },
    { id: "cells", label: "Multi-item cells" },
    { id: "search", label: "Doc search (library)" },
    { id: "doc", label: "The speech doc" },
    { id: "quick", label: "Quick cards" },
    { id: "docstyle", label: "Doc style & headings" },
    { id: "senddoc", label: "Sending to the doc" },
    { id: "fonts", label: "Fonts & zoom" },
    { id: "keys", label: "Keyboard shortcuts" },
    { id: "macros", label: "Macros & snippets" },
    { id: "import", label: "Importing .docx" },
    { id: "files", label: "Saving & files" },
    { id: "settings", label: "Settings" },
  ];

  let active = $state("start");
  let bodyEl = $state<HTMLElement>();

  function go(id: string) {
    active = id;
    bodyEl?.querySelector(`#sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />
<div class="backdrop" role="presentation" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="Nimbus manual" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <img class="logo" src="/logo.png" alt="" />
      <div>
        <h1>Nimbus Manual</h1>
        <p class="sub">Everything the app can do — flow, doc, and settings.</p>
      </div>
      <button class="close" onclick={onclose} aria-label="Close">×</button>
    </div>

    <div class="cols">
      <nav class="toc">
        {#each SECTIONS as s (s.id)}
          <button class:active={active === s.id} onclick={() => go(s.id)}>{s.label}</button>
        {/each}
      </nav>

      <div class="body" bind:this={bodyEl}>
        <section id="sec-start">
          <h2>Getting started</h2>
          <p>
            Nimbus is a flowing tool for competitive debate (Policy / LD / PF). It
            combines paper's strengths — seeing many flows at once and interacting
            with arguments spatially — with a laptop's: typing speed, copy/paste,
            search, and full <b>.docx</b> speech-doc integration.
          </p>
          <p>
            The whole app is <b>local-first and offline</b>: nothing depends on
            tournament wifi, and everything you do is saved to your machine.
          </p>
          <ul>
            <li>A <b>round</b> is one debate. Open or create one from the dashboard.</li>
            <li>Inside a round, columns are <b>speeches</b> and rows are <b>arguments</b>.</li>
            <li>Each position (case, off-case, DA…) is a <b>sheet</b> — a tab at the bottom.</li>
          </ul>
        </section>

        <section id="sec-grid">
          <h2>The flow grid</h2>
          <p>
            The grid already exists like paper or Excel — every cell is directly
            editable, no "create a cell" step. Just click and type.
          </p>
          <ul>
            <li><b>Enter</b> / <b>↓</b> — next row. <b>Tab</b> — next speech. Arrows move the cursor.</li>
            <li><kbd>{mod}</kbd>+arrows / the ribbon insert & delete rows.</li>
            <li><b>Row 0 of a sheet</b> is the LABEL cell — typing it renames the sheet everywhere.</li>
            <li>Paste from anywhere — it's standardized to <b>plain text</b> and takes the column's color. Multi-cell (tabs/newlines) spreads across cells like Excel.</li>
            <li><b>Undo / redo</b>: <kbd>{mod}Z</kbd> / <kbd>{mod}⇧Z</kbd> — 300 steps deep.</li>
          </ul>
        </section>

        <section id="sec-sheets">
          <h2>Sheets & positions</h2>
          <p>Sheets are the tabs at the bottom (Excel-style).</p>
          <ul>
            <li><b>New sheet</b>: <kbd>{combosLabel(km.newSheet, mac)}</kbd>, or the <b>+</b> tab.</li>
            <li><b>Switch</b>: <kbd>{combosLabel(km.prevSheet, mac)}</kbd> / <kbd>{combosLabel(km.nextSheet, mac)}</kbd>, or <kbd>{mod}1</kbd>–<kbd>{mod}9</kbd> to jump.</li>
            <li><b>Reorder</b>: drag a tab, or <kbd>{combosLabel(km.moveSheetLeft, mac)}</kbd> / <kbd>{combosLabel(km.moveSheetRight, mac)}</kbd>.</li>
            <li><b>Rename / delete</b>: right-click a tab, or edit its LABEL cell.</li>
            <li>Off-case pages start at the 1NC column; overviews at the block — no wasted columns, like a Verbatim template.</li>
          </ul>
        </section>

        <section id="sec-marks">
          <h2>Marks & colors</h2>
          <p>
            Ink follows the <b>speech side</b>, not the page: aff columns are blue,
            neg red — on every sheet, like flowing with two pens. From the ribbon
            (Debate group) or keys you can mark cells:
          </p>
          <ul>
            <li><b>Dropped</b> (<kbd>{combosLabel(km.markDropped, mac)}</kbd>) — a conceded argument.</li>
            <li><b>Star</b> (<kbd>{combosLabel(km.markStarred, mac)}</kbd>) — must-answer.</li>
            <li><b>Analytic</b> (<kbd>{combosLabel(km.markAnalytic, mac)}</kbd>) — green ink, your own analysis.</li>
            <li><b>Card</b> (<kbd>{combosLabel(km.markCard, mac)}</kbd>) — evidence, purple ink.</li>
            <li><b>Extend</b> (<kbd>{combosLabel(km.extendArg, mac)}</kbd>) — draws an arrow carrying the argument to the next same-side speech.</li>
            <li>Set a custom color with the ribbon <b>A</b> swatch, or <b>Auto color</b> to return to side ink. All defaults are configurable in Settings.</li>
          </ul>
          <p>
            <b>Argument lookup</b> (<kbd>{combosLabel(km.authorLookup, mac)}</kbd>): autocomplete
            from arguments banked out of imported docs.
          </p>
        </section>

        <section id="sec-spread">
          <h2>Spread view</h2>
          <p>
            See several sheets at once — the paper-on-your-desk view. Toggle with
            <kbd>{combosLabel(km.toggleSpread, mac)}</kbd> or the <b>Stack / Split</b> buttons.
          </p>
          <ul>
            <li><b>Stack</b> = vertical, columns aligned across flows. <b>Split</b> = side-by-side.</li>
            <li>Use the picker bar to toggle sheets on/off the desk, or <kbd>{mod}1</kbd>–<kbd>9</kbd>.</li>
            <li>Drag to reorder panels; drag the dividers to resize. Each panel scrolls on its own.</li>
          </ul>
        </section>

        <section id="sec-cells">
          <h2>Multi-item cells</h2>
          <p>
            A single flow cell can hold several sub-entries — a block's cards plus
            your own responses. Insert a block from Doc Search and it expands into
            an <b>expandable cell</b>: a header, then each card.
          </p>
          <ul>
            <li>Click <b>▸ N items</b> to expand/collapse. It stays put across saves.</li>
            <li><b>+ response</b> adds your own answer (an analytic); press <b>Enter</b> in a response to add another below.</li>
            <li>Hover between items for a <b>+</b> to insert a response anywhere in the list.</li>
            <li><b>×</b> removes a card or response; <b>clear</b> (on the header) drops the whole block.</li>
            <li>Click anywhere in the cell to start editing its header.</li>
          </ul>
        </section>

        <section id="sec-search">
          <h2>Doc search (your library)</h2>
          <p>
            <kbd>{combosLabel(km.openDocSearch, mac)}</kbd> opens Doc Search — search your
            prep files and insert cards straight into the flow.
          </p>
          <ul>
            <li>Add folders in <b>Settings → Library</b>. Nimbus indexes the .docx inside.</li>
            <li>Search <b>By name</b> (filename/heading) or <b>By content</b> (inside the cards).</li>
            <li>Dive into a file to browse its Pocket / Hat / Block / Tag structure, then insert.</li>
            <li>Inserting fills the flow cell only — it never auto-adds to your speech doc.</li>
          </ul>
        </section>

        <section id="sec-doc">
          <h2>The speech doc</h2>
          <p>
            The speech doc <b>is</b> CardMirror: it uses CardMirror's real schema,
            importer, and exporter, so cards render and round-trip identically
            (highlight = spoken, underline = the cut, emphasis = boxed power word,
            small = unread). Open it with <kbd>{mod}D</kbd> or the 📄 button.
          </p>
          <ul>
            <li><b>Structure</b> pills: Pocket <kbd>{mod}1</kbd>, Hat <kbd>{mod}2</kbd>, Block <kbd>{mod}3</kbd>, Tag <kbd>{mod}4</kbd>, Analytic <kbd>{mod}5</kbd>, Undertag <kbd>{mod}6</kbd>, Body <kbd>{mod}0</kbd>.</li>
            <li><b>Read markings</b>: Cite <kbd>{mod}9</kbd>, Emphasis <kbd>{mod}↓</kbd>, Underline <kbd>{mod}↑</kbd>, Clear <kbd>{mod}←</kbd>. Plus B / I / strikethrough and highlight colors.</li>
            <li><b>Find in doc</b> (<kbd>{mod}F</kbd>): highlights every match; Enter / Shift-Enter cycle.</li>
            <li><b>Read mode</b>: shows only the read-aloud (highlighted) text.</li>
            <li><b>Standardize highlighting</b> (Std ▾): rewrite every highlight to one color — optionally keeping one color as an exception.</li>
            <li><b>Backspace</b> on an empty heading/tag removes it. Empty headings don't clutter the outline.</li>
            <li><b>Outline</b> (left) jumps to any heading; collapse to Pocket / Hat / Block.</li>
            <li><b>Maximize</b> to fill the window, or <b>Pop out</b> into its own window. Drag the divider to resize; it can go narrow.</li>
            <li><b>Multiple docs</b>: the tab bar above the doc holds several independent docs — <b>＋</b> makes a new one, <b>📂 Open</b> imports a <b>.docx</b> into its own doc, double-click a tab to rename, <b>×</b> to close. Each keeps its own content, saved automatically.</li>
            <li><b>Pop out</b> (⇱ on a tab) opens a doc in its own window — you can have several out at once. The <b>main</b> doc (the flow-linked one) is always the docked tab; click a tab to make it the main.</li>
            <li><b>The speech doc</b> (<b>★</b>): click the star on any doc's tab to mark it as your speech doc — the one you're building. The star turns gold. Setting it makes that doc the docked/main doc so sends always land in it.</li>
            <li><b>Send to speech</b> (<kbd>`</kbd> / <kbd>~</kbd>, fixed): from any other doc (typically a source doc popped out into its own window), press this to send the current card/selection to your <b>★ speech doc</b> at its cursor — like Verbatim/CardMirror. If the speech doc isn't open, the card is appended to it.</li>
            <li><b>Em dash</b>: typing <kbd>---</kbd> in the speech doc or a flow cell collapses to a single long dash (—).</li>
            <li><b>Where sends land</b> — no toggle, the app follows what you select: a <b>highlight, one cell, or a range of cells</b> drops <b>at your cursor</b>; the <b>↕ Send Entire Row</b> button sends the whole speech in <b>flow order</b> (mirrors the flow, de-dupes).</li>
            <li>All doc shortcuts are rebindable in <b>Settings → Keyboard → Speech doc</b>.</li>
          </ul>
        </section>

        <section id="sec-quick">
          <h2>Quick cards</h2>
          <p>
            A reusable library of rich-text snippets — your go-to blocks, tags, or
            analytics you drop in again and again. Open the palette with
            <kbd>{combosLabel(km.docQuickCards, mac)}</kbd> or the <b>★ Quick</b> button.
          </p>
          <ul>
            <li><b>Save</b>: select text in the doc, open Quick Cards, click <b>＋ Save selection</b>, give it a name and optional tags.</li>
            <li><b>Insert</b>: open the palette, search by name / tag / text, and click a card (or Enter for the top match) to drop it at the cursor.</li>
            <li><b>Delete</b> with the <b>×</b> on any card.</li>
            <li><b>On the flow</b>: the <b>★</b> button in the top bar opens the same library — <b>drag a card onto the grid</b>, or click it to drop into the current cell (as plain text).</li>
            <li>The library persists across sessions and is saved with your setup.</li>
          </ul>
        </section>

        <section id="sec-docstyle">
          <h2>Doc style & headings</h2>
          <p>
            <b>Settings → Appearance → Speech Doc Style & Headings</b> lets you match
            how your CardMirror renders evidence, with a live preview:
          </p>
          <ul>
            <li><b>Heading sizes</b> (pt): Pocket / Hat / Block / Tag / Cite.</li>
            <li><b>Colors</b>: analytic and undertag ink.</li>
            <li><b>Marks</b>: emphasis boxed / bold / italic (+ box thickness), pocket box (+ thickness), underline bold, undertag italic / bold.</li>
            <li><b>Reset to Verbatim defaults</b> any time.</li>
          </ul>
          <p>To resize just some text, select it and use the ribbon's font-size <b>− / +</b> while the doc is focused.</p>
        </section>

        <section id="sec-senddoc">
          <h2>Sending to the doc</h2>
          <p>Cards reach the doc only when you ask — flowing an opponent's cards never touches your speech.</p>
          <ul>
            <li><b>⌖ Send Cell(s)</b> sends the selected cell — or a whole range of cells — at the cursor. <b>↕ Send Entire Row</b> sends the whole speech in flow order.</li>
            <li>Either way, content lands in <b>flow order</b> (top to bottom) — not just appended at the bottom — and re-sending updates rather than duplicating.</li>
            <li>A plain typed cell sends as an <b>analytic</b>; a card sends as a card; a multi-item cell sends its header, cards, and responses in order.</li>
            <li>The ribbon's <b>B / I / A color / font-size</b> act on the doc whenever the doc is the surface you last clicked into.</li>
          </ul>
        </section>

        <section id="sec-fonts">
          <h2>Fonts & zoom</h2>
          <ul>
            <li><b>Default font</b> (Settings → Appearance) drives the flow and doc. <b>Lexend</b> and <b>Calibri</b> are bundled and work offline (Calibri via the metric-compatible Carlito, so cards lay out the same).</li>
            <li><b>Pinch to zoom</b> the flow or the doc on a trackpad. Or <kbd>{combosLabel(km.zoomIn, mac)}</kbd> / <kbd>{combosLabel(km.zoomOut, mac)}</kbd> / <kbd>{combosLabel(km.zoomReset, mac)}</kbd> for the flow.</li>
          </ul>
        </section>

        <section id="sec-keys">
          <h2>Keyboard shortcuts</h2>
          <p>
            The core motions — Enter, Tab, arrows — are fixed muscle memory.
            Everything else is rebindable in <b>Settings → Keyboard</b>, grouped
            into Rows, Flowing & marks, Sheets, View & zoom, App, and Speech doc.
            Multiple bindings per action are allowed.
          </p>
        </section>

        <section id="sec-macros">
          <h2>Macros & snippets</h2>
          <ul>
            <li><b>Macros</b> are plain JavaScript (Settings → Editing) bound to a key — run as one undo step. The <code>flow</code> API can type, move, insert rows, and set marks for one-key argument blocks.</li>
            <li><b>Abbreviations</b> expand as you type (e.g. a short trigger → a long phrase).</li>
          </ul>
        </section>

        <section id="sec-import">
          <h2>Importing .docx</h2>
          <p>
            From a round's home page, import a Verbatim-convention <b>.docx</b>
            (Heading 1–4 = Pocket / Hat / Block / Tag). 1NC docs create sheets;
            answer docs (AT: / A2…) fuzzy-match existing sheets. Every doc's cards
            are also <b>banked</b> for argument lookup.
          </p>
        </section>

        <section id="sec-files">
          <h2>Saving & files</h2>
          <ul>
            <li>Everything autosaves to your machine (a heartbeat plus a flush on blur/close). Your work is never only in memory.</li>
            <li><kbd>{mod}S</kbd> saves the open flow to a <b>.nimbus</b> file; double-click a .nimbus file to open it.</li>
            <li>Export an HTML report or a round file from a round's home page. Settings (keybinds, macros, snippets, colors) back up and restore as a bundle.</li>
          </ul>
        </section>

        <section id="sec-settings">
          <h2>Settings</h2>
          <p><kbd>{combosLabel(km.openSettings, mac)}</kbd> opens Settings, split into tabs:</p>
          <ul>
            <li><b>Appearance</b> — theme, colors, default font, sizes, and the Speech Doc Style editor.</li>
            <li><b>Editing</b> — macros and abbreviations.</li>
            <li><b>Keyboard</b> — every rebindable shortcut, grouped.</li>
            <li><b>Library</b> — folders Doc Search indexes.</li>
            <li><b>Backup</b> — export/import your setup, and check for updates.</li>
          </ul>
          <p class="foot">Reopen this manual anytime from the 📖 button in the top bar.</p>
        </section>
      </div>
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
    width: min(920px, 96vw);
    height: min(760px, 92vh);
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .logo { width: 34px; height: 34px; object-fit: contain; }
  h1 { margin: 0; font-size: 18px; }
  .sub { margin: 2px 0 0; font-size: 12px; color: var(--text-dim); }
  .close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 24px;
    cursor: pointer;
    line-height: 1;
  }
  .cols { display: flex; flex: 1; min-height: 0; }
  .toc {
    width: 210px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .toc button {
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-size: 13px;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
  }
  .toc button:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .toc button.active { background: color-mix(in srgb, var(--accent) 20%, transparent); font-weight: 600; }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 26px 40px;
    scroll-behavior: smooth;
  }
  section { padding-top: 18px; }
  h2 {
    font-size: 16px;
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  p { font-size: 13.5px; line-height: 1.55; color: var(--text); margin: 0 0 10px; }
  ul { margin: 0 0 10px; padding-left: 20px; }
  li { font-size: 13.5px; line-height: 1.6; margin-bottom: 4px; }
  code {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
  kbd {
    background: var(--kbd-bg);
    border: 1px solid var(--kbd-border);
    border-radius: 4px;
    padding: 0 5px;
    font-size: 11px;
    white-space: nowrap;
  }
  .foot { color: var(--text-dim); font-size: 12px; margin-top: 12px; }
</style>
