// Local crash & freeze log (config/crash-log.json in the app-data folder).
//
// ⚠ LOCAL ONLY. Nothing here is ever sent anywhere. A user can copy it (Settings
// → Backup & privacy → Copy diagnostics) and choose to send it to us - that's
// the only way it leaves the machine. Error messages can contain bits of text,
// which is exactly why it is never sent automatically.
//
// What it records, newest last, kept across launches (it used to start empty
// every launch and overwrite the previous session's errors - so the log of the
// crash you restarted to escape was the first thing lost):
//   - errors (from crash.ts: uncaught throws, guarded effects)
//   - stalls: the page's own timer came back late while the window was VISIBLE,
//     i.e. something blocked the app for seconds (the "stopped responding" feel)
//   - slow disk: a file operation took 10s+ (a cloud-only Dropbox/iCloud file, a
//     file locked mid-sync) - see ipc.ts
//
// Deliberately imports nothing from the app's storage modules: those route
// through ipc.ts, which reports here, and a cycle there would be fragile.

import { APP_VERSION } from "./minversion";

export interface DiagEntry {
  kind: "error" | "stall" | "slow_disk" | "start";
  where: string;
  message: string;
  stack?: string;
  at: string;
  v?: string;
}

const BLOB = "crash-log";
const LS_KEY = "debate-flow:blob:" + BLOB;
const KEEP = 100;

let entries: DiagEntry[] = [];
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Listeners for anonymous health counts (telemetry hooks in without a cycle). */
const listeners: Array<(kind: DiagEntry["kind"]) => void> = [];

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeRaw<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Read what earlier launches (and other windows) already logged, once. */
function load(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    let old: DiagEntry[] = [];
    try {
      const raw = inTauri()
        ? await invokeRaw<string>("load_blob", { name: BLOB })
        : (globalThis.localStorage?.getItem(LS_KEY) ?? "[]");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) old = parsed as DiagEntry[];
    } catch {
      // No log yet, or unreadable - start fresh.
    }
    entries = [...old, ...entries].slice(-KEEP);
  })();
  return loaded;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void (async () => {
      await load();
      const json = JSON.stringify(entries.slice(-KEEP));
      try {
        if (inTauri()) await invokeRaw("save_blob", { name: BLOB, json });
        else globalThis.localStorage?.setItem(LS_KEY, json);
      } catch {
        // Nothing more we can do; it's still in memory for Copy diagnostics.
      }
    })();
  }, 1000);
}

export function logDiag(kind: DiagEntry["kind"], where: string, message: string, stack?: string): void {
  try {
    entries.push({ kind, where, message: message.slice(0, 2000), stack: stack?.slice(0, 4000), at: new Date().toISOString(), v: APP_VERSION });
    if (entries.length > KEEP * 2) entries = entries.slice(-KEEP);
    scheduleSave();
    for (const l of listeners) l(kind);
  } catch {
    // Diagnostics must never throw into the app.
  }
}

export function onDiag(fn: (kind: DiagEntry["kind"]) => void): void {
  listeners.push(fn);
}

/** Called by ipc.ts. `done` = it finished (false = still running at 10s). */
export function noteSlowIo(cmd: string, ms: number, done: boolean): void {
  logDiag("slow_disk", cmd, `${cmd} ${done ? "took" : "still running after"} ${Math.round(ms / 1000)}s`);
}

/**
 * Notice the app being blocked: a 1s timer that comes back 4s+ late while the
 * window is visible means the page couldn't run for that long. (Hidden windows
 * are skipped - a slowed timer there is the OS saving power, not a freeze.)
 */
export function startStallWatch(): void {
  if (typeof window === "undefined") return;
  let last = Date.now();
  let wasVisible = document.visibilityState === "visible";
  setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    const visible = document.visibilityState === "visible";
    if (gap > 4000 && visible && wasVisible) {
      logDiag("stall", "main", `the app was blocked for about ${Math.round(gap / 1000)}s`);
    }
    last = now;
    wasVisible = visible;
  }, 1000);
}

/** Main window, once at startup: load the old log and note this launch. */
export function startDiagnostics(): void {
  void load();
  logDiag("start", "app", `Nimbus ${APP_VERSION} started`);
  startStallWatch();
}

/** Everything a person can paste to us when something went wrong. */
export async function diagnosticsText(): Promise<string> {
  await load();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const lines = entries.slice(-60).map((e) => {
    const head = `${e.at}  [${e.kind}] ${e.where}${e.v ? ` (v${e.v})` : ""}: ${e.message}`;
    return e.stack ? `${head}\n    ${e.stack.split("\n").slice(0, 6).join("\n    ")}` : head;
  });
  return [`Nimbus ${APP_VERSION}`, ua, `${entries.length} entries (newest last)`, "", ...lines].join("\n");
}
