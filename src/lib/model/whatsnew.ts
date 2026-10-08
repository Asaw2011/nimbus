// "What's new" - the patch notes shown once after the app updates itself, and
// on first launch of a freshly downloaded build.
//
// ⚠ The notes are BUNDLED, not fetched. Nimbus is used in rounds on tournament
// wifi and is designed to work offline forever after one sign-in; a patch-notes
// panel that needs the network would be blank exactly when someone opens the app
// in a competition room. It also means the notes always match the binary they
// shipped with, which a fetched "latest release" body does not.

import { APP_VERSION } from "./minversion";

export interface ReleaseNote {
  version: string;
  /** One line under the heading - what this release is about. */
  headline: string;
  items: string[];
}

/**
 * Newest first. Add an entry when you cut a release; nothing else needs editing.
 *
 * Keep entries user-facing: what changed for someone flowing a round, not which
 * files moved.
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.5.4",
    headline: "Send your whole 2AC to the doc in one click, number your answers if you want, and Smart blocks picks the right section.",
    items: [
      "**Your 2AC, all at once.** With **2AC off-case** ticked in the Smart blocks tray, a **Your 2AC** box lists every off-case page and how much of your 2AC is on it. **Send all to doc** puts every page in your speech doc in one go, each under its page name - no more tilde-ing page by page. **T goes first**, and you can **drag** pages (⋮⋮) into whatever order you'll read them.",
      "**Answer numbers (experimental).** Turn on **Answer numbers** in Settings → Experimental and your 2NC/1NR answers get the number of the 2AC argument they answer (**2AC1**, **2AC 2-3**), and your 2AC answers on advantage pages the 1NC's (**1NC1**). Each new answer takes the next number by itself; the column header's ‹ › and + skip around or group. Sending the column puts your answers in number order under the number and a **[xxx]** line with what they said - even if you answered 2AC 2 before 2AC 1. Off by default; with it off nothing changes.",
      "**LD and PF too.** Your 2AC, the 2AC off-case lists and answer numbers work in every format, on the matching speeches: in LD the **1AR** (answering the NC) and the **NR**, in PF the **rebuttals**. The Smart blocks tray names them that way too.",
      "**LD and PF feel like their own events.** Prep starts at **4 minutes in LD and 3 in PF** (8 in policy - each is in Settings → Appearance → Prep clocks), the timer shows **that event's speech times**, pages are **Contentions** (PF: **Pro / Con contention**), overview pages start at the NR or rebuttal, and PF's cross-ex page has the three **crossfires**.",
      "**Smart blocks picks the right section.** A page like **Economy DA** now takes your 2AC file's **DA---Economy** blocks instead of the case **Economy** blocks with a similar name.",
    ],
  },
  {
    version: "1.5.3",
    headline: "Ask Nimbus how to do anything, try a sample round, and partner flowing stops crying wolf when someone minimizes.",
    items: [
      "**How do I…?** The **?** button at the top right of a flow (or **Ctrl+/**) now answers in plain words. Type what you want to do - \"drop\", \"send to doc\", \"two flows at once\" - and get the steps, your shortcut, and a button that does it for you. The full shortcut list is still in there.",
      "**Ask AI.** Press **Enter** in How do I…? and an AI answers your question from Nimbus's own help - only about using the app, never your arguments. It's free, needs the internet, and only your question is sent - never your flows or files. Without internet it falls back to the normal search.",
      "**Try a sample round.** New to Nimbus? **Try a sample round** on the home screen opens a filled-in practice flow to click around in. It's only saved if you change something.",
      "**A minimized partner isn't a dropped partner.** When your partner minimizes Nimbus or switches to CardMirror for a speech, their partner button now turns **grey - \"minimized\"** instead of blinking yellow and then red. You're still connected and nothing is lost. It turns red only if their Nimbus actually disconnects.",
      "**1NC pages get their names.** When every block is labelled \"1NC---OFF\" and the position's name is written underneath - as a plain line or a tag with no card (\"Midterms DA\", \"STATES CP.\") - that becomes the page's name instead of leaving it untitled.",
      "**K affs import as one page.** A 1AC that's one big block of cards now becomes a single advantage page, instead of one page per card.",
      "**The plan isn't a page.** Importing a 1AC lists its Plan section unticked, so it doesn't become an advantage page unless you tick it.",
      "**Import and Export are always open** on the round page - no more expanding them first.",
      "**Plainer words.** The empty top cell of a page says **Page name**, the send key shows as **` (left of 1)**, partner lanes are called **columns**, and the Smart blocks tabs explain themselves on hover.",
    ],
  },
  {
    version: "1.5.2",
    headline: "The partner screen only opens for new partner flows, and the red partner button keeps its person icon.",
    items: [
      "**Only new partner flows open on the partner screen.** Starting a new flow **With a partner** still takes you straight to start or join a session. Reopening a flow you already made goes right to the flow.",
      "**The red partner button shows the person icon** instead of a warning sign when you're not connected.",
    ],
  },
  {
    version: "1.5.1",
    headline: "Partner flows open on the join screen, and the partner button shows the connection at a glance.",
    items: [
      "**Partner flows start on the partner screen.** Pick **With a partner · Aff** or **Neg** and start flowing, and the first thing you see is where to start or join a session. Close it any time to carry on.",
      "**The partner button is color-coded.** **Green** when you're connected and everything is reaching your partner. **Blinking yellow** when the connection is lagging - reconnecting, or your partner has gone quiet for a few seconds. **Red** when a partner flow isn't connected at all.",
    ],
  },
  {
    version: "1.5.0",
    headline: "Smart blocks grows up: files follow your side, your 2AC and 1AR each answer their own speech, and every off-case page can list its whole 2AC.",
    items: [
      "**Files follow your side.** 2AC, 1AR and AFF files are the aff's; Case Neg and NEG files are the neg's. When you're aff your case neg is marked **not used**, and when you're neg your 2AC files are. Ticking **every sheet** no longer hides a file from its own pages.",
      "**Pick what your advantage pages use.** Under each 2AC or case-neg file in **Kit**, click **Adv pages use** and tick the pockets or hats your advantages should draw on (Case + Turns, say). A 2AC file is never dumped whole onto your advantages.",
      "**Answering 2AC / 1AR.** Your 2AC file only answers into your 2AC, your 1AR file only into your 1AR. The switch at the top of the tray moves to the 1AR by itself once the neg block is flowed - or click it.",
      "**2AC off-case.** Tick it and every off-case page named for its position (\"Midterms DA\", \"States CP\") lists every block under that position in your 2AC file, in order. Click down the list and they stack in your 2AC; a block that answers a flowed argument is marked and goes in that row. Untick it and only your advantages get suggestions.",
      "**No more duplicates.** Each block is offered once per page, under the argument it answers best, and disappears from the page the moment it's there - yours or your partner's.",
      "**Charts and tables survive.** A card inserted with Smart blocks now sends to your speech doc exactly as written, tables included.",
    ],
  },
  {
    version: "1.4.9",
    headline: "Empty new flows no longer pile up, the cloud is back, and update checks tell you when they can't connect.",
    items: [
      "**Empty new flows don't pile up.** A new flow is only saved once you actually do something in it - add a page, type, or rename it. Open one and go straight back, and nothing is left behind in Recent flows or your folders.",
      "**The cloud is back** at the top of the home screen.",
      "**Update checks say when they fail.** **Settings -> Check for updates** used to say \"up to date\" even when it couldn't reach the internet. It now says it couldn't check.",
    ],
  },
  {
    version: "1.4.8",
    headline: "A tidier home screen, colored Advantage and Off-case buttons, and new pages that just appear.",
    items: [
      "**Settings and Manual moved to the top right.** They're the same gear and book buttons as inside a flow. **Open a flow** and **Convert** now sit right under **Start flowing**.",
      "**A cleaner home screen.** The cloud is gone from the top, and tournaments show just their name without the folder path under it.",
      "**Recent flows are there when you come back.** Going back from a flow no longer shows the home screen without Recent flows for a moment before they pop in.",
      "**Advantage is blue and Off-case is red** in a flow's Add buttons, matching the colors of the pages they make. Overview and CX stay grey.",
      "**New pages just appear.** Adding an Advantage, Off-case or Overview no longer opens a rename box. Rename it any time with ✎, or by typing in its LABEL cell.",
      "**Page colors follow the page type.** The color picker on each page is gone, and the \"Saved to...\" file path under the round's details is too.",
    ],
  },
  {
    version: "1.4.7",
    headline: "Select a block of cells with the keyboard - hold Shift and use the arrow keys.",
    items: [
      "**Shift+arrows select cells.** Hold **Shift** and press an arrow key to highlight a block of cells straight from the one you're in - just like a spreadsheet. **Shift+Up/Down** starts extending right away; **Shift+Left/Right** kicks in once the caret reaches the edge of the cell's text, so you can still shift-select letters inside a cell first.",
      "**Everything you can do to a selection still works.** Once a block is highlighted, delete it, copy it, drag it, or mark it dropped / starred / analytic / card - now without ever leaving the keyboard.",
    ],
  },
  {
    version: "1.4.6",
    headline: "New pages ask what they are, every cross-ex lives under one CX tab, and home opens without the flicker.",
    items: [
      "**New pages ask what they are.** Ctrl+T (⌘T on a Mac) or the **+** tab now asks Advantage, Off-case, Overview or CX first (or press 1-4), then the name. The name comes filled in (Adv 2, Off 3...), so Enter is enough.",
      "**One CX tab for the whole round.** Picking 1AC, 1NC, 2AC... in the cross-ex speech bar no longer adds a tab each time. They all live under one CX tab, and the bar switches between them.",
      "**Home opens cleanly.** Going back from a flow no longer flashes every tournament open and \"Empty\" for a second.",
      "**Drag a selection past the edge to scroll.** Dragging a selection of cells up onto the column headers (or down to the bottom) scrolls the flow and keeps selecting, like selecting text in Word.",
      "**Smart blocks: Insert moves down a row,** the same as inserting from Ctrl+K.",
    ],
  },
  {
    version: "1.4.5",
    headline: "CardMirror .cmir files work in Ctrl+K and Smart blocks, pastes stay in one cell, and the condensed toolbar is slimmer.",
    items: [
      "**.cmir files work everywhere .docx does.** Ctrl+K lists and opens CardMirror .cmir files from your library, and you can add them to Smart blocks. Blocks and cards insert exactly as they do from a .docx.",
      "**Pasting a long block keeps it in one cell.** Text pasted from outside Nimbus no longer splits into a new row per line. Copying a range of Nimbus cells and pasting it back still fills the same range. Want the old splitting back? Turn it on in **Settings -> Editing -> Pasting**.",
      "**No Smart block suggestions for the 1NC.** The 1NC is read off a prepared shell, so suggestions for answering the 1AC are gone. Suggestions for the 2AC's answers to the 1NC (and everything after) are unchanged.",
      "**The condensed toolbar is shorter.** Condensing the toolbar now shrinks its height too, so the flow gets more room when you're in splitscreen.",
    ],
  },
  {
    version: "1.4.4",
    headline: "Pop the timer out so it stays on top of CardMirror, with real alarm sounds and shortcuts that work from anywhere.",
    items: [
      "**Pop the timer out.** The new pop-out button on the timer moves it into its own small window that stays on top of everything - over a maximized CardMirror, even while you click into it. It keeps counting as it moves, and docks back in one click.",
      "**Any size, anywhere.** **XS · S · M · L** buttons resize it (XS is just the time and a ▶ button), another puts it in a corner or at the top or bottom of the screen, and you can drag and resize it like any window. It reopens where you left it.",
      "**Shortcuts from any app.** **Ctrl+Alt+Space** starts or pauses the timer and **Ctrl+Alt+R** resets it - inside Nimbus, and from CardMirror while it's popped out. Change them in **Settings -> Appearance -> Timer alarm**.",
      "**A proper alarm.** At 0:00 it keeps ringing until you stop it, and it starts the moment the clock hits 0:00 (the countdown used to show 0:00 a second early). Five new built-in sounds, a volume slider, or import your own.",
    ],
  },
  {
    version: "1.4.3",
    headline: "Cross-ex shows whose it is, block answers end the way you want, and partner flowing is steadier.",
    items: [
      "**Cross-ex says whose cross-ex it is.** A bar at the top of every cross-ex page reads **Cross-ex of 1AC · 1NC · 2AC · 2NC**, and the headers say who asks and who answers. Click a speech to jump to its cross-ex - each one keeps its own questions, on its own tab.",
      "**Neg block answers end the way you want.** An answer you send with **~** no longer ends in \"---Neg Block\". Pick **---2NC**, **---1NR** or nothing in **Settings -> Flow & Formats -> Answer headers**.",
      "**Nothing you type goes missing while your partner types too.** If your partner's edit arrived in the split second after you typed, the last few characters of your cell could fail to reach them until you edited it again. Fixed.",
      "**Partner flowing runs on Nimbus's own servers.** It's steadier, and it keeps flowing costs low so it can stay free. If your network blocks the new servers, Nimbus quietly uses the old ones instead - nothing to set up.",
    ],
  },
  {
    version: "1.4.2",
    headline: "Build your own flow formats - your columns, your names, your sides - and switch to one in a click.",
    items: [
      "**Custom formats.** In **Settings -> Flow & Formats** you can now make your own format from scratch or by duplicating a built-in one. Add as many columns as you want, name each one, set its side (Aff / Neg / neutral), and reorder them - everything a built-in format has, under your control.",
      "**Apply a format in one click.** Each format has a **Use** button and shows a **✓ In use** badge, so the one your new flows start with is obvious and one tap away - no hunting for a separate setting. Making or duplicating a format selects it for you.",
      "**Jump straight to it.** The new-flow card has a **Manage…** link next to the format picker that opens **Flow & Formats** directly, and the format dropdown lists your custom formats alongside the built-ins.",
      "**Set the starting height.** Choose how many rows a fresh sheet opens with - paper still grows as you flow past the bottom, this just sets where it starts.",
    ],
  },
  {
    version: "1.4.1",
    headline: "Smart blocks is a switch now, you can flow a cross-ex, and importing is cleaner.",
    items: [
      "**Smart blocks is now optional.** It moved to **Settings -> Experimental** and starts off, so the flow stays clean until you want it. Turn it on and the ✦ Smart blocks tray comes back in the corner exactly as before.",
      "**Flow a cross-ex.** The **+** new-flow button offers **Cross-ex (Q&A)** - a simple two-column sheet with the question on the left and the answer on the right. Enter jumps question to answer to the next question; undo, autosave and sharing with your partner all work the same as any other flow.",
      "**Importing pages no longer fills your argument bank.** Bringing a doc in as sheets used to quietly load the whole thing into the author lookup. Now that only happens when you pick **Bank arguments only - no pages**, or bank something yourself.",
      "**Cleaner text throughout.** Tidied the punctuation across the app.",
    ],
  },
  {
    version: "1.4.0",
    headline: "Smart blocks: load your files for the round, and Nimbus offers the block that answers each argument.",
    items: [
      "**Smart blocks (beta).** Open **✦ Smart blocks** in the bottom-right corner of the flow and drop in your files for the round. When the other team makes an argument - in your lane or your partner's - Nimbus suggests the block that answers it. One click puts the whole block in your next speech on that row.",
      "**Every sheet uses its own file.** \"India CP\" draws only from your India CP file, so two counterplans' \"AT: Perm\" blocks never get mixed up. A 2AC file with a section for each CP works too: each sheet uses only its own section.",
      "**Case negs and 2ACs cover your aff sheets automatically.** A file named \"Case Neg\" is used on every advantage sheet, and when you're aff, so is the CASE section of your 2AC file.",
      "**Overviews, one click away.** The Overviews tab lists the sheet's overview blocks - the first block under each **Main** (Uniqueness, Link, Internal, Impact), and when you're aff, each advantage's impact overview from your 2AC file.",
      "**Your file, right beside the flow.** The File tab shows the sheet's file just like Doc Search does inside a file, with search and POC / HAT / BLK / CARD levels. Click a block to put it in the selected cell, or drag it onto any cell.",
      "**A library that follows you.** Pin 📌 the files you want in every round - T, theory, framework, your case neg - and they're in every kit automatically.",
    ],
  },
  {
    version: "1.3.5",
    headline: "A tidier home screen, a single Nimbus folder, a white-doc dark theme, and quicker housekeeping.",
    items: [
      "**One home for your flows.** Your loose flows now live in a single **Nimbus** folder in Documents, shown as **Recent flows** - no more split between a folder and a separate recents list. Tournaments are the folders inside **Nimbus/tournaments**, listed up top with their location on disk shown under each one.",
      "**A quick first-run setup** to pick your theme, speech format, and how flows are saved - all still changeable in Settings.",
      "**Delete a flow in a click.** Every flow row has an always-visible delete button (it asks once to confirm).",
      "**A new \"Dark · White Doc\" theme** - the whole app dark, but the speech doc stays white so cards read like paper.",
      "**Hover tooltips** on the toolbar, tidier \"AT:\" headers that name the card and speech, and a bigger cloud on the home screen.",
    ],
  },
  {
    version: "1.3.4",
    headline: "Nothing your partner types can go missing, and your own column stops calling itself \"Partner\".",
    items: [
      "**The home page scrolls all the way down again.** With more than a few tournaments, the bottom of the list was cut off - scrolling toward it pulled the page back up to the top instead of letting you reach it. The scrolling area was sized 40 pixels taller than the window it sits in, so the last of it was unreachable and the page underneath was being dragged instead.",
      "**Your partner's work can no longer be lost while you're on another flow.** If you opened a different flow during a session - flowing into the wrong one and copying it across, say - everything your partner wrote in the meantime arrived with nowhere to go and was dropped, for good. Their end had already counted it as sent, so it was never re-sent and going back to the flow didn't bring it. Nimbus now notices it missed something and asks for it again as soon as the flow is open.",
      "**Your own column says \"You\" again.** If you were the one who joined, your column was labelled **Partner** and your partner's said **You** - every time you left a session or reopened the flow. It was only ever right while the session was live, and it never happened to whoever hosted, which is why it was hard to pin down. Which lane is yours is now remembered with the flow.",
      "**You can't type over your partner's cell by accident.** With a cell of theirs selected, a stray keystroke could replace a line they had just written, and there was no getting it back - their text was never in your undo history. Their cells are now read-only while a session is live. **Empty ones still aren't**, so flowing a speech for them works exactly as before, and you can always select and copy.",
      "**Drag your tournaments into the order you want.** Grab the handle at the left of any folder on the home page and drag, or focus it and use the arrow keys. The order is saved.",
      "**Choose which side your column sits on.** When a speech is split between you and your partner, **Settings → My column** puts yours on the Left or the Right. Before this it depended on who started the session, so the two of you saw mirror images of the same flow. It only changes what you see.",
    ],
  },
  {
    version: "1.3.2",
    headline: "The other themes are back, and the sheet tabs can be made smaller.",
    items: [
      "**All the themes are back.** Snow, Paper, Cream, Sky, Mist and Slate return alongside Dark and Light, with exactly the colours they had - same backgrounds, same aff/neg ink. If you were using one of them and got moved to Light, pick it again in **Settings → Appearance** and it looks the way it did.",
      "**Sheet tabs come in three sizes.** The tab bar along the bottom got taller in 1.3.0, and every pixel of it is a bit of flow you can't see. **Settings → Sheet tabs → Tab size** offers Compact, Regular and Large - Compact is the old bar and gives you about half a row of flow back on a laptop. Regular is the new default, between the two.",
    ],
  },
  {
    version: "1.3.1",
    headline: "Importing a 1NC now gives your partner the off-case pages too.",
    items: [
      "**Off-case pages reach your partner.** Importing a 1NC created the pages on your screen and, often, on nobody else's - your partner had to build them by hand mid-round and the two flows drifted apart. A page made by an import arrives already full of cards, and the whole thing was being sent as one oversized message that the server quietly refused. Worse, nothing noticed: your computer treated it as delivered, so it was never sent again. Pages, rows and cards are now sent in pieces small enough to get through, and a big block of cards is split up rather than dropped. **You don't need to change how you import.**",
      "**Long blocks of cards sync in full.** The same limit was quietly cutting off individual cells holding a large expanded block - the page would look like it had synced with the biggest card in it missing. Those are sent in parts now and arrive complete.",
    ],
  },
  {
    version: "1.3.0",
    headline: "A cleaner, calmer Nimbus - same flow, less clutter.",
    items: [
      "**Two themes instead of five.** The theme picker is now just **Dark** and **Light** - a deep true-dark and a clean white, both on the same blue accent and the same aff/neg/analytic/card ink, so a flow looks the same in either one and nothing shifts color when you switch. The old in-between greys and paper tints are gone; if you were on one of them, Nimbus moves you to the nearest of the two and nothing you set is lost.",
      "**Crisp icons in place of emoji.** The toolbar, dashboard and tabs now use a single matched icon set that stays sharp at any size and takes the theme's color, instead of emoji that rendered differently on every machine. Everything means the same thing it did - it just looks like one app now.",
      "**Prep time lives with the other clocks.** The setting for how much prep each team gets moved out from under Appearance into its own **Prep clocks** section next to Timer presets, with a note that it sets new rounds - to change the round you're in, you still click the time in the ribbon and type over it.",
      "**A tidier dashboard and settings.** The round list and the settings window got a pass for spacing and alignment, so the app feels finished rather than busy. Nothing about where things are or what they do has changed.",
    ],
  },
  {
    version: "1.2.9",
    headline: "Nimbus stops freezing mid-round, and searching by content no longer downloads your whole Dropbox.",
    items: [
      "**The pauses while flowing are fixed.** On a big flow Nimbus could lock up for a second or two at a time, usually just as you were typing. Every undo step was keeping a complete copy of the round in memory, and three hundred of them on a full flow came to well over a gigabyte - so the app spent its time cleaning up memory instead of taking your keystrokes. Undo now keeps as much history as it can fit in a sensible amount of memory rather than a fixed number of steps: on an ordinary flow nothing changes and you still get the full three hundred, and on a very large one you get fewer steps but a responsive app. **Nothing about what a single undo does has changed.**",
      "**Partner flowing costs almost nothing when nobody is typing.** Four times a second, every second of a session, Nimbus was copying the entire flow and re-checking every cell to work out whether anything had changed - including while you were sitting listening to the other team. It now checks in an instant whether the flow has been touched at all and does the real work only when it has.",
      "**Judge feedback is your own.** In a partner session, feedback is no longer shared between the two of you - you each keep your own notes on what the judge said, which is usually not the same thing. Everything else still carries across as before: the judge's name, who you hit, the team names and the flow itself.",
      "**\"By content\" no longer starts reading your whole library the moment you click it.** If your prep is in Dropbox or OneDrive, the files are often stored online rather than on your computer, and reading them to search inside them quietly downloads every one - a mis-click could pull down hundreds of megabytes and tie the app up for several minutes with no way to stop it. Searching by content now works straight away on whatever has already been read, and bringing the rest up to date is a button you press. **You can stop it at any time**, and everything scanned so far is kept. Files that aren't downloaded to your computer are skipped and counted, so you can choose to fetch them rather than having it happen to you.",
    ],
  },
  {
    version: "1.2.8",
    headline: "Judge feedback in one block, and a reconnect that catches you up.",
    items: [
      "**Judge feedback is one box now.** Judge, who won, and everything they said - instead of separate boxes for the decision, the feedback and the speaker points. Nobody takes feedback down in categories; it arrives as bullet points in whatever order the judge says it. The box grows as you write and only starts scrolling once it is already about a screen tall. **Anything you recorded in the old boxes is kept** and appears in the new one.",
      "**Panels get an overall winner.** Three judges can split 2–1 and the round still has one result, so you can record it at the top. It has no feedback box of its own - that belongs to the judges underneath it.",
      "**Reconnecting catches you up on what you missed.** If your connection dropped, anything your partner wrote while you were away never reached you, and nothing re-sent it - their end had already counted it as delivered. Whoever comes back now gets the full current state of the flow. It merges with whatever you typed while you were offline rather than replacing it.",
    ],
  },
  {
    version: "1.2.7",
    headline: "Two partner-flowing fixes. Update if you flow with a partner.",
    items: [
      "**Your typing no longer jumps into the cell above.** When your partner added a row above the one you were in - pressing Enter, usually - the cursor stayed on the old row *number* instead of your row, so mid-word your caret was pulled into their new row and the rest of what you were writing landed there, mixed in with whatever it already said. It now follows your row wherever it moves.",
      "**\"AT:\" headers name the argument you're actually answering.** Sending an answer to the speech doc could head it with one of *your own* earlier arguments - an answer in the 1AR coming out as \"AT: <your own 2AC>\" - whenever the opponent's cell on that row was blank. And when the argument you were answering had been flowed by your partner rather than you, the answer arrived with no header at all. Both fixed: it looks for the other team's argument, prefers the one in your own lane, and falls back to your partner's lane instead of giving up.",
    ],
  },
  {
    version: "1.2.6",
    headline: "Partner flowing survives a dropped connection.",
    items: [
      "**Edits made while your connection is down now arrive when it comes back.** If you lost wifi for a few seconds and kept flowing - importing a 1NC, say - that work could be dropped without ever reaching your partner, and nothing would re-send it. Your partner's edits still reached you, so it looked like a one-way connection rather than lost work. Anything you flow while the connection is down is now sent the moment it returns.",
      "**The partner button tells you when you're not connected.** It only showed \"live\" or nothing, so a session that had *dropped* looked exactly like no session at all. A live session that isn't currently connected now turns amber and says so on the toolbar, and \"live\" means your partner is actually there - not just that the server answered.",
      "**Reopen a flow and you can jump straight back into its session.** Closing Nimbus or stepping out of a flow used to lose the room, so someone had to read the six-character code out again. The partner panel now offers **Rejoin** on the flow you were sharing. Hosting resumes the same code, so your partner reconnects on their own. It never reconnects by itself - joining replaces your flow with your partner's copy, so that stays your decision.",
    ],
  },
  {
    version: "1.2.5",
    headline: "Two fixes from real rounds.",
    items: [
      "**You see everything your partner types, not just the first letter.** If your cursor was parked on a cell while your partner typed into it, only their first character ever appeared - a whole sentence would arrive and you would see one letter, with nothing on screen to tell you anything was missing. The cell now keeps up live. Typing in a cell yourself still protects what you are writing: a partner's edit won't yank the text out from under you mid-word.",
      "**Doc Search opens when your library folders overlap.** If you had added a folder *and* a folder inside it, the same file was indexed twice and Doc Search refused to open at all. It now ignores the repeat. If this was happening to you, it fixes itself on first launch - you don't need to change your folders.",
    ],
  },
  {
    version: "1.2.4",
    headline: "The 2NR gets partner lanes too.",
    items: [
      "**Two 2NR columns when you flow aff.** 1.2.3 left the 2NR out, which was wrong: flowing aff you are taking the 2NR down while your partner writes the 2AR, which is exactly what lanes are for. Flowing aff now splits the **1NC**, the **Neg Block** *and* the **2NR**.",
      "**The 2AR still doesn't split, on purpose.** The only speeches left single are a 1AC - read off a prepared document - and whichever speech closes the round, because there is nothing left to prep behind it. Both new columns collapse from their own header like every other lane.",
    ],
  },
  {
    version: "1.2.3",
    headline: "A lane for every speech you have to flow, and either one collapses.",
    items: [
      "**Two columns for every opponent speech you flow.** Flowing neg you now get two **2AC** columns *and* two **1AR** columns; flowing aff, two **1NC** and two **Neg Block**. Their first speech and their last rebuttal are left alone - a 1AC is read off a prepared document, and nobody is prepping through a 2NR.",
      "**Collapse either lane, from the lane itself.** **⇤** on any lane header folds *that* column away - your own as readily as your partner's - and **⇥** on the one still showing brings it back. The toolbar's Hide partner button is gone: with two split speeches on a flow it could no longer say which lane it meant. A group always keeps one lane on screen, so there is always a header to click. Collapsing stays purely visual and never changes what you send to the speech doc.",
      "**Importing a speech doc fills your lane, not your partner's.** You can both import the same 1NC without landing on top of each other. Matching a doc to its column by filename works on split speeches again too.",
      "**Quick cards keep their formatting.** Dragging or clicking one onto the flow dropped the underlining, the highlighting, emphasis and cite - everything arrived as flat text, and sending that cell on to the speech doc gave you an unmarked card. All of it survives now.",
      "**The what's-new panel only appears once.** It came back on every launch until you explicitly closed it, so quitting Nimbus while it was still open meant seeing it again the next time you opened the app.",
    ],
  },
  {
    version: "1.2.1",
    headline: "Answer a block part by part, all the way down the flow.",
    items: [
      "**Automatic updates are switched on.** This is the last build you have to install by hand - from here on Nimbus checks for a new version on its own and can install it for you.",
      "**Every part of a block gets its own row.** Expand an inserted block and each part gets a proper flow tile in *every* speech after it, lined up exactly with the part it answers - so you answer their third card, they answer that, you answer that, out to the last speech. The tiles mark as cards or analytics like any other cell, each partner lane keeps its own, and the whole chain folds away when you collapse the block and comes back untouched when you open it.",
      "**Ctrl+Enter works inside a block.** It inserts a blank row into the block - below the argument you're on, or above it with Ctrl+Shift+Enter - and puts your cursor straight in it, the same way it makes a row on the rest of the flow. Every speech gets a tile for the new row, including rows you type yourself, so nothing you add is a dead end.",
      "**A block's parts read like flow cells now.** Same ink as the column they sit in, the card/analytic bar down the left edge, the chip in the corner, and the cite author leading in bold the way an inserted card does. The only thing marking a part or an answer out is a faint halo saying it belongs to the block.",
      "**Quick cards keep everything you highlighted.** Capturing a selection that spanned more than one block kept the first heading and quietly demoted the second to plain text, losing its type.",
      "**Dragging a quick card onto the flow works.** It never did - the panel's click-outside-to-close layer covered the whole grid, so the flow never saw the drop.",
      "**The toolbar says what its buttons do.** Speech doc, Quick cards, Timer, Arguments, Partner flow, Manual, Settings and Keys now carry their names instead of being unlabelled icons. The condensed bar and narrow windows still get the compact icons.",
      "**Analytic / Card from the toolbar works inside a block tile.** It was marking the whole cell around the tile; only the keyboard shortcuts did the right thing.",
      "**Hiding your partner's lane hides THEIRS.** When you were looking at your partner's flow in an \"a flow each\" session, ⇤ and the Hide partner button hid your own column instead of theirs, and your partner's lane was the one highlighted as yours.",
      "**Your own lane says \"You\" on both computers.** On a split speech you both saw \"You\" on the *same* column - whoever created the flow - so the person who joined had their own lane labelled \"Partner\". Each of you now sees your own column as \"You\" and your partner's as \"Partner\".",
      "**Leaving a session leaves you on your own flow.** Clicking Leave while you were reading your partner's page used to close your flow and leave you sitting on theirs.",
      "**The manual covers the rest of the app now** - partner flowing and lanes, prep clocks, the argument bank, the answer link, tournaments, and the toolbar.",
    ],
  },
  {
    version: "1.2.0",
    headline: "Flow with your partner, prep clocks in the toolbar, and cards straight into CardMirror.",
    items: [
      "**Flow with a partner, live.** Pair with a 6-character code and either share one flow or keep one each - you can see and edit your partner's page mid-round. You always save to your own file.",
      "**Partner lanes.** Pick your side when you make a flow and the opponent's second speech splits into a column each, so you and your partner aren't typing over one another.",
      "**Answer this argument** (Ctrl+Shift+G). Jumps to your reply in the next opposing speech and links it, so the doc gets \"AT: the argument you meant\".",
      "**Prep clocks for both teams** in the toolbar. Counts down from 8 minutes (change it in Settings), starting one stops the other, and you can click the time to fix it when nobody stopped the clock.",
      "**Cards go straight into CardMirror** - no plugin to install any more. Needs CardMirror 1.5.0 or newer. Highlighting, cites and structure all survive, and it doesn't steal your focus.",
      "**One toolbar, two sizes.** Full width or a condensed one for splitscreen, both the same height. It resizes itself to fit - including when the speech doc is open beside it - instead of scrolling.",
      "**Editable speech formats.** Rename any speech for a format in Settings, or double-click a column header to rename it in the round you're in.",
      "**Speech-doc fixes.** Body text binds into its card instead of clumping loose, and literal `---` survives instead of turning into a dash.",
      "**`.nimbus` files are back.** 1.1.0 retired the native format in favour of Excel; both work again, and you can still convert either way.",
    ],
  },
];

/** Numeric semver compare; missing parts count as 0. */
function cmp(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Everything released since `lastSeen`, newest first.
 *
 * An empty `lastSeen` is a machine that has never run Nimbus, so it gets only
 * the current version's notes - someone installing for the first time does not
 * want a changelog stretching back through releases they never ran.
 */
export function notesSince(lastSeen: string): ReleaseNote[] {
  if (!lastSeen) {
    const current = RELEASE_NOTES.find((n) => cmp(n.version, APP_VERSION) === 0);
    return current ? [current] : [];
  }
  return RELEASE_NOTES.filter(
    (n) => cmp(n.version, lastSeen) > 0 && cmp(n.version, APP_VERSION) <= 0,
  ).sort((a, b) => cmp(b.version, a.version));
}

/** Whether this launch should show the panel at all. */
export function hasUnseenNotes(lastSeen: string): boolean {
  return cmp(APP_VERSION, lastSeen || "0.0.0") > 0 && notesSince(lastSeen).length > 0;
}
