// Central crash reporting. A throw inside a Svelte `$effect` aborts the whole
// reactive flush - the UI then looks "frozen" (buttons dead) while native
// contenteditable typing still works. Wrapping suspect effects in `guard()` and
// routing everything here means a stray throw degrades gracefully AND leaves a
// full trace on disk (config/crash-log.json) so it can be diagnosed after the
// fact, without needing the devtools console open.
//
// The log itself lives in diagnostics.ts (kept across launches, local only).

import { logDiag } from "./diagnostics";

export function reportError(where: string, err: unknown): void {
  const e = err as Error;
  // eslint-disable-next-line no-console
  console.error(`[NIMBUS crash @ ${where}]`, err);
  logDiag("error", where, e?.message ?? String(err), e?.stack ?? "");
}

/** Run `fn`, reporting (but swallowing) any throw so it can't freeze the app. */
export function guard(where: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    reportError(where, err);
  }
}
