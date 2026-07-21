<script lang="ts">
  import { settings } from "../model/settings.svelte";

  let { onclose }: { onclose: () => void } = $props();

  function dismissForever() {
    settings.showTutorial = false;
    settings.save();
    onclose();
  }
</script>

<div class="backdrop" role="presentation">
  <div class="card" role="dialog" aria-modal="true">
    <div class="head">
      <img class="logo" src="/logo.png" alt="Nimbus" />
      <h1>Welcome to Nimbus</h1>
      <p class="tag">Fast, smart flowing for debate.</p>
    </div>

    <div class="grid">
      <div class="item">
        <span class="k">Type anywhere</span>
        It's a grid like Excel. Columns are speeches, rows are arguments —
        just click a cell and go.
      </div>
      <div class="item">
        <span class="k">Tabs = positions</span>
        Each flow (case, off-case, DA…) is a tab at the bottom. Drag to
        reorder, right-click to rename or delete.
      </div>
      <div class="item">
        <span class="k">See many at once</span>
        Hit <kbd>⌘B</kbd> or <b>Stack / Split</b> to lay several flows side by
        side — the paper-on-your-desk view.
      </div>
      <div class="item">
        <span class="k">Colors do the work</span>
        Aff columns are blue, neg red. Mark cells <b>Dropped</b>,
        <b>Analytic</b>, or <b>Card</b> from the ribbon or keys.
      </div>
      <div class="item">
        <span class="k">Make it yours</span>
        <kbd>⌘,</kbd> opens Settings — themes, custom keybinds, and JavaScript
        macros for one-key argument blocks.
      </div>
      <div class="item">
        <span class="k">Flow together</span>
        On a round's home page, start <b>Partner flowing</b> — share one code
        and edit the same round live.
      </div>
    </div>

    <div class="actions">
      <button class="primary" onclick={onclose}>Start flowing</button>
      <button class="ghost" onclick={dismissForever}>Don't show this again</button>
    </div>
    <p class="foot">You can reopen this anytime in Settings → “Show welcome tutorial”.</p>
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
    z-index: 50;
    padding: 20px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 26px 30px;
    max-width: 640px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  }
  .head {
    text-align: center;
    margin-bottom: 20px;
  }
  .logo {
    width: 56px;
    height: 56px;
    object-fit: contain;
  }
  h1 {
    margin: 6px 0 2px;
    font-size: 22px;
  }
  .tag {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .item {
    font-size: 13px;
    color: var(--text);
    line-height: 1.4;
  }
  .k {
    display: block;
    font-weight: 700;
    margin-bottom: 2px;
  }
  kbd {
    background: var(--kbd-bg);
    border: 1px solid var(--kbd-border);
    border-radius: 3px;
    padding: 0 5px;
    font-size: 11px;
  }
  .actions {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    margin-top: 24px;
  }
  .primary {
    background: var(--accent);
    border: none;
    color: #fff;
    font-weight: 600;
    border-radius: 8px;
    padding: 9px 22px;
    font-size: 14px;
    cursor: pointer;
  }
  .ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 13px;
    cursor: pointer;
  }
  .foot {
    text-align: center;
    color: var(--text-dim);
    font-size: 11px;
    margin: 12px 0 0;
  }
  @media (max-width: 560px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
