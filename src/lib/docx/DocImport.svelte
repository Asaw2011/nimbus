<script lang="ts">
  // DOCX-IMPORT feature (self-contained; delete this folder + the marked
  // block in RoundHome.svelte + `npm uninstall fflate` to remove it).
  //
  // Import an opponent's speech doc: each selected top-level section becomes
  // a sheet, its heading tree becomes rows in the chosen speech column.

  import { parseDocx, flowLines, guessTargetSheet, type ParsedDoc, type DocNode } from "./parse";
  import { store } from "../model/round.svelte";
  import { INITIAL_ROWS, makeSheet, makeRow } from "../model/types";

  let parsed = $state<ParsedDoc | null>(null);
  let rawNodes = $state<DocNode[]>([]); // original tree before level-splitting
  let fileName = $state("");
  let status = $state("");
  let checked = $state<boolean[]>([]);
  /** Per section: "new" = create a sheet, else the id of an existing sheet. */
  let targets = $state<string[]>([]);
  let speechIdx = $state(0);
  /** "auto" or a heading level 1–4 chosen by the user. */
  let splitLevel = $state<"auto" | 1 | 2 | 3 | 4>("auto");

  /** Collect every node at exactly `level`, walking into shallower nodes. */
  function nodesAtLevel(roots: DocNode[], level: number): DocNode[] {
    const out: DocNode[] = [];
    const walk = (ns: DocNode[]) => {
      for (const n of ns) {
        if (n.level === level) out.push(n);
        else if (n.level < level) walk(n.children);
      }
    };
    walk(roots);
    return out;
  }

  /**
   * Auto-detect the argument level: find the shallowest heading level that has
   * 3+ nodes across the whole doc — that's almost always the "one sheet per
   * argument" level (H1 for a multi-advantage 1AC, H3 for a 1NC where all
   * off-case positions live under a single H2 "OFF" hat).
   * Falls back to the single-chain unwrap if no level clears 3 nodes.
   */
  function autoSplit(roots: DocNode[]): DocNode[] {
    for (const level of [1, 2, 3, 4] as const) {
      const at = nodesAtLevel(roots, level);
      if (at.length >= 3) return at;
    }
    // Fewer than 3 nodes at every level — walk down single-child chains.
    let unwrapped = roots;
    while (unwrapped.length === 1 && unwrapped[0].children.length > 0) {
      unwrapped = unwrapped[0].children;
    }
    return unwrapped.length >= 2 ? unwrapped : roots;
  }

  /** Re-apply the current split level to the raw tree. */
  function applySplit(roots: DocNode[], level: "auto" | 1 | 2 | 3 | 4): DocNode[] {
    if (level === "auto") return autoSplit(roots);
    const at = nodesAtLevel(roots, level);
    return at.length >= 2 ? at : autoSplit(roots);
  }

  const speeches = $derived(store.round?.template.speeches ?? []);

  let guessNote = $state("");

  /**
   * Best signal, independent of how anyone names their docs: the round
   * itself. If the doc's sections match existing sheets (an answer doc) and
   * those sheets are filled through some column, the answers belong in the
   * NEXT column — rounds progress left to right.
   */
  function guessColumnFromRound(targetIds: string[]): number | null {
    const matched = (store.round?.sheets ?? []).filter((s) =>
      targetIds.includes(s.id),
    );
    if (matched.length === 0) return null;
    let lastUsedCol = -1;
    for (const sh of matched) {
      for (const row of sh.rows) {
        row.cells.forEach((c, ci) => {
          if (c.text.trim() && ci > lastUsedCol) lastUsedCol = ci;
        });
      }
    }
    if (lastUsedCol < 0 || lastUsedCol + 1 >= speeches.length) return null;
    return lastUsedCol + 1;
  }

  /** Weaker fallback: an abbr in the filename ("...2AC.docx" → 2AC). */
  function guessColumnFromName(name: string): number | null {
    const flat = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    let best = -1;
    let bestLen = 0;
    speeches.forEach((sp, i) => {
      const ab = sp.abbr.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (ab.length > 1 && ab.length > bestLen && flat.includes(ab)) {
        best = i;
        bestLen = ab.length;
      }
    });
    return best >= 0 ? best : null;
  }

  /** Where a section will land, so there's never a mystery about placement. */
  function placement(i: number): string {
    const abbr = speeches[speechIdx]?.abbr ?? "?";
    const sh = store.round?.sheets.find((s) => s.id === targets[i]);
    if (!sh) return `new sheet · fills ${abbr}`;
    const lastUsed = sh.rows.findLastIndex(
      (r) => r.cells[speechIdx]?.text.trim() !== "",
    );
    return `fills ${abbr} from row ${lastUsed + 2}`;
  }

  function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileName = file.name;
    status = "";
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const base = parseDocx(reader.result as ArrayBuffer);
        rawNodes = base.nodes;
        splitLevel = "auto";
        const nodes = applySplit(rawNodes, "auto");
        parsed = { ...base, nodes };
        checked = nodes.map(() => true);
        // Guess where each section belongs: an answer doc ("AT: Cap K")
        // matches the existing Cap K sheet; unmatched sections make new ones.
        const sheets = store.round?.sheets ?? [];
        targets = nodes.map(
          (n) => guessTargetSheet(n.text, sheets) ?? "new",
        );
        // Column guess, strongest signal first. Always overridable.
        const fromRound = guessColumnFromRound(targets);
        const fromName = guessColumnFromName(file.name);
        if (fromRound !== null) {
          speechIdx = fromRound;
          guessNote = `guessed — matched sheets are filled up to ${speeches[fromRound - 1]?.abbr ?? "?"}`;
        } else if (fromName !== null) {
          speechIdx = fromName;
          guessNote = "guessed from the filename";
        } else {
          const negIdx = speeches.findIndex((s) => s.side === "neg");
          speechIdx = Math.max(0, negIdx);
          guessNote = "default — double-check the column";
        }
        if (nodes.length === 0) {
          status = `Read ${base.paragraphCount} paragraphs but found no Heading styles — is this a Verbatim-formatted doc?`;
          parsed = null;
        }
      } catch (err) {
        status = err instanceof Error ? err.message : String(err);
        parsed = null;
      }
    };
    reader.readAsArrayBuffer(file);
    input.value = "";
  }

  /** When the user changes the split level, re-derive sections from the raw tree. */
  $effect(() => {
    if (!parsed || rawNodes.length === 0) return;
    const nodes = applySplit(rawNodes, splitLevel);
    const sheets = store.round?.sheets ?? [];
    parsed = { ...parsed, nodes };
    checked = nodes.map(() => true);
    targets = nodes.map((n) => guessTargetSheet(n.text, sheets) ?? "new");
  });

  function apply() {
    if (!parsed || !store.round) return;
    const jobs = parsed.nodes
      .map((node, i) => ({ node, target: targets[i], on: checked[i] }))
      .filter((j) => j.on);
    if (jobs.length === 0) return;
    const col = speechIdx;
    const side = speeches[col]?.side;
    const kind = side === "aff" ? "case" : "offcase";
    const nCols = speeches.length;
    let created = 0;
    let filled = 0;

    // One mutate = the whole import is a single undo step.
    store.mutate((r) => {
      for (const { node, target } of jobs) {
        const lines = flowLines(node);
        const existing = r.sheets.find((s) => s.id === target);
        if (existing) {
          // Answer doc: stack the answers in the chosen column of the
          // matched sheet, after anything already in that column.
          // (Row-level alignment to specific arguments is a Phase 3 AI job.)
          const lastUsed = existing.rows.findLastIndex(
            (row) => row.cells[col]?.text.trim() !== "",
          );
          const start = lastUsed + 1;
          lines.forEach((line, i) => {
            while (existing.rows.length <= start + i) {
              existing.rows.push(makeRow(nCols));
            }
            existing.rows[start + i].cells[col].text = line;
          });
          filled++;
        } else {
          const sheet = makeSheet(
            node.text,
            nCols,
            kind,
            col,
            Math.max(INITIAL_ROWS, lines.length + 4),
          );
          // Row 0 is the LABEL cell; content follows below it.
          sheet.rows[0].cells[col].text = node.text;
          lines.forEach((line, i) => {
            while (sheet.rows.length <= i + 1) sheet.rows.push(makeRow(nCols));
            sheet.rows[i + 1].cells[col].text = line;
          });
          r.sheets.push(sheet);
          created++;
        }
      }
    });
    const parts = [
      created && `created ${created} sheet${created === 1 ? "" : "s"}`,
      filled && `filled ${filled} existing`,
    ].filter(Boolean);
    status = `${parts.join(", ")} from ${fileName} ✓`;
    parsed = null;
  }
</script>

<div class="doc-import">
  {#if !parsed}
    <label class="chip file-btn">
      Import speech doc (.docx)
      <input type="file" accept=".docx" onchange={onFile} />
    </label>
  {:else}
    <div class="preview">
      <div class="preview-head">
        <strong>{fileName}</strong> — {parsed.headingCount} headings.
        <span class="col-pick">
          Split at:
          <select bind:value={splitLevel}>
            <option value="auto">Auto ({parsed.nodes.length} sections)</option>
            <option value={1}>Pocket (H1)</option>
            <option value={2}>Hat (H2)</option>
            <option value={3}>Block (H3)</option>
            <option value={4}>Tag (H4)</option>
          </select>
        </span>
        <span class="col-pick">
          Fill column:
          <select bind:value={speechIdx}>
            {#each speeches as sp, i (sp.id)}
              <option value={i}>{sp.abbr}</option>
            {/each}
          </select>
        </span>
        <span class="guess-note">{guessNote}</span>
      </div>
      {#each parsed.nodes as node, i (i)}
        <div class="node">
          <input type="checkbox" bind:checked={checked[i]} />
          <span class="node-title">{node.text}</span>
          <span class="node-count">{flowLines(node).length} rows · {placement(i)}</span>
          <select class="target" bind:value={targets[i]}>
            <option value="new">＋ new sheet</option>
            {#each store.round?.sheets ?? [] as sh (sh.id)}
              <option value={sh.id}>→ {sh.title || "(untitled)"}</option>
            {/each}
          </select>
        </div>
      {/each}
      <div class="actions">
        <button class="chip primary" onclick={apply}>Create sheets</button>
        <button class="chip" onclick={() => (parsed = null)}>Cancel</button>
      </div>
    </div>
  {/if}
  {#if status}
    <p class="status">{status}</p>
  {/if}
</div>

<style>
  .doc-import {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .chip {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 14px;
    padding: 4px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--accent);
  }
  .chip.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .file-btn {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
  }
  .file-btn input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .preview {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 340px;
    max-width: 560px;
  }
  .preview-head {
    font-size: 13px;
    margin-bottom: 4px;
  }
  .col-pick {
    display: inline-flex;
    align-items: center;
    font-weight: 700;
    color: var(--accent);
    margin-left: 6px;
  }
  .guess-note {
    display: block;
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 400;
    margin-top: 2px;
  }
  .preview-head select {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 12px;
    margin-left: 4px;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .node-title {
    font-weight: 600;
  }
  .node-count {
    color: var(--text-dim);
    font-size: 11px;
  }
  .target {
    margin-left: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 12px;
    max-width: 180px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .status {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0;
  }
</style>
