<script lang="ts">
  import { store } from "../model/round.svelte";
  import { settings } from "../model/settings.svelte";
  import { sheetAccent } from "../model/types";
  import { matchesAny, combosLabel } from "../model/keymap";
  import Grid from "./Grid.svelte";
  import Ribbon from "./Ribbon.svelte";
  import RoundHome from "./RoundHome.svelte";
  import SpreadView from "./SpreadView.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";
  import DocSearch from "$lib/search/DocSearch.svelte";
  import SpeechDoc from "$lib/doc/SpeechDoc.svelte";
  import { docBridge } from "$lib/doc/docBridge.svelte";
  import { docsStore } from "$lib/doc/docs.svelte";
  import type { DocNode } from "$lib/docx/parse";
  import type { Cell } from "../model/types";
  import { pinchZoom } from "$lib/util/pinch";
  import Manual from "./Manual.svelte";
  import QuickCardsPanel from "./QuickCardsPanel.svelte";

  let { onexit }: { onexit: () => void } = $props();

  let atHome = $state(true);
  let showHelp = $state(false);
  let showManual = $state(false);
  let showQuickCards = $state(false);
  // Spread view: several sheets visible at once, stacked or side-by-side.
  let spreadMode = $state<"off" | "vertical" | "horizontal">("off");
  let lastSpread = $state<"vertical" | "horizontal">("vertical");
  let hiddenInSpread = $state<string[]>([]);
  const spread = $derived(spreadMode !== "off");
  // Tab drag & drop reordering (Excel-style: grab a tab, slide it into place)
  let draggingTab = $state<string | null>(null);
  let dragOverIdx = $state<number | null>(null);
  let dragBefore = $state(true);

  /**
   * The whole strip is the drop zone: wherever the pointer is, snap to the
   * nearest slot between tabs (including past either end).
   */
  function trackDrag(e: DragEvent) {
    e.preventDefault();
    const strip = e.currentTarget as HTMLElement;
    const tabs = [...strip.querySelectorAll<HTMLElement>("[data-tabidx]")];
    dragOverIdx = tabs.length - 1;
    dragBefore = false;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        dragOverIdx = Number(t.dataset.tabidx);
        dragBefore = true;
        break;
      }
    }
  }

  function dropTab(e: DragEvent) {
    e.preventDefault();
    if (draggingTab && round && dragOverIdx !== null) {
      const from = round.sheets.findIndex((s) => s.id === draggingTab);
      let to = dragBefore ? dragOverIdx : dragOverIdx + 1;
      if (from >= 0 && from < to) to--;
      store.reorderSheet(draggingTab, to);
    }
    draggingTab = null;
    dragOverIdx = null;
  }
  let showSettings = $state(false);
  let showDocSearch = $state(false);
  let docOpen = $state(false);
  // Docked width is user-resizable and remembered across sessions. Can go
  // narrow (240px) so the doc doesn't crowd the flow.
  const DOC_MIN_W = 240;
  function loadDocWidth(): number {
    const saved = Number(localStorage.getItem("flow.docWidth"));
    return saved >= DOC_MIN_W ? saved : 380;
  }
  let docWidth = $state(loadDocWidth());
  let docExpanded = $state(false);
  interface DocAPI {
    appendCard(h: string, c: string): void;
    appendBlocks(l: string[]): void;
    insertAtCursor(h: string, c: string): void;
    appendNode(n: unknown): void;
    getDocJSON(): unknown;
    setDocJSON(j: unknown): void;
    removeByText(t: string): void;
    appendCMNodes(nodes: unknown[]): void;
    reorderByFlow(order: Record<string, number>): void;
    toggleBold(): void;
    toggleItalic(): void;
    setDocColor(hex: string | null): void;
    bumpDocFontSize(delta: number): void;
    insertCMAtCursor(nodes: unknown[]): void;
    insertNodeAtCursor(node: unknown): void;
  }
  let docRef = $state<DocAPI | null>(null);
  let resizingDoc = $state(false);

  // ── multiple speech docs (tabs) ──────────────────────────────────
  let docsReady = $state(false);
  let activeContent = $state<unknown>(null); // initialDoc for the active instance
  let docKey = $state(0); // bumped to remount the editor for a new/switched doc
  let renamingDocId = $state<string | null>(null);
  let docStatus = $state("");

  // Bring up the docs library the first time the doc opens.
  $effect(() => {
    if (docOpen && !docsReady) void initDocs();
  });
  async function initDocs() {
    await docsStore.init();
    activeContent = await docsStore.loadContent(docsStore.activeId);
    docsReady = true;
  }

  // Debounced doc-content save — the editor's onchange fires per keystroke, but
  // writing the (possibly image-heavy) doc to disk every stroke is wasteful.
  let docSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function onDocChange(json: unknown) {
    const id = docsStore.activeId;
    if (docSaveTimer) clearTimeout(docSaveTimer);
    docSaveTimer = setTimeout(() => docsStore.saveContent(id, json), 350);
  }

  /** Persist the doc currently in the editor to its blob (flush any pending). */
  function saveCurrentDoc() {
    if (docSaveTimer) { clearTimeout(docSaveTimer); docSaveTimer = null; }
    if (docsStore.activeId && docRef) {
      docsStore.saveContent(docsStore.activeId, docRef.getDocJSON());
    }
  }

  async function switchDoc(id: string) {
    if (id === docsStore.activeId) return;
    saveCurrentDoc();
    const content = await docsStore.loadContent(id);
    activeContent = content;
    docsStore.setActive(id);
    // No docKey bump: the editor keeps mounted and swaps to this doc's state via
    // the docId prop, so each doc's undo history survives a tab switch.
  }

  function newDoc() {
    saveCurrentDoc();
    activeContent = null;
    docsStore.newDoc("Untitled");
    // No docKey bump: the new doc gets a fresh state via its docId, and the
    // other docs keep their in-editor undo history.
  }

  async function closeDoc(id: string) {
    if (docBridge.isPoppedOut(id)) await docBridge.dock(id); // close its window
    const wasActive = id === docsStore.activeId;
    docsStore.close(id);
    if (wasActive) {
      activeContent = await docsStore.loadContent(docsStore.activeId);
      docKey++;
    }
  }

  function renameDoc(id: string, name: string) {
    docsStore.rename(id, name);
    renamingDocId = null;
  }

  /** Open a .docx into a NEW doc via CardMirror's importer. */
  async function openDocx() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, filters: [{ name: "Word Document", extensions: ["docx"] }] });
      if (!path || typeof path !== "string") return;
      docStatus = "Opening…";
      const { invoke } = await import("@tauri-apps/api/core");
      const bytes = await invoke<number[]>("read_binary_file", { path });
      const { fromDocx } = await import("$lib/cardmirror");
      const doc = await fromDocx(new Uint8Array(bytes));
      const name = (path.split(/[\\/]/).pop() ?? "Document").replace(/\.docx$/i, "");
      saveCurrentDoc();
      activeContent = doc.toJSON();
      docsStore.addFromContent(name, activeContent);
      docKey++;
      docStatus = "";
    } catch (err) {
      console.error("open docx failed", err);
      docStatus = "Couldn't open that .docx";
      setTimeout(() => (docStatus = ""), 2500);
    }
  }

  function startDocResize(e: PointerEvent) {
    resizingDoc = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDocResizeMove(e: PointerEvent) {
    if (!resizingDoc) return;
    const newWidth = window.innerWidth - e.clientX;
    // The popped-out placeholder holds no editor, so it can shrink much smaller
    // than the docked doc (which needs room for the toolbar + page).
    const min = DOC_MIN_W;
    docWidth = Math.min(window.innerWidth * 0.65, Math.max(min, newWidth));
  }
  function stopDocResize() {
    resizingDoc = false;
    localStorage.setItem("flow.docWidth", String(Math.round(docWidth)));
  }

  // A closed doc means the ribbon's text controls belong to the flow again.
  $effect(() => { if (!docOpen) store.activeSurface = "flow"; });

  // "Send to speech": ` / ~ from ANY source doc (a popped-out window) sends its
  // current card to the designated speech doc (★). The MAIN window is the sole
  // router — popped-out windows don't load docsStore, so only here do we know
  // which doc is the target and where it currently lives.
  $effect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let un: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      un = await listen<unknown[]>("nimbus:send-to-speech", (e) => void routeToSpeech(e.payload));
    })();
    return () => un?.();
  });

  /** Append CardMirror node JSON to the end of a stored doc's content — used
   *  when the speech doc isn't open anywhere (no live cursor to insert at). */
  function appendCMToDocJSON(content: unknown, nodes: unknown[]): unknown {
    const doc =
      content && typeof content === "object" && (content as { type?: string }).type === "doc"
        ? (content as { type: string; content?: unknown[] })
        : { type: "doc", content: [] };
    return { ...doc, content: [...(doc.content ?? []), ...nodes] };
  }

  /** Route sent cards to the ★ speech doc, wherever it is: the docked live
   *  editor, a popped-out window, or (if closed) its stored blob. */
  async function routeToSpeech(nodes: unknown[]) {
    if (!nodes?.length) return;
    const id = docsStore.speechDocId ?? docsStore.activeId;
    if (!id) return;
    if (id === docsStore.activeId && !docBridge.isPoppedOut(id) && docRef) {
      docOpen = true;
      docRef.insertCMAtCursor(nodes);
    } else if (docBridge.isPoppedOut(id)) {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("nimbus:insert-into-speech", { id, nodes });
    } else {
      const content = await docsStore.loadContent(id);
      docsStore.saveContent(id, appendCMToDocJSON(content, nodes));
    }
    const name = docsStore.docs.find((d) => d.id === id)?.name ?? "speech";
    flashDocStatus(`Sent to ★ ${name}`);
  }

  let docStatusTimer: ReturnType<typeof setTimeout> | null = null;
  function flashDocStatus(msg: string) {
    docStatus = msg;
    if (docStatusTimer) clearTimeout(docStatusTimer);
    docStatusTimer = setTimeout(() => (docStatus = ""), 1800);
  }

  // The docked (main) doc is always the flow-linked one, so inserts + sends
  // always target the docked editor.
  function appendToDoc(node: unknown) {
    docRef?.appendNode(node);
  }

  /** Pop a doc out into its own window. The docked/main doc is never also
   *  popped out, so if it's the active one, hand the docked slot to another. */
  async function popOutDoc(id: string) {
    const entry = docsStore.docs.find((d) => d.id === id);
    if (!entry) return;
    if (id === docsStore.activeId) {
      saveCurrentDoc();
      const other = docsStore.docs.find((d) => d.id !== id && !docBridge.isPoppedOut(d.id));
      if (other) {
        const c = await docsStore.loadContent(other.id);
        docsStore.setActive(other.id);
        activeContent = c;
      } else {
        docsStore.newDoc("Untitled");
        activeContent = null;
      }
      docKey++;
    }
    await docBridge.popOut(id, entry.name);
  }
  function popOutActiveDoc() {
    if (docsStore.activeId) void popOutDoc(docsStore.activeId);
  }

  /** Dock a popped-out doc back in and make it the active/main doc. */
  async function dockDoc(id: string) {
    await docBridge.dock(id);
    saveCurrentDoc();
    const c = await docsStore.loadContent(id);
    docsStore.setActive(id);
    activeContent = c;
    docKey++;
  }

  /** Mark a doc as THE speech doc (the ` / ~ send target) and make it the live
   *  docked editor, so cards sent from any popped-out source doc land in it. */
  function makeSpeechDoc(id: string) {
    docsStore.setSpeechDoc(id);
    docOpen = true;
    if (docBridge.isPoppedOut(id)) void dockDoc(id);
    else if (id !== docsStore.activeId) void switchDoc(id);
  }

  /** Doc-tab click: focus its window if popped out, else make it the main doc. */
  function docTabClick(id: string) {
    if (docBridge.isPoppedOut(id)) {
      const entry = docsStore.docs.find((d) => d.id === id);
      if (entry) void docBridge.popOut(id, entry.name);
    } else {
      void switchDoc(id);
    }
  }

  const CHIP_LEVEL: Record<string, number> = { POC: 1, HAT: 2, BLK: 3, TAG: 4, CARD: 4 };
  function stubNode(text: string, opts: { level?: number; analytic?: boolean } = {}): DocNode {
    return {
      level: opts.level ?? 4,
      isAnalytic: !!opts.analytic,
      text,
      runs: [],
      children: [],
      body: [],
      bodyRuns: [],
    } as unknown as DocNode;
  }

  // A doc "op" is either an exact CardMirror node (with images, sent verbatim)
  // or a DocNode (text-only adapter path).
  type DocOp = { cm: unknown } | { node: DocNode };

  // The doc content a cell contributes, IN ORDER. A card with a captured
  // CardMirror node keeps its images; typed text is your analysis → an ANALYTIC.
  function cellDocOps(cell: Cell | undefined): DocOp[] {
    if (!cell) return [];
    const text = cell.text?.trim();
    if (cell.items?.length) {
      const out: DocOp[] = [];
      if (text) {
        // Header only — its child cards live in `items`, don't duplicate them.
        out.push({ node: cell.card ? { ...(cell.card as DocNode), children: [] } : stubNode(text, { level: CHIP_LEVEL[cell.chip ?? ""] ?? 3 }) });
      }
      for (const it of cell.items) {
        if (it.kind === "card") out.push(it.cmNode ? { cm: it.cmNode } : { node: (it.card as DocNode) ?? stubNode(it.text) });
        else if (it.text?.trim()) out.push({ node: stubNode(it.text.trim(), { analytic: true }) });
      }
      return out;
    }
    if (cell.cmNode) return [{ cm: cell.cmNode }];
    if (cell.card) return [{ node: cell.card as DocNode }];
    if (text) return [{ node: stubNode(text, { analytic: true }) }]; // typed cell → analytic
    return [];
  }

  /** Label of a CardMirror node (tag/analytic heading text, else its text). */
  function cmNodeLabel(n: unknown): string {
    const flat = (x: unknown): string => {
      const y = x as { text?: string; content?: unknown[] };
      return y.text ?? (y.content ?? []).map(flat).join("");
    };
    const o = n as { type?: string; content?: unknown[] };
    if ((o.type === "card" || o.type === "analytic_unit") && o.content?.length) return flat(o.content[0]).trim();
    return flat(n).trim();
  }

  /** Map every label in the cursor's column → its flow position, so the doc can
   *  be reordered to match. Header, then items, row by row, top to bottom. */
  function columnOrder(col: number): Record<string, number> {
    const map: Record<string, number> = {};
    const sheet = store.round?.sheets.find((s) => s.id === store.activeSheetId);
    let n = 0;
    for (const row of sheet?.rows ?? []) {
      const cell = row.cells[col];
      if (!cell) continue;
      const t = cell.text?.trim();
      if (t && !(t in map)) map[t] = n++;
      for (const it of cell.items ?? []) {
        const it2 = it.text?.trim();
        if (it2 && !(it2 in map)) map[it2] = n++;
      }
    }
    return map;
  }

  /** Send a set of doc ops to the docked doc.
   *  - "cursor": drop them where the cursor is, in order, no reordering — for a
   *    cell / range / text grab that you're placing by hand.
   *  - "flow": de-dup by label (re-send replaces) and reorder the whole doc to
   *    match the flow — for building the whole speech top-to-bottom. */
  function sendOpsToDoc(ops: DocOp[], col: number, mode: "flow" | "cursor") {
    if (mode === "cursor") {
      for (const op of ops) {
        if ("cm" in op) docRef?.insertCMAtCursor([op.cm]);
        else docRef?.insertNodeAtCursor(op.node);
      }
      return;
    }
    for (const op of ops) {
      if ("cm" in op) {
        const label = cmNodeLabel(op.cm);
        if (label) docRef?.removeByText(label);
        docRef?.appendCMNodes([op.cm]);
      } else {
        const label = (op.node.text ?? "").trim();
        if (label) docRef?.removeByText(label);
        appendToDoc(op.node);
      }
    }
    docRef?.reorderByFlow(columnOrder(col));
  }

  // "Remove": clear the current cell (text/chip/card) AND delete its matching
  // card from the speech doc.
  function removeCellAndDoc() {
    if (!store.cursor || !store.activeSheetId) return;
    const { row, col } = store.cursor;
    const sheet = store.round?.sheets.find((s) => s.id === store.activeSheetId);
    const cell = sheet?.rows[row]?.cells[col];
    if (!cell) return;
    const text = cell.text.trim();
    if (text) docRef?.removeByText(text);
    store.mutate((r) => {
      const s = r.sheets.find((x) => x.id === store.activeSheetId);
      const c = s?.rows[row]?.cells[col];
      if (c) { c.text = ""; delete c.chip; delete c.card; delete c.marks; }
    });
  }

  // Selection send → AT THE CURSOR: the current cell, or — when a range is
  // selected — every selected cell's content, dropped where the cursor is.
  function sendCellToDoc() {
    if (!store.activeSheetId) return;
    const sheet = store.round?.sheets.find((s) => s.id === store.activeSheetId);
    if (!sheet) return;
    docOpen = true;
    const rect = store.hasMultiSelection ? store.selRect : null;
    if (rect) {
      // All selected cells, row by row, left to right.
      const ops: DocOp[] = [];
      for (let r = rect.r0; r <= rect.r1; r++)
        for (let c = rect.c0; c <= rect.c1; c++)
          ops.push(...cellDocOps(sheet.rows[r]?.cells[c]));
      sendOpsToDoc(ops, rect.c0, "cursor");
      return;
    }
    if (!store.cursor) return;
    const { row, col } = store.cursor;
    sendOpsToDoc(cellDocOps(sheet.rows[row]?.cells[col]), col, "cursor");
  }

  // "Send Entire Row" → FLOW ORDER: every cell in the current column, top to
  // bottom (de-duped, so re-sending updates rather than duplicates), reordered
  // to mirror the flow.
  function sendSpeechToDoc() {
    if (!store.cursor || !store.activeSheetId) return;
    const col = store.cursor.col;
    const sheet = store.round?.sheets.find((s) => s.id === store.activeSheetId);
    if (!sheet) return;
    docOpen = true;
    const ops = sheet.rows.flatMap((r) => cellDocOps(r.cells[col]));
    sendOpsToDoc(ops, col, "flow");
  }
  let addingSheet = $state(false);
  let newSheetTitle = $state("");
  // Tab right-click menu + inline rename.
  let tabMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let menuEl = $state<HTMLElement>();
  let menuReady = $state(false);
  let renamingTab = $state<string | null>(null);
  let renameValue = $state("");

  // Clamp the context menu into the viewport (tabs sit at the bottom, so it
  // must open upward/inward instead of falling off the edge).
  $effect(() => {
    if (tabMenu && menuEl) {
      const r = menuEl.getBoundingClientRect();
      const m = 8;
      let x = tabMenu.x;
      let y = tabMenu.y;
      if (x + r.width + m > window.innerWidth) x = window.innerWidth - r.width - m;
      if (y + r.height + m > window.innerHeight) y = tabMenu.y - r.height;
      if (y < m) y = m;
      if (x < m) x = m;
      menuEl.style.left = `${x}px`;
      menuEl.style.top = `${y}px`;
      menuReady = true;
    } else {
      menuReady = false;
    }
  });

  function openTabMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    tabMenu = { id, x: e.clientX, y: e.clientY };
  }
  function startRenameTab(id: string) {
    const s = store.round?.sheets.find((s) => s.id === id);
    renamingTab = id;
    renameValue = s?.title ?? "";
    tabMenu = null;
  }
  function commitRenameTab() {
    if (renamingTab && renameValue.trim()) {
      store.renameSheet(renamingTab, renameValue.trim());
    }
    renamingTab = null;
  }
  function deleteTab(id: string) {
    tabMenu = null;
    store.deleteSheet(id);
  }

  const round = $derived(store.round);
  const sheet = $derived(store.activeSheet);
  const km = $derived(settings.keymap);
  const mac = settings.isMac;
  function openSheet(sheetId: string) {
    // Save the current cursor row before leaving the active sheet.
    if (store.activeSheetId && !atHome && store.cursor) {
      sheetLastRow.set(store.activeSheetId, store.cursor.row);
    }
    store.activeSheetId = sheetId;
    const target = round?.sheets.find((s) => s.id === sheetId);
    const startCol = target?.startCol ?? 0;
    // Preserve the current speech column across sheets; clamp to the target's
    // startCol so you never land in a dead (hatched) column.
    const col = Math.max(store.cursor?.col ?? startCol, startCol);
    // Restore the last cursor row for this sheet, defaulting to row 1 (row 0
    // is the LABEL cell, so row 1 is the first real content row).
    const maxRow = Math.max(0, (target?.rows.length ?? 1) - 1);
    const row = Math.min(sheetLastRow.get(sheetId) ?? 1, maxRow);
    store.cursor = { row, col };
    atHome = false;
    spreadMode = "off";
  }

  function setSpread(mode: "vertical" | "horizontal") {
    spreadMode = spreadMode === mode ? "off" : mode;
    if (spreadMode !== "off") {
      lastSpread = mode;
      atHome = false;
    }
  }

  function toggleSheetOnDesk(sheetId: string) {
    hiddenInSpread = hiddenInSpread.includes(sheetId)
      ? hiddenInSpread.filter((id) => id !== sheetId)
      : [...hiddenInSpread, sheetId];
  }

  function tabClick(sheetId: string) {
    if (spread) {
      toggleSheetOnDesk(sheetId);
    } else {
      openSheet(sheetId);
    }
  }

  // Remember the last cursor row for each sheet so keybind navigation restores
  // position instead of always jumping to row 0.
  const sheetLastRow = new Map<string, number>();

  /** Move to the sheet left (-1) or right (+1) of the current one; wraps.
   *  Works in normal view and in spread (moves the focused flow). */
  function moveToSheet(delta: number) {
    const sheets = round?.sheets ?? [];
    if (sheets.length === 0) return;
    if (spread) {
      // Cycle the active flow through the ones on the desk.
      const visible = sheets.filter((s) => !hiddenInSpread.includes(s.id));
      if (visible.length === 0) return;
      let vi = visible.findIndex((s) => s.id === store.activeSheetId);
      if (vi < 0) vi = 0;
      const nv = visible.length;
      const target = visible[(((vi + delta) % nv) + nv) % nv];
      if (store.activeSheetId && store.cursor) sheetLastRow.set(store.activeSheetId, store.cursor.row);
      store.activeSheetId = target.id;
      const sCol = Math.max(store.cursor?.col ?? target.startCol, target.startCol);
      const sRow = Math.min(sheetLastRow.get(target.id) ?? 1, Math.max(0, target.rows.length - 1));
      store.cursor = { row: sRow, col: sCol };
      return;
    }
    let idx = sheets.findIndex((s) => s.id === store.activeSheetId);
    if (atHome || idx < 0) idx = delta > 0 ? -1 : 0;
    const n = sheets.length;
    openSheet(sheets[(((idx + delta) % n) + n) % n].id);
  }

  /** Reorder the current sheet one position left/right (keyboard, no drag). */
  function reorderCurrent(delta: number) {
    if (!round || !store.activeSheetId) return;
    const idx = round.sheets.findIndex((s) => s.id === store.activeSheetId);
    if (idx < 0) return;
    store.reorderSheet(store.activeSheetId, idx + delta);
  }

  function onkeydown(e: KeyboardEvent) {
    // Keystrokes inside the speech doc belong to the doc (it has its own undo,
    // ⌘1-6 styles, etc.). Don't let flow shortcuts (undo/redo, ⌘1-9 tab switch)
    // also fire off the same keypress.
    if (e.target instanceof HTMLElement && e.target.closest(".speech-doc")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if (mod && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
      e.preventDefault();
      store.redo();
    } else if (matchesAny(e, km.newSheet)) {
      e.preventDefault();
      addingSheet = true;
    } else if (matchesAny(e, km.prevSheet)) {
      e.preventDefault();
      moveToSheet(-1);
    } else if (matchesAny(e, km.nextSheet)) {
      e.preventDefault();
      moveToSheet(1);
    } else if (matchesAny(e, km.moveSheetLeft)) {
      e.preventDefault();
      reorderCurrent(-1);
    } else if (matchesAny(e, km.moveSheetRight)) {
      e.preventDefault();
      reorderCurrent(1);
    } else if (matchesAny(e, km.toggleSpread)) {
      e.preventDefault();
      setSpread(lastSpread);
    } else if (matchesAny(e, km.goHome)) {
      e.preventDefault();
      // Save position so returning to this sheet restores it.
      if (store.activeSheetId && store.cursor) {
        sheetLastRow.set(store.activeSheetId, store.cursor.row);
      }
      atHome = true;
    } else if (matchesAny(e, km.toggleHelp)) {
      e.preventDefault();
      showHelp = !showHelp;
    } else if (matchesAny(e, km.openSettings)) {
      e.preventDefault();
      showSettings = !showSettings;
    } else if (matchesAny(e, km.openDocSearch)) {
      e.preventDefault();
      showDocSearch = !showDocSearch;
    } else if (matchesAny(e, km.zoomReset)) {
      e.preventDefault();
      settings.zoomReset();
    } else if (matchesAny(e, km.zoomIn)) {
      e.preventDefault();
      settings.zoomIn();
    } else if (matchesAny(e, km.zoomOut)) {
      e.preventDefault();
      settings.zoomOut();
    } else if (mod && e.key === "d" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      docOpen = !docOpen;
    } else if (mod && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const target = round?.sheets[idx];
      if (target) {
        e.preventDefault();
        // In spread mode the number keys toggle sheets on/off the desk.
        if (spread) toggleSheetOnDesk(target.id);
        else openSheet(target.id);
      }
    }
  }

  function createSheet() {
    if (!newSheetTitle.trim()) return;
    const id = store.addSheet(newSheetTitle.trim());
    newSheetTitle = "";
    addingSheet = false;
    openSheet(id);
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#snippet tabs()}
  <div class="tabs" class:bottom={settings.tabsPosition === "bottom"} role="tablist">
    <button class="tab home-tab" class:active={atHome} onclick={() => (atHome = true)}>
      ⌂ Home
    </button>
    {#each round?.sheets ?? [] as s, i (s.id)}
      <!-- div, not button: WebKit won't start HTML5 drags from buttons -->
      <div
        class="tab"
        class:active={spread
          ? !hiddenInSpread.includes(s.id)
          : !atHome && s.id === store.activeSheetId}
        class:spread-hidden={spread && hiddenInSpread.includes(s.id)}
        class:dragging={draggingTab === s.id}
        class:drag-before={dragOverIdx === i && dragBefore && draggingTab !== s.id}
        class:drag-after={dragOverIdx === i && !dragBefore && draggingTab !== s.id}
        style="--stripe: {sheetAccent(s)}"
        role="button"
        tabindex="0"
        draggable="true"
        data-tabidx={i}
        ondragstart={(e) => {
          draggingTab = s.id;
          e.dataTransfer?.setData("text/plain", s.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        ondragend={() => {
          draggingTab = null;
          dragOverIdx = null;
        }}
        onclick={() => tabClick(s.id)}
        onkeydown={(e) => e.key === "Enter" && tabClick(s.id)}
        oncontextmenu={(e) => openTabMenu(e, s.id)}
      >
        {#if renamingTab === s.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="tab-rename"
            bind:value={renameValue}
            autofocus
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRenameTab();
              if (e.key === "Escape") renamingTab = null;
            }}
            onblur={commitRenameTab}
          />
        {:else}
          <span class="tab-num">{i + 1}</span>
          {s.title || "(untitled)"}
        {/if}
      </div>
    {/each}
    <button class="tab new" onclick={() => (addingSheet = true)} title="New sheet ({combosLabel(km.newSheet, mac)})">+</button>
  </div>
{/snippet}

{#if round}
  <!-- While a tab is being dragged, the whole window is the drop zone:
       only horizontal position decides the slot, so drops can't miss. -->
  <div
    class="flow-view"
    role="application"
    ondragover={draggingTab ? trackDrag : undefined}
    ondrop={draggingTab ? dropTab : undefined}
  >
    <div class="topbar">
      <button class="back" onclick={onexit} title="Back to rounds">←</button>
      <span class="round-name">{round.name}</span>
      <span class="meta">
        {round.template.name}{round.tournament ? ` · ${round.tournament}` : ""}
      </span>
      <span class="spacer"></span>
      <button class="icon-btn" class:active={docOpen} onclick={() => (docOpen = !docOpen)} title="Speech doc (⌘D)">📄</button>
      <button class="icon-btn" class:active={showQuickCards} onclick={() => (showQuickCards = !showQuickCards)} title="Quick cards — drag onto the flow">★</button>
      <button class="icon-btn" onclick={() => (showManual = true)} title="Manual — how everything works">📖</button>
      <button class="icon-btn" onclick={() => (showSettings = true)} title="Settings ({combosLabel(km.openSettings, mac)})">⚙</button>
      <button class="icon-btn" onclick={() => (showHelp = !showHelp)} title="Keybinds ({combosLabel(km.toggleHelp, mac)})">?</button>
    </div>

    {#if !atHome}
      <Ribbon
        {spreadMode}
        onspread={setSpread}
        onsendspeech={sendSpeechToDoc}
        onsendcell={sendCellToDoc}
        onremove={removeCellAndDoc}
        ondocbold={() => docRef?.toggleBold()}
        ondocitalic={() => docRef?.toggleItalic()}
        ondoccolor={(hex) => docRef?.setDocColor(hex)}
        ondocfontsize={(d) => docRef?.bumpDocFontSize(d)}
      />
    {/if}

    {#if settings.tabsPosition === "top"}{@render tabs()}{/if}

    <!-- Split workspace: flow on left, speech doc on right -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="workspace"
      onpointermove={onDocResizeMove}
      onpointerup={stopDocResize}
    >
      {#if !(docExpanded && docOpen && !spread)}
        <div
          class="flow-pane"
          use:pinchZoom={{ get: () => settings.zoom, set: (z) => settings.setZoomLive(z), commit: () => settings.save() }}
        >
          {#if spread && round}
            <SpreadView
              sheets={round.sheets}
              hidden={hiddenInSpread}
              direction={spreadMode === "horizontal" ? "horizontal" : "vertical"}
              ontoggle={toggleSheetOnDesk}
              onset={(h) => (hiddenInSpread = h)}
            />
          {:else if atHome || !sheet}
            <RoundHome onopensheet={openSheet} />
          {:else}
            <!-- Zoom applies to the single main flow only (WebView2/Chromium
                 `zoom`); the spread view zooms its own panels independently. -->
            <div class="zoom-wrap" style="zoom: {settings.zoom}">
              <Grid {sheet} />
            </div>
          {/if}
        </div>
      {/if}

      {#if docOpen}
        {#if !docExpanded}
          <div class="doc-divider" onpointerdown={startDocResize} role="separator" aria-orientation="vertical"></div>
        {/if}
        <div class="doc-pane" style={docExpanded ? "flex:1" : `width: ${docWidth}px`}>
          <div class="doc-tabs">
            {#each docsStore.docs as d (d.id)}
              {@const out = docBridge.isPoppedOut(d.id)}
              <div class="doc-tab" class:active={d.id === docsStore.activeId && !out} class:out>
                {#if renamingDocId === d.id}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    class="doc-tab-rename"
                    value={d.name}
                    autofocus
                    onblur={(e) => renameDoc(d.id, e.currentTarget.value)}
                    onkeydown={(e) => {
                      if (e.key === "Enter") renameDoc(d.id, e.currentTarget.value);
                      if (e.key === "Escape") renamingDocId = null;
                    }}
                  />
                {:else}
                  {@const isSpeech = d.id === docsStore.speechDocId}
                  <button
                    class="doc-tab-star"
                    class:on={isSpeech}
                    title={isSpeech ? "This is your speech doc — ` / ~ from any other doc sends cards here" : "Make this the speech doc (the ` / ~ send target)"}
                    onclick={() => makeSpeechDoc(d.id)}
                  >{isSpeech ? "★" : "☆"}</button>
                  <button class="doc-tab-name" onclick={() => docTabClick(d.id)} ondblclick={() => (renamingDocId = d.id)} title={out ? "In its own window — click to focus it" : "Double-click to rename"}>{d.name}</button>
                  {#if out}
                    <button class="doc-tab-icon" title="Dock back into Nimbus (make it the main doc)" onclick={() => dockDoc(d.id)}>⤓</button>
                  {:else}
                    <button class="doc-tab-icon" title="Pop out into its own window" onclick={() => popOutDoc(d.id)}>⇱</button>
                  {/if}
                  <button class="doc-tab-x" title="Close doc" onclick={() => closeDoc(d.id)}>×</button>
                {/if}
              </div>
            {/each}
            <button class="doc-tab-add" onclick={newDoc} title="New doc">＋</button>
            <button class="doc-tab-open" onclick={openDocx} title="Open a .docx into a new doc">📂 Open</button>
            {#if docStatus}<span class="doc-tab-status">{docStatus}</span>{/if}
          </div>
          <div class="doc-editor-wrap">
            {#if docsReady}
              {#key docKey}
                <SpeechDoc
                  bind:this={docRef}
                  initialDoc={activeContent}
                  docId={docsStore.activeId}
                  onchange={onDocChange}
                  expanded={docExpanded}
                  poppedOut={false}
                  onexpand={() => (docExpanded = !docExpanded)}
                  onpopout={popOutActiveDoc}
                  onTilde={docsStore.activeId !== docsStore.speechDocId ? (nodes) => void routeToSpeech(nodes) : null}
                />
              {/key}
            {/if}
          </div>
        </div>
      {/if}
    </div>

    {#if settings.tabsPosition === "bottom"}{@render tabs()}{/if}

    {#if tabMenu}
      <div class="ctx-backdrop" role="presentation"
        onclick={() => (tabMenu = null)} oncontextmenu={(e) => { e.preventDefault(); tabMenu = null; }}></div>
      {@const menuId = tabMenu.id}
      <div class="ctx-menu" class:ready={menuReady} bind:this={menuEl}>
        <button onclick={() => startRenameTab(menuId)}>Rename</button>
        <button class="danger" onclick={() => deleteTab(menuId)}>Delete flow</button>
      </div>
    {/if}

    {#if addingSheet}
      <div
        class="modal-backdrop"
        onclick={() => (addingSheet = false)}
        onkeydown={(e) => e.key === "Escape" && (addingSheet = false)}
        role="presentation"
      >
        <div
          class="modal"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          role="dialog"
          tabindex="-1"
        >
          <h3>New sheet</h3>
          <input
            placeholder="Title (e.g. Cap K, Econ DA, T-Subsets)"
            bind:value={newSheetTitle}
            onkeydown={(e) => e.key === "Enter" && createSheet()}
          />
          <button class="primary" onclick={createSheet}>Create</button>
        </div>
      </div>
    {/if}

    {#if showSettings}
      <SettingsPanel onclose={() => (showSettings = false)} />
    {/if}

    {#if showDocSearch}
      <DocSearch
        onclose={() => (showDocSearch = false)}
        onappenddoc={(node) => { docOpen = true; appendToDoc(node); }}
        onappendcm={(nodes) => { docOpen = true; docRef?.appendCMNodes(nodes); }}
      />
    {/if}

    {#if showManual}
      <Manual onclose={() => (showManual = false)} />
    {/if}

    {#if showQuickCards}
      <QuickCardsPanel onclose={() => (showQuickCards = false)} />
    {/if}

    {#if showHelp}
      <div class="help">
        <h3>Keybinds</h3>
        <table>
          <tbody>
            <tr><td><kbd>↵</kbd> / <kbd>↑↓</kbd></td><td>Move down / up a row</td></tr>
            <tr><td><kbd>Tab</kbd> / <kbd>⇧Tab</kbd></td><td>Next / previous speech</td></tr>
            <tr><td><kbd>⇧↵</kbd></td><td>New line inside a cell</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRowBelow, mac)}</kbd></td><td>Insert row below</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRowAbove, mac)}</kbd></td><td>Insert row above</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRow3Below, mac)}</kbd></td><td>Insert 3 rows below</td></tr>
            <tr><td><kbd>{combosLabel(km.insertRow3Above, mac)}</kbd></td><td>Insert 3 rows above</td></tr>
            <tr><td><kbd>{combosLabel(km.deleteRow, mac)}</kbd></td><td>Delete row</td></tr>
            <tr><td><kbd>{combosLabel(km.extendArg, mac)}</kbd></td><td>Extend argument → next speech</td></tr>
            <tr><td><kbd>{combosLabel(km.markDropped, mac)}</kbd></td><td>Mark dropped</td></tr>
            <tr><td><kbd>{combosLabel(km.markStarred, mac)}</kbd></td><td>Star (must answer)</td></tr>
            <tr><td><kbd>{combosLabel(km.markAnalytic, mac)}</kbd></td><td>Mark analytic (ink color)</td></tr>
            <tr><td><kbd>{combosLabel(km.markCard, mac)}</kbd></td><td>Mark card (ink color)</td></tr>
            <tr><td><kbd>{mac ? "⌘" : "Ctrl"}1–9</kbd></td><td>Jump to sheet</td></tr>
            <tr><td><kbd>{combosLabel(km.prevSheet, mac)}</kbd> / <kbd>{combosLabel(km.nextSheet, mac)}</kbd></td><td>Previous / next sheet</td></tr>
            <tr><td><kbd>{combosLabel(km.moveSheetLeft, mac)}</kbd> / <kbd>{combosLabel(km.moveSheetRight, mac)}</kbd></td><td>Move sheet left / right</td></tr>
            <tr><td><kbd>{mac ? "⌘" : "Ctrl"}C</kbd> / <kbd>{mac ? "⌘" : "Ctrl"}V</kbd></td><td>Copy / paste cells (Excel-style)</td></tr>
            <tr><td><kbd>{combosLabel(km.openDocSearch, mac)}</kbd></td><td>Doc Search (search prep files)</td></tr>
            <tr><td><kbd>{combosLabel(km.toggleSpread, mac)}</kbd></td><td>Spread view (tabs toggle sheets)</td></tr>
            <tr><td><kbd>{combosLabel(km.goHome, mac)}</kbd></td><td>Round home</td></tr>
            <tr><td><kbd>{combosLabel(km.newSheet, mac)}</kbd></td><td>New sheet</td></tr>
            <tr><td><kbd>{combosLabel(km.openSettings, mac)}</kbd></td><td>Settings</td></tr>
            <tr><td><kbd>trigger + space</kbd></td><td>Expand abbreviation (t/ → Turn:)</td></tr>
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/if}

<style>
  .flow-view {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .back {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 16px;
    cursor: pointer;
  }
  .round-name {
    font-weight: 600;
    font-size: 14px;
  }
  .meta {
    color: var(--text-dim);
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .icon-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 50%;
    width: 24px;
    height: 24px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }
  .icon-btn.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent);
    color: var(--accent);
  }
  /* Split workspace */
  .workspace {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }
  .flow-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .zoom-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .doc-divider {
    position: relative;
    width: 6px;
    background: var(--border);
    cursor: col-resize;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  /* Grip dots so the drag handle is obviously grabbable. */
  .doc-divider::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 26px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text-dim) 55%, transparent);
  }
  .doc-divider:hover { background: var(--accent); }
  .doc-divider:hover::before { background: #fff; }
  .doc-pane {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 240px;
  }
  /* Doc tabs (multiple speech docs) */
  .doc-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    border-left: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .doc-tab {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
    flex-shrink: 0;
    max-width: 180px;
  }
  .doc-tab.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--bg)); }
  .doc-tab-star {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1;
    padding: 4px 2px 4px 6px;
    cursor: pointer;
    opacity: 0.55;
  }
  .doc-tab-star:hover { opacity: 1; }
  .doc-tab-star.on { color: #f5b301; opacity: 1; }
  .doc-tab-name {
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    padding: 4px 8px;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }
  .doc-tab.active .doc-tab-name { font-weight: 600; }
  .doc-tab-x {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1;
    padding: 0 6px 0 0;
    cursor: pointer;
  }
  .doc-tab-x:hover { color: var(--mark-dropped, #c0392b); }
  .doc-tab-icon {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
  }
  .doc-tab-icon:hover { color: var(--accent); }
  .doc-tab.out { opacity: 0.7; border-style: dashed; }
  .doc-tab.out .doc-tab-name { font-style: italic; }
  .doc-tab-rename {
    background: var(--bg);
    border: none;
    color: var(--text);
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
    font-family: inherit;
    max-width: 160px;
  }
  .doc-tab-add, .doc-tab-open {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 12px;
    padding: 4px 8px;
    cursor: pointer;
    flex-shrink: 0;
    font-family: inherit;
  }
  .doc-tab-add:hover, .doc-tab-open:hover { border-color: var(--accent); }
  .doc-tab-status { font-size: 11px; color: var(--text-dim); margin-left: 4px; white-space: nowrap; }
  .doc-editor-wrap { flex: 1; min-height: 0; display: flex; }
  .doc-editor-wrap > :global(.speech-doc) { flex: 1; min-width: 0; }
  /* Excel-style sheet tab strip: flat joined tabs with dividers */
  .tabs {
    display: flex;
    gap: 0;
    padding: 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-shrink: 0;
  }
  .tabs.bottom {
    border-bottom: none;
    border-top: 1px solid var(--border);
  }
  .tab {
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    border-radius: 0;
    /* Tab text takes the sheet's color, like your template's blue/red pages */
    color: var(--stripe, var(--text-dim));
    /* Inactive tabs recede — no stripe, half opacity — so the current sheet
     * reads unambiguously. */
    opacity: 0.5;
    padding: 7px 18px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
    box-sizing: border-box;
  }
  .tab:hover {
    opacity: 0.85;
    background: color-mix(in srgb, var(--bg) 50%, var(--panel));
  }
  /* Active tab: full opacity, heavier, tinted in its own sheet color, with a
   * 3px accent bar on the edge facing the grid (top when tabs sit at the
   * bottom, bottom when they sit at the top). */
  .tab.active {
    opacity: 1;
    font-weight: 800;
    background: color-mix(in srgb, var(--stripe, var(--accent)) 12%, var(--bg));
    box-shadow: inset 0 3px 0 var(--stripe, var(--accent));
  }
  .tabs.bottom .tab.active {
    box-shadow: inset 0 3px 0 var(--stripe, var(--accent));
  }
  .tabs:not(.bottom) .tab.active {
    box-shadow: inset 0 -3px 0 var(--stripe, var(--accent));
  }
  .tab.dragging {
    opacity: 0.35;
  }
  .tab.spread-hidden {
    opacity: 0.4;
  }
  .tab-rename {
    background: var(--bg);
    border: 1px solid var(--accent);
    color: var(--text);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 12px;
    width: 110px;
  }
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .ctx-menu {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 31;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    min-width: 130px;
    opacity: 0; /* hidden until clamped into the viewport */
  }
  .ctx-menu.ready {
    opacity: 1;
  }
  .ctx-menu button {
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 6px 10px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
  }
  .ctx-menu button:hover {
    background: color-mix(in srgb, var(--accent) 15%, var(--panel));
  }
  .ctx-menu .danger {
    color: var(--mark-dropped);
  }
  .tab.drag-before {
    box-shadow:
      inset 3px 0 0 var(--accent),
      inset 0 2px 0 var(--stripe, transparent);
  }
  .tab.drag-after {
    box-shadow:
      inset -3px 0 0 var(--accent),
      inset 0 2px 0 var(--stripe, transparent);
  }
  .tab.home-tab,
  .tab.new {
    font-weight: 400;
  }
  .tab-num {
    color: var(--text-dim);
    font-size: 10px;
    margin-right: 5px;
    opacity: 0.7;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  .modal {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 320px;
  }
  .modal h3 {
    margin: 0;
    font-size: 14px;
  }
  .modal input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 13px;
  }
  .primary {
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: 4px;
    padding: 6px;
    cursor: pointer;
    font-weight: 600;
  }
  .help {
    position: fixed;
    right: 12px;
    bottom: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    z-index: 10;
    font-size: 12px;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
  }
  .help h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .help td {
    padding: 2px 8px 2px 0;
    color: var(--text-dim);
  }
  kbd {
    background: var(--kbd-bg);
    border: 1px solid var(--kbd-border);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
  }
</style>
