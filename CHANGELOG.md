# Changelog

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
