// Prep time for both teams, tracked on the round and shown in the ribbon.
//
// ── The rules this file exists to keep ──────────────────────────────────────
//
// 1. THE CLOCK IS DERIVED FROM WALL TIME, NEVER COUNTED DOWN PER TICK.
//    A running clock stores `startedAt` and the remaining time is always
//    `remainingMs - (now - startedAt)`. The tick decides how often the number
//    is REPAINTED, nothing else. This is not a style preference: a backgrounded
//    or minimised window has `setInterval` throttled to roughly once a minute,
//    and Nimbus has already shipped three separate bugs from that. A per-tick
//    countdown would quietly hand a team back minutes of prep every time the
//    window went behind CardMirror.
//
// 2. TICKS NEVER TOUCH THE UNDO STACK. Prep is persisted through
//    `store.applyRemote`, which autosaves without pushing history, and only on
//    a discrete user action (start / pause / reset / edit) — never on the tick.
//    An undo step pushed from a timer poisons the stack; that is a known trap.
//
// 3. NO SESSION, NO TIMER. The interval only exists while a clock is actually
//    running, and is torn down the moment both are paused.

import { store } from "./round.svelte";
import { settings } from "./settings.svelte";
import type { PrepClock, RoundPrep } from "./types";

export type PrepSide = "aff" | "neg";

/** Repaint cadence. 250ms is smooth enough for a tenth-free mm:ss display and
 *  cheap; the value shown is computed from the clock, so jitter is invisible. */
const TICK_MS = 250;

function freshClock(): PrepClock {
  return { remainingMs: settings.prepMinutes * 60_000 };
}

class Prep {
  /** Repaint pulse. Only advances while something is running. */
  private now = $state(Date.now());
  private tick: ReturnType<typeof setInterval> | null = null;

  /** The round's prep, seeded from settings the first time it's asked for. A
   *  round created before prep tracking existed simply has none yet. */
  private read(side: PrepSide): PrepClock {
    return store.round?.prep?.[side] ?? freshClock();
  }

  /** Persist a change. `applyRemote` autosaves and pushes NO undo step. */
  private write(side: PrepSide, next: PrepClock): void {
    if (!store.round) return;
    store.applyRemote((r) => {
      const prep: RoundPrep = r.prep ?? { aff: freshClock(), neg: freshClock() };
      prep[side] = next;
      r.prep = prep;
    });
    this.sync();
  }

  /** Milliseconds left, floored at zero. Live while running. */
  remaining(side: PrepSide): number {
    const c = this.read(side);
    if (!c.startedAt) return Math.max(0, c.remainingMs);
    return Math.max(0, c.remainingMs - (this.now - c.startedAt));
  }

  running(side: PrepSide): boolean {
    return !!this.read(side).startedAt;
  }

  /** True once a team has burned all of it — drives the spent styling. */
  spent(side: PrepSide): boolean {
    return this.remaining(side) === 0;
  }

  /** "8:00", or "0:07" in the last minute. Tabular so it doesn't jitter. */
  label(side: PrepSide): string {
    const total = Math.ceil(this.remaining(side) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  start(side: PrepSide): void {
    if (this.running(side)) return;
    const left = this.remaining(side);
    if (left <= 0) return;
    // Starting one team's clock stops the other's — both teams are never on
    // prep at once, and forgetting to stop the opponent's is the whole reason
    // the remaining time is editable.
    const other: PrepSide = side === "aff" ? "neg" : "aff";
    if (this.running(other)) this.pause(other);
    this.write(side, { remainingMs: left, startedAt: Date.now() });
  }

  pause(side: PrepSide): void {
    if (!this.running(side)) return;
    this.write(side, { remainingMs: this.remaining(side) });
  }

  toggle(side: PrepSide): void {
    this.running(side) ? this.pause(side) : this.start(side);
  }

  /** Back to a full allotment at the current setting. */
  reset(side: PrepSide): void {
    this.write(side, freshClock());
  }

  /** Set the time left by hand — the fix for "nobody stopped the clock".
   *  Pausing first means editing a running clock doesn't immediately re-subtract
   *  the time it was already running for. */
  setRemainingMs(side: PrepSide, ms: number): void {
    const capped = Math.max(0, Math.min(60 * 60_000, Math.round(ms)));
    this.write(side, { remainingMs: capped });
  }

  /** Parse "8", "8:00", "0:45" → ms. Returns null when it isn't a time. */
  parse(text: string): number | null {
    const t = text.trim();
    if (!t) return null;
    const m = /^(\d{1,2})(?::([0-5]?\d))?$/.exec(t);
    if (!m) return null;
    const mins = Number(m[1]);
    const secs = m[2] === undefined ? 0 : Number(m[2]);
    return mins * 60_000 + secs * 1000;
  }

  /** Start or stop the repaint pulse to match what's actually running, and stop
   *  a clock that has just hit zero so it doesn't sit there running at 0:00. */
  private sync(): void {
    const live = this.running("aff") || this.running("neg");
    if (live && !this.tick) {
      this.now = Date.now();
      this.tick = setInterval(() => {
        this.now = Date.now();
        for (const side of ["aff", "neg"] as PrepSide[]) {
          if (this.running(side) && this.remaining(side) === 0) this.pause(side);
        }
      }, TICK_MS);
    } else if (!live && this.tick) {
      clearInterval(this.tick);
      this.tick = null;
    }
  }

  /** Called when a round is opened: a clock left running when the app closed is
   *  still running, and its elapsed time is real, so just resume repainting. */
  attach(): void {
    this.now = Date.now();
    this.sync();
  }
}

export const prep = new Prep();
