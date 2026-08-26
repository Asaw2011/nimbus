// Nimbus Flow — CardMirror plugin.
//
// Bridges Nimbus → CardMirror with FULL fidelity. Nimbus (a registered flow app)
// queues each sent card as CardMirror-native HTML. This plugin pulls the queue
// (api.flowPost) and inserts each card by dispatching a synthetic
// `paste` event into the active editor — which runs CardMirror's own rich-paste
// path, so highlight / cite / body / structure all survive. No focus stealing:
// the paste happens in CardMirror's renderer regardless of which window is front.
//
// Polling starts at load ONLY when Nimbus is already registered on the
// handshake (one check, at startup). Otherwise "Nimbus: start auto-sync" is the
// explicit way to turn it on. "Nimbus: paste now" pulls immediately.
//
// Poll interval is POLL_MS and there is deliberately NO per-tick flowApps()
// call -- see pull(). Both exist so this plugin is a good neighbor to other
// flow apps sharing the same handshake directory.
(function () {
  "use strict";
  var APP_ID = "nimbus";
  // 700ms was far too aggressive: this runs for every user who has the plugin
  // installed, forever. Sends are not latency-critical, so seconds are plenty.
  var POLL_MS = 3000;
  var api = null;
  var timer = null;

  // `api.showToast` DOES exist in CardMirror 0.1.0-beta.31 (it's built in the
  // renderer bundle, resources/renderer/assets/main-*.js — not inside app.asar,
  // which is why an asar-only search misses it). This guard stays anyway: the
  // poller now starts at load time, where there is no plugin `api` at all, so
  // every message must survive `api` being null. Falls back to a console line.
  function say(msg) {
    try {
      if (api && typeof api.showToast === "function") {
        api.showToast(msg);
        return;
      }
    } catch (e) {
      /* fall through to the log */
    }
    console.log("[nimbus-flow] " + msg);
  }

  function editorEl() {
    // Prefer the editor the caret is in; else the first visible ProseMirror.
    var active = document.activeElement;
    if (active && active.closest) {
      var host = active.closest(".ProseMirror");
      if (host) return host;
    }
    var all = Array.prototype.slice.call(document.querySelectorAll(".ProseMirror"));
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null) return all[i];
    }
    return all[0] || null;
  }

  // Reconstruct the card by feeding CardMirror's own paste handler our native
  // HTML through a synthetic ClipboardEvent (Chromium/Electron honors a
  // constructed DataTransfer on the event).
  function pasteHtml(el, html) {
    try {
      var dt = new DataTransfer();
      dt.setData("text/html", html);
      // A plain-text flavor so paste never comes through empty on odd paths.
      dt.setData("text/plain", (el && el.textContent != null) ? "" : "");
      var ev = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      el.focus();
      el.dispatchEvent(ev);
      return true;
    } catch (e) {
      console.error("[nimbus-flow] paste failed", e);
      return false;
    }
  }

  // The poller works off `window.electronAPI` (the preload bridge) rather than
  // the plugin `api`, because `api` only exists inside a command's run(). Using
  // the bridge lets auto-sync start the moment the plugin loads — see boot().
  function bridge() {
    // Prefer the plugin api when a command has handed it to us (same methods,
    // and it's the documented surface); fall back to the preload bridge.
    if (api && typeof api.flowPost === "function") return api;
    var w = typeof window !== "undefined" ? window.electronAPI : null;
    return w && typeof w.flowPost === "function" ? w : null;
  }

  // Uids of the docs living in THIS window. `listDocs()` is on the preload
  // bridge (not the plugin api), so it's available at load time — which is what
  // lets auto-sync run without a command ever being invoked.
  async function ownDocUids() {
    var w = typeof window !== "undefined" ? window.electronAPI : null;
    if (!w || typeof w.listDocs !== "function") return [];
    try {
      var docs = (await w.listDocs()) || [];
      var out = [];
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        if (d && d.isOwnWindow && d.uid) out.push(d.uid);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  async function pull() {
    var b = bridge();
    if (!b) return;
    try {
      // No flowApps() pre-check here. It rescanned the handshake directory and
      // pinged EVERY registered flow app (1.5s timeout each) on every single
      // tick, so this plugin hammered unrelated apps on machines that have
      // them. flowPost already reports app-not-running from a local file
      // check at almost no cost, which is the same information.
      // Identify this window by the uids of the docs it owns, so Nimbus can
      // address a card at one specific doc. Titles are NOT usable for this: an
      // unsaved doc is reported as "Untitled" by the bridge while the window's
      // document.title carries no filename at all, so title matching silently
      // dropped every card. listDocs() gives exact ids and marks which entries
      // belong to the calling window.
      var res = await b.flowPost(APP_ID, "/pending", { uids: await ownDocUids() });
      if (!res || !res.ok || !res.body) return;
      var cards = res.body.cards || [];
      if (!cards.length) return;
      var el = editorEl();
      if (!el) return;
      for (var i = 0; i < cards.length; i++) pasteHtml(el, cards[i]);
    } catch (e) {
      // transient (CardMirror not focused, Nimbus closed) — ignore
    }
  }

  function startPolling() {
    if (timer) return false;
    timer = setInterval(pull, POLL_MS);
    return true;
  }

  function startAutoSync(a) {
    api = a;
    if (!startPolling()) return say("Nimbus auto-sync already on");
    say("Nimbus auto-sync on — sends will paste here automatically");
  }

  // Start polling at load ONLY if Nimbus is actually registered on the
  // handshake. Starting unconditionally meant the plugin polled forever for
  // people who installed it once and never opened Nimbus again. This is the
  // one and only flowApps() call: once at startup, never per tick.
  //
  // If Nimbus isn't registered, "Nimbus: start auto-sync" stays the explicit
  // way in — so someone who installs the plugin first and Nimbus second isn't
  // stuck, they just run the command once.
  async function boot() {
    var b = bridge();
    if (!b) return; // no preload bridge — wait for a command to hand us `api`
    try {
      if (typeof b.flowApps !== "function") return;
      var apps = (await b.flowApps()) || [];
      var nimbus = apps.find(function (a) {
        return a && (a.appId === APP_ID || a.app === APP_ID || a.id === APP_ID);
      });
      if (!nimbus) return;
    } catch (e) {
      return; // can't tell — stay quiet rather than poll on spec
    }
    startPolling();
  }

  function pasteNow(a) {
    api = a;
    return pull();
  }

  // async, deliberately not awaited; it never rejects (see boot).
  boot();

  if (window.__registerCardMirrorPlugin) {
    window.__registerCardMirrorPlugin({
      id: "nimbus-flow",
      name: "Nimbus Flow",
      apiVersion: 1,
      commands: [
        {
          id: "nimbus-flow.start",
          label: "Nimbus: start auto-sync",
          keywords: ["nimbus", "flow", "auto", "sync", "paste"],
          run: startAutoSync,
        },
        {
          id: "nimbus-flow.paste",
          label: "Nimbus: paste queued cards now",
          keywords: ["nimbus", "flow", "paste", "pull"],
          run: pasteNow,
        },
      ],
    });
  }
})();
