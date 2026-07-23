# Session log — 2026-07-22

Work done this session, most recent first. All code changes are on disk and
committed to git (branch `main`).

## Done & committed

### Read mode: fixed empty boxes + large gaps (the big one)
Root causes found by dumping the ACTUAL marks off the user's exported speech
docs (`~/Desktop/[S]1AR.docx`, `Speech.docx`) via `fromDocx`:
- The read-aloud text is `highlight` runs (e.g. `highlight(lightGray)` /
  `highlight(cyan)`). Cut text = `underline_mark`; condensed filler =
  `font_size`; boxed power words = `emphasis_mark` (often also highlighted).
- **Empty boxes** = whitespace-only runs carrying `emphasis_mark`/`underline`
  (a boxed/underlined space). Now hidden in read mode; also stripped on insert.
- **Stale `!important` CSS** (`cardmirror.css` old `.pmd-emphasis` block with
  `border … !important`) forced the box ON everywhere — defeating both read
  mode and the Settings "Emphasis: boxed" toggle. DELETED. The modular
  `.pmd-emphasis-box`-gated block now governs.
- **Large gap (transitioning → 1%)** = fully-hidden `card_body` nodes each
  render `::after { content:" "; white-space:pre }`; `pre` spaces don't
  collapse, so several stacked = one big gap. Fix: read-mode plugin now marks a
  body with zero shown runs as a `display:none` node decoration.
- **Excess spacing generally**: plugin was inserting a separator space after
  EVERY hidden run. Rewrote to insert ONE space per hidden *group*.

Files: `src/lib/doc/readMode.ts`, `src/lib/doc/SpeechDoc.svelte`
(`stripBlankRunMarks` on `appendCMNodes`), `src/lib/cardmirror/cardmirror.css`.

### Doc panel + spread view coexist
`FlowView.svelte`: the speech doc pane was gated behind `!spread`, so opening
Split/Split-Horizontal hid it. Removed the exclusion — flow-pane (flex:1) holds
the spread, doc-pane docks on the right. Now you can flow multiple off-cases
AND have the doc open.

### Doubled outline entries fixed
`SpeechDoc.svelte` `rebuildOutline`: `analytic_unit` (wrapper) AND its child
`analytic` heading are both level-4, so each analytic pushed two outline items.
Now `analytic_unit` is handled like `card` — read the inner heading's label once
and stop descending.

## Adam's INTEGRATION-GUIDE.md — progress (applied by concept; patch not present)
- [x] §1 tauri.conf minWidth 380, minHeight 300
- [x] §2 editable bulkRows (2–50, default 3) + actionLabel + Settings field
- [x] §3 insert-below cursor lands on first new row (row+1)
- [x] §4 active sheet tab stands out (inactive 0.5 opacity; active bold+tinted+bar)
- [x] §5 DOCX import: positionSections expands OFF containers; cleanSectionTitle;
      sectionTitles number generic offs. Verified: 1NC OFF → N sheets not 1.
- [x] §6 DOCX import: author extraction + 3 modes (pages+tags / pages / bank-only)
- [x] §7 (folded into §6): normalizeAuthor + collectCards author extraction
- [x] §8 card bank + author autocomplete (⌘Space lookup, bold author in cell)
- [x] §9 authored cards keep side color (setCellWithAuthor no forced card ink)
- [x] §10 autosave hardening (dirty flag, 5s heartbeat, flush on blur/hide)
- [x] §11 click to select, click again to edit
- [x] §12 zoom (⌘± / ⌘⇧0 + ribbon − 100% +) AND off-screen star/scroll cues
- [x] §13 moving a cell recolors to destination speech

ALL 13 SECTIONS APPLIED. Notes:
- ⌘Space (author lookup) may collide with macOS Spotlight; rebind in Settings →
  Keybinds if it doesn't fire.
- §7's "two-pass strict-then-bold" cite detection was simplified: collectCards
  uses the existing cite-run detection (Style13ptBold / Cite). Good enough for
  the current parser; can add the bold-only fallback pass later if a doc has no
  cite style at all.
