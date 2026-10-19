<script lang="ts">
  import { untrack } from "svelte";
  import { settings } from "../model/settings.svelte";
  import { store } from "../model/round.svelte";
  import { combosLabel } from "../model/keymap";

  let { onclose }: { onclose: () => void } = $props();

  const mac = settings.isMac;
  const km = $derived(settings.keymap);

  // check = what the user has to actually DO before the step unlocks. null means
  // it's a read-and-Next step. anchor = the element to ring, by data-tour tag.
  type Check = "type" | "drop" | "evidence" | "smart" | "addpage" | "spread" | "doc" | "send" | "partner" | "help" | "settings";
  type Step = { title: string; body: string; anchor: string | null; check: Check | null; hint?: string };

  const steps = $derived<Step[]>([
    {
      title: "Welcome - let's actually flow",
      body: "This is a real sample round. I'll point at each feature and you try it yourself. Press Esc to bail any time.",
      anchor: null,
      check: null,
    },
    {
      title: "Type in a cell",
      body: "Click any cell and type a few words. It's a grid like Excel - no setup, just go.",
      anchor: '[data-tour="grid"]',
      check: "type",
      hint: "Columns are speeches, rows are arguments.",
    },
    {
      title: "Mark it Dropped",
      body: "Click a cell, then hit Dropped so you remember they didn't answer it.",
      anchor: '[data-tour="drop"]',
      check: "drop",
      hint: `Shortcut: ${combosLabel(km.markDropped, mac)}`,
    },
    {
      title: "Card or analytic",
      body: "Mark a cell as a Card (carded evidence) - the ink recolors so you can read the flow at a glance. Analytic works the same way.",
      anchor: '[data-tour="evidence"]',
      check: "evidence",
      hint: `Aff columns are blue, neg red. Card: ${combosLabel(km.markCard, mac)}`,
    },
    {
      title: "Smart blocks",
      body: "Open the Smart blocks tray. Add your case files to its kit and it surfaces the exact blocks that answer what's on the page - click one to drop it in.",
      anchor: '[data-tour="smart"]',
      check: "smart",
      hint: "Beta. It never types for you - every insert is a click.",
    },
    {
      title: "Add a page",
      body: "Every position is its own tab. Click the + to add one.",
      anchor: '[data-tour="tabs"]',
      check: "addpage",
      hint: "Right-click a tab to rename or delete it.",
    },
    {
      title: "The speech doc",
      body: "Open the speech doc - a full CardMirror-style doc right beside your flow.",
      anchor: '[data-tour="doc"]',
      check: "doc",
      hint: `Shortcut: ${combosLabel(km.toggleDoc, mac)}`,
    },
    {
      title: "Send a cell to the doc",
      body: "Click a cell that has a card in it, then hit Send Cell - it lands in the speech doc at your cursor, formatting and all.",
      anchor: '[data-tour="send"]',
      check: "send",
      hint: `Send a whole row at once with ${combosLabel(km.sendRowToDoc, mac)}.`,
    },
    {
      title: "See many at once",
      body: "Click Stack to lay your flows out side by side - the paper-on-your-desk view.",
      anchor: '[data-tour="spread"]',
      check: "spread",
      hint: `Shortcut: ${combosLabel(km.toggleSpread, mac)}`,
    },
    {
      title: "Flow with a partner",
      body: "Open Partner flow to share this round live - you both flow into the same sheets in real time, each in your own color.",
      anchor: '[data-tour="partner"]',
      check: "partner",
      hint: "One of you starts a session and sends the code; the other joins.",
    },
    {
      title: "Stuck? Just ask",
      body: 'Open "How do I…" and ask in plain words - "drop", "send to doc", "partner". It answers and opens the thing for you.',
      anchor: '[data-tour="help"]',
      check: "help",
    },
    {
      title: "Make it yours",
      body: "Open Settings - themes, custom keybinds, and macros for one-key argument blocks all live here.",
      anchor: '[data-tour="settings"]',
      check: "settings",
      hint: `Shortcut: ${combosLabel(km.openSettings, mac)}`,
    },
    {
      title: "That's the basics - go flow",
      body: "You've touched the main things. Poke at anything in this sample; the Manual has the rest. Reopen this from Settings → Show welcome tutorial.",
      anchor: null,
      check: null,
    },
  ]);

  let i = $state(0);
  const step = $derived(steps[i]);
  const last = $derived(i === steps.length - 1);

  let rect = $state<DOMRect | null>(null);
  let done = $state(false); // current step's action completed
  let sent = false; // a cell was sent to the doc since this step opened

  // the send gate can't be read off the store, so FlowView pings us on a send.
  $effect(() => {
    const h = () => (sent = true);
    window.addEventListener("nimbus:sent-to-doc", h);
    return () => window.removeEventListener("nimbus:sent-to-doc", h);
  });

  // a flat read of everything a gate might compare against.
  function scan() {
    const r = store.round;
    let textLen = 0, drop = 0, ev = 0, sheets = 0;
    if (r) {
      sheets = r.sheets.length;
      for (const s of r.sheets)
        for (const row of s.rows)
          for (const c of row.cells) {
            if (c.text) textLen += c.text.length;
            if (c.marks?.dropped) drop++;
            if (c.marks?.evidence) ev++;
          }
    }
    return { textLen, drop, ev, sheets };
  }

  let base = { textLen: 0, drop: 0, ev: 0, sheets: 0 };

  function passed(check: Check): boolean {
    const cur = scan();
    switch (check) {
      case "type": return cur.textLen > base.textLen;
      case "drop": return cur.drop > base.drop;
      case "evidence": return cur.ev > base.ev;
      case "addpage": return cur.sheets > base.sheets;
      case "smart": return !!document.querySelector('[data-tour-panel="smart"]');
      case "spread": return !!document.querySelector('[data-tour-panel="spread"]');
      case "doc": return !!document.querySelector('[data-tour-panel="doc"]');
      case "send": return sent;
      case "partner": return !!document.querySelector('[data-tour-panel="partner"]');
      case "help": return !!document.querySelector('[data-tour-panel="help"]');
      case "settings": return !!document.querySelector('[data-tour-panel="settings"]');
    }
  }

  function locate() {
    const sel = steps[i].anchor;
    if (!sel) { rect = null; return; }
    const el = document.querySelector(sel) as HTMLElement | null;
    rect = el ? el.getBoundingClientRect() : null;
  }

  // step setup: snapshot the baseline, scroll the target in, reset completion.
  // untrack so reading the store for the baseline doesn't make this re-run on
  // every keystroke (which would keep moving the goalposts and never unlock).
  $effect(() => {
    const idx = i;
    untrack(() => {
      done = false;
      sent = false;
      base = scan();
      const sel = steps[idx].anchor;
      if (sel) (document.querySelector(sel) as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" });
      locate();
    });
  });

  // one cheap poll drives both the gate and keeping the ring on its target
  // (handles panels opening, scrolls, resizes). 200ms is plenty.
  let advancing = false;
  $effect(() => {
    const id = setInterval(() => {
      locate();
      const c = steps[i].check;
      if (c && !done && passed(c)) {
        done = true;
        if (!last) {
          advancing = true;
          setTimeout(() => { advancing = false; if (i < steps.length - 1) i++; }, 850);
        }
      }
    }, 200);
    return () => clearInterval(id);
  });

  const PAD = 6;
  const ringStyle = $derived(
    rect
      ? `left:${rect.left - PAD}px;top:${rect.top - PAD}px;width:${rect.width + PAD * 2}px;height:${rect.height + PAD * 2}px;`
      : "",
  );

  // keep the card beside the target and always fully on-screen.
  const cardStyle = $derived.by(() => {
    if (!rect) return "";
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = 320, H = 190;
    const left = Math.max(12, Math.min(rect.left, vw - W - 12));
    let top: number;
    if (vh - rect.bottom >= H + 20) top = rect.bottom + 14;
    else if (rect.top >= H + 20) top = rect.top - H - 14;
    else top = (vh - H) / 2;
    top = Math.max(12, Math.min(top, vh - H - 12));
    return `left:${left}px;top:${top}px;width:${W}px;`;
  });

  function next() { if (last) onclose(); else { advancing = false; i++; } }
  function back() { if (i > 0) i--; }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onclose(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- root is click-through so you can actually use the app; only the card isn't -->
<div class="tour" role="presentation">
  {#if rect}
    <div class="ring" class:ok={done} style={ringStyle}></div>
  {/if}

  <div class="card" class:centered={!rect} style={cardStyle}>
    <div class="count">{i + 1} / {steps.length}</div>
    <h2>{step.title}</h2>
    <p>{step.body}</p>
    {#if step.hint}<p class="hint">{step.hint}</p>{/if}

    <div class="status">
      {#if step.check}
        {#if done}
          <span class="ok-txt">✓ nice - moving on…</span>
        {:else}
          <span class="wait"><span class="dot"></span> try it - I'll move on when you do</span>
        {/if}
      {/if}
    </div>

    <div class="row">
      <button class="skip" onclick={onclose}>Skip tour</button>
      <span class="sp"></span>
      {#if i > 0}<button class="ghost" onclick={back}>Back</button>{/if}
      {#if !step.check || done || last}
        <button class="primary" onclick={next}>{last ? "Done" : "Next"}</button>
      {:else}
        <button class="ghost" onclick={next} title="Skip just this step">Skip step</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none; /* click through to the real app */
  }
  .ring {
    position: fixed;
    border-radius: 8px;
    outline: 2px solid var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
    transition: all 0.14s ease;
    animation: pulse 1.6s ease-in-out infinite;
  }
  .ring.ok {
    outline-color: #22a06b;
    box-shadow: 0 0 0 3px color-mix(in srgb, #22a06b 40%, transparent);
    animation: none;
  }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent); }
    50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 12%, transparent); }
  }
  .card {
    position: fixed;
    pointer-events: auto; /* the card itself IS interactive */
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 15px 17px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    transition: left 0.14s ease, top 0.14s ease;
  }
  .card.centered {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 360px;
    max-width: calc(100vw - 32px);
  }
  .count { font-size: 11px; color: var(--text-dim); letter-spacing: 0.04em; }
  h2 { margin: 4px 0 6px; font-size: 16px; }
  p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text); }
  .hint { margin-top: 6px; font-size: 12px; color: var(--text-dim); }
  .status { min-height: 18px; margin-top: 12px; font-size: 12px; }
  .wait { color: var(--text-dim); display: inline-flex; align-items: center; gap: 6px; }
  .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent);
    animation: blink 1s ease-in-out infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  .ok-txt { color: #22a06b; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .sp { flex: 1; }
  button { border-radius: 7px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
  .primary { background: var(--accent); border: none; color: #fff; font-weight: 600; }
  .ghost { background: none; border: 1px solid var(--border); color: var(--text); }
  .skip { background: none; border: none; color: var(--text-dim); padding: 7px 4px; }
</style>
