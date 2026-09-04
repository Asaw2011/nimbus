<script lang="ts">
  // Patch notes, shown once after an update and on first launch of a fresh
  // download. Dismissing it records the version so it never reappears for the
  // same build.
  //
  // ⚠ Like the tutorial, this must be gated on `auth.signedIn` by its CALLER.
  // The tutorial's backdrop once rendered straight over the sign-in screen; an
  // overlay that can appear before someone is through the gate is a bug, not a
  // z-index question.
  import { settings } from "../model/settings.svelte";
  import { APP_VERSION } from "../model/minversion";
  import { notesSince } from "../model/whatsnew";

  let { onclose }: { onclose: () => void } = $props();

  // Snapshot at construction: `close()` writes lastSeenVersion, which would
  // otherwise empty the list out from under the render.
  const notes = notesSince(settings.lastSeenVersion);
  const isFirstRun = !settings.lastSeenVersion;

  function close() {
    settings.lastSeenVersion = APP_VERSION;
    settings.save();
    onclose();
  }

  /** Minimal inline markdown: **bold** and `code`, escaped first. */
  function fmt(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") close(); }} />

<!-- Closing on a backdrop click is done by comparing target to currentTarget
     rather than stopping propagation on the card. Same behaviour, but the card
     needs no click handler of its own — a non-interactive element with a click
     handler and no keyboard path is an accessibility warning, and Escape above
     is the keyboard path for the backdrop. -->
<div
  class="wn-backdrop"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) close(); }}
>
  <div
    class="wn-card"
    role="dialog"
    aria-modal="true"
    aria-label="What's new in Nimbus"
    tabindex="-1"
  >
    <div class="wn-head">
      <div>
        <h2>{isFirstRun ? "Welcome to Nimbus" : "Nimbus just updated"}</h2>
        <p class="wn-sub">
          {isFirstRun ? "You're on" : "You're now on"} <b>version {APP_VERSION}</b>.
        </p>
      </div>
      <button class="wn-x" title="Close" onclick={close}>✕</button>
    </div>

    <div class="wn-body">
      {#each notes as note (note.version)}
        <section>
          {#if notes.length > 1}<h3>{note.version}</h3>{/if}
          <p class="wn-headline">{note.headline}</p>
          <ul>
            {#each note.items as item, i (i)}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <li>{@html fmt(item)}</li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>

    <div class="wn-foot">
      <span class="wn-hint">The full manual is under 📖 in the top bar.</span>
      <button class="wn-go" onclick={close}>Start flowing →</button>
    </div>
  </div>
</div>

<style>
  /* Below the login gate's z-index 1000 on purpose — this must never be able to
     paint over the sign-in screen even if the caller's guard were removed. */
  .wn-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .wn-card {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
    width: min(620px, 100%);
    max-height: min(78vh, 720px);
    display: flex;
    flex-direction: column;
  }
  .wn-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 20px 22px 12px;
    border-bottom: 1px solid var(--border);
  }
  .wn-head h2 { margin: 0; font-size: 19px; }
  .wn-sub { margin: 4px 0 0; font-size: 13px; color: var(--text-dim); }
  .wn-x {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 15px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .wn-x:hover { color: var(--text); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  /* The list can outgrow the card on a small window, so it scrolls rather than
     pushing the dismiss button off the bottom where nobody can reach it. */
  .wn-body { overflow-y: auto; padding: 16px 22px 4px; }
  .wn-body section + section { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
  .wn-body h3 { margin: 0 0 6px; font-size: 13px; color: var(--accent); letter-spacing: 0.04em; }
  .wn-headline { margin: 0 0 10px; font-size: 13.5px; color: var(--text-dim); line-height: 1.45; }
  .wn-body ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 9px; }
  .wn-body li { font-size: 13.5px; line-height: 1.5; }
  .wn-body :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
  .wn-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 22px 18px;
    border-top: 1px solid var(--border);
  }
  .wn-hint { font-size: 12px; color: var(--text-dim); }
  .wn-go {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 9px 18px;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .wn-go:hover { filter: brightness(1.06); }
</style>
