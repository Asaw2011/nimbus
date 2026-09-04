<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "$lib/ui/Dashboard.svelte";
  import FlowView from "$lib/ui/FlowView.svelte";
  import Tutorial from "$lib/ui/Tutorial.svelte";
  import WhatsNew from "$lib/ui/WhatsNew.svelte";
  import { hasUnseenNotes } from "$lib/model/whatsnew";
  import { store } from "$lib/model/round.svelte";
  import { settings } from "$lib/model/settings.svelte";
  import {
    isDirty,
    markOpened,
    saveToFile,
    saveAs,
    openPath,
    autosaveToFile,
  } from "$lib/model/filedoc.svelte";
  import { checkForUpdate, type UpdateInfo } from "$lib/updater";
  import SpeechDocWindow from "$lib/doc/SpeechDocWindow.svelte";
  import { flushDocs } from "$lib/doc/docs.svelte";
  import { reportError } from "$lib/model/crash";
  import { auth } from "$lib/model/auth.svelte";
  import LoginGate from "$lib/ui/LoginGate.svelte";
  import { APP_VERSION, checkMinimumVersion, type VersionBlock } from "$lib/model/minversion";

  // Pop-out window mode: render ONLY the speech-doc editor.
  const isDocWindow =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("docwin");

  let view: "dashboard" | "flow" = $state("dashboard");
  // Auth gate. `authChecked` flips once the on-disk session has been consulted;
  // until then we render nothing rather than a login form we might not need.
  let authChecked = $state(false);
  let versionBlock = $state<VersionBlock | null>(null);
  let showTutorial = $state(false);
  let showWhatsNew = $state(false);
  let pendingUpdate = $state<UpdateInfo | null>(null);
  let updateState = $state<"idle" | "downloading" | "done">("idle");
  let updatePct = $state(0);
  // Close-prompt state.
  let closePrompt = $state(false);
  let closeError = $state("");
  let closing = false;
  // Plain mirror of `view` — read from the close callback where a $state
  // reference could be stale. Kept in sync by the effect below.
  let inFlowView = false;
  $effect(() => {
    inFlowView = view === "flow";
  });
  // Brief "Saved ✓" / error toast.
  let toast = $state("");
  function flashToast(msg: string) {
    toast = msg;
    setTimeout(() => (toast = ""), 2200);
  }

  onMount(() => {
    // The pop-out doc window renders ONLY <SpeechDocWindow/>. None of the main
    // window's setup applies here — and critically, the close guard would
    // force_quit the WHOLE app when the doc window is closed/docked back. So
    // skip all main-window setup in the doc window.
    if (isDocWindow) return;

    // Auth gate. Both of these are fire-and-forget and both fail OPEN: neither
    // is awaited, so nothing here can delay or block the app starting. A user
    // with a cached session is already rendering by this point.
    auth
      .init()
      .catch((e) => reportError("auth.init", e))
      .finally(() => (authChecked = true));
    checkMinimumVersion()
      .then((b) => (versionBlock = b))
      .catch(() => (versionBlock = null));

    // Surface uncaught errors instead of letting them silently freeze the UI:
    // a throw in an event handler or effect can leave native contenteditable
    // typing working while every JS-driven button goes dead. Log loudly and
    // toast so a freeze is visible and reportable.
    const onErr = (e: ErrorEvent) => {
      reportError(`window.error ${e.filename}:${e.lineno}:${e.colno}`, e.error ?? e.message);
      flashToast("⚠︎ " + (e.error?.message ?? e.message));
    };
    const onRej = (e: PromiseRejectionEvent) => {
      reportError("unhandledrejection", e.reason);
      flashToast("⚠︎ " + ((e.reason as Error)?.message ?? String(e.reason)));
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);

    // First-open (or re-enabled) welcome tutorial.
    if (settings.showTutorial) showTutorial = true;
    // Patch notes, once, when the running build is newer than the last one whose
    // notes were shown — whether it got here by the auto-updater or by someone
    // downloading the installer.
    //
    // ⚠ Never stacked on top of the tutorial. A brand-new machine gets the
    // tutorial, which is the better first thing to read and explains the app
    // rather than what changed in it; the version is still recorded below so
    // that user doesn't then get a changelog for the build they started on.
    if (hasUnseenNotes(settings.lastSeenVersion)) {
      if (showTutorial) {
        settings.lastSeenVersion = APP_VERSION;
        settings.save();
      } else {
        showWhatsNew = true;
      }
    }
    setupCloseGuard();
    setupFileOpen();
    const teardownAutosave = setupAutosave();
    // Check for updates in the background after a short delay so it
    // doesn't slow down the initial render.
    setTimeout(() => {
      checkForUpdate().then((u) => { if (u) pendingUpdate = u; });
    }, 4000);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      teardownAutosave();
    };
  });

  /** Belt-and-braces persistence: a 5s heartbeat plus a flush whenever the
   *  window loses focus / is hidden / is being torn down. The per-edit debounce
   *  alone can't cover a crash, sleep, or force-quit between keystroke and flush. */
  function setupAutosave(): () => void {
    // The docked speech doc has its own debounce and is torn down with the
    // window, so it rides along on every one of these — a heartbeat included.
    const flush = () => { void flushDocs(); void store.autosaveIfDirty(); };
    // Writing the round back to its OWN file keeps the two copies from ever
    // drifting apart — the drift is what let a stale file overwrite newer work.
    // It runs on a slower cadence than the app-data autosave because the file can
    // live in a synced Dropbox folder and is far heavier to write; but it must
    // also run on blur/hide/close, which is exactly when work would otherwise be
    // stranded in app data alone.
    const flushFile = () => { void autosaveToFile(store.round); };
    const flushAll = () => { flush(); flushFile(); };
    const heartbeat = setInterval(flush, 5000);
    const fileBeat = setInterval(flushFile, 30000);
    const onVisibility = () => { if (document.visibilityState === "hidden") flushAll(); };
    window.addEventListener("blur", flushAll);
    window.addEventListener("pagehide", flushAll);
    window.addEventListener("beforeunload", flushAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(heartbeat);
      clearInterval(fileBeat);
      window.removeEventListener("blur", flushAll);
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("beforeunload", flushAll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  async function installUpdate() {
    if (!pendingUpdate) return;
    updateState = "downloading";
    try {
      await pendingUpdate.install((pct) => { updatePct = pct; });
      updateState = "done";
    } catch {
      updateState = "idle";
    }
  }

  async function openFileIntoApp(path: string) {
    const round = await openPath(path);
    if (round) {
      store.loadRound(round);
      view = "flow";
    }
  }

  async function setupFileOpen() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    // A file the app was launched with (double-clicked in Finder/Explorer).
    const pending = await invoke<string | null>("take_pending_file");
    if (pending) await openFileIntoApp(pending);
    // A file opened while the app is already running.
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("open-file", (e) => {
      if (e.payload) void openFileIntoApp(e.payload);
    });
  }

  async function onGlobalKey(e: KeyboardEvent) {
    // ⌘S / Ctrl+S — save the open flow to its file (prompts if none yet).
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !e.shiftKey) {
      if (store.round) {
        e.preventDefault();
        try {
          const ok = await saveToFile(store.round);
          if (ok) flashToast("Saved ✓");
        } catch (err) {
          flashToast("Save failed: " + (err instanceof Error ? err.message : err));
        }
      }
    }
  }

  // Reset file dirty-tracking whenever the open round changes.
  let lastRoundId = "";
  $effect(() => {
    const id = store.round?.id ?? "";
    if (id !== lastRoundId) {
      lastRoundId = id;
      markOpened(store.round);
    }
  });

  async function setupCloseGuard() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.onCloseRequested((event) => {
      if (closing) return;
      // Always take control of the close, then either prompt or quit the
      // process ourselves — don't rely on Tauri's default close (unreliable
      // here). Only prompt for a flow linked to a file with unsaved changes.
      let shouldPrompt = false;
      try {
        shouldPrompt =
          inFlowView && !!store.round?.filePath && isDirty(store.round);
      } catch {
        shouldPrompt = false;
      }
      event.preventDefault();
      if (shouldPrompt) {
        closePrompt = true;
      } else {
        void forceClose();
      }
    });
  }

  async function forceClose() {
    closing = true;
    closePrompt = false;
    if (!("__TAURI_INTERNALS__" in window)) return;
    // Flush the round AND the docked speech doc to disk, then quit the process
    // directly. force_quit fires no pagehide, so this is the doc's only chance —
    // and both writes are awaited so the exit can't outrun the IPC.
    try {
      await flushDocs();
    } catch {
      /* doc save failed; quitting anyway */
    }
    try {
      await store.saveNow();
    } catch {
      /* app-data save failed; quitting anyway */
    }
    // Try several ways to actually exit — whichever the platform honors.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("force_quit");
    } catch {
      /* fall through */
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().destroy();
    } catch {
      /* nothing more we can do */
    }
  }

  async function onSave() {
    if (!store.round) return forceClose();
    try {
      if (await saveToFile(store.round)) forceClose();
      else closeError = "Couldn't save (no location chosen). Try Save As, or Don't Save.";
    } catch (err) {
      closeError = "Save failed: " + (err instanceof Error ? err.message : err);
    }
  }
  async function onSaveAs() {
    if (!store.round) return forceClose();
    try {
      if (await saveAs(store.round)) forceClose();
      else closeError = "Save cancelled.";
    } catch (err) {
      closeError = "Save failed: " + (err instanceof Error ? err.message : err);
    }
  }
</script>

<svelte:window onkeydown={onGlobalKey} />

{#if isDocWindow}
  <!-- The pop-out doc window is a child of an already-signed-in main window.
       Gating it again would strand the editor behind a second login. -->
  <SpeechDocWindow />
{:else if versionBlock}
  <LoginGate block={versionBlock} />
{:else if !auth.signedIn}
  <!-- Blank rather than the login form until the on-disk session has been
       checked: the localStorage mirror can be wiped while the disk copy is
       fine, and flashing "sign in" at somebody who is signed in looks broken. -->
  {#if authChecked}
    <LoginGate />
  {/if}
{:else if view === "flow" && store.round}
  <FlowView onexit={() => (view = "dashboard")} />
{:else}
  <Dashboard onopen={() => (view = "flow")} />
{/if}

<!-- Gated: the tutorial's backdrop is z-index 50, so on a first run it rendered
     straight over the sign-in screen. Nothing that overlays the app should be
     reachable before the user is through the gate. -->
{#if showTutorial && auth.signedIn && !versionBlock && !isDocWindow}
  <Tutorial onclose={() => (showTutorial = false)} />
{/if}

<!-- Same gate as the tutorial, for the same reason: nothing overlays the app
     until the user is through sign-in. `!showTutorial` is belt-and-braces —
     onMount already picks one or the other — so a future change to either can't
     stack two modals on a first run. -->
{#if showWhatsNew && !showTutorial && auth.signedIn && !versionBlock && !isDocWindow}
  <WhatsNew onclose={() => (showWhatsNew = false)} />
{/if}

{#if closePrompt}
  <div class="close-backdrop" role="presentation">
    <div class="close-card" role="dialog" aria-modal="true">
      <h2>Save this flow before closing?</h2>
      <p>“{store.round?.name}” has changes that aren't saved to a file yet.</p>
      <div class="close-actions">
        <button class="primary" onclick={onSave}>Save</button>
        <button onclick={onSaveAs}>Save As…</button>
        <button class="danger" onclick={forceClose}>Don't Save</button>
        <button class="ghost" onclick={() => { closePrompt = false; closeError = ''; }}>Cancel</button>
      </div>
      {#if closeError}
        <p class="close-err">{closeError}</p>
      {/if}
      <p class="note">Your work is always auto-kept in Nimbus either way — this saves a copy to your computer.</p>
    </div>
  </div>
{/if}

{#if toast}
  <div class="toast">{toast}</div>
{/if}

{#if pendingUpdate}
  <div class="update-banner">
    {#if updateState === "idle"}
      <span>Nimbus {pendingUpdate.version} is available</span>
      <button onclick={installUpdate}>Install</button>
      <button class="dismiss" onclick={() => (pendingUpdate = null)}>✕</button>
    {:else if updateState === "downloading"}
      <span>Downloading… {updatePct}%</span>
    {:else}
      <span>Update installed — restart Nimbus to apply</span>
      <button onclick={() => pendingUpdate?.relaunch()}>Restart now</button>
      <button class="dismiss" onclick={() => (pendingUpdate = null)}>Later</button>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent);
    color: #fff;
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 13px;
    z-index: 70;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    white-space: nowrap;
  }
  .update-banner button {
    background: rgba(255, 255, 255, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.4);
    color: #fff;
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .update-banner button:hover {
    background: rgba(255, 255, 255, 0.38);
  }
  .update-banner .dismiss {
    background: none;
    border: none;
    opacity: 0.7;
    font-size: 14px;
    padding: 2px 4px;
  }
  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    z-index: 70;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  }
  .close-err {
    color: var(--mark-dropped) !important;
    font-size: 12px !important;
    margin: 10px 0 0 !important;
  }
  .close-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }
  .close-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px 26px;
    max-width: 420px;
    max-height: 90vh;
    overflow-y: auto;
  }
  .close-card h2 {
    margin: 0 0 6px;
    font-size: 16px;
  }
  .close-card p {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .close-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .close-actions button {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 7px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .close-actions .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .close-actions .danger {
    color: var(--mark-dropped);
    border-color: var(--mark-dropped);
  }
  .close-actions .ghost {
    color: var(--text-dim);
  }
  .note {
    margin: 14px 0 0 !important;
    font-size: 11px !important;
  }
</style>
