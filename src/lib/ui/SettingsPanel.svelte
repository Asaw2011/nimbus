<script lang="ts">
  import { settings } from "../model/settings.svelte";
  import type { ActionId, Combo } from "../model/keymap";
  import { ACTION_LABELS, comboFromEvent, comboLabel } from "../model/keymap";
  import { THEMES } from "../model/settings.svelte";
  import { loadSnippets, saveSnippets } from "../model/snippets";
  import { validateMacroCode } from "../model/macros";
  import { exportSettings, importSettings } from "../model/backup";
  import { uid } from "../model/types";

  let { onclose }: { onclose: () => void } = $props();

  let rebinding = $state<ActionId | null>(null);
  let rebindingMacro = $state<string | null>(null);
  /** Captured combo waiting for the user to confirm a conflict. */
  let conflict = $state<{
    combo: Combo;
    existing: string;
    action: ActionId | null;
    macroId: string | null;
  } | null>(null);
  let snippets = $state(loadSnippets());
  let newTrigger = $state("");
  let newExpansion = $state("");

  // Macro code editor state (macros are plain JavaScript using the flow API)
  let macroName = $state("");
  let macroCode = $state("");
  let editingMacroId = $state<string | null>(null);
  const syntaxError = $derived(
    macroCode.trim() ? validateMacroCode(macroCode) : null,
  );
  const codeValid = $derived(macroCode.trim() !== "" && syntaxError === null);

  const actions = Object.keys(ACTION_LABELS) as ActionId[];

  function onRebindKey(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      rebinding = null;
      rebindingMacro = null;
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) return;
    // Conflict check: warn if these keys are already bound to something.
    const existing = settings.findBinding(combo);
    if (existing) {
      conflict = {
        combo,
        existing,
        action: rebinding,
        macroId: rebindingMacro,
      };
      rebinding = null;
      rebindingMacro = null;
      return;
    }
    commitBind(combo, rebinding, rebindingMacro);
    rebinding = null;
    rebindingMacro = null;
  }

  function commitBind(
    combo: Combo,
    action: ActionId | null,
    macroId: string | null,
  ) {
    if (action) settings.addBind(action, combo);
    else if (macroId) settings.rebindMacro(macroId, combo);
  }

  function confirmConflict() {
    if (!conflict) return;
    commitBind(conflict.combo, conflict.action, conflict.macroId);
    conflict = null;
  }

  function editMacro(id: string) {
    const m = settings.macros.find((m) => m.id === id);
    if (!m) return;
    editingMacroId = id;
    macroName = m.name;
    macroCode = m.code;
  }

  function cancelEdit() {
    editingMacroId = null;
    macroName = "";
    macroCode = "";
  }

  function saveMacro() {
    if (!macroName.trim() || !codeValid) return;
    if (editingMacroId) {
      settings.updateMacro(editingMacroId, {
        name: macroName.trim(),
        code: macroCode,
      });
    } else {
      settings.addMacro({
        id: uid(),
        name: macroName.trim(),
        combo: null,
        code: macroCode,
      });
    }
    cancelEdit();
  }

  // Backup / restore
  let backupStatus = $state("");

  async function doExport() {
    try {
      const path = await exportSettings();
      backupStatus = `Exported to ${path}`;
    } catch (e) {
      backupStatus = `Export failed: ${e instanceof Error ? e.message : e}`;
    }
  }

  function doImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const err = importSettings(String(reader.result ?? ""));
      backupStatus = err ?? "Imported ✓ — keybinds, macros, snippets, and colors applied.";
      if (!err) snippets = { ...loadSnippets() };
    };
    reader.readAsText(file);
    input.value = "";
  }

  function addSnippet() {
    if (!newTrigger.trim() || !newExpansion) return;
    snippets = { ...snippets, [newTrigger.trim()]: newExpansion };
    saveSnippets(snippets);
    newTrigger = "";
    newExpansion = "";
  }

  function removeSnippet(trigger: string) {
    const { [trigger]: _, ...rest } = snippets;
    snippets = rest;
    saveSnippets(snippets);
  }
</script>

<svelte:window onkeydown={rebinding || rebindingMacro ? onRebindKey : undefined} />

<div
  class="backdrop"
  onclick={onclose}
  onkeydown={(e) => e.key === "Escape" && onclose()}
  role="presentation"
>
  <div
    class="panel"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      // While assigning a bind, capture the keys here (the panel would
      // otherwise swallow them before the window handler sees them).
      if (rebinding || rebindingMacro) onRebindKey(e);
      else e.stopPropagation();
    }}
    role="dialog"
    tabindex="-1"
  >
    <div class="head">
      <h2>Settings</h2>
      <button class="close" onclick={onclose}>×</button>
    </div>

    <section>
      <h3>Appearance</h3>
      <div class="row theme-row">
        Theme
        <div class="swatches">
          {#each THEMES as t (t.id)}
            <button
              class="theme-swatch"
              class:on={settings.theme === t.id}
              style="background: {t.bg}"
              title={t.label}
              onclick={() => { settings.theme = t.id; settings.save(); }}
            >
              <span class="theme-name" class:dark={t.id === 'dark'}>{t.label}</span>
            </button>
          {/each}
        </div>
      </div>
      <label class="row">
        Sheet tabs
        <div class="seg">
          <button
            class:on={settings.tabsPosition === "top"}
            onclick={() => { settings.tabsPosition = "top"; settings.save(); }}
          >Top</button>
          <button
            class:on={settings.tabsPosition === "bottom"}
            onclick={() => { settings.tabsPosition = "bottom"; settings.save(); }}
          >Bottom</button>
        </div>
      </label>
      <label class="row">
        Aff / Pro color
        <span class="inline">
          <input
            type="color"
            value={settings.affColor || (settings.theme === "dark" ? "#7fb5ff" : "#1a6fd4")}
            oninput={(e) => { settings.affColor = e.currentTarget.value; settings.save(); }}
          />
          {#if settings.affColor}
            <button class="chip" onclick={() => { settings.affColor = ""; settings.save(); }}>reset</button>
          {/if}
        </span>
      </label>
      <label class="row">
        Neg / Con color
        <span class="inline">
          <input
            type="color"
            value={settings.negColor || (settings.theme === "dark" ? "#ff9a7f" : "#c8442a")}
            oninput={(e) => { settings.negColor = e.currentTarget.value; settings.save(); }}
          />
          {#if settings.negColor}
            <button class="chip" onclick={() => { settings.negColor = ""; settings.save(); }}>reset</button>
          {/if}
        </span>
      </label>
      <label class="row">
        Analytic ink color
        <span class="inline">
          <input
            type="color"
            value={settings.analyticColor || (settings.theme === "dark" ? "#5fd98a" : "#1e8e4a")}
            oninput={(e) => { settings.analyticColor = e.currentTarget.value; settings.save(); }}
          />
          {#if settings.analyticColor}
            <button class="chip" onclick={() => { settings.analyticColor = ""; settings.save(); }}>reset</button>
          {/if}
        </span>
      </label>
      <label class="row">
        Card ink color
        <span class="inline">
          <input
            type="color"
            value={settings.cardColor || (settings.theme === "dark" ? "#c792ea" : "#7c4dbe")}
            oninput={(e) => { settings.cardColor = e.currentTarget.value; settings.save(); }}
          />
          {#if settings.cardColor}
            <button class="chip" onclick={() => { settings.cardColor = ""; settings.save(); }}>reset</button>
          {/if}
        </span>
      </label>
      <label class="row">
        Min column width
        <span class="inline">
          <input
            type="range"
            min="100"
            max="320"
            step="10"
            value={settings.colMinWidth}
            oninput={(e) => { settings.colMinWidth = Number(e.currentTarget.value); settings.save(); }}
          />
          {settings.colMinWidth}px
        </span>
      </label>
      <label class="row">
        Row height
        <span class="inline">
          <input
            type="range"
            min="20"
            max="60"
            step="2"
            value={settings.rowHeight}
            oninput={(e) => { settings.rowHeight = Number(e.currentTarget.value); settings.save(); }}
          />
          {settings.rowHeight}px
        </span>
      </label>
      <label class="row">
        Font size
        <span class="inline">
          <input
            type="range"
            min="10"
            max="22"
            step="1"
            value={settings.fontSize}
            oninput={(e) => { settings.fontSize = Number(e.currentTarget.value); settings.save(); }}
          />
          {settings.fontSize}px
        </span>
      </label>
      <label class="row">
        Font
        <select
          value={settings.fontFamily}
          onchange={(e) => { settings.fontFamily = e.currentTarget.value; settings.save(); }}
        >
          <option value="">System</option>
          <option value="Calibri, sans-serif">Calibri</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Times New Roman', serif">Times</option>
          <option value="ui-monospace, Menlo, monospace">Mono</option>
        </select>
      </label>
      <label class="row">
        Show welcome tutorial on open
        <input
          type="checkbox"
          checked={settings.showTutorial}
          onchange={(e) => { settings.showTutorial = e.currentTarget.checked; settings.save(); }}
        />
      </label>
      <label class="row">
        Default save format
        <div class="seg">
          <button
            class:on={settings.defaultSaveFormat === "nimbus"}
            onclick={() => { settings.defaultSaveFormat = "nimbus"; settings.save(); }}
          >Nimbus</button>
          <button
            class:on={settings.defaultSaveFormat === "xlsx"}
            onclick={() => { settings.defaultSaveFormat = "xlsx"; settings.save(); }}
          >Excel</button>
        </div>
      </label>
    </section>

    <section>
      <h3>Keybinds</h3>
      <p class="hint">
        Enter/Tab/arrows are fixed grid motions. Click a binding, then press the
        new keys. Esc cancels.
      </p>
      {#each actions as action (action)}
        <div class="row">
          {ACTION_LABELS[action]}
          <span class="binds">
            {#each settings.keymap[action] ?? [] as combo, bi (bi)}
              <span class="bind-chip">
                {comboLabel(combo, settings.isMac)}
                <button
                  class="bind-x"
                  title="Remove this binding"
                  onclick={() => settings.removeBind(action, bi)}
                >×</button>
              </span>
            {/each}
            <button
              class="bind add"
              class:listening={rebinding === action}
              title="Add a binding"
              onclick={() => { rebinding = action; rebindingMacro = null; conflict = null; }}
            >
              {rebinding === action ? "press keys…" : "+"}
            </button>
          </span>
        </div>
      {/each}
      {#if conflict}
        <div class="conflict">
          <span>
            <kbd>{comboLabel(conflict.combo, settings.isMac)}</kbd> is already
            bound to <strong>{conflict.existing}</strong>.
          </span>
          <span class="conflict-actions">
            <button class="chip" onclick={confirmConflict}>Bind anyway</button>
            <button class="chip" onclick={() => (conflict = null)}>Cancel</button>
          </span>
        </div>
      {/if}
      <div class="keymap-actions">
        <button class="reset" onclick={() => settings.resetKeymap()}>Reset to defaults</button>
        <button class="reset" onclick={() => settings.clearAllBinds()}>Clear all binds</button>
      </div>
    </section>

    <section>
      <h3>Macros</h3>
      <p class="hint">
        Macros are JavaScript. Your code runs at the cursor via the
        <code>flow</code> API, fires on a keystroke, and undoes as one step.
      </p>
      {#each settings.macros as m (m.id)}
        <div class="row">
          <span class="macro-desc"><strong>{m.name}</strong>
            <code class="code-preview">{m.code.replace(/\/\/[^\n]*\n?/g, "").replace(/\n+/g, " ").trim().slice(0, 48)}</code>
          </span>
          <span class="inline">
            {#if m.combo && rebindingMacro !== m.id}
              <span class="bind-chip">
                {comboLabel(m.combo, settings.isMac)}
                <button
                  class="bind-x"
                  title="Remove this binding"
                  onclick={() => settings.rebindMacro(m.id, null)}
                >×</button>
              </span>
            {:else}
              <button
                class="bind"
                class:listening={rebindingMacro === m.id}
                onclick={() => { rebindingMacro = m.id; rebinding = null; conflict = null; }}
              >
                {rebindingMacro === m.id ? "press keys…" : "bind"}
              </button>
            {/if}
            <button class="icon" title="Edit macro code" onclick={() => editMacro(m.id)}>✎</button>
            <button class="icon danger" title="Delete macro" onclick={() => settings.deleteMacro(m.id)}>×</button>
          </span>
        </div>
      {/each}

      <div class="macro-builder">
        <div class="builder-head">
          {editingMacroId ? "Editing macro" : "New macro"}
          {#if editingMacroId}
            <button class="chip" onclick={cancelEdit}>cancel</button>
          {/if}
        </div>
        <input placeholder="Macro name" bind:value={macroName} />
        <textarea
          class="code"
          rows="8"
          spellcheck="false"
          placeholder={'// JavaScript — e.g.\nflow.type("AT: ");\nflow.insertBelow(4);\nflow.down();'}
          bind:value={macroCode}
        ></textarea>
        {#if macroCode.trim() && syntaxError}
          <div class="parse-error">Syntax error: {syntaxError}</div>
        {/if}
        <button
          class="chip save-macro"
          disabled={!macroName.trim() || !codeValid}
          onclick={saveMacro}
        >
          {editingMacroId ? "Save changes" : "Save macro"}
        </button>

        <details class="guide">
          <summary>flow API guide</summary>
          <p class="hint">
            Macros are standard JavaScript (variables, loops, if/else all work).
            The <code>flow</code> object is your handle into the sheet:
          </p>
          <table>
            <tbody>
              <tr><td><code>flow.type(text)</code></td><td>type text into the current cell (appends)</td></tr>
              <tr><td><code>flow.setText(text)</code> / <code>flow.getText()</code></td><td>replace / read the current cell</td></tr>
              <tr><td><code>flow.clear()</code></td><td>empty the current cell</td></tr>
              <tr><td><code>flow.insertBelow(n)</code> / <code>flow.insertAbove(n)</code></td><td>insert n blank rows</td></tr>
              <tr><td><code>flow.deleteRow()</code></td><td>delete the current row</td></tr>
              <tr><td><code>flow.down(n)</code> <code>.up(n)</code> <code>.left(n)</code> <code>.right(n)</code></td><td>move the cursor (n optional)</td></tr>
              <tr><td><code>flow.goto(row, col)</code> / <code>flow.cursor()</code></td><td>jump to a cell / get {'{row, col}'}</td></tr>
              <tr><td><code>flow.bottom()</code></td><td>last filled row in this column (−1 if none)</td></tr>
              <tr><td><code>flow.dropped()</code> · <code>flow.star()</code></td><td>toggle marks on the current cell</td></tr>
              <tr><td><code>flow.analytic()</code> · <code>flow.card()</code></td><td>tag as analytic / card (colors ink)</td></tr>
              <tr><td><code>flow.rowCount()</code> <code>flow.colCount()</code> <code>flow.sheetName()</code></td><td>sheet info</td></tr>
            </tbody>
          </table>
          <p class="hint">Example — number 4 answers down the column:</p>
          <pre class="code">{`for (let i = 1; i <= 4; i++) {
  flow.type(i + ") ");
  flow.down();
}`}</pre>
          <p class="hint">
            Runs at the cursor, one undo step. Errors are logged to the console
            (View → Developer Tools). After saving, click the macro's binding
            button to assign keys.
          </p>
        </details>
      </div>
    </section>

    <section>
      <h3>Abbreviations</h3>
      <p class="hint">Type a trigger followed by a space to expand it while flowing.</p>
      {#each Object.entries(snippets) as [trigger, expansion] (trigger)}
        <div class="row">
          <span><code>{trigger}</code> → {expansion}</span>
          <button class="icon danger" onclick={() => removeSnippet(trigger)}>×</button>
        </div>
      {/each}
      <div class="snippet-add">
        <input placeholder="trigger (e.g. da/)" bind:value={newTrigger} />
        <input
          placeholder="expansion"
          bind:value={newExpansion}
          onkeydown={(e) => e.key === "Enter" && addSnippet()}
        />
        <button class="chip" onclick={addSnippet}>Add</button>
      </div>
    </section>

    <section>
      <h3>Backup</h3>
      <p class="hint">
        Everything here (keybinds, macros, snippets, colors, folders) is saved
        to disk automatically — flows too. Export a bundle to move your setup
        to another computer or keep a copy.
      </p>
      <div class="backup-row">
        <button class="chip" onclick={doExport}>Export settings</button>
        <label class="chip file-btn">
          Import settings…
          <input type="file" accept=".json,application/json" onchange={doImport} />
        </label>
      </div>
      {#if backupStatus}
        <p class="backup-status">{backupStatus}</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: min(560px, 92vw);
    max-height: 84vh;
    overflow-y: auto;
    padding: 20px 24px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .close {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 20px;
    cursor: pointer;
  }
  section {
    margin-top: 18px;
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 0 0 8px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0 0 8px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    padding: 5px 0;
    gap: 12px;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .theme-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .swatches {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .theme-swatch {
    width: 74px;
    height: 46px;
    border: 2px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 4px;
    position: relative;
  }
  .theme-swatch.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .theme-name {
    font-size: 10px;
    font-weight: 600;
    color: #333;
    background: rgba(255, 255, 255, 0.85);
    border-radius: 3px;
    padding: 0 4px;
  }
  .theme-name.dark {
    color: #eee;
    background: rgba(0, 0, 0, 0.5);
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 4px 14px;
    font-size: 12px;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent);
    color: #fff;
  }
  .bind {
    background: var(--kbd-bg);
    border: 1px solid var(--kbd-border);
    color: var(--text);
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    min-width: 70px;
  }
  .bind.listening {
    border-color: var(--accent);
    color: var(--accent);
  }
  .binds {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .bind-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--kbd-bg);
    border: 1px solid var(--kbd-border);
    color: var(--text);
    border-radius: 4px;
    padding: 2px 4px 2px 8px;
    font-size: 12px;
  }
  .bind-x {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
    padding: 0 3px;
    line-height: 1;
  }
  .bind-x:hover {
    color: var(--mark-dropped);
  }
  .bind.add {
    min-width: 26px;
    padding: 3px 8px;
  }
  .conflict {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    background: var(--dropped-bg);
    border: 1px solid var(--mark-dropped);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    margin: 8px 0;
  }
  .conflict-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .keymap-actions {
    display: flex;
    gap: 8px;
  }
  .reset {
    margin-top: 6px;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .chip {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .icon {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    padding: 0 8px;
    cursor: pointer;
  }
  .icon.danger:hover {
    color: var(--mark-dropped);
    border-color: var(--mark-dropped);
  }
  .snippet-add {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .macro-desc {
    color: var(--text);
    font-size: 12px;
  }
  .code-preview {
    color: var(--text-dim);
    background: var(--bg);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
  }
  .macro-desc strong {
    font-weight: 600;
  }
  .macro-builder {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px dashed var(--border);
    padding-top: 10px;
  }
  .macro-builder input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .builder-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: var(--text-dim);
  }
  textarea.code {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
  }
  .parse-error {
    color: var(--mark-dropped);
    font-size: 12px;
    background: var(--dropped-bg);
    border-radius: 4px;
    padding: 5px 8px;
  }
  .guide {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .guide summary {
    cursor: pointer;
    color: var(--accent);
  }
  .guide td {
    padding: 3px 10px 3px 0;
    vertical-align: top;
  }
  pre.code {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text);
  }
  .save-macro:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .snippet-add input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
    flex: 1;
  }
  code {
    background: var(--kbd-bg);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .backup-row {
    display: flex;
    gap: 8px;
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
  .backup-status {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-dim);
    word-break: break-all;
  }
</style>
