// THE LIST of everything anonymous usage stats can ever say. Shared, word for
// word, by the app (telemetry.svelte.ts) and the stats Worker (stats/), and BOTH
// throw away anything not on it.
//
// ⛔ THE RULE (Adam, 2026-11-16): stats are anonymous and can never carry a
// flow. No cell text, cards, blocks, RFDs, file / folder / tournament / team /
// opponent / judge names, no account or email. Seeing someone's prep would be a
// cheating risk. So every detail below is a FIXED word from a list - there is
// no free-text field anywhere, and adding one is forbidden. A new event or
// value = edit this file (both sides pick it up) and say what it reveals.

export const EVENTS = {
  /** Nimbus started (one per launch, main window). */
  app_open: {},
  /** A flow was opened on the flowing screen (new or existing). */
  flow_open: { format: ["policy", "ld", "pf"], mode: ["solo", "partner"] },
  /** That flow was left; how long it was open, rounded into a bucket. */
  flow_close: { format: ["policy", "ld", "pf"], length: ["<15m", "15-45m", "45-90m", "90-180m", "180m+"] },
  /** A feature was used. Counts only. */
  feature: {
    name: [
      "smart_blocks", "rfd_panel", "judges", "ask_ai", "popout_timer", "popout_doc",
      "docx_import", "underline",
    ],
  },
  /** Something was sent to a doc - which editor only. */
  send: { to: ["builtin", "cardmirror", "falcon"] },
  /** Partner-sync transport health (counts, to see how often the relay fails). */
  sync: { what: ["relay", "supabase", "moved_to_supabase", "relay_drop", "refused"] },
  /** Settings that shape the app, sampled once per launch. */
  setup: {
    toolbar: ["traditional", "simple", "retro", "other"],
    answer_numbers: ["on", "off"],
  },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type EventName = keyof typeof EVENTS;
export type EventProps<E extends EventName> = {
  [K in keyof (typeof EVENTS)[E]]: (typeof EVENTS)[E][K] extends readonly (infer V)[] ? V : never;
};

export const OSES = ["win", "mac", "linux", "other"] as const;
export type Os = (typeof OSES)[number];

/** One line of a batch: an event, its fixed details, and how many times it
 *  happened that UTC day. */
export interface Tally {
  day: string; // YYYY-MM-DD (UTC)
  e: string;
  p: Record<string, string>;
  n: number;
}

export interface Batch {
  /** Random per install (crypto.randomUUID), not tied to the account. */
  id: string;
  v: string;
  os: string;
  tallies: Tally[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TALLIES = 200;
export const MAX_COUNT = 10_000;

/** A detail object in a stable order, so equal details make an equal key. */
export function propsKey(p: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1))));
}

/** Exactly the event's keys, each a value from its list - or null. Extra keys,
 *  missing keys, other words: all rejected. */
export function cleanProps(e: string, p: unknown): Record<string, string> | null {
  const spec = (EVENTS as Record<string, Record<string, readonly string[]>>)[e];
  if (!spec || !Object.prototype.hasOwnProperty.call(EVENTS, e)) return null;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const given = p as Record<string, unknown>;
  const keys = Object.keys(spec);
  if (Object.keys(given).length !== keys.length) return null;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = given[k];
    if (typeof v !== "string" || !spec[k].includes(v)) return null;
    out[k] = v;
  }
  return out;
}

/** The whole batch, cleaned. Anything off-list is dropped, never stored. */
export function cleanBatch(raw: unknown): Batch | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || !UUID.test(b.id)) return null;
  if (typeof b.v !== "string" || !VERSION.test(b.v)) return null;
  const os = (OSES as readonly string[]).includes(b.os as string) ? (b.os as string) : "other";
  if (!Array.isArray(b.tallies)) return null;
  const tallies: Tally[] = [];
  for (const t of b.tallies.slice(0, MAX_TALLIES)) {
    if (!t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    if (typeof x.day !== "string" || !DAY.test(x.day) || typeof x.e !== "string") continue;
    const p = cleanProps(x.e, x.p);
    const n = typeof x.n === "number" && Number.isInteger(x.n) ? Math.min(Math.max(x.n, 1), MAX_COUNT) : 0;
    if (p && n) tallies.push({ day: x.day, e: x.e, p, n });
  }
  return { id: b.id, v: b.v, os, tallies };
}
