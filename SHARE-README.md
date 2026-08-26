# Nimbus — install & CardMirror setup

Nimbus is a debate flowing app. It can send cards straight into a CardMirror Desktop doc, with
highlighting, cites and formatting intact. That second part needs a small plugin.

## 1. Install Nimbus

Run **`Nimbus_0.1.5_x64-setup.exe`**.

- Windows 64-bit only.
- It installs per-user (into `%LOCALAPPDATA%\Nimbus`), so there is **no admin prompt**.
- SmartScreen will probably warn that the publisher is unknown — the app isn't code-signed.
  Click **More info → Run anyway**.
- If you already have Nimbus open, close it before installing.

That's everything if you only want to flow. The rest is only for the CardMirror link.

## 2. Install the CardMirror plugin (optional)

**You need CardMirror Desktop `0.1.0-beta.31` or newer.** Older builds don't have the plugin API at
all and this will silently do nothing.

Copy the **`nimbus-flow`** folder into CardMirror's plugins directory so you end up with:

```
%APPDATA%\@cardmirror\desktop\plugins\nimbus-flow\cardmirror-plugin.json
%APPDATA%\@cardmirror\desktop\plugins\nimbus-flow\plugin.js
```

Paste `%APPDATA%\@cardmirror\desktop\plugins` into the File Explorer address bar to get there. If a
`plugins` folder doesn't exist yet, create it.

**Then fully quit and reopen CardMirror.** Plugins are only read at startup, so a reload isn't
enough.

## 3. Use it

In Nimbus's top bar there's a **Send to** toggle: **Doc** (Nimbus's own built-in speech doc) or
**CardMirror**. It defaults to **Doc** — switch it to CardMirror to route sends there.

Then flow as normal and press **`` ` ``** to send the selected cell, or **Ctrl+`** for the whole row.

The plugin starts polling on its own as soon as CardMirror launches. There's nothing to turn on, but
if you ever want to force it there are two commands in CardMirror's command palette:
*Nimbus: start auto-sync* and *Nimbus: paste queued cards now*.

## If cards don't arrive

- **Is CardMirror actually running, with a doc open?** A card addressed to a doc that isn't open
  stays queued rather than being delivered to the wrong doc. It'll arrive when you open that doc.
- **Every send is also copied to your clipboard**, so `Ctrl+V` into CardMirror always works as a
  fallback. If `Ctrl+V` pastes correctly but auto-paste doesn't, the problem is the plugin
  (not installed, or CardMirror wasn't restarted), not Nimbus.
- Nimbus talks to CardMirror over a **local-only** connection (127.0.0.1) with a random per-session
  token. Nothing leaves your machine and there's no account or login anywhere in this.

## Handy keys

| Key | Does |
|---|---|
| `` ` `` | Send the current cell / selection to the doc |
| `Ctrl+`` ` `` | Send the whole row (flow order) |
| `Ctrl+Alt+T` | Timer — stopwatch + countdown presets |
| `Ctrl+E` | Open / close the built-in speech doc |
| `Ctrl+J` | Argument lookup (autocomplete from banked cards) |
| `Ctrl+K` | Doc Search — search your prep files |
| `Ctrl+/` | Show all keybinds |
| `Ctrl+,` | Settings (every shortcut here is rebindable) |
