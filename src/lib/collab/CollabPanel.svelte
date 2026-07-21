<script lang="ts">
  // COLLAB feature (self-contained; see sync.svelte.ts header for removal).
  // One room code: host makes it, partner types it, connected.

  import { collab } from "./sync.svelte";
  import { store } from "../model/round.svelte";
  import type { Round } from "../model/types";

  let joinInput = $state("");
  let copied = $state(false);

  // Stream local changes to the partner while connected.
  $effect(() => {
    const snap =
      collab.status === "connected" && store.round
        ? ($state.snapshot(store.round) as Round)
        : null;
    collab.onLocalChange(snap);
  });

  async function copyCode() {
    await navigator.clipboard.writeText(collab.code);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="collab">
  <input
    class="name"
    placeholder="Your name (shown to your partner)"
    bind:value={collab.myName}
    onchange={() => collab.saveName()}
  />

  {#if collab.status === "off"}
    <div class="row">
      <button class="chip primary" onclick={() => collab.host()}>Start session</button>
      <span class="or">or join with a code:</span>
      <input
        class="code-in"
        placeholder="FLOW code"
        bind:value={joinInput}
        onkeydown={(e) => e.key === "Enter" && joinInput.trim() && collab.join(joinInput)}
      />
      <button class="chip" disabled={!joinInput.trim()} onclick={() => collab.join(joinInput)}>Join</button>
    </div>
  {:else if collab.status === "hosting"}
    <div class="code-box">
      <div class="code-label">Give your partner this code:</div>
      <div class="code-big" onclick={copyCode} role="button" tabindex="0"
        onkeydown={(e) => e.key === "Enter" && copyCode()}>
        {collab.code}
      </div>
      <button class="chip" onclick={copyCode}>{copied ? "Copied ✓" : "Copy"}</button>
      <button class="chip ghost" onclick={() => collab.leave()}>Cancel</button>
    </div>
    <p class="hint">Waiting for your partner to join…</p>
  {:else if collab.status === "joining"}
    <div class="row">
      <span class="joining"><span class="spinner"></span> Connecting to <strong>{collab.code}</strong>…</span>
      <button class="chip ghost" onclick={() => collab.leave()}>Cancel</button>
    </div>
    <p class="hint">Joining adopts your partner's round (their sheets replace what's here).</p>
  {:else if collab.status === "connected"}
    <div class="connected">
      <span class="dot"></span>
      Flowing live with <strong>{collab.partnerName || "partner"}</strong>
      <span class="code-tag">{collab.code}</span>
      <button class="chip ghost" onclick={() => collab.leave()}>Disconnect</button>
    </div>
    <p class="hint">Edits sync both ways in real time. Note: undo history is shared.</p>
  {/if}

  {#if collab.error}
    <p class="err">{collab.error}</p>
  {/if}
  {#if collab.status !== "connected"}
    <p class="hint sub">
      Connects over the internet through free public relays — no account, no
      cost. Works for online tournaments. Experimental.
    </p>
  {/if}
</div>

<style>
  .collab {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
    max-width: 560px;
  }
  .name {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 13px;
    min-width: 240px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .or {
    font-size: 12px;
    color: var(--text-dim);
  }
  .code-in {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 14px;
    font-family: ui-monospace, Menlo, monospace;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    width: 120px;
  }
  .chip {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 14px;
    padding: 5px 14px;
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
  .chip.ghost {
    border-style: dashed;
  }
  .chip:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .code-box {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .code-label {
    font-size: 13px;
    color: var(--text-dim);
  }
  .code-big {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--accent);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 4px 16px;
    cursor: pointer;
  }
  .connected {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    flex-wrap: wrap;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #3dd066;
    box-shadow: 0 0 6px #3dd066;
  }
  .code-tag {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 11px;
    color: var(--text-dim);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .joining {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .hint {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0;
  }
  .hint.sub {
    opacity: 0.8;
  }
  .err {
    font-size: 12px;
    color: var(--mark-dropped);
    margin: 0;
  }
</style>
