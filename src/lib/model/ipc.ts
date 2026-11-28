// The one door to Nimbus's native (Rust) commands.
//
// ⚠ WHY THIS EXISTS (1.7.7). The file commands used to run on the app's MAIN
// thread - a slow disk (a Dropbox/iCloud file that's still in the cloud, a file
// Dropbox has locked mid-sync, a big library scan) froze the whole window
// ("Not Responding" / the beachball) until it finished. They now run on a
// background thread instead. The main thread had one property worth keeping,
// though: it did them ONE AT A TIME, IN THE ORDER ASKED. Saves are often fired
// without waiting for the previous one (settings, doc content), and two writes
// of the SAME file racing on background threads could land old-over-new.
//
// So every operation on a given file waits for the previous operation on THAT
// file: per-file, first-in-first-out - the order that matters for "newest
// wins". Different files don't wait for each other (a doc's last save on
// close must not sit behind an unrelated settings write), and Rust holds a lock
// so no two file operations ever run at the same instant (lib.rs).
//
// Listings and existence checks (list_flows, scan_library_roots, …) never
// write, so they go straight through.

import { noteSlowIo } from "./diagnostics";

/** Which file(s) a command touches, or null = not a file operation. */
function keysOf(cmd: string, a: Record<string, unknown> = {}): string[] | null {
  const p = (v: unknown) => "path:" + String(v ?? "").toLowerCase();
  switch (cmd) {
    case "save_round":
    case "load_round":
    case "delete_round":
      return ["round:" + String(a.id ?? "")];
    case "save_blob":
    case "load_blob":
      return ["blob:" + String(a.name ?? "")];
    case "write_text_file":
    case "read_text_file":
    case "write_binary_file":
    case "read_binary_file":
    case "delete_path":
    case "create_dir":
      return [p(a.path)];
    case "move_path":
      return [p(a.from), p(a.to)];
    case "export_to_downloads":
      return ["download:" + String(a.filename ?? "").toLowerCase()];
    default:
      return null;
  }
}

/** Past this, a disk operation is logged (never skipped: order matters). */
const SLOW_MS = 10_000;

/** The last queued operation per file. Entries remove themselves when done. */
const tails = new Map<string, Promise<unknown>>();

async function raw<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function timed<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t0 = Date.now();
  const slow = setTimeout(() => noteSlowIo(cmd, Date.now() - t0, false), SLOW_MS);
  try {
    return await raw<T>(cmd, args);
  } finally {
    clearTimeout(slow);
    const ms = Date.now() - t0;
    if (ms >= SLOW_MS) noteSlowIo(cmd, ms, true);
  }
}

/**
 * Drop-in for `invoke` from @tauri-apps/api/core. A file operation waits for
 * the previous operation on the same file; everything else goes straight through.
 */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const keys = keysOf(cmd, args);
  if (!keys) return raw<T>(cmd, args);
  const before = keys.map((k) => tails.get(k)).filter(Boolean) as Promise<unknown>[];
  const run = (before.length ? Promise.all(before) : Promise.resolve()).then(() => timed<T>(cmd, args));
  // The file's queue moves on whether this succeeded or failed - a failed save
  // must not block every save after it.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  for (const k of keys) tails.set(k, settled);
  void settled.then(() => {
    for (const k of keys) if (tails.get(k) === settled) tails.delete(k);
  });
  return run;
}

/**
 * Wait for every queued file operation to finish - capped, so a dead disk can
 * never stop Nimbus from quitting or a window from closing.
 *
 * ⚠ Call before `force_quit` / closing a window. On the main thread, a quit
 * asked for after a save could only run after that save; now that saves run
 * elsewhere, the quit would otherwise overtake fire-and-forget writes
 * (settings, doc content) and lose them.
 */
export function ioIdle(maxMs = 8_000): Promise<void> {
  return Promise.race([
    Promise.all([...tails.values()]).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, maxMs)),
  ]);
}
