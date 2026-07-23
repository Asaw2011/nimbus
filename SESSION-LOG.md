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

## PENDING — Adam's INTEGRATION-GUIDE.md (in ~/Downloads)
NOT yet applied. 13 changes to fold in (patch file was NOT downloaded, only the
guide, so apply by concept). Checklist:
- [ ] §1 tauri.conf minWidth 900→380, minHeight 600→300
- [ ] §2 editable "insert N rows" (`bulkRows` setting, default 3, clamp 2–50)
- [ ] §3 insert-below cursor lands on first new row (row+1)
- [ ] §4 active sheet tab stands out (0.5 opacity inactive; active bold+tinted)
- [ ] §5 DOCX import: correct sheet splitting (expand OFF container, not Adv---)
- [ ] §6 DOCX import: author extraction + bank-only mode (3 radio modes)
- [ ] §7 two-pass parse (strict cite style, then any-bold fallback)
- [ ] §8 card bank + author autocomplete (⌘Space lookup, bold author in cell)
- [ ] §9 authored cards colored by side (not flat card color)
- [ ] §10 autosave hardening (dirty flag, 5s heartbeat, flush on blur/hide)
- [ ] §11 click to select, click again to edit
- [ ] §12 zoom (⌘±) + off-screen star/scroll cues
- [ ] §13 moving a cell recolors to destination speech
Note: current tree diverged heavily from 0.1.4 (added CardMirror engine + doc
panel), so §5–§8 (parse.ts) need careful semantic reconciliation.
