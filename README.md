# Flow

Flowing software for competitive debate (Policy / LD / PF) that combines the
advantages of paper — seeing many flows at once, spatial argument interaction —
with the advantages of a laptop: typing speed, copy/paste, search, and
integration with the rest of the debate tech stack.

Two design pillars, in priority order:

1. **FAST** — keystroke-to-paint in under a frame, every action keybound,
   fully offline/local-first (tournament wifi cannot be trusted), instant load.
2. **SMART** — doc-aware (auto-fill flows from `.docx` speech docs via
   [CardMirror](https://github.com/ant981228/cardmirror)'s API), AI-assisted
   (dropped-arg detection, cross-flow double binds), with a hard Tournament
   Mode toggle that disables all AI/network features.

## Architecture

- **Tauri 2 + Svelte 5 + TypeScript.** Native shell for small binary / low
  RAM; all app logic in the frontend so a pure-web build stays possible.
- **Excel-like grid base** (`src/lib/model/types.ts`): sheets are plain
  row × speech-column grids that already exist like paper — click anywhere and
  type, no structure-creation ceremony. Smart features layer on top without
  changing the base mental model.
- **Template-driven columns** (`src/lib/model/templates.ts`): speech order is
  data, not code — Policy/LD/PF presets are editable and side order is
  flippable (e.g. Con-first PF).
- **Persistence** (`src-tauri/src/lib.rs`): rounds are JSON files in the app
  data dir, written atomically; localStorage fallback when running as a plain
  web page.

## Roadmap

- [x] Phase 0 — core flow engine: keyboard-first grid, smart insertion,
  extension arrows, abbreviation autocomplete, undo/redo, autosave, sheets
- [ ] Phase 1 — the paper spread: tile multiple flows at once, synced speech
  highlighting, cross-flow links, exports/round reports
- [ ] Phase 2 — doc ingestion: CardMirror `fromDocx()` autofill of speech docs
- [ ] Phase 3 — AI: dropped args, double binds, coverage checklists,
  practice-mode transcription auto-flow

## Development

```sh
npm install
npm run tauri dev   # desktop app (requires Rust)
npm run dev         # browser-only dev (localStorage persistence)
npm run check       # typecheck
```

Press `⌘/` in the app for the keybind reference.
