<script lang="ts">
  // one-time nudge after 1.6.2 for people who already use Nimbus
  import { settings } from "../model/settings.svelte";
  import { combosLabel } from "../model/keymap";

  let { onstart, onlater }: { onstart: () => void; onlater: () => void } = $props();

  const mac = settings.isMac;
  const km = $derived(settings.keymap);
</script>

<div class="backdrop" role="presentation">
  <div class="card" role="dialog" aria-modal="true" aria-label="Take the guided tour">
    <img class="logo" src="/logo.png" alt="Nimbus" />
    <h1>New: a hands-on guided tour</h1>
    <p class="lead">
      Five minutes, and you build a real flow yourself. Even if you've been using
      Nimbus a while, there's probably something in here you haven't found yet.
    </p>
    <ul>
      <li><b>Pull blocks with <kbd>{combosLabel(km.openDocSearch, mac)}</kbd></b> from a free Midterms DA file that ships with the app</li>
      <li><b>Smart blocks, Send to Doc, partner flowing</b> and the other tools, one step at a time</li>
      <li><b>Nothing gets saved.</b> The practice round goes away when you're done</li>
    </ul>
    <div class="actions">
      <button class="primary" onclick={onstart}>Take the tour</button>
      <button class="ghost" onclick={onlater}>Maybe later</button>
    </div>
    <p class="foot">You can always start it from Settings → Help → Replay tour.</p>
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
    max-width: 480px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    text-align: center;
  }
  .logo { width: 56px; height: 56px; }
  h1 { margin: 10px 0 8px; font-size: 21px; }
  .lead { margin: 0 0 14px; font-size: 14px; line-height: 1.5; color: var(--text); }
  ul {
    text-align: left;
    margin: 0 0 18px;
    padding-left: 20px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-dim);
  }
  li { margin-bottom: 4px; }
  li b { color: var(--text); font-weight: 600; }
  kbd {
    font-family: inherit;
    font-size: 12px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
  }
  .actions { display: flex; gap: 10px; justify-content: center; }
  button { border-radius: 8px; padding: 9px 18px; font-size: 14px; cursor: pointer; font-family: inherit; }
  .primary { background: var(--accent); border: none; color: #fff; font-weight: 600; }
  .ghost { background: none; border: 1px solid var(--border); color: var(--text); }
  .foot { margin: 14px 0 0; font-size: 12px; color: var(--text-dim); }
</style>
