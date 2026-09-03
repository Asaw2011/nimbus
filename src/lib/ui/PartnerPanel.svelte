<script lang="ts">
  // Start or join a partner flowing session. Deliberately a small modal rather
  // than something always on screen: it is a thing you do once at the top of a
  // round, then forget about. Live status lives in the ribbon instead.
  import { session, type SessionMode } from "$lib/model/session.svelte";
  import { store } from "$lib/model/round.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let codeInput = $state("");
  let hostMode = $state<SessionMode>("shared");
  let copied = $state(false);

  const laneName = $derived(
    (store.round?.template.speeches ?? []).find(
      (s) => !!s.laneGroup && s.lane === store.myLane,
    )?.abbr ?? "",
  );
  const hasLanes = $derived(
    (store.round?.template.speeches ?? []).some((s) => !!s.laneGroup),
  );

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(session.code);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard can be blocked; the code is on screen to read out anyway.
    }
  }
</script>

<div class="pp-backdrop" role="presentation" onclick={onclose}></div>
<div class="pp-modal" role="dialog" aria-label="Flow with a partner">
  <div class="pp-head">
    <span class="pp-title">Flow with a partner</span>
    <span class="pp-sp"></span>
    <button class="pp-x" onclick={onclose} title="Close">✕</button>
  </div>

  <div class="pp-body">
    {#if session.status === "off" || session.status === "error"}
      {#if session.error}
        <div class="pp-err">{session.error}</div>
      {/if}
      <p class="pp-lead">
        You both stay on your own copy of the flow — nothing is stored on a
        server, and each of you keeps saving to your own file.
      </p>
      {#if !hasLanes && hostMode === "shared"}
        <div class="pp-warn">
          This flow has no partner lanes, so you'll both be typing in the same
          columns. For split lanes, pick a side when you create the flow.
        </div>
      {/if}

      <div class="pp-two">
        <div class="pp-card">
          <div class="pp-card-t">Start a session</div>
          <div class="pp-modes">
            <label class="pp-mode" class:sel={hostMode === "shared"}>
              <input type="radio" value="shared" bind:group={hostMode} />
              <span>
                <strong>One flow, together</strong>
                <em>You both flow the same page. Split lanes if this flow has them.</em>
              </span>
            </label>
            <label class="pp-mode" class:sel={hostMode === "separate"}>
              <input type="radio" value="separate" bind:group={hostMode} />
              <span>
                <strong>A flow each</strong>
                <em>You keep yours, they keep theirs, and you can both see and edit
                  either — so you can drop a block onto their page.</em>
              </span>
            </label>
          </div>
          <button class="pp-primary" onclick={() => session.host(hostMode)}>Start &amp; get a code</button>
        </div>
        <div class="pp-card">
          <div class="pp-card-t">Join your partner</div>
          <p>Type the code they read you. Their flow replaces what's on your screen.</p>
          <div class="pp-joinrow">
            <input
              class="pp-code-in"
              placeholder="ABC123"
              maxlength="8"
              bind:value={codeInput}
              onkeydown={(e) => e.key === "Enter" && session.join(codeInput)}
            />
            <button class="pp-primary" disabled={codeInput.trim().length < 6} onclick={() => session.join(codeInput)}>Join</button>
          </div>
        </div>
      </div>

    {:else if session.status === "hosting"}
      <div class="pp-code-wrap">
        <div class="pp-code">{session.code}</div>
        <button class="pp-copy" onclick={copyCode}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p class="pp-lead">Read this to your partner. Waiting for them to join…</p>
      {#if session.pending}
        <div class="pp-req">
          <div><strong>{session.pending.email}</strong> wants to join.</div>
          <div class="pp-reqbtns">
            <button class="pp-primary" onclick={() => session.accept()}>Let them in</button>
            <button class="pp-btn" onclick={() => session.decline()}>Decline</button>
          </div>
        </div>
      {/if}
      <button class="pp-btn wide" onclick={() => session.leave()}>Cancel</button>

    {:else if session.status === "joining"}
      <p class="pp-lead">
        Asked to join <strong>{session.code}</strong>. Waiting for your partner
        to let you in…
      </p>
      <button class="pp-btn wide" onclick={() => session.leave()}>Cancel</button>

    {:else}
      <div class="pp-live">
        <span class="pp-dot" class:on={session.peerOnline}></span>
        <div>
          <div><strong>{session.peerEmail}</strong> — {session.peerOnline ? "connected" : "reconnecting…"}</div>
          <div class="pp-sub">
            Room {session.code} · {session.mode === "separate" ? "a flow each" : "one shared flow"}
            {#if laneName}· your lane is <strong>{laneName}</strong>{/if}
            {#if session.queued > 0}· {session.queued} edits waiting to send{/if}
          </div>
        </div>
      </div>
      {#if session.desynced}
        <div class="pp-err">
          You were offline long enough that some edits couldn't be queued. The
          two flows may no longer match — end this session and start a fresh one
          to be sure. Nothing has been lost on either side.
        </div>
      {/if}
      <div class="pp-warn">
        Undo history clears whenever your partner's changes arrive — otherwise
        undoing would wipe their work.
      </div>
      <button class="pp-btn wide" onclick={() => session.leave()}>End session</button>
      <p class="pp-fine">Ending keeps the flow on both sides exactly as it is.</p>
    {/if}
  </div>
</div>

<style>
  .pp-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 60; }
  .pp-modal {
    position: fixed; z-index: 61; top: 50%; left: 50%; transform: translate(-50%,-50%);
    width: min(560px, 94vw); background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); overflow: hidden;
  }
  .pp-head { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .pp-title { font-weight: 700; font-size: 15px; }
  .pp-sp { flex: 1; }
  .pp-x { background: none; border: none; color: var(--text-dim); font-size: 15px; cursor: pointer; }
  .pp-body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .pp-lead { margin: 0; font-size: 13px; color: var(--text-dim); line-height: 1.45; }
  .pp-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  .pp-modes { display: flex; flex-direction: column; gap: 6px; }
  .pp-mode { display: flex; gap: 7px; align-items: flex-start; padding: 7px 8px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
  .pp-mode.sel { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .pp-mode input { margin-top: 2px; flex: none; }
  .pp-mode strong { display: block; font-size: 12px; font-weight: 600; }
  .pp-mode em { display: block; font-style: normal; font-size: 11px; color: var(--text-dim); line-height: 1.35; margin-top: 1px; }
  .pp-card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .pp-card-t { font-weight: 700; font-size: 13px; }
  .pp-card p { margin: 0; font-size: 12px; color: var(--text-dim); line-height: 1.4; flex: 1; }
  .pp-primary {
    background: var(--accent); border: 1px solid var(--accent); color: #fff;
    border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .pp-primary:disabled { opacity: 0.5; cursor: default; }
  .pp-btn {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer;
  }
  .pp-btn.wide { align-self: flex-start; }
  .pp-joinrow { display: flex; gap: 6px; }
  .pp-code-in {
    flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 8px; font-size: 14px; font-family: ui-monospace, monospace;
    letter-spacing: 0.14em; text-transform: uppercase;
  }
  .pp-code-wrap { display: flex; align-items: center; gap: 10px; }
  .pp-code {
    font-family: ui-monospace, monospace; font-size: 30px; font-weight: 700;
    letter-spacing: 0.18em; color: var(--accent);
  }
  .pp-copy { background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  .pp-req { border: 1px solid var(--accent); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .pp-reqbtns { display: flex; gap: 6px; }
  .pp-live { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .pp-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
  .pp-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-dim); flex: none; }
  .pp-dot.on { background: #2e8b57; }
  .pp-err { border: 1px solid var(--mark-dropped, #c0392b); color: var(--mark-dropped, #c0392b); border-radius: 6px; padding: 8px 10px; font-size: 12px; }
  .pp-warn { border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; padding: 8px 10px; font-size: 12px; color: var(--text-dim); line-height: 1.45; }
  .pp-fine { margin: 0; font-size: 11px; color: var(--text-dim); }
</style>
