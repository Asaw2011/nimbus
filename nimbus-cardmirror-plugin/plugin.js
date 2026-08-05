// Nimbus Flow — CardMirror plugin.
//
// Bridges Nimbus → CardMirror with FULL fidelity. Nimbus (a registered flow app)
// queues each sent card as CardMirror-native HTML. This plugin pulls the queue
// (api.flowApps + api.flowPost) and inserts each card by dispatching a synthetic
// `paste` event into the active editor — which runs CardMirror's own rich-paste
// path, so highlight / cite / body / structure all survive. No focus stealing:
// the paste happens in CardMirror's renderer regardless of which window is front.
//
// The plugin API only hands us `api` inside a command's run(), so "Nimbus:
// start auto-sync" captures it and starts the poller (run once per session, or
// bind it to a key). "Nimbus: paste now" pulls immediately.
(function () {
  "use strict";
  var APP_ID = "nimbus";
  var api = null;
  var timer = null;

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

  async function pull() {
    if (!api) return;
    try {
      var apps = await api.flowApps();
      var nimbus = (apps || []).find(function (a) {
        return a && (a.appId === APP_ID || a.app === APP_ID || a.id === APP_ID);
      });
      if (!nimbus || nimbus.running === false) return;
      var res = await api.flowPost(APP_ID, "/pending", {});
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

  function startAutoSync(a) {
    api = a;
    if (timer) return api.showToast("Nimbus auto-sync already on");
    timer = setInterval(pull, 700);
    api.showToast("Nimbus auto-sync on — sends will paste here automatically");
  }

  function pasteNow(a) {
    api = a;
    return pull();
  }

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
