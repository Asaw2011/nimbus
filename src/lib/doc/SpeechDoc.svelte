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
  import { guard, reportError } from "$lib/model/crash";
  import { pinchZoom } from "$lib/util/pinch";
  import QuickCards from "./QuickCards.svelte";
  import "$lib/cardmirror/cardmirror.css";

  let {
    onchange = null,
    initialDoc = null,
    docId = null,
    onpopout = null,
    onexpand = null,
    expanded = false,
    poppedOut = false,
    onTilde = null,
  }: {
    onchange?: ((json: unknown) => void) | null;
    initialDoc?: unknown;
    /** Identifies which doc is loaded. When it changes, the editor swaps to that
     *  doc's cached state (preserving its undo history) instead of remounting. */
    docId?: string | null;
    onpopout?: (() => void) | null;
    onexpand?: (() => void) | null;
    expanded?: boolean;
    poppedOut?: boolean;
    /** When set, pressing ` / ~ sends the current card/selection here (used by
     *  source docs to "send to speech"). Fixed key — not rebindable. */
    onTilde?: ((cmNodes: unknown[]) => void) | null;
  } = $props();

  let mountEl = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let mounted = false;
  // Ticks on every transaction so toolbar active-states recompute on cursor move.
  let selTick = $state(0);

  // ── Heading outline (collapsible nav tree, like CardMirror) ──────
  interface OutlineItem { pos: number; level: number; text: string; }
  let outline = $state<OutlineItem[]>([]);
  let showOutline = $state(true);
  let collapsedOutline = $state<Set<number>>(new Set());

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
      if (collapsedOutline.has(it.pos)) hideLevel = it.level;
    });
    return res;
  });

  function toggleOutline(pos: number) {
    const next = new Set(collapsedOutline);
    if (next.has(pos)) next.delete(pos); else next.add(pos);
    collapsedOutline = next;
  }
  // Collapse the whole outline to a given level (Pocket=1 / Hat=2 / Block=3).
  function collapseOutlineTo(level: number) {
    const next = new Set<number>();
    outline.forEach((it, i) => {
      const child = outline[i + 1];
      if (it.level >= level && child && child.level > it.level) next.add(it.pos);
    });
    collapsedOutline = next;
  }
  const HEADING_LEVEL: Record<string, number> = {
    pocket: 1, hat: 2, block: 3, card: 4, tag: 4, analytic: 4, analytic_unit: 4,
  };

  function rebuildOutline() {
    if (!view) return;
    const items: OutlineItem[] = [];
    try {
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
          // you type its text.
          if (text) items.push({ pos, level: lvl, text });
          return false;
        }
        const text = node.textContent.trim();
        if (text) items.push({ pos, level: lvl, text });
      }
      return undefined;
    });
    } catch (err) { console.error("rebuildOutline failed", err); }
    outline = items;
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
      view.dispatch(tr);
      view.focus();
      // Scroll the clicked heading to the TOP of the pane (like CardMirror),
      // rather than parking it at the bottom edge (ProseMirror's "nearest").
      const at = view.domAtPos(clamped).node;
      const el = at.nodeType === 3 ? at.parentElement : (at as HTMLElement);
      el?.scrollIntoView({ block: "start", behavior: "auto" });
    } catch { rebuildOutline(); }
  }
  let applyingExternal = false;

  // Per-doc EditorState cache so switching tabs and coming back keeps that doc's
  // full undo history — remounting the editor would throw the history away.
  const stateCache = new Map<string, EditorState>();
  let currentDocId: string | null = null;
  // The last doc JSON that serialized cleanly — the recovery point if a later
  // transaction lands the editor on a corrupt, un-editable state.
  let lastGoodJSON: unknown = null;

  /** Rebuild the editor from the last good doc so editing keeps working after a
   *  corrupt-node crash (instead of being stuck on a half-applied state). */
  function recoverDoc() {
    if (!view) return;
    try {
      view.updateState(buildState(lastGoodJSON));
      rebuildOutline();
      view.focus();
    } catch (err) {
      reportError("SpeechDoc.recoverDoc", err);
    }
  }

  /** A node is "safe" if ProseMirror can actually walk it. A corrupt fragment
   *  (a child ends up undefined) throws `c.nodeSize` inside nodesBetween on the
   *  next edit/focus and aborts the whole operation (e.g. backspace stops
   *  deleting). Drop such nodes at the door instead of letting them into state. */
  function isSafeNode(n: PMNode): boolean {
    try {
      n.check();
      n.descendants(() => true);
      return true;
    } catch {
      return false;
    }
  }

  /** Recursively drop null/undefined children and holes from `content` arrays.
   *  A sparse/holey content array reaches ProseMirror as a Fragment with an
   *  `undefined` child, which crashes `nodesBetween` (`c.nodeSize`) on the next
   *  edit/focus and freezes the whole app. Sanitizing on the way in prevents it. */
  function sanitizeCMJson<T>(json: T): T {
    if (Array.isArray(json)) {
      return json.filter((x) => x != null).map((x) => sanitizeCMJson(x)) as unknown as T;
    }
    if (json && typeof json === "object") {
      const out = { ...(json as Record<string, unknown>) };
      if (Array.isArray(out.content)) {
        out.content = out.content.filter((x) => x != null).map((x) => sanitizeCMJson(x));
      }
      return out as unknown as T;
    }
    return json;
  }

  /** Build a fresh EditorState (with its own history) from doc JSON. */
  function buildState(json: unknown): EditorState {
    const doc = json
      ? (() => {
          try { return schema.nodeFromJSON(sanitizeCMJson(json)); } catch { return undefined; }
        })()
      : undefined;
    return EditorState.create({
      schema,
      doc,
      plugins: [
        readModePlugin(),
        searchPlugin(),
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        // CardMirror's tag/analytic boundary rules (Backspace/Delete/Enter),
        // ported verbatim so the doc edits exactly like CardMirror. Each returns
        // false for the non-tag cases so the base keymap handles them.
        keymap({
          Backspace: chainCommands(
            backspaceAtTagStart, backspaceAtFirstBodyStart,
            keepCursorInLeadingBlockOnBlockedMerge, blockBackspaceNodeSelect,
          ),
          Delete: chainCommands(
            deleteAtTagEnd, deleteAtContainerEnd,
            keepCursorInLeadingBlockOnBlockedMerge, blockDeleteNodeSelect,
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
    lastGoodJSON = initialDoc ?? null;
    if (docId) stateCache.set(docId, state);

    view = new EditorView(mountEl, {
      state,
      // All doc shortcuts route through settings.keymap (configurable in
      // Settings → keybinds → "Speech doc"), read live so rebinds take effect
      // immediately. Runs before the base keymap so it can override ⌘←/⌘↑/etc.
      handleKeyDown: (_v, e) => docKeydown(e),
      // Typing the third hyphen turns "---" into a single em dash (—).
      handleTextInput: (v, from, _to, text) => {
        if (text !== "-" || from < 2) return false;
        if (v.state.doc.textBetween(from - 2, from, undefined, "￼") !== "--") return false;
        v.dispatch(v.state.tr.insertText("—", from - 2, from));
        return true;
      },
      // Focusing the doc claims it as the active surface, so the flow ribbon's
      // text controls (B / I / color / size) act on the doc.
      handleDOMEvents: {
        focus: () => { store.activeSurface = "doc"; syncDocSelSize(); return false; },
      },
      dispatchTransaction(tr: Transaction) {
        if (!view) return;
        // apply() runs plugin appendTransactions and updateState re-renders —
        // either can throw on a corrupt node. If so, revert to the last good
        // doc so editing (backspace/delete/typing) keeps working instead of
        // getting stuck on a half-applied, un-editable state.
        try {
          view.updateState(view.state.apply(tr));
        } catch (err) {
          reportError("SpeechDoc.apply", err);
          recoverDoc();
          return;
        }
        selTick++;
        guard("SpeechDoc.dispatch", () => {
          if (tr.selectionSet || tr.docChanged) syncDocSelSize();
          if (tr.docChanged) {
            rebuildOutline();
            if (view) {
              const json = view.state.doc.toJSON(); // throws if the doc is corrupt
              lastGoodJSON = json;
              if (!applyingExternal) onchange?.(json);
            }
          }
        });
      },
    });
    rebuildOutline();
    view.focus();
  });

  // Switching tabs changes docId. Swap the editor to that doc's state — its
  // cached state (undo history intact) if we've edited it this session, else a
  // fresh one from the loaded content. No remount, so history survives.
  $effect(() => {
    const id = docId;
    if (!view || !mounted || id === currentDocId) return;
    if (currentDocId) stateCache.set(currentDocId, view.state);
    const next = (id && stateCache.get(id)) || buildState(initialDoc);
    if (id) stateCache.set(id, next);
    currentDocId = id;
    view.updateState(next);
    try { lastGoodJSON = next.doc.toJSON(); } catch { /* keep prior good */ }
    rebuildOutline();
    syncDocSelSize();
    view.focus();
  });

  /** Serialise the current document to JSON (for pop-out handoff / persistence). */
  export function getDocJSON(): unknown {
    return view?.state.doc.toJSON() ?? null;
  }

  /** Drop a doc's cached editor state so the next switch to it rebuilds from its
   *  (freshly saved) blob — used after a background append to a non-shown doc. */
  export function invalidateCache(id: string) {
    if (id === currentDocId) return; // the live doc is already up to date
    stateCache.delete(id);
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
    const nodes = sorted.map((s) => s.node).filter(isSafeNode);
    if (!nodes.length) return;
    if (nodes.length === top.length && sorted.every((s, idx) => s.i === idx)) return; // already ordered
    const frag = Fragment.fromArray(nodes);
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
    const fs = schema.marks.font_size;
    const { from, to, empty } = view.state.selection;
    let hp: number | null = null;
    // Clamp every position into the document — a stale selection after a tab
    // swap can point past the end, and nodesBetween(a, to>size) throws
    // `nodeSize` of undefined, which (inside an $effect) freezes the doc UI.
    const size = view.state.doc.content.size;
    const a = Math.min(Math.max(0, empty ? from - 1 : from), size);
    const b = Math.min(Math.max(a + 1, to), size);
    try {
      view.state.doc.nodesBetween(a, b, (node) => {
        if (hp !== null) return false;
        if (node.isText) {
          const m = node.marks.find((x) => x.type === fs);
          if (m) hp = Number(m.attrs.halfPoints);
        }
        return true;
      });
    } catch { /* out-of-range/transient state — fall back to the base size */ }
    return hp != null ? hp / 2 : baseSizeForSelection();
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
      const slice = Slice.fromJSON(schema, sanitizeCMJson(contentJson) as never);
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
    if (!view) return;
    nodes = nodes.filter(isSafeNode);
    if (nodes.length === 0) return;
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
    if (!isSafeNode(card)) return;
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
    const nt = schema.nodes[type];
    if (!nt) { view.focus(); return; }
    const { state } = view;
    // Normal in-place change first (works for paragraph/pocket/hat/block that
    // aren't a card's required first child).
    if (setBlockType(nt)(state, view.dispatch)) { view.focus(); return; }
    // Blocked because the cursor is in a card's/analytic_unit's required heading
    // (tag/analytic) — a card can't just swap its tag for another block type. So
    // UNWRAP the card: replace it with [newBlock(heading text), ...body], so you
    // can freely switch a tag to any style instead of being grid-locked.
    const at = state.selection.$from;
    for (let d = at.depth - 1; d >= 0; d--) {
      const node = at.node(d);
      if (node.type.name === "card" || node.type.name === "analytic_unit") {
        const start = at.before(d);
        const end = at.after(d);
        const head = node.firstChild; // tag / analytic
        const repl: PMNode[] = [nt.create(null, head ? head.content : undefined)];
        node.forEach((child, _off, i) => { if (i > 0) repl.push(child); }); // keep body
        const tr = state.tr.replaceWith(start, end, repl);
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start + 1, tr.doc.content.size))));
        view.dispatch(tr.scrollIntoView());
        view.focus();
        return;
      }
    }
    view.focus();
  }

  // Tag lives inside a card — wrap the current line in a card > tag.
  function makeCard() {
    if (!view) return;
    const { state } = view;
    const pos = state.selection.$from;
    const text = pos.parent.textContent;
    const tag = schema.nodes.tag.create(
      { id: crypto.randomUUID() },
      text ? [schema.text(text)] : undefined,
    );
    const card = schema.nodes.card.create(null, [tag]);
    const from = pos.before();
    const to = pos.after();
    const tr = state.tr.replaceWith(from, to, card);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  // Analytic lives inside an analytic_unit — the plain setBlockType can't create
  // one. Wrap the current line in an analytic_unit > analytic so you can type it.
  function makeAnalytic() {
    if (!view) return;
    const { state } = view;
    const pos = state.selection.$from;
    const para = pos.parent;
    const text = para.textContent;
    const heading = schema.nodes.analytic.create(
      { id: crypto.randomUUID() },
      text ? [schema.text(text)] : undefined,
    );
    const unit = schema.nodes.analytic_unit.create(null, [heading]);
    const from = pos.before();
    const to = pos.after();
    const tr = state.tr.replaceWith(from, to, unit);
    // Put the cursor inside the analytic heading.
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
    view.dispatch(tr.scrollIntoView());
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

  /** Capture the current card/selection as CardMirror node JSON (for `~` send). */
  function captureForTilde(): unknown[] {
    if (!view) return [];
    const sel = view.state.selection;
    if (!sel.empty) {
      const out: unknown[] = [];
      sel.content().content.forEach((n) => out.push(n.toJSON()));
      return out;
    }
    // Send the SECTION owned by the heading at the cursor (like CardMirror):
    //  - on a Hat heading  → the whole hat (its blocks, analytics, and cards)
    //  - on a Block heading → the whole block and nothing else
    //  - on a single card/analytic → just that one card.
    const doc = view.state.doc;
    const idx = sel.$from.index(0); // which top-level node the cursor is in
    if (idx < 0 || idx >= doc.childCount) return [];
    const topNode = doc.child(idx);
    const name = topNode.type.name;
    if (name === "card" || name === "analytic_unit") return [topNode.toJSON()];
    const LEVEL: Record<string, number> = { pocket: 1, hat: 2, block: 3 };
    const myLevel = LEVEL[name];
    if (!myLevel) return [topNode.toJSON()];
    // The section = this heading + following top-level nodes until the next
    // heading of the same or a higher level.
    const out: unknown[] = [topNode.toJSON()];
    for (let i = idx + 1; i < doc.childCount; i++) {
      const n = doc.child(i);
      const lvl = LEVEL[n.type.name] ?? 5; // cards/analytics/bodies are "below" a heading
      if (lvl <= myLevel) break;
      out.push(n.toJSON());
    }
    return out;
  }

  /** Insert CardMirror node JSON at the cursor (after the current top-level
   *  node), keeping images. Used by "send to speech" and at-cursor sends. */
  export function insertCMAtCursor(nodes: unknown[]) {
    if (!view || !nodes.length) return;
    try {
      nodes.forEach(stripBlankRunMarks);
      insertPMAtCursor(nodes.map((j) => schema.nodeFromJSON(sanitizeCMJson(j) as never)));
    } catch (err) {
      console.error("insertCMAtCursor failed", err);
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
    if (!view) return;
    pm = pm.filter(isSafeNode);
    if (!pm.length) return;
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
    // FIXED (unchangeable) — ` / ~ sends the current card/selection to the
    // speech doc at the cursor, like CardMirror/Verbatim "send to speech".
    if (onTilde && (e.key === "`" || e.key === "~") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      onTilde(captureForTilde());
      return true;
    }
    // Undo/redo — handled explicitly here (this runs before every other keymap)
    // so the doc always undoes its OWN history, never the flow's, regardless of
    // plugin ordering or which surface the window's key handler thinks is active.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { if (view) undo(view.state, view.dispatch); return true; }
      if ((k === "z" && e.shiftKey) || k === "y") { if (view) redo(view.state, view.dispatch); return true; }
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
    if (matchesAny(e, km.docUnderline)) return hit(() => mark("underline_mark"));
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
    if (searchQuery) runSearch(0);
  }
  function closeSearch() {
    searchOpen = false;
    if (view) view.dispatch(view.state.tr.setMeta(searchKey, { query: "", index: 0 }));
    view?.focus();
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
        .setSelection(TextSelection.create(view.state.doc, m.from, m.to))
        .scrollIntoView();
      tr.setMeta(searchKey, { query: searchQuery, index: searchIndex });
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
    }
  }
  function stepSearch(dir: number) {
    if (searchCount === 0) { runSearch(0); return; }
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
    void saveDocx(stripAnalytics(view.state.doc), "Speech.docx");
  }

  /** Export = a plain .docx of exactly what's here, analytics and all. */
  function exportDoc() {
    if (!view) return;
    void saveDocx(view.state.doc, "Document.docx");
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

  export function appendCMNodes(jsonNodes: unknown[]) {
    if (!view || jsonNodes.length === 0) return;
    try {
      jsonNodes.forEach(stripBlankRunMarks);
      const nodes = jsonNodes.map((j) => schema.nodeFromJSON(sanitizeCMJson(j))).filter(isSafeNode);
      if (!nodes.length) return;
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, nodes).scrollIntoView());
    } catch (err) {
      console.error("appendCMNodes failed", err);
    }
  }
</script>

<div
  class="speech-doc pmd-document"
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
      class:active={blockActive("paragraph", selTick)}
      onclick={() => setBlock("paragraph")}
      title="Body ({keyHint('docBody')})"
    >Body<span class="k">{keyHint("docBody")}</span></button>
    <div class="toolbar-sep"></div>
    <!-- read markings -->
    <div class="tb-grid marks">
      {#each READ_MARKS as m}
        <button
          class="pill"
          class:active={markActive(m.mark, selTick)}
          onclick={() => mark(m.mark)}
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
        oninput={() => runSearch(0)}
        onkeydown={onSearchKey}
      />
      <span class="find-count">{searchCount ? `${searchIndex + 1}/${searchCount}` : (searchQuery ? "0/0" : "")}</span>
      <button class="find-btn" onclick={() => stepSearch(-1)} title="Previous (⇧↵)" disabled={!searchCount}>↑</button>
      <button class="find-btn" onclick={() => stepSearch(1)} title="Next (↵)" disabled={!searchCount}>↓</button>
      <button class="find-btn close" onclick={closeSearch} title="Close (Esc)">×</button>
    </div>
  {/if}

  <div class="doc-body">
    {#if showOutline}
      <aside class="outline">
        <div class="outline-head">
          <span>Outline</span>
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
          {#each visibleOutline as item (item.pos)}
            <div class="outline-row lvl{item.level}">
              {#if item.hasKids}
                <button class="outline-arrow" onclick={() => toggleOutline(item.pos)}>{collapsedOutline.has(item.pos) ? "▸" : "▾"}</button>
              {:else}
                <span class="outline-arrow ghost"></span>
              {/if}
              <button class="outline-item" onclick={() => scrollToPos(item.pos)} title={item.text}>{item.text}</button>
            </div>
          {/each}
        {/if}
      </aside>
    {/if}
    <div
      class="doc-scroll"
      style="zoom: {settings.docZoom}"
      use:pinchZoom={{ get: () => settings.docZoom, set: (z) => settings.setDocZoomLive(z), commit: () => settings.save() }}
    >
      <div class="doc-page" bind:this={mountEl}></div>
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
    width: 200px;
    flex-shrink: 0;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--panel);
    padding: 6px 0;
  }
  .outline-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    font-weight: 700;
    padding: 4px 8px 6px 12px;
  }
  .outline-levels { display: flex; gap: 2px; }
  .outline-levels button {
    background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 4px; width: 18px; height: 18px; font-size: 10px; cursor: pointer; padding: 0;
  }
  .outline-levels button:hover { color: var(--text); border-color: var(--accent); }
  .outline-empty { font-size: 12px; color: var(--text-dim); padding: 4px 12px; }
  .outline-row { display: flex; align-items: center; }
  .outline-row.lvl1 { padding-left: 4px; }
  .outline-row.lvl2 { padding-left: 14px; }
  .outline-row.lvl3 { padding-left: 24px; }
  .outline-row.lvl4 { padding-left: 34px; }
  .outline-arrow {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    width: 14px; font-size: 9px; padding: 0; flex-shrink: 0;
  }
  .outline-arrow.ghost { cursor: default; }
  .outline-item {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    padding: 3px 8px 3px 2px;
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
  }
  :global([data-theme="dark"]) .doc-scroll { background: #1c1c1c; }
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
  .doc-page :global(.ProseMirror) { min-height: 100%; caret-color: #1a6fd4; }
  :global([data-theme="dark"]) .doc-page :global(.ProseMirror) { caret-color: #4a9eff; }
</style>
