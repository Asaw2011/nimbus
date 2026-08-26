<script lang="ts">
  // The sign-in screen shown when there is no cached session.
  //
  // Sign-UP deliberately lives on nimbusdebate.com, not here: it keeps that site
  // as the funnel and avoids rebuilding the email round-trip in the app.
  import { auth } from "../model/auth.svelte";
  import type { VersionBlock } from "../model/minversion";

  let { block = null }: { block?: VersionBlock | null } = $props();

  let email = $state("");
  let password = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    await auth.signIn(email, password);
    // On success the parent swaps this component out; nothing to do here.
    password = "";
  }

  function openSite() {
    // Tauri opens external links through the opener plugin; the browser build
    // falls back to a normal new tab.
    if ("__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/plugin-opener")
        .then((m) => m.openUrl("https://nimbusdebate.com/#downloads"))
        .catch(() => window.open("https://nimbusdebate.com/#downloads", "_blank"));
    } else {
      window.open("https://nimbusdebate.com/#downloads", "_blank");
    }
  }
</script>

<div class="gate">
  <div class="card">
    <h1>NIMBUS</h1>

    {#if block}
      <p class="lead">{block.message}</p>
      <button class="primary" onclick={openSite}>Get the latest version</button>
      <p class="fine">This copy is {block.minVersion} or older.</p>
    {:else}
      <p class="lead">Sign in with your nimbusdebate.com account.</p>

      <form onsubmit={submit}>
        <label>
          <span>Email</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="email"
            bind:value={email}
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            autofocus
            disabled={auth.busy}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            bind:value={password}
            autocomplete="current-password"
            disabled={auth.busy}
          />
        </label>

        {#if auth.error}
          <p class="err" role="alert">{auth.error}</p>
        {/if}

        <button class="primary" type="submit" disabled={auth.busy}>
          {auth.busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p class="fine">
        No account? <button class="linkish" onclick={openSite}>Create one at nimbusdebate.com</button>
      </p>
      <p class="fine dim">You only need to do this once — after that Nimbus opens offline.</p>
    {/if}
  </div>
</div>

<style>
  .gate {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
    /* Above every other overlay in the app (the tutorial backdrop is 50, the
       settings panel 20). Belt-and-braces: those are also not rendered while
       the gate is up, but nothing should ever be able to cover the login. */
    z-index: 1000;
  }
  .card {
    width: min(380px, 100%);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 28px 26px 22px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 20px;
    letter-spacing: 0.14em;
    font-weight: 700;
  }
  .lead {
    margin: 0 0 18px;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.45;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--text-dim);
  }
  input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 8px 10px;
    font: inherit;
    font-size: 13px;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  input:disabled {
    opacity: 0.6;
  }
  .primary {
    margin-top: 4px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 9px 12px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
  }
  .primary:disabled {
    opacity: 0.65;
    cursor: default;
  }
  .err {
    margin: 0;
    color: #ff6b6b;
    font-size: 12px;
    line-height: 1.4;
  }
  .fine {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--text-dim);
    text-align: center;
  }
  .fine.dim {
    margin-top: 6px;
    opacity: 0.75;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
