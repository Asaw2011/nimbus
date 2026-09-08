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
    { id: "partner", label: "Flowing with a partner" },
    { id: "prep", label: "Prep clocks & timer" },
    { id: "bank", label: "The argument bank" },
    { id: "answer", label: "Linking an answer" },
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
    { id: "tournaments", label: "Tournaments & dashboard" },
    { id: "toolbar", label: "Toolbar & top bar" },
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

          <h3>Answering a block part by part</h3>
          <p>
            Expand a block and <b>every speech after it</b> gets its own tile for
            each part, lined up exactly with the part it answers. So you answer
            the 1NC's third card in the 2AC, they answer that in the block, you
            answer that in the 1AR — the argument keeps its own row all the way
            to the last speech.
          </p>
          <ul>
            <li>Each tile is a real flow cell: mark it a <b>card</b> or an <b>analytic</b>, colour it, bold it, star it — the ribbon buttons and the keyboard shortcuts both work while your cursor is in one.</li>
            <li><b>Enter</b> drops to the next part's tile, so you can flow straight down a block.</li>
            <li><kbd>{combosLabel(km.insertRowBelow, mac)}</kbd> / <kbd>{combosLabel(km.insertRowAbove, mac)}</kbd> insert a blank row <b>into the block</b>, below or above the argument you're on, and put the cursor in it — the same keys that make a row anywhere else on the flow. Rows you add are answerable down the flow like any other.</li>
            <li>Each partner lane keeps its <b>own</b> answers, so you and your partner aren't typing in the same box.</li>
            <li><b>Collapse the block and the whole chain folds away</b> with it — the header keeps a <b>· N resp</b> badge and a read-only summary. Expand it again and everything is where you left it.</li>
          </ul>
        </section>

        <section id="sec-partner">
          <h2>Flowing with a partner</h2>
          <p>
            <b>👤 Partner flow</b> in the top bar pairs two copies of Nimbus over
            the internet so you and your partner see each other type. One of you
            starts and reads out the <b>6-character code</b>; the other types it
            in; the first approves, with the joiner's email shown.
          </p>
          <ul>
            <li><b>One flow, together</b> — you both work on the same flow.</li>
            <li><b>A flow each</b> — you keep your own flow and open your partner's beside it. Both are live and <b>both are editable</b>, so you can drop a block onto their page while they're speaking. The <b>Mine / Theirs</b> switcher in the top bar says whose page you're typing on, and their flow renders in a different colour so you can't mistake it.</li>
            <li>A small outline and a <b>Partner</b> pill show where their cursor is.</li>
            <li><b>You always save to your own file.</b> Your partner's flow is never written to your disk under your file's name — that rule is not adjustable.</li>
            <li>Nothing about a flow is stored on a server; the connection is only a relay. Close the panel and flowing carries on.</li>
          </ul>

          <h3>Partner lanes</h3>
          <p>
            Pick <b>I'm Aff</b> or <b>I'm Neg</b> when you make a flow and the
            opponent's second speech splits into two columns — one for you, one
            for your partner — so you are never typing over each other.
          </p>
          <ul>
            <li>Both lanes answer the <b>same</b> speech, not each other.</li>
            <li>
              In a live session each of you sees <b>your own</b> lane headed
              <b>You</b> and the other headed <b>Partner</b> — so the same column
              is labelled differently on each computer, on purpose.
            </li>
            <li><b>⇤</b> on the lane header (or <b>Hide partner</b> in the ribbon) hides your partner's lane to declutter. It is purely visual — it never changes what your speech doc says.</li>
            <li>The side is chosen when the flow is created and can't be switched later.</li>
          </ul>
        </section>

        <section id="sec-prep">
          <h2>Prep clocks &amp; the timer</h2>
          <ul>
            <li>Both teams' prep sits in the <b>ribbon</b>, on the right. Press ▶ to run one — starting one stops the other, and it stops itself at 0:00.</li>
            <li>Click the time to correct it by hand when nobody stopped the clock; right-click to reset it.</li>
            <li>Prep length is in Settings (8 minutes by default).</li>
            <li><b>⏱ Timer</b> in the top bar (<kbd>{combosLabel(km.toggleTimer, mac)}</kbd>) is the separate speech stopwatch, with countdown presets.</li>
          </ul>
        </section>

        <section id="sec-bank">
          <h2>The argument bank</h2>
          <p>
            <kbd>{combosLabel(km.authorLookup, mac)}</kbd> in a cell opens the
            bank: start typing an author or a tag and it completes the argument
            for you, with the author in bold, so a card you've read before takes
            a couple of keystrokes.
          </p>
          <ul>
            <li><b>Enter</b> takes the author; <b>Tab</b> takes the author and the tag.</li>
            <li>The bank fills up from the docs you import, and holds analytics as well as carded arguments.</li>
            <li><b>🗃 Arguments</b> in the top bar edits what it offers.</li>
          </ul>
        </section>

        <section id="sec-answer">
          <h2>Linking an answer to an argument</h2>
          <p>
            <kbd>{combosLabel(km.replyToArg, mac)}</kbd> (or <b>↩ Answer</b> in
            the ribbon) jumps to your reply in the next opposing speech and
            records what it answers, so sending it to the speech doc writes
            <b>“AT: the argument you actually meant”</b> instead of guessing at
            whatever sits to the left.
          </p>
          <ul>
            <li>The cell shows a small <b>↩</b> tag naming the argument it answers.</li>
            <li>It's stored as the speech, not the column, so it survives renaming and reordering.</li>
            <li>Use it to answer your <b>partner's</b> lane deliberately — that's the case the left-to-right guess can't get right on its own.</li>
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
          <p class="foot">
            CardMirror is by Anthony Trufanov — Required Notice: Copyright &copy; 2026
            Anthony Trufanov, used under PolyForm Noncommercial 1.0.0. See
            <b>Credits &amp; license</b> at the end of this manual.
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
          <h3>Sending to CardMirror instead</h3>
          <p>
            <b>Send to</b> in the top bar chooses between Nimbus's own speech doc
            and <b>CardMirror Desktop</b>. Cards go straight across — highlighting,
            cites, images and structure all survive, and it doesn't steal your
            focus mid-round.
          </p>
          <ul>
            <li>Needs <b>CardMirror 1.5.0 or newer</b> running. <b>There is no plugin to install</b> — earlier versions of Nimbus needed one and no longer do.</li>
            <li>The dropdown beside it picks which CardMirror document receives sends; leave it on <b>Auto</b> to use whichever one CardMirror has starred as the speech doc.</li>
            <li>If CardMirror isn't running, the card goes to your <b>clipboard</b> instead so nothing is lost — paste it wherever you meant it to go.</li>
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
            <li><b>Excel (.xlsx)</b> works too — save as either, and convert between them from the dashboard. Both formats are first-class; neither is going away.</li>
            <li>Renaming a flow renames its file, and renaming the file's round retitles it — the name on the dashboard is the round's own title, not the filename.</li>
            <li>Export an HTML report or a round file from a round's home page. Settings (keybinds, macros, snippets, colors) back up and restore as a bundle.</li>
          </ul>
        </section>

        <section id="sec-tournaments">
          <h2>Tournaments &amp; the dashboard</h2>
          <p>
            The dashboard groups your flows by tournament. <b>Link a folder</b>
            points a tournament at a folder on disk — a Dropbox folder is fine —
            and every flow inside it, <b>including ones in per-round subfolders</b>,
            shows up under it.
          </p>
          <ul>
            <li>A flow that exists in more than one place collapses to a single row with an <b>N copies</b> badge; hover it to see the other paths. Nothing is deleted or hidden without a trace.</li>
            <li>Tournaments start collapsed; one you make during a session stays open.</li>
            <li>Flows that aren't under any linked folder sit under <b>Not in a tournament</b>.</li>
          </ul>
        </section>

        <section id="sec-toolbar">
          <h2>The toolbar &amp; top bar</h2>
          <ul>
            <li>The <b>top bar</b> carries the panels — speech doc, quick cards, timer, arguments, partner flow, manual, settings. <b>⤡</b> condenses it to icons when you want the vertical room; it does that on its own in a narrow window.</li>
            <li>The <b>ribbon</b> below it has two densities — full and condensed — cycled by the <b>⇥⇤</b> button on its right. Both are the same height, so switching never shifts the grid.</li>
            <li>It resizes itself to fit whatever room it has, including when the speech doc is open beside it. The prep clocks stay pinned to the right so they're always reachable.</li>
            <li>In the condensed ribbon the text-size and zoom readouts are hidden — zoom keeps its shortcuts and pinch, and text size is in Settings.</li>
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
          <h3>Updating</h3>
          <p>
            From 1.2.1 onward Nimbus checks for a new version on its own shortly
            after it starts, and offers to install it. You can also check any time
            from <b>Settings → Backup</b>. Updates are signed, so Nimbus will
            refuse anything that didn't come from us.
          </p>
          <p class="foot">Reopen this manual anytime from the 📖 button in the top bar.</p>
        </section>

        <section>
          <h2>Credits &amp; license</h2>
          <p>
            Nimbus is built together with
            <b>Asaw2011</b> (github.com/Asaw2011/nimbus).
          </p>
          <p>
            The speech doc engine is <b>CardMirror</b> by <b>Anthony Trufanov</b>
            (github.com/ant981228/cardmirror) — the real schema, importer and
            exporter, vendored into Nimbus.
          </p>
          <p>
            <b>Required Notice: Copyright &copy; 2026 Anthony Trufanov.</b>
            CardMirror is used under the PolyForm Noncommercial License 1.0.0
            (polyformproject.org/licenses/noncommercial/1.0.0). That license
            forbids commercial use, and because CardMirror is part of Nimbus,
            that applies to Nimbus as a whole — it is free to use and is meant
            to stay that way.
          </p>
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
  /* Sub-heading inside a section — no rule under it, so it reads as part of the
     section rather than starting a new one. */
  h3 {
    font-size: 13.5px;
    margin: 14px 0 6px;
    color: var(--text);
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
