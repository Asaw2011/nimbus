# Privacy

*Last updated November 2026*

Nimbus Flow is a small, independent beta project. This page explains, in plain
terms, what happens with your information. A matching version lives on the
website at [nimbusdebate.com/privacy.html](https://nimbusdebate.com/privacy.html).

## What we collect

- Your email address and password, when you sign up (handled by Supabase, our
  authentication provider — we never see or store your password ourselves).
- A simple log entry each time you download the app, so we can see rough usage
  counts (which app, and when — nothing else).
- Anonymous usage counts from the app (from 1.7.2), described below. You can
  switch them off.

## What we use it for

- Logging you in and keeping your account secure.
- Sending you the one-time email confirmation and password-reset links you request.
- Getting a rough sense of how many people use Nimbus during the beta, to help
  prioritize what to build next.

## What we don't do

- We don't sell or share your email with anyone.
- We don't send marketing emails.
- We don't track you across other websites.

## Your files and prep never leave your computer

This is the part debaters care about most, so we want to be blunt about it:
**Nimbus cannot take your files, your prep, your blocks, or your flows.** There
is no feature that uploads them, because the ability to do so was never built.

- The documents you open for CardMirror and Smart blocks — your `.docx` and
  `.cmir` files — are read and saved **only on your own machine**. They are never
  sent to us or to anyone else. We run no server that receives them, and we have
  no way to see them.
- Your flows, argument bank, snippets, timers and settings are stored locally on
  your device too, the same way. Nimbus is built to work fully offline after a
  single sign-in. The only thing it sends in the background is the anonymous
  usage counts below, which never contain any of this.
- We cannot "steal" another team's files or prep, and neither can anyone using
  Nimbus. Opening a file in your own copy of the app does nothing but display it
  to you, on your computer.

The only information that ever leaves your device is (1) your login, described
above, (2) when you *choose* to flow live with your partner, the cells of
that one shared flow are passed between the two of you through a realtime relay
so your partner can see them as you type. That relay carries only the flow you
are actively sharing — never your stored files, prep, or other flows — it passes
the data through rather than storing it, and only your partner receives it, and
(3) when you press **Ask AI** in *How do I…?*, the question you typed is sent,
together with Nimbus's own built-in help text, to an AI model run by Cloudflare
so it can answer. Nothing else goes with it — no flow, file or prep — and we
don't store the questions. If you never press Ask AI, nothing is sent, and
(4) anonymous usage counts, explained next.

## Anonymous usage stats

From 1.7.2, Nimbus counts how often its features get used, so we know what to
fix and what to build next. It's anonymous: each install gets a random ID made
on your computer, unrelated to your name, email or account.

**We can never see your flows, cards, blocks, speech docs, RFDs, files,
opponents, judges, or anything you type.** There is nothing in the stats anyone
could scout. The app can only send fixed words from one short list
([`src/lib/telemetry/events.ts`](src/lib/telemetry/events.ts)) and how many
times each happened that day, e.g. "opened a policy flow", "used Smart blocks",
"sent to CardMirror". Our server ([`stats/`](stats/)) re-checks every word
against the same list and throws away anything else. It never stores your IP
address. Counts are deleted after about 13 months.

The full list: Nimbus opened (version, and Windows / Mac / Linux); a flow
opened (Policy / LD / PF, solo or partner) and roughly how long it stayed open;
features used (Smart blocks, RFD panel, Judges, Ask AI, pop-out timer, pop-out
doc, Word import, Ctrl+U underline); where cards were sent (built-in doc,
CardMirror or Falcon); partner-sync health (which connection was used, drops,
refusals); app health (from 1.7.7: that the app froze for a few seconds, that a
file save or open took 10+ seconds, or that an error was caught - the word
only, never the error message or where it happened); toolbar style and
whether answer numbers is on.

## The crash & freeze log (stays on your computer)

From 1.7.7, Nimbus keeps a small log of its own errors and freezes in its
app-data folder (`config/crash-log.json`), so a problem can be diagnosed after
you restart. It is **never sent anywhere**. If you want our help, Settings →
Backup & privacy → **Copy diagnostics** copies it so you can paste it to us
yourself. Error messages can contain bits of text, which is exactly why it is
never sent automatically.

See exactly what's sent, word for word, or switch it off in
**Settings → Backup & privacy → Share anonymous usage stats**. Switching it off
also deletes anything not yet sent.

## Open source — don't take our word for it

Every line of code Nimbus runs is public and free to read. The entire app is
open source under the MIT license, in this repository. Nothing about how it
handles your data is hidden.

If you would rather verify these claims than trust them, please do. Clone the
repository and read it, ask a coach or a developer to look it over, or point an
AI code assistant at the whole codebase and ask it plainly: *"Does this app
upload, transmit, or exfiltrate the user's files or prep anywhere?"* You are
welcome to audit it however you like. There is nothing there to find, and that
is exactly the point of keeping it open.

## Deleting your account

Self-serve deletion isn't built into the site yet. If you'd like your account
and data removed, open an issue on
[GitHub](https://github.com/Asaw2011/nimbus/issues) or reach out however you
normally would, and it'll be handled by hand.

## Questions

Ideas, concerns, or questions about any of this are welcome via the same
[GitHub Issues](https://github.com/Asaw2011/nimbus/issues) page used for bug
reports.
