// Central crash reporting. A throw inside a Svelte `$effect` aborts the whole
// reactive flush — the UI then looks "frozen" (buttons dead) while native
// contenteditable typing still works. Wrapping suspect effects in `guard()` and
// routing everything here means a stray throw degrades gracefully AND leaves a
// full trace on disk (config/crash-log.json) so it can be diagnosed after the
// fact, without needing the devtools console open.

import { saveBlob } from "./blobs";

const log: unknown[] = [];

export function reportError(where: string, err: unknown): void {
  const e = err as Error;
  // eslint-disable-next-line no-console
  console.error(`[NIMBUS crash @ ${where}]`, err);
  log.push({
    where,
    message: e?.message ?? String(err),
    stack: e?.stack ?? "",
    at: new Date().toISOString(),
  });
  try {
    saveBlob("crash-log", log.slice(-50));
  } catch {
    /* nothing more we can do */
  }
}

/** Run `fn`, reporting (but swallowing) any throw so it can't freeze the app. */
export function guard(where: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    reportError(where, err);
  }
}
