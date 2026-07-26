# Changelog

## v0.1.8

### Flowing
- **Timer** (new **Timer** button, top bar) — a draggable floating timer with a
  count-up **stopwatch** and **five countdown presets** (Constructive / Rebuttal
  / CX / Prep / 1 min by default). It flashes and beeps at 0:00. All five presets
  are editable in **Settings → Timer presets** (label + `m:ss`).
- **Cursor → speech** lives in the ribbon now (compact **Cursor** group). Pick a
  speech and your cursor jumps to the **top** of that column — and stays on that
  column as you switch flows. Same from the Home-screen speech chips.
- **Move-cursor lands on the top of the column** (row 0), from the ribbon
  dropdown and the Home screen.

### Settings
- **Main event** (Policy / LD / PF) — new rounds default their template to your
  event, so the first option isn't a different event.

## v0.1.7

### Fixed — data loss (critical)
- **Speech docs no longer lose content.** Config blobs whose names contain a
  colon (`doc:<id>`, `docs-list:<round>`) were silently rejected by the disk
  writer, so doc content lived only in the size-limited localStorage cache and
  got evicted after a few image-heavy `.docx` uploads. Blob names are now
  sanitized to a filesystem-safe form and persist to disk. An in-memory
  "known non-empty" guard also refuses to overwrite real content with an empty
  doc from a transient/teardown state.
- **Pop-out docs dock back reliably.** Pop-out windows (`speech-doc-*`) were
  missing the capability grant to emit events / close themselves, so "Dock back"
  did nothing. Fixed the capability glob; both dock paths now hand content over
  cleanly (with a disk fallback).
- **`⌘Z` on the flow works** — a focused cell now repaints on undo/redo instead
  of keeping the stale text on screen.

### Speech doc
- **Save / Save As** to `.docx` (`⌘S` / `⌘⇧S`). Save writes back to the doc's
  bound file silently; Save As picks a new one and remembers it.
- **Word count + read-time estimate** in the toolbar. Set your pace in
  **Settings → words per minute** and the doc shows how long its text takes to
  read aloud (e.g. `600 words · ~2:00` at 300 wpm).
- **Uploading a `.docx` now banks its cards and analytics** into the argument
  bank (⌘J lookup + Bank manager), not just the editor.
- Opening a doc lands at its **top**; switching back to a doc keeps your exact
  **scroll position**. Drag-reorder the doc tabs.
- `---` stays literal (no more broken em-dash glyph; debate tags use `---`).

### Flowing
- **Argument bank manager** (new **Bank** button) — view, edit, add, and remove
  banked cards/analytics.
- **Paired line-by-line responses.** "respond →" on a card cell creates one
  answer box per card in the next speech column, each aligned to the card it
  answers and **growing as you type** (the row expands, keeping everything
  aligned).
- **Paste into a LABEL cell** works (single-line, reliable in WebView).
- Cleaner **top bar** — labeled buttons (Doc · Quick cards · Bank · Manual ·
  Settings · Keybinds) instead of icons; the ribbon spans full width above the
  flow↔doc split.

### Search & performance
- **More accurate file search** — every query token must match (AND), so
  "cap k" no longer surfaces every file containing "k".
- **⌘K stays open** in the doc so you can insert several cards in a row (✕ /
  Esc to close); large docs skip the localStorage cache to keep saves fast.

## v0.1.6

### Speech doc
- **CardMirror editing, ported from source** (`ant981228/cardmirror`). Tag /
  analytic **Backspace, Delete, and Enter** now behave exactly like CardMirror:
  Enter in a tag splits into a new card, Enter at a tag's end makes a body,
  protected tag boundaries, empty-container cleanup, first-body-slot backspace,
  and cross-boundary deletes with node-selection (`tag-keymap.ts`,
  `boundary-cursor-keymap.ts`).
- **Docs are now per flow.** Each flow keeps its own set of speech docs, saved
  per round — reopen an old flow and its docs are all there; none bleed between
  flows.
- **Tilde sends the whole section** — `` ` `` / `~` on a Hat sends the whole
  hat, on a Block the whole block, on a single card just that card.
- **Self-healing on a corrupt node.** A malformed node can no longer freeze the
  editor: inserts are sanitized/validated, and if one slips in the doc reverts
  to its last good state so editing keeps working.
- Per-doc **undo history survives tab switches**; explicit ⌘Z owns the doc.
- **★ speech doc** designation on a tab; send from any doc to it.
- **Drag a `.docx` onto the doc pane** to open it; outline clicks scroll the
  heading to the **top**; `---` becomes an em dash (—).

### Flowing
- **New pages open blank on their LABEL cell** — pick a kind (Off-case /
  Advantage / Overview / CX) and name it on the grid, no naming dialog.
- **Jump to a speech** from a round's home — one click parks your cursor on that
  speech's column (2AC, 1AR, …) across every flow.
- **"Space down"** keybind (default `⌘\`, count set in Settings) moves the cursor
  down N rows to leave room for answers — without inserting rows.
- **Analytic / card cells** use a colored left-edge bar instead of recolored
  text; the star bar moves right when combined.
- **Delete** on a selection clears imported block contents (cards/responses),
  not just the header. Dragging a block from ⌘K now builds visible, editable
  items (collapsed by default).

### Send to doc
- The **selection decides the mode**: a highlight, one cell, or a range → **at
  the cursor**; **↕ Send Entire Row** → **flow order** (mirrors the flow,
  de-dupes). Multi-cell send added; the old flow/cursor toggle is gone.

### Search & import
- **Relevance-ranked** ⌘K content search (exact / whole-word / filename matches
  rank higher); analytics show a gold **ANL** chip, not a green CARD chip.
- **Author bank fills after import** — the ⌘J lookup is no longer empty
  post-import; Enter inserts the author, Tab inserts author + tag.

### Appearance & platform
- New **Slate** theme; dark-mode speech-doc text is readable (fixed invalid
  `:global()` CSS that dropped every dark rule).
- **Ribbon density** — cycle full / icons / slim.
- **Windows-accurate keybind labels** (`Ctrl+Shift+Enter` on Win/Linux, compact
  `⌘⇧↵` on Mac).

### Stability
- Uncaught errors are logged to disk and surfaced with a toast; the grid's
  reactive effects are guarded so a stray throw can't freeze the UI.
- Merged the Windows build fix (`RunEvent::Opened` gated to macOS).

## v0.1.5
- Multi-flow spread view, speech doc, docx import, tournaments-as-folders,
  macros, custom keybinds, `.nimbus`/`.xlsx` formats. Windows + macOS installers.
