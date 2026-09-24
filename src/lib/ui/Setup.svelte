<script lang="ts">
  // First-run setup: a one-time prompt to pick the basics - theme, speech
  // format, and how flows are saved. Everything here is also in Settings, so
  // this is a friendly starting point, not the only way to change any of it.
  import { settings, THEMES } from "../model/settings.svelte";
  import { builtinTemplates } from "../model/templates";

  let { onclose }: { onclose: () => void } = $props();

  const templates = builtinTemplates();

  function pickTheme(id: (typeof THEMES)[number]["id"]) {
    settings.theme = id;
    settings.save();
  }
  function pickTemplate(i: number) {
    settings.setDefaultTemplate(i);
  }
  function pickFormat(f: "nimbus" | "xlsx") {
    settings.defaultSaveFormat = f;
    settings.save();
  }
  function finish() {
    settings.setupDone = true;
    settings.save();
    onclose();
  }
</script>

<div class="backdrop" role="presentation">
  <div class="card" role="dialog" aria-modal="true" aria-label="Welcome to Nimbus">
    <h1>Welcome to Nimbus</h1>
    <p class="sub">A couple of quick choices - you can change any of these later in Settings.</p>

    <section class="block">
      <h2>Theme</h2>
      <div class="swatches">
        {#each THEMES as t (t.id)}
          <button
            class="swatch"
            class:on={settings.theme === t.id}
            style="background: {t.bg}"
            title={t.label}
            onclick={() => pickTheme(t.id)}
          >
            <span class="swatch-name">{t.label}</span>
          </button>
        {/each}
      </div>
    </section>

    <section class="block">
      <h2>Speech format</h2>
      <div class="chips">
        {#each templates as t, i (t.id)}
          <button class="chip" class:on={settings.defaultTemplate === i} onclick={() => pickTemplate(i)}>{t.name}</button>
        {/each}
      </div>
    </section>

    <section class="block">
      <h2>How flows are saved</h2>
      <div class="chips">
        <button class="chip" class:on={settings.defaultSaveFormat === "nimbus"} onclick={() => pickFormat("nimbus")}>
          Nimbus (.nimbus) - full fidelity
        </button>
        <button class="chip" class:on={settings.defaultSaveFormat === "xlsx"} onclick={() => pickFormat("xlsx")}>
          Excel (.xlsx) - opens in spreadsheets
        </button>
      </div>
    </section>

    <button class="start" onclick={finish}>Get started</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 80;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 26px 30px;
    width: min(560px, 92vw);
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  }
  h1 {
    margin: 0 0 4px;
    font-size: 22px;
    color: var(--text);
  }
  .sub {
    margin: 0 0 18px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .block {
    margin: 0 0 18px;
  }
  .block h2 {
    margin: 0 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .swatch {
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
  .swatch:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }
  .swatch.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .swatch.on::after {
    content: "✓";
    position: absolute;
    top: 3px;
    right: 4px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: var(--accent);
  }
  .swatch-name {
    font-size: 10px;
    font-weight: 600;
    color: #333;
    background: rgba(255, 255, 255, 0.85);
    border-radius: 3px;
    padding: 0 4px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .chip:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }
  .chip.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg));
    color: var(--text);
    font-weight: 600;
  }
  .start {
    margin-top: 6px;
    width: 100%;
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: 9px;
    padding: 11px 0;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  .start:hover {
    background: color-mix(in srgb, #000 8%, var(--accent));
  }
</style>
