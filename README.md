<div align="center">
  <img src="static/logo.png" width="96" alt="Nimbus logo" />
  <h1>Nimbus</h1>
  <p><strong>Fast flowing for competitive debate</strong> — Policy · LD · PF</p>
</div>

Nimbus is a desktop flowing app that combines the strengths of paper — seeing
many flows at once, spatial argument interaction — with the strengths of a
laptop: typing speed, copy/paste, search, and integration with the rest of the
debate tech stack.

Built to be **FAST**: every action is keybound, the app is local-first and works
fully offline (tournament wifi can't be trusted), and it loads instantly. It's
**doc-aware** too — a full CardMirror-schema speech doc is built in, and you can
import `.docx` speech docs.

## Download

Grab the latest installer from the
[**Releases**](https://github.com/Asaw2011/nimbus/releases) page:

- **macOS** — `Nimbus_0.2.7_universal.dmg` (Intel + Apple Silicon)
- **Windows** — `Nimbus_0.2.7_x64-setup.exe`

Builds are currently unsigned, so first launch shows a security warning:
- macOS: right-click the app → **Open**
- Windows: **More info → Run anyway**

From 0.2.1 on, Nimbus **updates itself** — it checks on launch and offers an
in-app **Install** when a new version ships, so you only download once.

## New in 0.2.0

- **Flow → doc on the backtick** — `` ` `` sends the cell, `⌘`` ` `` `` the whole
  speech, `⌘⌫` clears it + pulls its card; hand-typed answers get an
  **"AT: …"** header naming what they answer.
- **Grouping, reworked** — clearer right-side brace + tinted cells; **⌘-click**
  any cells (even 1, 4, 6) then **⌘R**, sequential or not, one key.
- **Logical default keybinds** — marks off the copy/paste family; Extend `⌘→`,
  Group `⌘R` (no more ⌘G/⌘⇧G).
- **Doc keyboard zoom** (`⌘=` / `⌘-`), **⌘F** scrolls to the match, and **1NC
  import splits by block heading** (one page per off-case).

Earlier: argument grouping + ribbon auto-fit (0.1.9), Timer (0.1.8), the doc
data-loss fix, Save / Save As, and the argument bank (0.1.7).

See the [full changelog](CHANGELOG.md) for details.

## What's in it today

**Flowing**
- Excel-style grid — columns are speeches, rows are arguments; click anywhere
  and type, no setup ceremony
- Keyboard-first: smart row insertion, extension arrows, abbreviation
  autocomplete, undo/redo
- Speech-side coloring (aff blue / neg red on every sheet), plus per-cell marks:
  **dropped**, **star** (must-answer), **analytic**, **card**
- Templates for Policy / LD / PF — fully editable, side order flippable
  (e.g. Con-first PF)
- LABEL cell that auto-names a flow as you type its tag
- **New pages open blank on their LABEL cell** — pick a kind (Off-case /
  Advantage / Overview / CX) and name it as you go, no naming dialog
- **Jump to a speech** — the ribbon's **Cursor → speech** dropdown (or a chip on
  the round's home) parks your cursor on the **top** of that speech's column
  (2AC, 1AR, …), and it stays on that column across every flow
- **"Space down"** — a keybind (default `⌘\`) moves the cursor down N rows to
  leave room for answers; the row count is set in Settings
- **Timer** — a draggable stopwatch plus five countdown presets (speech / prep
  times, adjustable in Settings) that beep at 0:00

**The spread** (what no other flowing tool has)
- See multiple flows at once — **stack** them (speech columns aligned across
  flows) or lay them **side by side**
- Pick which flows are on the desk; drag to reorder; resize the split

**Power tools**
- **Excel-style ribbon** — font, size, bold/italic, ink color, rows, debate
  marks, view
- **Custom keybinds** — multiple binds per action, conflict warnings; includes
  sheet navigation (prev/next, reorder, hover) and all other actions
- **Macros** — write your own in JavaScript via a `flow` API (e.g. a one-key
  "AT:" answer block); runs as a single undo step
- Range selection (drag-select, copy as TSV, bulk-mark, drag-move blocks)

**Files & formats**
- Two formats: **`.nimbus`** (native, full fidelity) and **`.xlsx`** (Excel).
  Convert between them either way, losslessly — flow in Excel or in Nimbus.
- **Double-click** a `.nimbus` or `.xlsx` file to open it straight into Nimbus
  from Finder or Explorer; **⌘S / Ctrl+S** to save; pick your default save
  format in Settings
- **Save/Open** flows anywhere on your computer; export an HTML round report
- **Excel-style multi-cell paste** — paste TSV content and it distributes
  across the target cells correctly
- Correctly imports Verbatim-exported `.xlsx` files (handles blank leading rows)

**Tournaments = real folders**
- A tournament is an actual folder on your computer. Create one and Nimbus makes
  the folder; **link** any existing folder to use it as a tournament
- Flows live inside as files; **drag a flow between tournaments** to move the
  file on disk — organize in Nimbus or in Finder/Explorer, it's the same files

**The speech doc — CardMirror, inside Nimbus**
- A full CardMirror-schema editor: highlight (spoken), underline (the cut),
  emphasis (boxed power word), condensed (unread) — with lossless `.docx`
  round-trip
- Structure + read-marking shortcuts, **find-in-doc** (`⌘F`), read mode, and
  **standardize highlighting** (unify every highlight, with an optional exception)
- Editable **doc style & headings** — sizes, colors, emphasis/underline/pocket —
  with a live preview
- **Build from the flow — the selection decides where it lands.** Highlight some
  text, one cell, or a whole range and send it **at your cursor**; hit **↕ Send
  Entire Row** to send the whole speech in **flow order** (mirrors the flow,
  de-dupes so re-sending updates rather than duplicates). Typed cells send as
  analytics, cards as cards. Nothing is auto-added.
- **Multiple docs, and a ★ speech doc.** Keep several docs in tabs; mark one as
  your **speech doc** with the star. Press **`` ` `` / `~`** in any other doc to
  send its current card straight to the speech doc — the classic Verbatim/
  CardMirror "send to speech." Each doc keeps its **own undo history** across
  tab switches.
- **Quick Cards** — save any selection as a reusable card and drop it into the
  doc from the Quick Cards palette.
- **CardMirror editing, ported from source** — tag / analytic Backspace, Delete,
  and Enter behave exactly like CardMirror (Enter splits into a new card, Enter
  at a tag's end makes a body, protected tag boundaries), plus cross-boundary
  deletes and node-selection.
- **Docs are per flow** — each flow keeps its own set of speech docs; open a
  flow from years ago and its docs are all still there, none bleed between flows.
- **Drag a `.docx` onto the doc pane** to open it in a new doc.
- Type `---` for an em dash (—); maximize the doc, or pop it out into its own
  window.

**Import `.docx`**
- A 1NC creates off-case sheets; answer docs (AT:/A2…) match your existing flows;
  the target column is guessed from the round. Every doc's cards are banked for
  argument lookup.

**Make it yours**
- Themes (five light, plus **Slate** and Dark), custom aff/neg/analytic/card
  colors, adjustable font/size/row height, and **bundled Lexend + Calibri** fonts
  that work offline
- **Ribbon auto-fits** the window (full → icons → slim → micro) so it stays one
  row on any screen; the density button sets your preferred max verbosity
- **Pinch-to-zoom** the flow and the doc; tabbed Settings; and a built-in
  **📖 Manual** that explains every feature
- Everything auto-saves to disk and survives updates; export/import your full
  settings bundle

## Acknowledgements

Nimbus's entire speech doc **is [CardMirror](https://github.com/ant981228/cardmirror)**,
created by **Anthony Trufanov** — its editor, its `.docx` importer and exporter,
and its document schema are vendored directly into this app. The highlighting
(spoken), underline (the cut), emphasis (boxed power word), the tag/analytic card
structure, and the lossless `.docx` round-trip all behave exactly like CardMirror
because they are CardMirror's own code.

Sincere thanks to Anthony Trufanov for building CardMirror and making it
available. Nimbus would not have a real, trustworthy speech doc without his work —
it is the foundation of the entire feature. CardMirror is used with gratitude
under its **PolyForm Noncommercial** license, and all credit for that engine
belongs to him. If Nimbus is useful to you, please support the original work
first: **[CardMirror by Anthony Trufanov](https://github.com/ant981228/cardmirror)**.

## Planned

Not built yet — this is the roadmap.

- Signed builds (no "unidentified developer" warning)
- Cloud sync / backup across your own devices

Ideas and bug reports are welcome via
[Issues](https://github.com/Asaw2011/nimbus/issues).

## Tech

- **Tauri 2 + SvelteKit (Svelte 5) + TypeScript** — small, fast native shell;
  all app logic in the frontend.
- Rounds and settings are JSON files in the app data dir, written atomically.
- Cross-platform installers are built automatically in GitHub Actions on every
  version tag (macOS universal + Windows x64).

## Development

```sh
npm install
npm run tauri dev   # desktop app (requires the Rust toolchain)
npm run dev         # browser-only dev at localhost:1420
npm run check       # typecheck
```

Cut a release (builds macOS + Windows in the cloud):

```sh
git tag v0.2.0 && git push origin v0.2.0
```

Open the **📖 Manual** in the app for a full feature reference, or press `⌘/`
(Mac) / `Ctrl+/` (Windows) for the keybind list.
