<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { toggleMark, setBlockType, baseKeymap, chainCommands } from "prosemirror-commands";
  // CardMirror's authoritative tag/analytic boundary editing (ported from
  // ant981228/cardmirror src/editor/tag-keymap.ts) — Backspace/Delete/Enter.
  import {
    backspaceAtTagStart, deleteAtTagEnd, backspaceAtFirstBodyStart,
    deleteAtContainerEnd, enterMidTag, enterAtTagEnd, enterInHeading,
  } from "$lib/cardmirror/editor/tag-keymap";
  import {
    keepCursorInLeadingBlockOnBlockedMerge, blockBackspaceNodeSelect, blockDeleteNodeSelect,
  } from "$lib/cardmirror/editor/boundary-cursor-keymap";
  // Core editing normalizer (ARCHITECTURE §14.3): a paragraph typed right after
  // a card is auto-absorbed into it as a card_body, so bodies stay bound to
  // their card instead of clumping loose at doc level. A heading breaks the zone.
  import { absorbPlugin } from "$lib/cardmirror/editor/absorb-plugin";
  import { keymap } from "prosemirror-keymap";
  import { history, undo, redo } from "prosemirror-history";
  import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
  import type { DocNode } from "$lib/docx/parse";
  import { cardmirrorSchema as schema, nodesFromDocNode } from "$lib/cardmirror/adapter";
  import { readModePlugin, readModeKey } from "./readMode";
  import { searchPlugin, searchKey } from "./docSearch";
  import { settings } from "$lib/model/settings.svelte";
  import { store } from "$lib/model/round.svelte";
  import { matchesAny, comboLabel, type ActionId } from "$lib/model/keymap";
  import { pinchZoom } from "$lib/util/pinch";
  import QuickCards from "./QuickCards.svelte";
  import "$lib/cardmirror/cardmirror.css";

  let {
    onchange = null,
    initialDoc = null,
    docId = null,
    docName = "",
    onpopout = null,
    onexpand = null,
    expanded = false,
    poppedOut = false,
    onTilde = null,
    onTildeCursor = null,
  }: {
    onchange?: (() => void) | null;
    initialDoc?: unknown;
    /** Identifies which doc is loaded. When it changes, the editor swaps to that
     *  doc's cached state (preserving its undo history) instead of remounting. */
    docId?: string | null;
    /** The doc's display name — used for Export / Send filenames. */
    docName?: string;
    onpopout?: (() => void) | null;
    onexpand?: (() => void) | null;
    expanded?: boolean;
    poppedOut?: boolean;
    /** When set, pressing ` / ~ sends the current card/selection here (used by
     *  source docs to "send to speech"). Fixed key — not rebindable. */
    onTilde?: ((cmNodes: unknown[]) => void) | null;
    /** Like onTilde, but sends to the speech doc AT ITS CURSOR rather than the
     *  end. Bound to the rebindable `sendToSpeechCursor` action. */
    onTildeCursor?: ((cmNodes: unknown[]) => void) | null;
  } = $props();

  // Shared by the pinch action and the Ctrl +/-/0 keyboard fallback so both
  // drive the doc's zoom identically.
  const docZoomOpts = {
    get: () => settings.docZoom,
    set: (z: number) => settings.setDocZoomLive(z),
    commit: () => settings.save(),
  };

  let mountEl = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let mounted = false;
  // Ticks on every transaction so toolbar active-states recompute on cursor move.
  let selTick = $state(0);

  // ── Heading outline (collapsible nav tree, like CardMirror) ──────
  /** `key` is the heading's stable UUID (`id` attr — see schema/ids.ts), NOT its
   *  document position: positions shift on every keystroke, so a collapse set
   *  keyed by them came apart the moment you typed above a collapsed heading and
   *  the whole tree sprang open. `pos` is still carried for scroll-to. */
  interface OutlineItem { key: string; pos: number; level: number; text: string; }
  let outline = $state<OutlineItem[]>([]);
  let showOutline = $state(true);
  let collapsedOutline = $state<Set<string>>(new Set());

  // Visible outline honouring collapsed ancestors, with a hasKids flag.
  const visibleOutline = $derived.by(() => {
    const res: (OutlineItem & { hasKids: boolean })[] = [];
    let hideLevel = Infinity;
    outline.forEach((it, i) => {
      if (it.level > hideLevel) return; // hidden under a collapsed ancestor
      hideLevel = Infinity;
      const next = outline[i + 1];
      const hasKids = !!next && next.level > it.level;
      res.push({ ...it, hasKids });
      if (collapsedOutline.has(it.key)) hideLevel = it.level;
    });
    return res;
  });

  function toggleOutline(key: string) {
    const next = new Set(collapsedOutline);
    if (next.has(key)) next.delete(key); else next.add(key);
    collapsedOutline = next;
  }

  // ── Resizable outline rail ───────────────────────────────────────
  // The nav width is user-draggable and remembered, so the page (the actual
  // paper) gets exactly as much room as you want. Clamped so it can go quite
  // slim without vanishing, and can't swallow the page.
  const OUTLINE_MIN = 84;
  const OUTLINE_MAX = 340;
  function loadOutlineWidth(): number {
    const saved = Number(
      typeof localStorage !== "undefined" ? localStorage.getItem("doc.outlineWidth") : "",
    );
    return saved >= OUTLINE_MIN && saved <= OUTLINE_MAX ? saved : 140;
  }
  let outlineWidth = $state(loadOutlineWidth());
  let outlineEl = $state<HTMLElement>();
  let resizingOutline = $state(false);
  function startOutlineResize(e: PointerEvent) {
    resizingOutline = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onOutlineResizeMove(e: PointerEvent) {
    if (!resizingOutline || !outlineEl) return;
    const left = outlineEl.getBoundingClientRect().left;
    outlineWidth = Math.min(OUTLINE_MAX, Math.max(OUTLINE_MIN, e.clientX - left));
  }
  function stopOutlineResize() {
    if (!resizingOutline) return;
    resizingOutline = false;
    if (typeof localStorage !== "undefined")
      localStorage.setItem("doc.outlineWidth", String(Math.round(outlineWidth)));
  }
  /** Level the outline is collapsed to when a document opens: Hat. A real file
   *  has hundreds of blocks and cards, and a fully expanded tree (the old
   *  default) is unreadable — pockets + hats is what you actually navigate by.
   *  Applied on open only, so it never re-collapses what you expand while working. */
  const OUTLINE_OPEN_LEVEL = 2;

  // Collapse the whole outline to a given level (Pocket=1 / Hat=2 / Block=3).
  function collapseOutlineTo(level: number) {
    const next = new Set<string>();
    outline.forEach((it, i) => {
      const child = outline[i + 1];
      if (it.level >= level && child && child.level > it.level) next.add(it.key);
    });
    collapsedOutline = next;
  }
  const HEADING_LEVEL: Record<string, number> = {
    pocket: 1, hat: 2, block: 3, card: 4, tag: 4, analytic: 4, analytic_unit: 4,
  };

  // The outline only feeds the sidebar, so it can lag typing slightly. Coalesce
  // bursts of keystrokes into one rebuild instead of walking the whole doc each.
  let outlineTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleOutline() {
    if (outlineTimer) clearTimeout(outlineTimer);
    outlineTimer = setTimeout(rebuildOutline, 200);
  }

  function rebuildOutline() {
    if (outlineTimer) { clearTimeout(outlineTimer); outlineTimer = null; }
    if (!view) return;
    const items: OutlineItem[] = [];
    // Heading nodes carry a UUID `id` attr that survives edits; fall back to the
    // position only if one is somehow missing, so a null id can never collapse
    // several headings under one shared key.
    const keyOf = (node: PMNode, pos: number) =>
      (node.attrs?.id as string | null) ?? `@${pos}`;
    view.state.doc.descendants((node, pos) => {
      const lvl = HEADING_LEVEL[node.type.name];
      if (lvl !== undefined) {
        // A card / analytic_unit is a wrapper whose first child is the heading
        // (tag / analytic). Use that child's text and DON'T descend — otherwise
        // the inner heading (also level 4) would push a second, doubled item.
        if (node.type.name === "card" || node.type.name === "analytic_unit") {
          const head = node.firstChild;
          const text = head ? head.textContent.trim() : "";
          // Skip still-empty headings — don't clutter the outline with
          // "(untitled)" the instant you make a tag/analytic. It appears once
          // you type its text. The id lives on the head (tag/analytic), not the
          // wrapper, so key off that.
          if (text) items.push({ key: keyOf(head!, pos), pos, level: lvl, text });
          return false;
        }
        const text = node.textContent.trim();
        if (text) items.push({ key: keyOf(node, pos), pos, level: lvl, text });
      }
      return undefined;
    });
    outline = items;
    spokenWords = countSpokenWords(view.state.doc);
  }

  // ── read-time estimate (words read aloud ÷ each reader's wpm) ──────
  let spokenWords = $state(0);

  /** Words that get read aloud: all text inside tag/analytic headings, plus any
   *  highlighted (or shaded) text anywhere. Mirrors CardMirror's read-time basis
   *  (tags + analytics + highlights). */
  function countSpokenWords(doc: PMNode): number {
    let words = 0;
    // Counted by hand instead of `s.trim().match(/\S+/g).length` — that built a
    // trimmed copy AND an array of every word for each text node in the doc,
    // and this walks the whole document on each rebuild.
    const wc = (s: string) => {
      let n = 0;
      let inWord = false;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        // Same set /\S/ treats as space, for the characters that actually turn
        // up in .docx text: ASCII whitespace plus NBSP and friends.
        const ws = c <= 32 || c === 0xa0 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 ||
          c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
        if (!ws && !inWord) n++;
        inWord = !ws;
      }
      return n;
    };
    const walk = (node: PMNode, spoken: boolean) => {
      const name = node.type.name;
      const inSpoken = spoken || name === "tag" || name === "analytic";
      if (node.isText) {
        const hl =
          inSpoken ||
          node.marks.some((m) => m.type.name === "highlight" || m.type.name === "shading");
        if (hl) words += wc(node.text ?? "");
        return;
      }
      node.forEach((child) => walk(child, inSpoken));
    };
    doc.forEach((n) => walk(n, false));
    return words;
  }

  /** "42:30" from a word count and a words-per-minute pace. */
  function readTime(words: number, wpm: number): string {
    const secs = wpm > 0 ? Math.round((words / wpm) * 60) : 0;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function scrollToPos(pos: number) {
    if (!view) return;
    const { state } = view;
    // Stale entry (doc shrank/changed out from under the outline) → resync the
    // outline so it stops listing things that aren't in the doc anymore.
    if (pos >= state.doc.content.size) { rebuildOutline(); return; }
    const clamped = Math.min(pos + 1, state.doc.content.size);
    try {
      const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(clamped)));
      // Don't use PM's scrollIntoView — its minimal scroll lands the target at
      // the BOTTOM edge. Instead scroll the heading to the TOP of the pane, the
      // way CardMirror's outline jumps work.
      view.dispatch(tr);
      view.focus();
      requestAnimationFrame(() => {
        if (!view) return;
        try {
          const dom = view.domAtPos(clamped).node;
          const el = (dom.nodeType === 3 ? dom.parentElement : dom) as HTMLElement | null;
          el?.scrollIntoView({ block: "start", inline: "nearest" });
        } catch { /* non-fatal — selection already moved */ }
      });
    } catch { rebuildOutline(); }
  }
  let applyingExternal = false;

  // Per-doc EditorState cache so switching tabs and coming back keeps that doc's
  // full undo history — remounting the editor would throw the history away.
  // Capped: each entry holds a whole document PLUS its undo stack, so an
  // unbounded map meant memory grew for every doc opened all tournament.
  const STATE_CACHE_MAX = 8;
  const stateCache = new Map<string, EditorState>();
  let currentDocId: string | null = null;

  /** Cache a doc's state, evicting the least-recently-used (never the open one). */
  function cacheState(id: string, state: EditorState) {
    stateCache.delete(id);
    stateCache.set(id, state);
    for (const key of stateCache.keys()) {
      if (stateCache.size <= STATE_CACHE_MAX) break;
      if (key !== currentDocId && key !== id) stateCache.delete(key);
    }
  }

  /** Build a fresh EditorState (with its own history) from doc JSON. */
  function buildState(json: unknown): EditorState {
    const doc = json
      ? (() => {
          try { return schema.nodeFromJSON(json); } catch { return undefined; }
        })()
      : undefined;
    return EditorState.create({
      schema,
      doc,
      plugins: [
        absorbPlugin,
        readModePlugin(),
        searchPlugin(),
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        // Backspace on an EMPTY heading/tag actually removes it (base Backspace
        // leaves empty pockets/hats/blocks/tags stuck as un-deletable boxes).
        // CardMirror's tag/analytic boundary rules (Backspace/Delete/Enter),
        // ported verbatim from ant981228/cardmirror so the doc EDITS exactly
        // like CardMirror, not just looks like it. Each command returns false
        // for cases it doesn't own, so the chain falls through to the next rule
        // and finally to baseKeymap.
        //
        // Order matters and is deliberate:
        //   backspaceEmptyBlock    — ours, first: an EMPTY heading/tag is removed
        //                            outright rather than converted. It bails on
        //                            `content.size !== 0`, so it never competes
        //                            with the two rules below.
        //   backspaceHeadingToBody — ours: start of a NON-empty pocket/hat/block
        //                            becomes body text.
        //   then CardMirror's tag rules, which own tags *inside* cards.
        keymap({
          Backspace: chainCommands(
            backspaceEmptyBlock,
            backspaceHeadingToBody,
            backspaceAtTagStart,
            backspaceAtFirstBodyStart,
            keepCursorInLeadingBlockOnBlockedMerge,
            blockBackspaceNodeSelect,
          ),
          Delete: chainCommands(
            backspaceEmptyBlock,
            deleteAtTagEnd,
            deleteAtContainerEnd,
            keepCursorInLeadingBlockOnBlockedMerge,
            blockDeleteNodeSelect,
          ),
          Enter: chainCommands(enterMidTag, enterAtTagEnd, enterInHeading),
        }),
        keymap(baseKeymap),
      ],
    });
  }

  $effect(() => {
    if (!mountEl || mounted) return;
    mounted = true;

    const state = buildState(initialDoc);
    currentDocId = docId;
    if (docId) cacheState(docId, state);

    view = new EditorView(mountEl, {
      state,
      // All doc shortcuts route through settings.keymap (configurable in
      // Settings → keybinds → "Speech doc"), read live so rebinds take effect
      // immediately. Runs before the base keymap so it can override ⌘←/⌘↑/etc.
      handleKeyDown: (_v, e) => docKeydown(e),
      // NOTE: no "---" → em dash conversion here (removed deliberately). "---"
      // is the Verbatim separator debate docs are written in — 1NC---K,
      // OFF---PTX, Adv---Costs — and our own importer keys off it
      // (cleanSectionTitle / isOffContainer in docx/parse.ts). Auto-converting
      // it fought the convention and stopped a typed tag from round-tripping
      // back through import. The grid's oninput drops it for the same reason.
      // Focusing the doc claims it as the active surface, so the flow ribbon's
      // text controls (B / I / color / size) act on the doc.
      handleDOMEvents: {
        focus: () => { store.activeSurface = "doc"; syncDocSelSize(); return false; },
      },
      dispatchTransaction(tr: Transaction) {
        if (!view) return;
        view.updateState(view.state.apply(tr));
        // Bump so toolbar active-states (which read view.state) re-render as the
        // cursor/selection moves.
        selTick++;
        if (tr.selectionSet || tr.docChanged) syncDocSelSize();
        if (tr.docChanged) {
          // Both were running on EVERY keystroke and walking / serializing the
          // whole doc — the lag on big docs. The outline rebuild is now
          // debounced, and the parent serializes lazily inside its own save
          // debounce (onchange is just a "something changed" ping).
          scheduleOutline();
          if (!applyingExternal) onchange?.();
        }
      },
    });
    rebuildOutline();
    collapseOutlineTo(OUTLINE_OPEN_LEVEL);
    view.focus();
  });

  // Switching tabs changes docId. Swap the editor to that doc's state — its
  // cached state (undo history intact) if we've edited it this session, else a
  // fresh one from the loaded content. No remount, so history survives.
  $effect(() => {
    const id = docId;
    if (!view || !mounted || id === currentDocId) return;
    if (currentDocId) cacheState(currentDocId, view.state);
    const next = (id && stateCache.get(id)) || buildState(initialDoc);
    currentDocId = id;
    if (id) cacheState(id, next);
    view.updateState(next);
    rebuildOutline();
    // Switching tabs is opening a document too — and the collapsed set is keyed
    // by position, so carrying the previous doc's over would be meaningless.
    collapseOutlineTo(OUTLINE_OPEN_LEVEL);
    syncDocSelSize();
    view.focus();
  });

  /** Drop a non-active doc's cached editor state so the next switch to it
   *  rebuilds from its (updated) blob — used after a background send-to-speech
   *  appends to a docked-but-not-shown doc. */
  export function invalidateCache(id: string): void {
    if (id !== currentDocId) stateCache.delete(id);
  }

  /** Serialise the current document to JSON (for pop-out handoff / persistence). */
  export function getDocJSON(): unknown {
    return view?.state.doc.toJSON() ?? null;
  }

  /** Label of a top-level node (tag/analytic heading text, else its own text). */
  function nodeLabel(node: PMNode): string {
    return (
      node.type.name === "card" || node.type.name === "analytic_unit"
        ? node.firstChild?.textContent ?? ""
        : node.textContent
    ).trim();
  }

  /** Reorder the doc's top-level nodes to match the flow's row order. `order`
   *  maps a node label → its flow position; unknown labels (things typed
   *  straight into the doc) keep their relative order at the end. Called after a
   *  send so cards land in the right order no matter which order you sent them. */
  export function reorderByFlow(order: Record<string, number>) {
    if (!view) return;
    const top: { node: PMNode; key: number; i: number }[] = [];
    view.state.doc.forEach((node, _offset, index) => {
      const key = order[nodeLabel(node)] ?? Number.MAX_SAFE_INTEGER;
      top.push({ node, key, i: index });
    });
    const sorted = [...top].sort((a, b) => a.key - b.key || a.i - b.i);
    if (sorted.every((s, idx) => s.i === idx)) return; // already ordered
    const frag = Fragment.fromArray(sorted.map((s) => s.node));
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, frag));
  }

  // ── ribbon → doc text actions (used when the doc is the active surface) ──
  export function toggleBold() { mark("bold"); }
  export function toggleItalic() { mark("italic"); }

  /** Base size (pt) for the block the cursor is in — headings size by type, body
   *  is 11pt — used when a run carries no explicit font_size mark. */
  function baseSizeForSelection(): number {
    if (!view) return 11;
    const dt = settings.docTypography;
    const at = view.state.selection.$from;
    for (let d = at.depth; d >= 0; d--) {
      switch (at.node(d).type.name) {
        case "pocket": return dt.sizePocket;
        case "hat": return dt.sizeHat;
        case "block": return dt.sizeBlock;
        case "tag": return dt.sizeTag;
        case "cite":
        case "cite_paragraph": return dt.sizeCite;
      }
    }
    return 11;
  }

  /** Effective font size (pt) of the current selection: an explicit font_size
   *  mark if present, else the block's base size. */
  function effectiveDocFontSize(): number {
    if (!view) return 11;
    // Runs inside a reactive effect, so it must NEVER throw — a throw here
    // aborts Svelte's render flush and freezes the whole doc UI (dead tabs,
    // can't switch/set the speech doc). Clamp every position into the current
    // doc (a fresh/empty or just-swapped doc can leave the selection out of
    // range for a tick) and swallow anything unexpected.
    try {
      const fs = schema.marks.font_size;
      const size = view.state.doc.content.size;
      const { from, to, empty } = view.state.selection;
      const a = Math.max(0, Math.min(empty ? from - 1 : from, size));
      const b = Math.max(a, Math.min(Math.max(a + 1, to), size));
      if (a >= b) return baseSizeForSelection();
      let hp: number | null = null;
      view.state.doc.nodesBetween(a, b, (node) => {
        if (hp !== null) return false;
        if (node.isText) {
          const m = node.marks.find((x) => x.type === fs);
          if (m) hp = Number(m.attrs.halfPoints);
        }
        return true;
      });
      return hp != null ? hp / 2 : baseSizeForSelection();
    } catch {
      return 11;
    }
  }

  function syncDocSelSize() {
    store.docSelSize = Math.round(effectiveDocFontSize());
  }

  /** ⁠Ribbon − / + : resize ONLY the selected text (per-run font_size mark). */
  export function bumpDocFontSize(delta: number) {
    if (!view) return;
    const { from, to, empty } = view.state.selection;
    if (empty) return; // need a selection to resize
    const fs = schema.marks.font_size;
    const next = Math.max(6, Math.min(48, effectiveDocFontSize() + delta));
    let tr = view.state.tr.removeMark(from, to, fs);
    tr = tr.addMark(from, to, fs.create({ halfPoints: Math.round(next * 2) }));
    view.dispatch(tr);
    view.focus();
    syncDocSelSize();
  }
  /** Set (or clear, when null) the selection's text color. `hex` may include #. */
  export function setDocColor(hex: string | null) {
    if (!view) return;
    const m = schema.marks.font_color;
    const { from, to, empty } = view.state.selection;
    if (empty) { view.focus(); return; }
    if (hex) {
      const color = hex.replace(/^#/, "").toLowerCase();
      if (/^[0-9a-f]{6}$/.test(color)) view.dispatch(view.state.tr.addMark(from, to, m.create({ color })));
    } else {
      view.dispatch(view.state.tr.removeMark(from, to, m));
    }
    view.focus();
  }

  // ── quick cards (capture / insert reusable snippets) ─────────────
  /** A minimal DocNode built from a PM card/analytic_unit node (for send-to-doc
   *  from the flow later). Text only — image bytes don't survive this path. */
  function pmToDocNode(node: PMNode): unknown {
    const isAnalytic = node.type.name === "analytic_unit";
    const head = node.firstChild?.textContent.trim() ?? "";
    const body: string[] = [];
    node.forEach((child, _o, i) => { if (i > 0) body.push(child.textContent); });
    return { level: 4, isAnalytic, text: head, runs: [], children: [], body, bodyRuns: [] };
  }

  /** Build the flow-cell form of the selection so a dragged quick card lands as
   *  a real structured cell (chip + items), not flat text. */
  function buildFlowRep(slice: import("prosemirror-model").Slice): {
    header: string;
    chip?: string;
    card?: unknown;
    items?: { text: string; kind: "card" | "response"; chip?: string; card?: unknown }[];
  } {
    const CHIP: Record<string, string> = { pocket: "POC", hat: "HAT", block: "BLK", tag: "TAG" };
    let header = "";
    let chip = "";
    const items: { text: string; kind: "card" | "response"; chip?: string; card?: unknown }[] = [];
    slice.content.forEach((node) => {
      const t = node.type.name;
      if (CHIP[t] && !header) {
        header = node.textContent.trim();
        chip = CHIP[t];
      } else if (t === "card") {
        items.push({ text: node.firstChild?.textContent.trim() ?? "", kind: "card", chip: "CARD", card: pmToDocNode(node) });
      } else if (t === "analytic_unit") {
        items.push({ text: node.firstChild?.textContent.trim() ?? "", kind: "card", chip: "ANL", card: pmToDocNode(node) });
      } else {
        const txt = node.textContent.trim();
        if (txt) items.push({ text: txt, kind: "response" });
      }
    });
    // A lone card with no surrounding heading → a plain carded cell.
    if (!header && items.length === 1 && items[0].kind === "card") {
      return { header: items[0].text, chip: items[0].chip, card: items[0].card };
    }
    return { header: header || items[0]?.text || "", chip: chip || undefined, items: items.length ? items : undefined };
  }

  /** Capture the current selection as a quick-card payload, or null if empty. */
  export function captureQuickCard(): { contentJson: unknown; name: string; preview: string; flow: ReturnType<typeof buildFlowRep> } | null {
    if (!view) return null;
    const sel = view.state.selection;
    if (sel.empty) return null;
    const slice = sel.content();
    // Default name: the smallest enclosing heading/tag, else the selected text.
    let name = "";
    const at = sel.$from;
    for (let d = at.depth; d >= 0; d--) {
      const n = at.node(d);
      if (n.type.name === "card" || n.type.name === "analytic_unit") {
        name = n.firstChild?.textContent.trim() ?? "";
        break;
      }
      if (["tag", "pocket", "hat", "block", "analytic", "undertag"].includes(n.type.name)) {
        name = n.textContent.trim();
        break;
      }
    }
    const preview = view.state.doc.textBetween(sel.from, sel.to, " ", " ").trim();
    if (!name) name = preview.slice(0, 60);
    return { contentJson: slice.toJSON(), name, preview, flow: buildFlowRep(slice) };
  }

  /** Insert a saved quick card's content at the cursor. */
  export function insertQuickCard(contentJson: unknown) {
    if (!view) return;
    try {
      const slice = Slice.fromJSON(schema, contentJson as never);
      view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
      view.focus();
    } catch (err) {
      console.error("insertQuickCard failed", err);
    }
  }

  /** Remove the first top-level card/heading whose label matches `text`. */
  export function removeByText(text: string) {
    if (!view || !text.trim()) return;
    const target = text.trim();
    const { state } = view;
    let foundPos = -1;
    let foundSize = 0;
    state.doc.forEach((node, offset) => {
      if (foundPos >= 0) return;
      const label =
        node.type.name === "card" || node.type.name === "analytic_unit"
          ? node.firstChild?.textContent ?? ""
          : node.textContent;
      if (label.trim() === target) { foundPos = offset; foundSize = node.nodeSize; }
    });
    if (foundPos >= 0) view.dispatch(state.tr.delete(foundPos, foundPos + foundSize));
  }

  /** Replace the document from external JSON (pop-out sync) without echoing back. */
  export function setDocJSON(json: unknown) {
    if (!view || !json) return;
    try {
      const doc = schema.nodeFromJSON(json);
      applyingExternal = true;
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
      tr.setMeta("addToHistory", false);
      view.updateState(view.state.apply(tr));
      applyingExternal = false;
      rebuildOutline();
    } catch (err) {
      console.error("setDocJSON failed", err);
      applyingExternal = false;
    }
  }

  onDestroy(() => {
    view?.destroy();
    view = null;
    mounted = false;
  });

  // ── inserting ──────────────────────────────────────────────────

  function insertAtEnd(nodes: ReturnType<typeof schema.nodes.card.create>[]) {
    if (!view || nodes.length === 0) return;
    const { state } = view;
    view.dispatch(state.tr.insert(state.doc.content.size, nodes).scrollIntoView());
  }

  /** Rich insert from Doc Search / drag — full CardMirror card structure. */
  export function appendNode(node: DocNode) {
    try {
      insertAtEnd(nodesFromDocNode(node));
    } catch (err) {
      console.error("appendNode failed, falling back to plain text", err);
      // Fallback: flatten to a plain card so the insert never silently fails.
      const lines: string[] = [];
      const walk = (n: DocNode) => {
        n.body.forEach((l) => lines.push(l));
        n.children.forEach(walk);
      };
      walk(node);
      appendCard(node.text, lines.join("\n"));
    }
  }

  /** Plain-string card (from the "→ Doc" ribbon button / cell text). */
  export function appendCard(header: string, fullCard: string) {
    if (!view) return;
    const lines = fullCard.split("\n").map((l) => l.trim()).filter((l) => l && l !== header);
    const tag = schema.nodes.tag.create(null, header ? [schema.text(header)] : []);
    const bodies = lines.map((line) => schema.nodes.card_body.create(null, [schema.text(line)]));
    insertAtEnd([schema.nodes.card.create(null, [tag, ...bodies])]);
  }

  export function appendBlocks(lines: string[]) {
    const nodes = lines
      .filter((l) => l.trim())
      .map((line) => schema.nodes.block.create(null, [schema.text(line)]));
    insertAtEnd(nodes);
  }

  export function insertAtCursor(header: string, fullCard: string) {
    if (!view) return;
    const lines = fullCard.split("\n").map((l) => l.trim()).filter((l) => l && l !== header);
    const tag = schema.nodes.tag.create(null, header ? [schema.text(header)] : []);
    const bodies = lines.map((line) => schema.nodes.card_body.create(null, [schema.text(line)]));
    const card = schema.nodes.card.create(null, [tag, ...bodies]);
    view.dispatch(view.state.tr.replaceSelectionWith(card).scrollIntoView());
  }

  // ── toolbar ────────────────────────────────────────────────────

  function mark(name: string, attrs?: Record<string, unknown>) {
    if (!view) return;
    const m = schema.marks[name];
    if (m) toggleMark(m, attrs)(view.state, view.dispatch);
    view.focus();
  }

  function setBlock(type: string) {
    if (!view) return;
    if (type === "analytic") { makeAnalytic(); return; }
    if (type === "tag") { makeCard(); return; }
    // Pocket/Hat/Block are top-level headings that a card / analytic_unit's
    // (isolating) content spec forbids, so plain setBlockType silently fails
    // when the cursor sits inside one — the "can't write a block under a card"
    // bug. setStructure handles both the normal and the locked-inside cases.
    if (type === "pocket" || type === "hat" || type === "block") { setStructure(type); return; }
    // "Body" is illegal inside a card/analytic_unit, so it needs the same
    // escape hatch — otherwise the button silently does nothing and you're
    // stuck in tag formatting with no way back to plain text.
    if (type === "paragraph") { setBody(); return; }
    const nt = schema.nodes[type];
    if (nt) setBlockType(nt)(view.state, view.dispatch);
    view.focus();
  }

  /** "Body" — plain, unformatted text wherever the cursor is.
   *  At the doc level that's a paragraph. Inside a card / analytic_unit a
   *  paragraph is illegal (the content spec forbids it), so: a non-head line
   *  becomes the unit's own body paragraph, and the HEAD line unwraps the whole
   *  unit back into plain paragraphs — "this isn't a card after all". */
  function setBody() {
    if (!view) return;
    const { state } = view;
    if (setBlockType(schema.nodes.paragraph)(state, view.dispatch)) { view.focus(); return; }
    const rpos = state.selection.$from;
    let unitDepth = -1;
    for (let d = rpos.depth; d >= 1; d--) {
      const n = rpos.node(d).type.name;
      if (n === "card" || n === "analytic_unit") { unitDepth = d; break; }
    }
    if (unitDepth < 0) { view.focus(); return; }
    if (rpos.index(unitDepth) > 0) {
      // A cite/undertag line inside the unit → the unit's plain body type.
      setBlockType(schema.nodes.card_body)(state, view.dispatch);
      view.focus();
      return;
    }
    try {
      const unit = rpos.node(unitDepth);
      const unitFrom = rpos.before(unitDepth);
      const unitTo = rpos.after(unitDepth);
      const paras: PMNode[] = [];
      unit.forEach((child) => {
        // Textblocks (tag/analytic/card_body/cite/undertag) flatten to
        // paragraphs; anything else (a table) is kept as-is.
        paras.push(child.isTextblock ? schema.nodes.paragraph.create(null, child.content) : child);
      });
      if (!paras.length) paras.push(schema.nodes.paragraph.create());
      const tr = state.tr.replaceWith(unitFrom, unitTo, Fragment.fromArray(paras));
      tr.setSelection(TextSelection.near(tr.doc.resolve(unitFrom + 1)));
      view.dispatch(tr.scrollIntoView());
    } catch (err) {
      console.error("setBody unwrap failed", err);
    }
    view.focus();
  }

  /** Apply a top-level heading style (pocket/hat/block). When the cursor is at
   *  the doc level, this is just setBlockType. When it's trapped inside a card
   *  or analytic_unit — whose content can't hold a heading — lift the current
   *  line OUT into a new heading placed right after that unit, so the button
   *  always does something instead of quietly failing. */
  function setStructure(type: string) {
    if (!view) return;
    const nt = schema.nodes[type];
    if (!nt) return;
    const { state } = view;
    // Normal path: a directly-convertible block (top-level paragraph/cite/heading).
    if (setBlockType(nt)(state, view.dispatch)) { view.focus(); return; }
    // Locked inside an isolating card / analytic_unit — extract instead.
    const rpos = state.selection.$from;
    let unitDepth = -1;
    for (let d = rpos.depth; d >= 1; d--) {
      const name = rpos.node(d).type.name;
      if (name === "card" || name === "analytic_unit") { unitDepth = d; break; }
    }
    if (unitDepth < 0) { view.focus(); return; } // some other lock — no-op, as before
    try {
      const unit = rpos.node(unitDepth);
      const unitFrom = rpos.before(unitDepth);
      const unitTo = rpos.after(unitDepth);
      const lineIndex = rpos.index(unitDepth);
      // Index 0 is the required tag/analytic head — never remove it (that would
      // orphan the card's body). Only body lines get pulled out.
      const onHead = lineIndex === 0;
      const headingText = onHead ? "" : rpos.parent.textContent;
      const heading = nt.create(
        { id: crypto.randomUUID() },
        headingText ? [schema.text(headingText)] : undefined,
      );
      const kept: PMNode[] = [];
      unit.forEach((child, _o, i) => { if (onHead || i !== lineIndex) kept.push(child); });
      const newUnit = unit.copy(Fragment.fromArray(kept));
      const tr = state.tr.replaceWith(unitFrom, unitTo, Fragment.fromArray([newUnit, heading]));
      const headingInner = Math.min(unitFrom + newUnit.nodeSize + 1, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(headingInner)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    } catch (err) {
      console.error("setStructure extract failed", err);
      view.focus();
    }
  }

  // A tag lives inside a card; an analytic inside an analytic_unit.
  function makeCard() { makeUnit("card"); }
  function makeAnalytic() { makeUnit("analytic_unit"); }

  /** The card / analytic_unit form of a TOP-LEVEL node, keeping its inline
   *  content (highlighting, underlines, sizes) instead of flattening to plain
   *  text. Anything that isn't a unit or a textblock (a table) is left alone. */
  function asUnit(node: PMNode, unitType: "card" | "analytic_unit"): PMNode {
    const headType = unitType === "card" ? "tag" : "analytic";
    if (node.type.name === unitType) return node; // already that kind
    const head = (content: Fragment) =>
      schema.nodes[headType].create({ id: crypto.randomUUID() }, content);
    if (node.type.name === "card" || node.type.name === "analytic_unit") {
      // Swap only the head node's type — card and analytic_unit share the same
      // body content spec, so the evidence underneath carries over untouched.
      const kids: PMNode[] = [head(node.firstChild?.content ?? Fragment.empty)];
      node.forEach((child, _o, i) => { if (i !== 0) kids.push(child); });
      return schema.nodes[unitType].create(node.attrs, Fragment.fromArray(kids));
    }
    if (node.isTextblock) return schema.nodes[unitType].create(null, [head(node.content)]);
    return node;
  }

  /** Turn the selection into card(s) (tag head) or analytic_unit(s).
   *
   *  - A selection spanning several top-level nodes converts EVERY one of them,
   *    so "highlight the whole block of tags → Analytic" does what it looks like
   *    (it used to convert only the first).
   *  - A cursor/selection inside one node: at the doc level the line is replaced
   *    in place; on a unit's HEAD line the whole unit converts (tag ⇄ analytic);
   *    on a body line inside an isolating unit — where nesting is illegal and a
   *    plain replace would THROW — the line is extracted into a new sibling unit. */
  function makeUnit(unitType: "card" | "analytic_unit") {
    if (!view) return;
    const headType = unitType === "card" ? "tag" : "analytic";
    const { state } = view;
    const sel = state.selection;
    try {
      // ── multi-node selection → convert each top-level node it touches ──
      if (!sel.empty) {
        const touched: { node: PMNode; start: number; end: number }[] = [];
        state.doc.forEach((node, offset) => {
          const end = offset + node.nodeSize;
          if (end > sel.from && offset < sel.to) touched.push({ node, start: offset, end });
        });
        if (touched.length > 1) {
          const frag = Fragment.fromArray(touched.map((t) => asUnit(t.node, unitType)));
          const from = touched[0].start;
          const tr = state.tr.replaceWith(from, touched[touched.length - 1].end, frag);
          // Keep the same span selected so you can chain another action on it.
          const size = tr.doc.content.size;
          const a = tr.doc.resolve(Math.min(from + 1, size));
          const b = tr.doc.resolve(Math.max(0, Math.min(from + frag.size - 1, size)));
          tr.setSelection(TextSelection.between(a, b));
          view.dispatch(tr.scrollIntoView());
          view.focus();
          return;
        }
      }

      const rpos = sel.$from;
      let unitDepth = -1;
      for (let d = rpos.depth; d >= 1; d--) {
        const name = rpos.node(d).type.name;
        if (name === "card" || name === "analytic_unit") { unitDepth = d; break; }
      }

      if (unitDepth < 0) {
        // Top-level line — replace it in place.
        const from = rpos.before();
        const to = rpos.after();
        const tr = state.tr.replaceWith(from, to, asUnit(rpos.parent, unitType));
        tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
        view.dispatch(tr.scrollIntoView());
        view.focus();
        return;
      }
      // Already inside a card/analytic_unit.
      const lineIndex = rpos.index(unitDepth);
      const unit = rpos.node(unitDepth);
      const unitFrom = rpos.before(unitDepth);
      const unitTo = rpos.after(unitDepth);
      if (lineIndex === 0) {
        if (unit.type.name === unitType) { view.focus(); return; } // already that kind
        const tr = state.tr.replaceWith(unitFrom, unitTo, asUnit(unit, unitType));
        tr.setSelection(TextSelection.near(tr.doc.resolve(unitFrom + 2)));
        view.dispatch(tr.scrollIntoView());
        view.focus();
        return;
      }
      const head = schema.nodes[headType].create({ id: crypto.randomUUID() }, rpos.parent.content);
      const kept: PMNode[] = [];
      unit.forEach((child, _o, i) => { if (i !== lineIndex) kept.push(child); });
      const keptUnit = unit.copy(Fragment.fromArray(kept));
      const newUnit = schema.nodes[unitType].create(null, [head]);
      const tr = state.tr.replaceWith(unitFrom, unitTo, Fragment.fromArray([keptUnit, newUnit]));
      const headInner = Math.min(unitFrom + keptUnit.nodeSize + 2, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(headInner)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    } catch (err) {
      console.error(`makeUnit(${unitType}) failed`, err);
      view.focus();
    }
  }

  // Textblocks where CardMirror represents underline as a direct <u> rather
  // than the named "Underline" character style (see its named-style normalizer).
  const STRUCTURAL_BLOCKS = new Set(["tag", "analytic", "pocket", "hat", "block", "undertag"]);

  function inStructuralBlock(): boolean {
    if (!view) return false;
    const at = view.state.selection.$from;
    for (let d = at.depth; d >= 0; d--) {
      if (STRUCTURAL_BLOCKS.has(at.node(d).type.name)) return true;
    }
    return false;
  }

  /** True when the selection carries EITHER underline representation. */
  function underlineActive(_tick?: number): boolean {
    if (!view) return false;
    const sel = view.state.selection;
    const has = (m: (typeof schema.marks)[string] | undefined) => {
      if (!m || !view) return false;
      if (sel.empty) return !!m.isInSet(view.state.storedMarks ?? sel.$from.marks());
      return view.state.doc.rangeHasMark(sel.from, sel.to, m);
    };
    return has(schema.marks.underline_mark) || has(schema.marks.underline_direct);
  }

  /**
   * Underline toggle that can always turn itself back OFF.
   *
   * CardMirror stores underline two ways — the named `underline_mark` (body)
   * and a direct `<u>` `underline_direct` (headings) — and its normalizer
   * plugin, which keeps them from coexisting, isn't part of this editor. The
   * browser's native ⌘U removes only the direct one, so text that picked up
   * both stayed underlined with no way to clear it. Clearing BOTH whenever
   * either is present makes the toggle honest; applying the one that matches
   * the block keeps .docx round-trip correct.
   */
  function toggleUnderline() {
    if (!view) return;
    const um = schema.marks.underline_mark;
    const ud = schema.marks.underline_direct;
    const sel = view.state.selection;
    if (underlineActive()) {
      if (sel.empty) {
        let marks = view.state.storedMarks ?? sel.$from.marks();
        if (um) marks = um.removeFromSet(marks);
        if (ud) marks = ud.removeFromSet(marks);
        view.dispatch(view.state.tr.setStoredMarks(marks));
      } else {
        let tr = view.state.tr;
        if (um) tr = tr.removeMark(sel.from, sel.to, um);
        if (ud) tr = tr.removeMark(sel.from, sel.to, ud);
        view.dispatch(tr);
      }
    } else {
      const target = inStructuralBlock() ? ud : um;
      if (target) toggleMark(target)(view.state, view.dispatch);
    }
    view.focus();
  }

  function markActive(name: string, _tick?: number): boolean {
    if (!view) return false;
    const m = schema.marks[name];
    if (!m) return false;
    const sel = view.state.selection;
    if (sel.empty) return !!m.isInSet(view.state.storedMarks ?? sel.$from.marks());
    return view.state.doc.rangeHasMark(sel.from, sel.to, m);
  }

  function setHighlight(color: string) {
    if (!view) return;
    const m = schema.marks.highlight;
    if (color === "none") {
      // Clear highlight in the selection.
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.removeMark(from, to, m));
    } else {
      // Force-apply the chosen colour (not toggle) so switching colours works.
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.addMark(from, to, m.create({ color })));
    }
    view.focus();
  }

  const HL_COLORS = [
    { name: "yellow", css: "#ffff00" },
    { name: "green", css: "#00ff00" },
    { name: "cyan", css: "#00ffff" },
    { name: "magenta", css: "#ff00ff" },
    { name: "blue", css: "#4d7bff" },
    { name: "lightGray", css: "#c0c0c0" },
  ];

  // ── toolbar: labeled structure + read-marking buttons (CardMirror layout) ──
  // Order matches CardMirror's grid (row-filled 3-wide / 2-wide). `action` ties
  // each button to a configurable keybind in settings.
  const STYLES: { type: string; label: string; action: ActionId }[] = [
    { type: "pocket", label: "Pocket", action: "docPocket" },
    { type: "hat", label: "Hat", action: "docHat" },
    { type: "analytic", label: "Analytic", action: "docAnalytic" },
    { type: "tag", label: "Tag", action: "docTag" },
    { type: "block", label: "Block", action: "docBlock" },
    { type: "undertag", label: "Undertag", action: "docUndertag" },
  ];
  const READ_MARKS: { mark: string; label: string; action: ActionId }[] = [
    { mark: "cite_mark", label: "Cite", action: "docCite" },
    { mark: "emphasis_mark", label: "Emphasis", action: "docEmphasis" },
    { mark: "underline_mark", label: "Underline", action: "docUnderline" },
  ];

  /** The current key label for an action (first binding), for toolbar hints.
   *  Reads settings so the toolbar updates the instant you rebind in Settings. */
  function keyHint(action: ActionId): string {
    const b = settings.keymap[action]?.[0];
    return b ? comboLabel(b, settings.isMac) : "";
  }

  /** Backspace at the very START of a NON-empty Pocket / Hat / Block turns it
   *  back into ordinary body text. Without this, backspacing out of the front of
   *  a heading did nothing at all — the only way to undo a mis-styled heading was
   *  to find the style buttons. Deliberately scoped to the three container
   *  headings: tags and analytics have their own boundary rules.
   *
   *  Runs AFTER backspaceEmptyBlock in the chain, which is what you want — that
   *  one only fires on an EMPTY block (it bails on `content.size !== 0`), so the
   *  two never contend: empty heading → removed, typed-in heading → body text. */
  function backspaceHeadingToBody(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean {
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || !sel.empty) return false;
    const at = sel.$from;
    if (at.parentOffset !== 0) return false;
    if (!["pocket", "hat", "block"].includes(at.parent.type.name)) return false;
    return setBlockType(schema.nodes.paragraph)(state, dispatch);
  }

  /** Backspace/Delete on an EMPTY heading/tag removes it. Base Backspace can't:
   *  an empty pocket/hat/block renders as a stuck box, and an empty tag as an
   *  un-deletable "(untitled)" card. Returns false for non-empty blocks so
   *  normal character deletion is untouched. */
  function backspaceEmptyBlock(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean {
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || !sel.empty) return false;
    const at = sel.$from;
    // Only act at the very start of a completely empty block.
    if (at.parentOffset !== 0 || at.parent.content.size !== 0) return false;
    if (at.parent.type === schema.nodes.paragraph) return false; // let base handle

    // 1) Empty heading (pocket/hat/block/analytic/undertag) → plain paragraph,
    //    so the box disappears and it becomes a normal, deletable line.
    if (setBlockType(schema.nodes.paragraph)(state, dispatch)) return true;

    // 2) Empty tag inside a card / analytic_unit that is ITSELF entirely empty
    //    → delete the whole stub node (never destroys a card with real body).
    for (let d = at.depth - 1; d >= 0; d--) {
      const node = at.node(d);
      if (node.type.name === "card" || node.type.name === "analytic_unit") {
        if (node.textContent.trim() !== "") return false; // has real content — keep it
        if (dispatch) {
          dispatch(state.tr.delete(at.before(d), at.after(d)).scrollIntoView());
        }
        return true;
      }
    }
    return false;
  }

  /** Section depth of a TOP-LEVEL node type: pocket < hat < block < card.
   *  Cards/analytics are self-contained units (level 4). Everything else
   *  (paragraph, cite, undertag, table…) is body — it belongs to whatever
   *  heading precedes it and has no section of its own. */
  function topLevelRank(name: string): number | undefined {
    switch (name) {
      case "pocket": return 1;
      case "hat": return 2;
      case "block": return 3;
      case "card":
      case "analytic_unit": return 4;
      default: return undefined;
    }
  }

  /**
   * Capture what `~` sends to the speech doc, as CardMirror node JSON:
   * - an explicit text selection → exactly what's selected;
   * - the cursor on a HEADING (pocket/hat/block) → that heading plus everything
   *   beneath it, up to (not including) the next heading at the same-or-shallower
   *   level — i.e. the whole hat, or the whole block, and nothing else;
   * - the cursor on a single card/analytic (or loose body) → just that one node.
   */
  function captureForTilde(): unknown[] {
    if (!view) return [];
    try {
      const sel = view.state.selection;
      if (!sel.empty) {
        const out: unknown[] = [];
        sel.content().content.forEach((n) => out.push(n.toJSON()));
        return out;
      }
      if (sel.$from.depth === 0) return [];
      const doc = view.state.doc;
      const anchorIdx = sel.$from.index(0);
      const anchor = doc.child(anchorIdx);
      const rank = topLevelRank(anchor.type.name);
      // A card/analytic unit or a loose body node → send only that node.
      if (rank === undefined || rank >= 4) return [anchor.toJSON()];
      // A heading → send it plus every following node deeper than it, stopping
      // at the next sibling heading of the same or a shallower level.
      const out: unknown[] = [anchor.toJSON()];
      for (let i = anchorIdx + 1; i < doc.childCount; i++) {
        const child = doc.child(i);
        const r = topLevelRank(child.type.name);
        if (r !== undefined && r <= rank) break;
        out.push(child.toJSON());
      }
      return out;
    } catch (err) {
      console.error("captureForTilde failed", err);
      return [];
    }
  }

  /** Insert CardMirror node JSON at the cursor (after the current top-level
   *  node), keeping images. Used by "send to speech" and at-cursor sends. */
  export function insertCMAtCursor(nodes: unknown[]) {
    if (!view || !nodes.length) return;
    try {
      nodes.forEach(stripBlankRunMarks);
      insertPMAtCursor(nodes.map((j) => schema.nodeFromJSON(j as never)));
    } catch (err) {
      console.error("insertCMAtCursor failed", err);
    }
  }

  /** Insert CardMirror node JSON at the CURSOR of a doc that may be a background
   *  tab (not currently shown). Targets that doc's cached editor state so the
   *  cards land where its cursor last was. Returns the updated content JSON to
   *  persist, or null if there's no cached state (the doc was never opened this
   *  session) — the caller should then fall back to appending at the end. */
  export function insertCMAtCachedCursor(id: string, nodes: unknown[]): unknown | null {
    if (!view || !nodes.length) return null;
    if (id === currentDocId) { insertCMAtCursor(nodes); return view.state.doc.toJSON(); }
    const base = stateCache.get(id);
    if (!base) return null;
    try {
      nodes.forEach(stripBlankRunMarks);
      const frag = Fragment.fromArray(nodes.map((j) => schema.nodeFromJSON(j as never)));
      const at = base.selection.$from;
      const pos = at.depth > 0 ? at.after(1) : base.selection.from;
      const tr = base.tr.insert(pos, frag);
      const after = Math.min(pos + frag.size, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(after)));
      const next = base.apply(tr);
      stateCache.set(id, next);
      return next.doc.toJSON();
    } catch (err) {
      console.error("insertCMAtCachedCursor failed", err);
      return null;
    }
  }

  /** Insert a DocNode (adapter path) at the cursor. */
  export function insertNodeAtCursor(node: DocNode) {
    if (!view) return;
    try {
      insertPMAtCursor(nodesFromDocNode(node));
    } catch (err) {
      console.error("insertNodeAtCursor failed", err);
    }
  }

  /** Insert top-level PM nodes after the current node, and move the cursor past
   *  them so successive inserts stack in order. */
  function insertPMAtCursor(pm: PMNode[]) {
    if (!view || !pm.length) return;
    const frag = Fragment.fromArray(pm);
    const at = view.state.selection.$from;
    const pos = at.depth > 0 ? at.after(1) : view.state.selection.from;
    const tr = view.state.tr.insert(pos, frag);
    const after = Math.min(pos + frag.size, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(after)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  /** Route a doc keydown through the configurable keymap. Returns true (and lets
   *  ProseMirror preventDefault) when the event matched a doc action. */
  function docKeydown(e: KeyboardEvent): boolean {
    // Zoom keybinds act on the surface you're in — in the doc they zoom the
    // PAGE, not the flow. Same rebindable actions the flow uses, and the
    // keyboard fallback for a touchpad pinch the webview never forwards.
    if (matchesAny(e, settings.keymap.zoomReset)) { e.preventDefault(); settings.docZoomReset(); return true; }
    if (matchesAny(e, settings.keymap.zoomIn)) { e.preventDefault(); settings.docZoomIn(); return true; }
    if (matchesAny(e, settings.keymap.zoomOut)) { e.preventDefault(); settings.docZoomOut(); return true; }
    // FIXED (unchangeable) — ` / ~ sends the current card/selection to the
    // speech doc at the cursor, like CardMirror/Verbatim "send to speech".
    if (onTilde && (e.key === "`" || e.key === "~") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      onTilde(captureForTilde());
      return true;
    }
    // Rebindable variant — send to the speech doc AT ITS CURSOR (` = end).
    if (onTildeCursor && matchesAny(e, settings.keymap.sendToSpeechCursor)) {
      onTildeCursor(captureForTilde());
      return true;
    }
    // Undo/redo — handled explicitly here (this runs before every other keymap)
    // so the doc always undoes its OWN history, never the flow's, regardless of
    // plugin ordering or which surface the window's key handler thinks is active.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { if (view) undo(view.state, view.dispatch); return true; }
      if ((k === "z" && e.shiftKey) || k === "y") { if (view) redo(view.state, view.dispatch); return true; }
      // ⌘/Ctrl+U must be OURS. Left to the browser it applies a native <u>,
      // a second underline representation our toggle can't see — which is how
      // text ended up permanently underlined with no way to switch it off.
      if (k === "u") { toggleUnderline(); return true; }
    }
    const km = settings.keymap;
    const hit = (fn: () => void) => { fn(); return true; };
    if (matchesAny(e, km.docBody)) return hit(() => setBlock("paragraph"));
    if (matchesAny(e, km.docPocket)) return hit(() => setBlock("pocket"));
    if (matchesAny(e, km.docHat)) return hit(() => setBlock("hat"));
    if (matchesAny(e, km.docBlock)) return hit(() => setBlock("block"));
    if (matchesAny(e, km.docTag)) return hit(() => setBlock("tag"));
    if (matchesAny(e, km.docAnalytic)) return hit(() => setBlock("analytic"));
    if (matchesAny(e, km.docUndertag)) return hit(() => setBlock("undertag"));
    if (matchesAny(e, km.docCite)) return hit(() => mark("cite_mark"));
    if (matchesAny(e, km.docEmphasis)) return hit(() => mark("emphasis_mark"));
    if (matchesAny(e, km.docUnderline)) return hit(() => toggleUnderline());
    if (matchesAny(e, km.docClearFormat)) return hit(() => clearMarks());
    if (matchesAny(e, km.docBold)) return hit(() => mark("bold"));
    if (matchesAny(e, km.docItalic)) return hit(() => mark("italic"));
    if (matchesAny(e, km.docFind)) return hit(() => openSearch());
    if (matchesAny(e, km.docQuickCards)) return hit(() => (quickOpen = true));
    return false;
  }

  // The active heading style at the cursor — for button highlighting. A tag /
  // analytic lives inside a card / analytic_unit, so walk the ancestor chain.
  // `_tick` is unused but, passed from the template, makes the call re-run when
  // the selection changes (Svelte tracks the reactive read at the call site).
  function blockActive(type: string, _tick?: number): boolean {
    if (!view) return false;
    const resolved = view.state.selection.$from;
    for (let d = resolved.depth; d >= 0; d--) {
      if (resolved.node(d).type.name === type) return true;
    }
    return false;
  }

  /** ⌘← — strip all read/format marks from the selection (CardMirror "Clear"). */
  function clearMarks() {
    if (!view) return;
    const { from, to, empty } = view.state.selection;
    if (empty) { view.focus(); return; }
    let tr = view.state.tr;
    for (const n of ["emphasis_mark", "cite_mark", "underline_mark", "bold", "italic", "strikethrough", "highlight"]) {
      if (schema.marks[n]) tr = tr.removeMark(from, to, schema.marks[n]);
    }
    view.dispatch(tr);
    view.focus();
  }

  // ── find-in-doc (⌘F) ───────────────────────────────────────────
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let searchCount = $state(0);
  let searchIndex = $state(0);
  let searchInputEl = $state<HTMLInputElement>();

  function openSearch() {
    searchOpen = true;
    queueMicrotask(() => { searchInputEl?.focus(); searchInputEl?.select(); });
    if (searchQuery) { searchFresh = true; runSearch(0); }
  }
  function closeSearch() {
    searchOpen = false;
    if (view) view.dispatch(view.state.tr.setMeta(searchKey, { query: "", index: 0 }));
    view?.focus();
  }
  /** The doc's scrolling ancestor (the pane that actually moves). */
  function docScroller(): HTMLElement | null {
    let el: HTMLElement | null = view?.dom.parentElement ?? null;
    while (el) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  }

  /** Scroll the doc so `pos` is comfortably on screen.
   *
   *  ProseMirror's own `tr.scrollIntoView()` can't do this for find: while the
   *  find bar is open the DOM selection lives in the SEARCH INPUT, so PM starts
   *  its scroll-parent walk from that input — which is a sibling of the doc's
   *  scroller, not inside it — and nothing scrolls at all. Measure the position
   *  and move the scroller directly instead. */
  function scrollPosIntoView(pos: number) {
    if (!view) return;
    const box = docScroller();
    if (!box) return;
    // Prefer the rendered highlight's own rect — it's the exact thing the user
    // is looking for, and it stays correct even where coordsAtPos can't measure
    // (content-visibility subtrees, freshly-inserted decorations).
    let top: number | null = null;
    let bottom: number | null = null;
    const el = view.dom.querySelector(".doc-find.current") as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      top = r.top;
      bottom = r.bottom;
    } else {
      try {
        const c = view.coordsAtPos(pos);
        top = c.top;
        bottom = c.bottom;
      } catch {
        return; // not measurable — the decoration still marks the hit
      }
    }
    const rect = box.getBoundingClientRect();
    const margin = Math.min(120, rect.height / 3);
    if (top < rect.top + margin) {
      box.scrollTop -= rect.top + margin - top;
    } else if (bottom > rect.bottom - margin) {
      box.scrollTop += bottom - (rect.bottom - margin);
    }
  }

  /** Recompute matches for the current query, land on `index`, scroll to it. */
  function runSearch(index: number) {
    if (!view) return;
    view.dispatch(view.state.tr.setMeta(searchKey, { query: searchQuery, index }));
    const st = searchKey.getState(view.state);
    searchCount = st?.matches.length ?? 0;
    searchIndex = st?.index ?? 0;
    const m = st?.matches[searchIndex];
    if (m) {
      const tr = view.state.tr
        .setSelection(TextSelection.create(view.state.doc, m.from, m.to));
      tr.setMeta(searchKey, { query: searchQuery, index: searchIndex });
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
      // PM updates the DOM synchronously in updateState, so the "current" match
      // decoration already exists — scroll now rather than from a rAF, which
      // never fires while the pane/window isn't compositing (a background or
      // popped-out doc would silently never scroll).
      scrollPosIntoView(m.from);
    }
  }
  /** True while the current query hasn't been navigated yet — so the FIRST
   *  Enter lands on match 1 (the thing you just searched for) instead of
   *  skipping to match 2, which typing-ahead had already selected. */
  let searchFresh = true;
  function stepSearch(dir: number) {
    if (searchCount === 0) { runSearch(0); return; }
    if (searchFresh && dir > 0) {
      searchFresh = false;
      runSearch(searchIndex); // stay on the first hit, just take me there
      return;
    }
    searchFresh = false;
    runSearch(searchIndex + dir);
  }
  function onSearchKey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
  }

  // ── standardize highlighting (CardMirror uniHighlight) ─────────
  // Rewrite every highlighted run to one color (or strip all when target=null),
  // optionally leaving one "exception" color untouched.
  let stdOpen = $state(false);
  let stdExcept = $state<string>(""); // "" = no exception

  function standardizeHighlight(target: string | null) {
    if (!view) return;
    const hl = schema.marks.highlight;
    let tr = view.state.tr;
    // Marks don't change node sizes, so original positions stay valid.
    view.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const m = node.marks.find((mk) => mk.type === hl);
      if (!m) return true;
      if (stdExcept && String(m.attrs.color) === stdExcept) return true; // keep exception
      const from = pos;
      const to = pos + node.nodeSize;
      tr = tr.removeMark(from, to, hl);
      if (target) tr = tr.addMark(from, to, hl.create({ color: target }));
      return true;
    });
    if (tr.docChanged) view.dispatch(tr.scrollIntoView());
    stdOpen = false;
    view.focus();
  }

  let readMode = $state(false);
  let sendStatus = $state("");
  let quickOpen = $state(false);

  // Drop analytics (own analysis) before export: whole analytic_units, and
  // any analytic heading inside a card. Mirrors CardMirror's stripAnalytics.
  function stripAnalytics(doc: PMNode): PMNode {
    const out: PMNode[] = [];
    doc.forEach((child) => {
      if (child.type.name === "analytic_unit") return;
      if (child.type.name === "card") {
        const kids: PMNode[] = [];
        child.forEach((c) => { if (c.type.name !== "analytic") kids.push(c); });
        out.push(child.copy(Fragment.fromArray(kids)));
      } else {
        out.push(child);
      }
    });
    return schema.node("doc", null, Fragment.fromArray(out));
  }

  /** Empty the whole document (for a clean re-send). */
  export function clearDoc() {
    if (!view) return;
    const empty = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, empty.content));
  }

  function toggleReadMode() {
    readMode = !readMode;
    if (view) {
      view.dispatch(view.state.tr.setMeta(readModeKey, { on: readMode }));
    }
  }

  /** Save a document to .docx via CardMirror's own toDocx (perfect round-trip)
   *  through the OS save dialog (or a browser download in web builds). */
  async function saveDocx(doc: PMNode, defaultName: string) {
    if (!view) return;
    try {
      const { toDocx } = await import("$lib/cardmirror");
      const bytes = await toDocx(doc);
      if ("__TAURI_INTERNALS__" in window) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          defaultPath: defaultName,
          filters: [{ name: "Word Document", extensions: ["docx"] }],
        });
        if (!path) return;
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
      } else {
        const blob = new Blob([bytes as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = defaultName; a.click();
        URL.revokeObjectURL(url);
      }
      sendStatus = "Saved ✓";
    } catch (err) {
      sendStatus = "Export failed";
      console.error(err);
    }
    setTimeout(() => (sendStatus = ""), 2500);
  }

  /** Send = the speech doc for the round: analytics (your own analysis) are
   *  stripped, like CardMirror's includeAnalytics:false. */
  function sendDoc() {
    if (!view) return;
    void saveDocx(stripAnalytics(view.state.doc), `SEND_${safeDocName()}.docx`);
  }

  /** Export = a plain .docx of exactly what's here, analytics and all. */
  function exportDoc() {
    if (!view) return;
    void saveDocx(view.state.doc, `${safeDocName()}.docx`);
  }

  /** The doc's name, made safe for a filename (falls back to "Untitled"). */
  function safeDocName(): string {
    const n = (docName || "").trim() || "Untitled";
    return n.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  }

  /** Insert CardMirror-schema nodes (from fromDocx) directly at the doc end. */
  // A whitespace-only text run must never carry a *visible* character mark
  // (emphasis box / cite / underline) — it renders as an empty box or a stray
  // "_ _" gap. Strip those marks from blank runs before insert; keep highlight
  // (a highlighted space is invisible and harmless, and preserves spacing).
  function stripBlankRunMarks(node: unknown): void {
    const o = node as { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] };
    if (o.type === "text" && o.marks && !(o.text ?? "").trim()) {
      o.marks = o.marks.filter(
        (m) => m.type !== "emphasis_mark" && m.type !== "cite_mark" &&
               m.type !== "underline_mark" && m.type !== "bold",
      );
    }
    if (Array.isArray(o.content)) o.content.forEach(stripBlankRunMarks);
  }

  // ── cite on hover (CardMirror's floating author label) ───────────
  // Hovering a card shows its cite — the bold "Snyder 09" — pinned to the right
  // edge, level with the line under the pointer.
  //
  // Read straight off the DOM, deliberately NOT as a ProseMirror decoration: a
  // decoration set would have to be recomputed across the whole document on every
  // transaction for something only ever needed under the pointer. It also never
  // writes into the editor's own DOM — PM's DOMObserver watches attributes, so
  // stamping one onto a card would dirty that node on every hover.
  //
  // `pointerover` (not `pointermove`) fires exactly when the pointer crosses into
  // a new element, which is precisely when the label has to move.
  let citeHover = $state<{ text: string; top: number } | null>(null);
  let citeUnit: HTMLElement | null = null; // card the label is describing
  let citeLine: HTMLElement | null = null; // line it's level with
  let citeText = "";

  /** A card's cite: the bold cite run, else a whole cite paragraph. "" when the
   *  card has no cite at all (hand-typed cards, analytics) — no label then. */
  function citeOf(unit: HTMLElement): string {
    const el = unit.querySelector(".pmd-cite") ?? unit.querySelector(".pmd-cite-para");
    const t = (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    return t.length > 60 ? t.slice(0, 59) + "…" : t;
  }

  /** Vertical offset of `el` within `root` (which must be positioned). Walks the
   *  offsetParent chain rather than using rects: `.doc-scroll` carries the doc
   *  zoom, so getBoundingClientRect reports zoomed pixels while the label — a
   *  child of that same zoomed box — is positioned in unzoomed ones. */
  function offsetWithin(el: HTMLElement, root: HTMLElement): number {
    let y = 0;
    let n: HTMLElement | null = el;
    while (n && n !== root) {
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    return y;
  }

  function onDocPointerOver(e: PointerEvent) {
    const scroller = e.currentTarget as HTMLElement;
    const t = e.target as HTMLElement | null;
    const unit = t?.closest?.(".pmd-card, .pmd-analytic-unit") as HTMLElement | null;
    if (!unit) { clearCiteHover(); return; }
    const line = (t!.closest(".pmd-card > *, .pmd-analytic-unit > *") ??
      unit.firstElementChild) as HTMLElement | null;
    if (unit === citeUnit && line === citeLine) return; // nothing actually moved
    // Only re-read the cite when the card changes; only measure when the line does.
    if (unit !== citeUnit) { citeUnit = unit; citeText = citeOf(unit); }
    citeLine = line;
    citeHover = citeText && line
      ? { text: citeText, top: offsetWithin(line, scroller) }
      : null;
  }

  function clearCiteHover() {
    citeUnit = null;
    citeLine = null;
    citeText = "";
    citeHover = null;
  }

  export function appendCMNodes(jsonNodes: unknown[]) {
    if (!view || jsonNodes.length === 0) return;
    try {
      jsonNodes.forEach(stripBlankRunMarks);
      const nodes = jsonNodes.map((j) => schema.nodeFromJSON(j));
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, nodes).scrollIntoView());
    } catch (err) {
      console.error("appendCMNodes failed", err);
    }
  }
</script>

<div
  class="speech-doc pmd-document"
  class:compact={settings.compactDoc}
  class:pmd-read-mode={readMode}
  class:pmd-emphasis-box={settings.docTypography.emphasisBox}
  class:pmd-emphasis-bold={settings.docTypography.emphasisBold}
  class:pmd-emphasis-italic={settings.docTypography.emphasisItalic}
  class:pmd-no-pocket-box={!settings.docTypography.pocketBox}
  class:pmd-underline-bold={settings.docTypography.underlineBold}
  class:pmd-undertag-italic={settings.docTypography.undertagItalic}
  class:pmd-undertag-bold={settings.docTypography.undertagBold}
  style="
    --pmd-emphasis-box-size: {settings.docTypography.emphasisBoxSize}pt;
    --pmd-pocket-box-size: {settings.docTypography.pocketBoxSize}pt;
    --pmd-size-pocket: {settings.docTypography.sizePocket}pt;
    --pmd-size-hat: {settings.docTypography.sizeHat}pt;
    --pmd-size-block: {settings.docTypography.sizeBlock}pt;
    --pmd-size-tag: {settings.docTypography.sizeTag}pt;
    --pmd-size-cite: {settings.docTypography.sizeCite}pt;
    --pmd-color-analytic: {settings.docTypography.colorAnalytic};
    --pmd-color-undertag: {settings.docTypography.colorUndertag};
  "
>
  <div class="doc-toolbar">
    <!-- structure styles (Pocket/Hat/Block/Tag/Analytic/Undertag), like CardMirror -->
    <div class="tb-grid styles">
      {#each STYLES as s}
        <button
          class="pill"
          class:active={blockActive(s.type, selTick)}
          onclick={() => setBlock(s.type)}
          title="{s.label} ({keyHint(s.action)})"
        >{s.label}<span class="k">{keyHint(s.action)}</span></button>
      {/each}
    </div>
    <button
      class="pill body"
      class:active={blockActive("paragraph", selTick) || blockActive("card_body", selTick)}
      onclick={() => setBlock("paragraph")}
      title="Body ({keyHint('docBody')})"
    >Body<span class="k">{keyHint("docBody")}</span></button>
    <div class="toolbar-sep"></div>
    <!-- read markings -->
    <div class="tb-grid marks">
      {#each READ_MARKS as m}
        <button
          class="pill"
          class:active={m.mark === "underline_mark" ? underlineActive(selTick) : markActive(m.mark, selTick)}
          onclick={() => (m.mark === "underline_mark" ? toggleUnderline() : mark(m.mark))}
          title="{m.label} ({keyHint(m.action)})"
        >{m.label}<span class="k">{keyHint(m.action)}</span></button>
      {/each}
      <button class="pill" onclick={clearMarks} title="Clear formatting ({keyHint('docClearFormat')})">Clear<span class="k">{keyHint("docClearFormat")}</span></button>
    </div>
    <div class="toolbar-sep"></div>
    <button class="tb-btn" class:active={markActive("bold", selTick)} onclick={() => mark("bold")} title="Bold ({keyHint('docBold')})"><b>B</b></button>
    <button class="tb-btn" class:active={markActive("italic", selTick)} onclick={() => mark("italic")} title="Italic ({keyHint('docItalic')})"><i>I</i></button>
    <button class="tb-btn" class:active={markActive("strikethrough", selTick)} onclick={() => mark("strikethrough")} title="Strikethrough"><s>S</s></button>
    <div class="toolbar-sep"></div>
    <span class="hl-label" title="Highlight (spoken text)">Hl</span>
    {#each HL_COLORS as c}
      <button class="hl-swatch" style="background:{c.css}" onclick={() => setHighlight(c.name)} title="Highlight {c.name}" aria-label="Highlight {c.name}"></button>
    {/each}
    <button class="hl-swatch clear" onclick={() => setHighlight("none")} title="Clear highlight">⌀</button>
    <div class="std-wrap">
      <button class="tb-btn" class:active={stdOpen} onclick={() => (stdOpen = !stdOpen)} title="Standardize highlighting across the doc">Std ▾</button>
      {#if stdOpen}
        <div class="std-backdrop" role="presentation" onclick={() => (stdOpen = false)}></div>
        <div class="std-pop">
          <div class="std-row">
            <span class="std-lbl">Keep (exception):</span>
            <button class="std-none" class:sel={stdExcept === ""} onclick={() => (stdExcept = "")}>none</button>
            {#each HL_COLORS as c}
              <button class="hl-swatch" class:sel={stdExcept === c.name} style="background:{c.css}" onclick={() => (stdExcept = c.name)} title="Keep {c.name}" aria-label="Keep {c.name}"></button>
            {/each}
          </div>
          <div class="std-row">
            <span class="std-lbl">Make all highlights:</span>
            {#each HL_COLORS as c}
              <button class="hl-swatch" style="background:{c.css}" onclick={() => standardizeHighlight(c.name)} title="Standardize all to {c.name}{stdExcept ? ` (except ${stdExcept})` : ''}" aria-label="Standardize to {c.name}"></button>
            {/each}
            <button class="std-strip" onclick={() => standardizeHighlight(null)} title="Remove all highlighting{stdExcept ? ` (except ${stdExcept})` : ''}">Remove all</button>
          </div>
        </div>
      {/if}
    </div>
    <div class="toolbar-sep"></div>
    <button class="tb-btn" class:active={quickOpen} onclick={() => (quickOpen = true)} title="Quick cards — save & reuse snippets ({keyHint('docQuickCards')})">★ Quick</button>
    <button class="tb-btn icon" class:active={searchOpen} onclick={openSearch} title="Find in doc ({keyHint('docFind')})">⌕</button>
    <button class="tb-btn read" class:active={readMode} onclick={toggleReadMode} title="Read mode — show only the read-aloud text">Read</button>
    <button class="tb-btn" onclick={clearDoc} title="Clear the whole document">Clear Doc</button>
    <button class="tb-btn" onclick={exportDoc} title="Export a plain .docx of everything here (keeps analytics)">Export</button>
    <button class="tb-btn send" onclick={sendDoc} title="Send the speech doc as .docx (analytics stripped)">Send</button>
    {#if sendStatus}<span class="send-status">{sendStatus}</span>{/if}
    <div class="toolbar-sep"></div>
    {#if settings.readers.length}
      <div class="read-time" title="Estimated read-aloud time (tags + analytics + highlighted words) at each reader's words-per-minute — set in Settings">
        <span class="rt-words">{spokenWords.toLocaleString()}</span>
        {#each settings.readers as r (r.name)}
          <span class="rt-reader"><span class="rt-name">{r.name}</span> {readTime(spokenWords, r.wpm)}</span>
        {/each}
      </div>
      <div class="toolbar-sep"></div>
    {/if}
    {#if onexpand}
      <button class="tb-btn labeled" onclick={onexpand} title={expanded ? "Shrink the doc back to a side panel" : "Maximize the doc to fill the window"}>
        <span class="tb-ic">{expanded ? "⇥" : "⤢"}</span>{expanded ? "Shrink" : "Maximize"}
      </button>
    {/if}
    {#if onpopout}
      <button class="tb-btn labeled" onclick={onpopout} title={poppedOut ? "Dock the doc back into Nimbus" : "Pop the doc out into its own window"}>
        <span class="tb-ic">{poppedOut ? "⤓" : "⇱"}</span>{poppedOut ? "Dock" : "Pop out"}
      </button>
    {/if}
    <button class="tb-btn icon" class:active={showOutline} onclick={() => (showOutline = !showOutline)} title="Toggle the heading outline">☰</button>
    <span class="doc-label">Speech Doc</span>
  </div>

  {#if searchOpen}
    <div class="doc-find-bar">
      <span class="find-icon">⌕</span>
      <input
        bind:this={searchInputEl}
        bind:value={searchQuery}
        class="find-input"
        placeholder="Find in doc…"
        spellcheck="false"
        oninput={() => { searchFresh = true; runSearch(0); }}
        onkeydown={onSearchKey}
      />
      <span class="find-count">{searchCount ? `${searchIndex + 1}/${searchCount}` : (searchQuery ? "0/0" : "")}</span>
      <button class="find-btn" onclick={() => stepSearch(-1)} title="Previous (⇧↵)" disabled={!searchCount}>↑</button>
      <button class="find-btn" onclick={() => stepSearch(1)} title="Next (↵)" disabled={!searchCount}>↓</button>
      <button class="find-btn close" onclick={closeSearch} title="Close (Esc)">×</button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="doc-body" onpointermove={onOutlineResizeMove} onpointerup={stopOutlineResize}>
    {#if showOutline}
      <aside class="outline" bind:this={outlineEl} style="width: {outlineWidth}px">
        <div class="outline-head">
          <span class="outline-title">Outline</span>
          <span class="outline-levels">
            <button title="Collapse to Pocket" onclick={() => collapseOutlineTo(1)}>P</button>
            <button title="Collapse to Hat" onclick={() => collapseOutlineTo(2)}>H</button>
            <button title="Collapse to Block" onclick={() => collapseOutlineTo(3)}>B</button>
            <button title="Expand all" onclick={() => (collapsedOutline = new Set())}>⊞</button>
          </span>
        </div>
        {#if outline.length === 0}
          <div class="outline-empty">No headings yet.</div>
        {:else}
          {#each visibleOutline as item (item.key)}
            <div class="outline-row lvl{item.level}">
              {#if item.hasKids}
                <button class="outline-arrow" onclick={() => toggleOutline(item.key)}>{collapsedOutline.has(item.key) ? "▸" : "▾"}</button>
              {:else}
                <span class="outline-arrow ghost"></span>
              {/if}
              <button class="outline-item" onclick={() => scrollToPos(item.pos)} title={item.text}>{item.text}</button>
            </div>
          {/each}
        {/if}
      </aside>
      <div
        class="outline-divider"
        class:dragging={resizingOutline}
        onpointerdown={startOutlineResize}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize the outline"
      ></div>
    {/if}
    <div
      class="doc-scroll"
      style="zoom: {settings.docZoom}"
      use:pinchZoom={docZoomOpts}
      onpointerover={onDocPointerOver}
      onpointerleave={clearCiteHover}
    >
      <div class="doc-page" bind:this={mountEl}></div>
      {#if citeHover}
        <span class="cite-hover" style="top: {citeHover.top}px">{citeHover.text}</span>
      {/if}
    </div>
  </div>

  {#if quickOpen}
    <QuickCards
      oncapture={captureQuickCard}
      oninsert={insertQuickCard}
      onclose={() => { quickOpen = false; view?.focus(); }}
    />
  {/if}
</div>

<style>
  .speech-doc {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    border-left: 1px solid var(--border);
    overflow: hidden;
  }
  .doc-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 5px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .toolbar-sep { width: 1px; height: 26px; background: var(--border); margin: 0 3px; }
  /* ── Compact density ──────────────────────────────────────────────────
     Tightens the toolbar (so it wraps into fewer rows) and narrows the
     outline + page gutters, handing the reclaimed space to the document —
     the whole point when the doc lives in the split-screen side panel.
     Toggle in Settings → Appearance ("Compact doc chrome"). */
  .speech-doc.compact .doc-toolbar { padding: 3px 8px; gap: 3px 4px; }
  .speech-doc.compact .toolbar-sep { height: 20px; margin: 0 2px; }
  .speech-doc.compact .pill { padding: 2px 6px; font-size: 11px; gap: 4px; line-height: 1.3; }
  .speech-doc.compact .pill .k { font-size: 9px; }
  .speech-doc.compact .tb-grid { gap: 2px; }
  .speech-doc.compact .tb-btn { padding: 2px 6px; font-size: 12px; min-width: 24px; }
  .speech-doc.compact .tb-btn.icon { min-width: 22px; font-size: 13px; }
  .speech-doc.compact .tb-btn.labeled,
  .speech-doc.compact .tb-btn.read,
  .speech-doc.compact .tb-btn.send { font-size: 11px; padding: 2px 7px; }
  .speech-doc.compact .hl-swatch { width: 15px; height: 15px; }
  .speech-doc.compact .read-time { font-size: 10px; gap: 6px; }
  .speech-doc.compact .outline-head { padding: 2px 5px 4px 8px; letter-spacing: 0; }
  .speech-doc.compact .outline-levels button { width: 15px; height: 15px; font-size: 8px; }
  .speech-doc.compact .outline-item { font-size: 11px; padding: 2px 6px 2px 1px; }
  .speech-doc.compact .outline-row.lvl2 { padding-left: 9px; }
  .speech-doc.compact .outline-row.lvl3 { padding-left: 16px; }
  .speech-doc.compact .outline-row.lvl4 { padding-left: 23px; }
  .speech-doc.compact .doc-page { padding: 8px 12px; }
  /* Labeled structure / mark buttons laid out in a compact CardMirror-style grid. */
  .tb-grid { display: grid; gap: 3px; }
  .tb-grid.styles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tb-grid.marks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    white-space: nowrap;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 5px;
    padding: 3px 9px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    line-height: 1.4;
  }
  .pill:hover { border-color: var(--accent); }
  .pill.active { background: color-mix(in srgb, var(--accent) 20%, var(--bg)); border-color: var(--accent); }
  .pill .k { font-size: 10px; color: var(--text-dim); }
  .pill.active .k { color: color-mix(in srgb, var(--accent) 60%, var(--text)); }
  .pill.body { align-self: stretch; }
  /* Find-in-doc bar */
  .doc-find-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .find-icon { color: var(--text-dim); font-size: 14px; }
  .find-input {
    flex: 1;
    max-width: 320px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    padding: 4px 8px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  .find-input:focus { border-color: var(--accent); }
  .find-count { font-size: 11px; color: var(--text-dim); min-width: 34px; }
  .find-btn {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 4px; width: 24px; height: 24px; cursor: pointer; font-size: 13px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .find-btn:hover:not(:disabled) { border-color: var(--accent); }
  .find-btn:disabled { opacity: 0.4; cursor: default; }
  .find-btn.close { font-size: 16px; }
  /* Match highlights (decorations from the search plugin) */
  .doc-page :global(.doc-find) { background: rgba(255, 213, 0, 0.45); border-radius: 2px; }
  .doc-page :global(.doc-find.current) { background: #ff9f1a; color: #000; }
  .tb-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--text);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 13px;
    cursor: pointer;
    min-width: 28px;
    font-family: inherit;
  }
  .tb-btn:hover { background: var(--bg); border-color: var(--border); }
  .tb-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tb-btn.icon { min-width: 26px; font-size: 14px; }
  .tb-btn.labeled {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    min-width: auto;
    padding: 3px 9px;
  }
  .tb-btn.labeled .tb-ic { font-size: 14px; line-height: 1; }
  .tb-btn.read, .tb-btn.send { font-size: 12px; min-width: auto; padding: 3px 10px; }
  .tb-btn.read.active { background: #2e8b57; border-color: #2e8b57; color: #fff; }
  .tb-btn.send { color: var(--accent); border-color: var(--accent); }
  .send-status { font-size: 11px; color: var(--text-dim); }
  .read-time {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .rt-words { font-weight: 700; color: var(--text); }
  .rt-words::after { content: " words"; font-weight: 400; color: var(--text-dim); }
  .rt-reader { display: inline-flex; align-items: baseline; gap: 3px; }
  .rt-name { color: var(--accent); font-weight: 600; }
  .hl-label { font-size: 11px; color: var(--text-dim); margin: 0 2px; }
  .hl-swatch {
    width: 18px;
    height: 18px;
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
  }
  .hl-swatch:hover { outline: 1.5px solid var(--accent); }
  .hl-swatch.sel { outline: 2px solid var(--accent); outline-offset: 1px; }
  .std-wrap { position: relative; display: inline-flex; }
  .std-backdrop { position: fixed; inset: 0; z-index: 40; }
  .std-pop {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 41;
    margin-top: 4px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 7px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    white-space: nowrap;
  }
  .std-row { display: flex; align-items: center; gap: 5px; }
  .std-lbl { font-size: 11px; color: var(--text-dim); min-width: 96px; }
  .std-none, .std-strip {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    font-size: 11px;
    padding: 2px 7px;
    cursor: pointer;
    font-family: inherit;
  }
  .std-none.sel { border-color: var(--accent); color: var(--accent); }
  .std-none:hover, .std-strip:hover { border-color: var(--accent); }
  .hl-swatch.clear {
    background: var(--bg) !important;
    color: var(--text-dim);
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .doc-label {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .doc-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .outline {
    width: 140px;
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--panel);
    padding: 4px 0;
    container-type: inline-size;
  }
  /* When the rail is dragged narrow, drop the "Outline" word rather than let it
     clip to a ragged sliver — the collapse buttons carry it. */
  @container (max-width: 124px) {
    .outline-title { display: none; }
    .outline .outline-head { justify-content: flex-end; }
  }
  /* Draggable seam between the outline rail and the page — set the rail to any
     width you like; it's remembered. Thin, with a grip so it reads as grabbable. */
  .outline-divider {
    width: 5px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--border);
    position: relative;
    transition: background 0.15s;
  }
  .outline-divider::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 22px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text-dim) 55%, transparent);
  }
  .outline-divider:hover,
  .outline-divider.dragging { background: var(--accent); }
  .outline-divider:hover::before,
  .outline-divider.dragging::before { background: #fff; }
  .outline-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    font-weight: 700;
    padding: 3px 6px 5px 9px;
  }
  .outline-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .outline-levels { display: flex; gap: 2px; flex-shrink: 0; }
  .outline-levels button {
    background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 4px; width: 17px; height: 17px; font-size: 9px; cursor: pointer; padding: 0;
  }
  .outline-levels button:hover { color: var(--text); border-color: var(--accent); }
  .outline-empty { font-size: 11px; color: var(--text-dim); padding: 4px 9px; }
  .outline-row { display: flex; align-items: center; }
  .outline-row.lvl1 { padding-left: 2px; }
  .outline-row.lvl2 { padding-left: 11px; }
  .outline-row.lvl3 { padding-left: 20px; }
  .outline-row.lvl4 { padding-left: 29px; }
  .outline-arrow {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    width: 13px; font-size: 9px; padding: 0; flex-shrink: 0;
  }
  .outline-arrow.ghost { cursor: default; }
  .outline-item {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    padding: 3px 7px 3px 1px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .outline-item:hover { background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
  .outline-row.lvl1 .outline-item { font-weight: 700; }
  .outline-row.lvl2 .outline-item { font-weight: 600; }
  .outline-row.lvl4 .outline-item { color: var(--text-dim); }
  /* Full-bleed editor (like CardMirror) — no floating "paper" page, the text
     fills the whole panel edge to edge, top to bottom. */
  .doc-scroll {
    flex: 1;
    overflow-y: auto;
    background: #fff;
    padding: 0;
    /* Containing block for the hover cite label below. */
    position: relative;
  }
  /* The hovered card's cite, at the right edge and level with the line under the
     pointer. Informational only — it must never take a click or a caret. */
  .cite-hover {
    position: absolute;
    right: 6px;
    max-width: 45%;
    pointer-events: none;
    user-select: none;
    z-index: 5;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 17px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  }
  :global([data-theme="dark"]) .doc-scroll { background: #1c1c1c; }
  :global([data-theme="slate"]) .doc-scroll { background: #2b3038; }
  .doc-page {
    max-width: none;
    margin: 0;
    background: #fff;
    padding: 10px 16px;
    box-shadow: none;
    min-height: 100%;
    box-sizing: border-box;
    /* The doc/editing surface follows the default font (Calibri by default). */
    font-family: var(--doc-font, "Calibri", "Segoe UI", Arial, sans-serif);
  }
  :global([data-theme="dark"]) .doc-page { background: #1c1c1c; }
  :global([data-theme="slate"]) .doc-page { background: #2b3038; }
  .doc-page :global(.ProseMirror) { min-height: 100%; caret-color: #1a6fd4; }
  :global([data-theme="dark"]) .doc-page :global(.ProseMirror),
  :global([data-theme="slate"]) .doc-page :global(.ProseMirror) { caret-color: #4a9eff; }
</style>
