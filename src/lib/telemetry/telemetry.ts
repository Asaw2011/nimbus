// Anonymous usage stats - the app side. Sends DAILY COUNTS of the fixed events
// in ./events.ts to the `nimbus-stats` Worker (stats/ in this repo).
//
// ⛔ Never sends a flow, a card, a file name, a name of anything, or who you
// are. The install ID is random, made here, and has nothing to do with the
// account. See the rule at the top of events.ts.
//
// Optional in every way: switched off (Settings → Privacy), offline, the Worker
// down - all just mean nothing is sent. It never throws into the caller, never
// blocks anything, and never calls settings.save() (safe from the pop-out
// timer, which must not save).

import { settings } from "../model/settings.svelte";
import { APP_VERSION } from "../model/minversion";
import { onDiag } from "../model/diagnostics";
import { cleanProps, propsKey, type Batch, type EventName, type EventProps, type Os, type Tally } from "./events";

const STATS_URL = "https://stats.nimbusdebate.com";
/** Tester override, e.g. http://localhost:8789 for `wrangler dev`. Also the
 *  only way stats run in a dev build. */
const URL_KEY = "nimbus.statsUrl";
const ID_KEY = "nimbus.installId";
const QUEUE_KEY = "nimbus.stats.queue";
const LAST_KEY = "nimbus.stats.lastSent";
const MAX_QUEUE = 300;
const KEEP_DAYS = 30;
const FLUSH_MS = 10 * 60_000;
const FIRST_FLUSH_MS = 30_000;

let started = false;
let queue: Tally[] = [];

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function endpoint(): string | null {
  const o = store()?.getItem(URL_KEY);
  if (o) return o;
  return import.meta.env.DEV ? null : STATS_URL;
}

function enabled(): boolean {
  return settings.shareUsage !== false && endpoint() !== null;
}

function installId(): string {
  const s = store();
  let id = s?.getItem(ID_KEY) ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    s?.setItem(ID_KEY, id);
  }
  return id;
}

function os(): Os {
  const ua = globalThis.navigator?.userAgent ?? "";
  if (/Windows/i.test(ua)) return "win";
  if (/Mac/i.test(ua)) return "mac";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

const today = () => new Date().toISOString().slice(0, 10);

function load(): void {
  try {
    const raw = JSON.parse(store()?.getItem(QUEUE_KEY) ?? "[]");
    const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    queue = Array.isArray(raw)
      ? raw.filter((t: Tally) => t && t.day >= cutoff && cleanProps(t.e, t.p) && t.n > 0)
      : [];
  } catch {
    queue = [];
  }
}

function persist(): void {
  try {
    store()?.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full or gone - the counts just live in memory.
  }
}

/**
 * Count one event. Typed against events.ts, and re-checked at runtime: an
 * event or value that isn't on the list is dropped right here.
 */
export function track<E extends EventName>(e: E, p: EventProps<E>): void {
  try {
    if (!started || !enabled()) return;
    const clean = cleanProps(e, p);
    if (!clean) return;
    const day = today();
    const key = propsKey(clean);
    const hit = queue.find((t) => t.day === day && t.e === e && propsKey(t.p) === key);
    if (hit) hit.n++;
    else if (queue.length < MAX_QUEUE) queue.push({ day, e, p: clean, n: 1 });
    persist();
  } catch {
    // Stats must never break the app.
  }
}

/** Shorthand for the commonest event. */
export function feature(name: EventProps<"feature">["name"]): void {
  track("feature", { name });
}

async function flush(leaving = false): Promise<void> {
  const url = endpoint();
  if (!url || !enabled() || !queue.length) return;
  const sending = queue.map((t) => ({ ...t, p: { ...t.p } }));
  const batch: Batch = { id: installId(), v: APP_VERSION, os: os(), tallies: sending };
  try {
    const r = await fetch(`${url}/v1/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
      keepalive: leaving,
      signal: leaving ? undefined : AbortSignal.timeout(15_000),
    });
    if (!r.ok) return;
  } catch {
    return; // Offline: try again later, counts kept.
  }
  // Take off what was sent; anything counted meanwhile stays.
  for (const s of sending) {
    const k = propsKey(s.p);
    const t = queue.find((q) => q.day === s.day && q.e === s.e && propsKey(q.p) === k);
    if (t) t.n -= s.n;
  }
  queue = queue.filter((t) => t.n > 0);
  persist();
  try {
    store()?.setItem(LAST_KEY, JSON.stringify({ at: new Date().toISOString(), batch }));
  } catch {
    // Display only.
  }
}

/** Main window only, once. Other windows' track() calls do nothing. */
export function startTelemetry(): void {
  if (started) return;
  try {
    started = true;
    load();
    // Timers and listeners always run (each send re-checks the switch), so
    // turning stats on later works without a restart. track() is a no-op while off.
    track("app_open", {});
    const tb = settings.toolbarStyle;
    track("setup", {
      toolbar: tb === "traditional" || tb === "simple" || tb === "retro" ? tb : "other",
      answer_numbers: settings.answerNumbers ? "on" : "off",
    });
    setTimeout(() => void flush(), FIRST_FLUSH_MS);
    setInterval(() => void flush(), FLUSH_MS);
    globalThis.addEventListener?.("pagehide", () => void flush(true));
    // Health counts: just the kind ("stall" / "slow_disk" / "error"), never the
    // message - the local log keeps the detail and is never sent.
    onDiag((kind) => {
      if (kind === "stall" || kind === "slow_disk" || kind === "error") track("health", { what: kind });
    });
    // Partner-sync transport counts (realtime.ts fires these; cleanProps drops
    // any word that isn't on the list).
    globalThis.addEventListener?.("nimbus:sync", (e) => {
      const what = (e as CustomEvent).detail;
      track("sync", { what } as EventProps<"sync">);
    });
  } catch {
    // Never break startup over stats.
  }
}

/** Turning stats off throws away everything not yet sent. */
export function forgetPending(): void {
  queue = [];
  persist();
}

/** For "See exactly what's sent": the counts waiting to go, and the last
 *  batch that went, exactly as sent. */
export function statsPreview(): { pending: Batch; last: { at: string; batch: Batch } | null } {
  let last = null;
  try {
    last = JSON.parse(store()?.getItem(LAST_KEY) ?? "null");
  } catch {
    // none
  }
  return {
    pending: { id: installId(), v: APP_VERSION, os: os(), tallies: queue },
    last,
  };
}
