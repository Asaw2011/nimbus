<div align="center">
  <img src="static/logo.png" width="96" alt="Nimbus logo" />
  <h1>Nimbus</h1>
  <p><strong>Fast, smart flowing for competitive debate</strong> — Policy · LD · PF</p>
</div>

Nimbus is a desktop flowing app that combines the strengths of paper — seeing
many flows at once, spatial argument interaction — with the strengths of a
laptop: typing speed, copy/paste, search, and integration with the rest of the
debate tech stack.

Two design pillars, in priority order:

1. **FAST** — every action is keybound, the app is local-first and works fully
   offline (tournament wifi can't be trusted), and it loads instantly.
2. **SMART** — doc-aware today (import `.docx` speech docs), AI-assisted soon
   (see [Planned](#planned)).

> **Status:** Nimbus is usable today for real rounds. The **AI features are not
> built yet** — everything under [Planned](#planned) is a roadmap, not a
> shipped feature.

## Download

Grab the latest installer from the
[**Releases**](https://github.com/Asaw2011/nimbus/releases) page:

- **macOS** — `Nimbus_0.1.4_universal.dmg` (Intel + Apple Silicon)
- **Windows** — `Nimbus_0.1.4_x64-setup.exe`

Builds are currently unsigned, so first launch shows a security warning:
- macOS: right-click the app → **Open**
- Windows: **More info → Run anyway**

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

**Scouting & opponent research**
- **Scouting hub** — track opposing teams organized as
  School → Team → Tournament → Round
- Upload their `.docx` speech docs per round alongside your own answers and
  round notes; every block stays attached to the speech it came from
- Flows auto-link to the matching team by code (e.g. `Greenhill LL`) — no
  manual attaching; tournament folders from the main dashboard surface in
  scouting automatically

**The speech doc — CardMirror, inside Nimbus**
- A full CardMirror-schema editor: highlight (spoken), underline (the cut),
  emphasis (boxed power word), condensed (unread) — with lossless `.docx`
  round-trip
- Structure + read-marking shortcuts, **find-in-doc** (`⌘F`), read mode, and
  **standardize highlighting** (unify every highlight, with an optional exception)
- Editable **doc style & headings** — sizes, colors, emphasis/underline/pocket —
  with a live preview
- **Send to Doc / Cell → Doc** — build your speech from the flow, always in flow
  order; typed cells send as analytics, cards as cards. Nothing is auto-added.
- Maximize it, or pop it out into its own window

**Import `.docx`**
- A 1NC creates off-case sheets; answer docs (AT:/A2…) match your existing flows;
  the target column is guessed from the round. Every doc's cards are banked for
  argument lookup.

**Make it yours**
- Themes (five light + dark), custom aff/neg/analytic/card colors, adjustable
  font/size/row height, and **bundled Lexend + Calibri** fonts that work offline
- **Pinch-to-zoom** the flow and the doc; tabbed Settings; and a built-in
  **📖 Manual** that explains every feature
- Everything auto-saves to disk and survives updates; export/import your full
  settings bundle

## Planned

Not built yet — this is the roadmap.

- **AI layer** (the "smart" half), all optional and with a hard **Tournament
  Mode** off-switch that disables every AI/network feature for rules compliance:
  - Row-level argument alignment — line up 2AC answers with the 1NC arguments
    they respond to, as a suggestion you accept or reject
  - Dropped-argument detection — flag arguments with no response before your
    next speech
  - Next-speech coverage checklist
  - Cross-flow analysis — double binds and contradictions between positions
- Practice mode: live speech transcription that auto-flows
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
git tag v0.1.5 && git push origin v0.1.5
```

Open the **📖 Manual** in the app for a full feature reference, or press `⌘/`
(Mac) / `Ctrl+/` (Windows) for the keybind list.
