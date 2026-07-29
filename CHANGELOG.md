# Changelog

## v0.2.7

### Flow → doc, rebuilt to just work
- **Send cell = clean paste at your cursor.** It drops the card/block right where
  your cursor is in the doc, on its own line, as one intact chunk — and touches
  nothing else. No scattering, no re-parenting the content below, no stray blank
  lines. (Cursor defaults to the end of the doc when it opens, so an un-placed
  send appends to the bottom.)
- **Blocks send exactly what's on the flow.** A block now sends its heading plus
  the items it actually shows on the grid — not the original imported copy — so
  items you deleted or edited don't come back, and nothing lands out of order.
- **Send Entire Row** appends the whole speech in flow order to the bottom,
  de-duped.

### Doc editing
- **Styles/highlights apply to what you selected.** Toolbar and ribbon style
  buttons no longer steal your selection on click, so a highlight lands on the
  text you highlighted — not the line above or below.
- **Backspace at the start of a Hat/Pocket/Block turns it into body text.**

### Flowing
- **⌘↑ / ⌘↓ jump to the filled cell above / below** in your column (Excel-style
  "jump to the data") — for grabbing context from a nearby cell. Rebindable.

### Fixed
- **The screen no longer bounces.** The ribbon's auto-fit could flip between
  sizes forever (a resize feedback loop), shoving the whole layout up and down.

## v0.2.6

### Flow → doc sends, fixed (this was badly broken)
- **No more scrambling.** Sending a whole speech used to rebuild the entire
  document and sort every block by flow position — which interleaved separate
  speeches together into gibberish. That's gone: sends now **append to the end
  of the doc, in order**, and never touch what you've already written.
- **Sends land predictably.** Cards used to drop at the doc's (often stale)
  cursor, mid-document, scattering them everywhere. Every send now goes to the
  bottom of the doc in order.
- **Focus stays on the flow.** The doc no longer steals the keyboard after a
  send, so you can send card after card and keep flowing (your next keystroke
  won't land in the doc).
- **Editing the doc is stable again.** The editor is no longer built while the
  pane is hidden — a hidden editor has no layout, so clicks and typing landed in
  the wrong place ("everything goes everywhere"). It's built when first shown.
- Re-sending a whole speech still de-dupes (updates in place, no duplicates).

> If a doc got scrambled by an earlier version, this won't un-scramble it —
> clear that doc (or start a fresh one) and re-send.

## v0.2.5

### Argument bank (⌘J) — scroll the whole thing
- **The lookup was capped at 12 results**, so a big imported doc's cards were cut
  off and you couldn't reach most of them. The cap is **gone** — ⌘J now lists
  your entire bank, however large.
- **You can actually scroll it now.** Arrowing through the list keeps the
  highlighted match in view, the mouse wheel scrolls the list (not the grid
  behind it), and the dropdown **flips above the cell** when it would otherwise
  open off the bottom of the screen.

### Under the hood
- The release workflow now **publishes automatically** and marks the build as
  the latest release, so updates go live without a manual step.

## v0.2.4

### Fixed — auto-update actually works now
- **The updater could never check for updates.** The app's capability file was
  missing the `updater` and `process` permission grants, so every update check
  was blocked by Tauri and silently treated as "no update available" — on both
  macOS and Windows. Granted the permissions.
- Because the fix has to ship *inside* a build, **install 0.2.4 by hand once**
  (download below). From 0.2.4 forward, the in-app **Update available → Install →
  Restart** flow works automatically.
- The update check now **logs failures** instead of swallowing them, so a
  blocked permission or bad manifest can't masquerade as "up to date" again.

## v0.2.3

### Fixed — doc data loss (again, for good)
- **Closing the speech doc no longer wipes it.** The doc pane used to *unmount*
  the editor on close and rebuild it on reopen from a stored copy that could be
  stale — so a send/edit/delete right before closing vanished. The editor now
  **stays mounted and is just hidden**, so there's nothing to rebuild and nothing
  to lose.
- **Quick cards keep their body.** Dropping a saved quick card into the doc used
  to insert the tag but silently drop the card's body (ProseMirror merged the
  block into the cursor's line and discarded what didn't fit). Whole-block cards
  now insert as their own block, body intact.

### New — round result (RFD)
- **RFD panel on a round's home** — record how the round came out: **one ballot
  per judge** (panels supported) with an **AFF/NEG vote**, **reason for
  decision**, **feedback**, and **speaker points**, plus round notes. An
  auto-computed result badge (e.g. *"AFF (school) wins 2–1"*) summarizes the
  ballots. It all saves with the flow.

## v0.2.2

- **Auto-update signing fixed.** 0.2.1's `latest.json` shipped unsigned (the
  bundle was missing `createUpdaterArtifacts`, so the `.sig` files were never
  uploaded). Enabled updater artifacts and made the release manifest fail if a
  signature is missing. **0.2.2 is the first build whose updates actually verify
  and install** — send people this one.

## v0.2.1

- **Automatic updates are live.** Nimbus now checks for a new version on launch
  and shows an in-app **Update available → Install → Restart** banner (also a
  manual check in Settings) — no more visiting GitHub. Signed builds for macOS
  and Windows. (Auto-update works from this version forward.)

## v0.2.0

### Flow → doc sends (all on the backtick)
- **`` ` `` sends the cell**, **`⌘`` ` `` `` sends the whole speech** (flow order),
  **`⌘⌫` clears the cell + pulls its card out of the doc**. Keyboard versions of
  the ribbon's Send cell / Send Entire Row / Remove buttons.
- **"AT: `<argument>`" auto-header** — sending a hand-typed answer cell labels the
  analytic with the argument it answers (the cell to its left).

### Argument grouping (reworked)
- Much more **visible**: grouped cells get a tinted background and a bold brace
  down the **right** edge (opening toward the answer column), with a label pill
  tucked out of the text.
- **One key for sequential and non-sequential** — drag-select a range, or
  **⌘-click** cells (1, 4, 6), then **⌘R**. The cell you're on counts too.
- A quick hint appears if you try to group fewer than two cells in a column.

### Keybinds — logical defaults
- Marks moved **off the copy/paste/save family**: Dropped `⌘D`, Star `⌘⇧8`,
  Analytic `⌘⇧A`, Card `⌘⇧E`.
- **Extend = `⌘→`**, **Group = `⌘R`** — distinct, memorable keys (no more
  `⌘G`/`⌘⇧G` confusion). Sheet move is `⌘⇧[` / `⌘⇧]`.
- All rebindable in Settings.

### Doc & import
- **Keyboard zoom** in the doc (`⌘=` / `⌘-` / `⌘⇧0`) — always works.
- **⌘F + Enter** reliably scrolls to the match.
- **1NC import splits by the Block heading** (one page per off-case), not by
  pockets/hats or per card; long taglines stay Untitled and don't duplicate.

## v0.1.9

### Flowing
- **Group arguments** — bracket several arguments to answer them together, like
  drawing a brace on paper. Select a range and press **⦃ Group** (ribbon) or
  **⌘⇧G**; for a **non-sequential** group (1, 4, 6) **⌘-click** the cells first,
  then group. Renders as a labeled brace down the left edge; **Ungroup** removes it.
- **Cursor → speech now centers every flow.** Jumping the cursor to a speech
  (ribbon **Cursor** dropdown or a Home chip) scrolls **all** visible flows so
  that column is centered with its neighbors — in normal, stack, and split
  views — and stays in the spread instead of collapsing to one flow.
- **Fixed 1AC (and other dead columns).** Jumping to a speech whose column is
  absent on the current sheet (e.g. 1AC on an off-case) now orients to the edge
  instead of doing nothing.
- **Separate Stack / Split keybinds** — **⌘B** = Stack, **⌘⇧B** = Split (each
  rebindable), instead of one key that only reopened the last mode.

### Ribbon
- **Auto-fits the window** — measures its width and compacts (full → icons →
  slim → micro) so it fits one row on any screen, re-fitting on resize. No more
  horizontal scrolling.
- Cursor → speech moved into a compact **Cursor** group.

### Speech doc & quick cards
- **Quick cards drop onto the flow** — the panel is non-modal now, so dragging a
  card onto a cell works (the old backdrop swallowed the drop); click still drops
  into the current cell.
- **Quick-card tag style is preserved** — capturing a selection grabs whole
  blocks, so a saved tag re-inserts as a tag every time (was intermittent).
- **Uploading a doc splits pages by block/off-case**, never one page per card.

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
