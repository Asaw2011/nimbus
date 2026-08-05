# Nimbus Flow — CardMirror plugin

Auto-pastes cards sent from the [Nimbus](https://github.com/Asaw2011/nimbus)
flowing app into your active CardMirror document, with full fidelity (highlight,
cite, body, and structure preserved) and without stealing focus.

## How it works

Nimbus registers as a CardMirror "flow app" and queues each sent card as
CardMirror-native HTML. This plugin pulls that queue (`flowApps` / `flowPost`)
and inserts each card by dispatching a synthetic paste into the editor — so it
runs through CardMirror's own rich-paste path.

## Install (current: dev-load, per session)

In CardMirror: **Settings → Plugins** → make sure **"Enable plugins"** is on
(restart CardMirror if it says the change takes effect next launch) → **"Load
plugin from file…"** and pick this folder (`nimbus-cardmirror-plugin/`).

This is session-only — re-load it after each CardMirror restart.

> **Persistent install (not set up yet):** CardMirror can install plugins
> permanently from a public GitHub release via community mode
> (`__plugins('community-on')` → Settings → Plugins → Install → repo URL). That
> needs this plugin published to its own public repo, which we haven't done yet.

## Use

- In **Nimbus**, set the top-bar toggle to **Send to → CardMirror**.
- In **CardMirror**, run the command **"Nimbus: start auto-sync"** once per
  session (Command palette: ⌘⇧Space → type "Nimbus"). You can also bind it to a
  key in Settings → Keybindings.
- Now sending a card in Nimbus (`` ` ``) auto-pastes it into your CardMirror doc.

`Nimbus: paste queued cards now` pulls immediately without the poller.

## Dev-load (no install)

For quick testing: **Settings → Plugins → "Load plugin from file…"** and pick
this folder. This is session-only (re-load after each CardMirror restart).
