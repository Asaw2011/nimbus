// The pop-out timer: its own small, borderless, always-on-top OS window, so it
// can sit over a maximized CardMirror and stay there when you click into it.
//
// ONE timer at a time. Popping out HANDS the timer's state to the new window
// and the in-app timer closes; docking hands it back. The state is wall-clock
// based (startedAt + banked time), so the handoff is exact - nothing restarts
// or drifts, and there is never a second copy counting.
//
// ⚠ The pop-out NEVER saves settings. Each window has its own copy of the
// settings store, and a save writes the whole thing - so a pop-out saving on
// close would overwrite anything changed in the main window while it was out.
// It reports its bounds back in the dock message and the MAIN window saves.

import { settings, type TimerWinBounds } from "$lib/model/settings.svelte";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const TIMER_LABEL = "timer";
const DOCK_EVENT = "timer://dock";

/** Everything needed to carry a running timer across windows. */
export interface TimerState {
  mode: "countdown" | "stopwatch";
  running: boolean;
  accumMs: number;
  startedAt: number;
  targetMs: number;
  activePreset: number | null;
}

export interface DockMessage {
  state: TimerState;
  /** true: show the timer in the app again. false: the timer was closed. */
  show: boolean;
  bounds: TimerWinBounds | null;
}

/** Size presets, logical pixels. The timer's layout follows the window's
 *  actual size, so dragging an edge works as well as a preset. */
export const SIZES = {
  XS: { w: 150, h: 54, label: "Very small: just the time" },
  S: { w: 210, h: 100, label: "Small: time and start/reset" },
  M: { w: 250, h: 180, label: "Medium: time, start/reset and stopwatch" },
  L: { w: 300, h: 270, label: "Large: everything, with the presets" },
} as const;
export type SizeId = keyof typeof SIZES;

export const POSITIONS = [
  { id: "tl", label: "Top left" },
  { id: "t", label: "Top" },
  { id: "tr", label: "Top right" },
  { id: "bl", label: "Bottom left" },
  { id: "b", label: "Bottom" },
  { id: "br", label: "Bottom right" },
] as const;
export type PositionId = (typeof POSITIONS)[number]["id"];

class TimerPop {
  /** The timer is out in its own window. */
  open = $state(false);
  /** Set when the pop-out docks; the flow view picks it up and clears it. */
  docked = $state<DockMessage | null>(null);
  private listening = false;

  private async listen(): Promise<void> {
    if (this.listening || !inTauri) return;
    this.listening = true;
    const { listen } = await import("@tauri-apps/api/event");
    await listen<DockMessage>(DOCK_EVENT, (e) => {
      this.open = false;
      if (e.payload.bounds) {
        settings.timerWin = e.payload.bounds;
        settings.save();
      }
      this.docked = e.payload;
    });
  }

  /** Pop the timer out. Resolves false if the window couldn't be made (the
   *  caller keeps the in-app timer, so nothing is lost). */
  async popOut(state: TimerState): Promise<boolean> {
    if (!inTauri) return false;
    await this.listen();
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(TIMER_LABEL);
    if (existing) {
      await existing.setFocus();
      this.open = true;
      return true;
    }
    const b = settings.timerWin;
    const size = b ?? SIZES.S;
    return new Promise<boolean>((resolve) => {
      const win = new WebviewWindow(TIMER_LABEL, {
        url: `/?timerwin=1&s=${encodeURIComponent(JSON.stringify(state))}`,
        title: "Nimbus Timer",
        width: size.w,
        height: size.h,
        ...(b ? { x: b.x, y: b.y } : {}),
        minWidth: 110,
        minHeight: 40,
        decorations: false,
        alwaysOnTop: true,
        // Keeps it visible across macOS Spaces; best-effort over full-screen apps.
        visibleOnAllWorkspaces: true,
        resizable: true,
        // The whole top strip and the time are drag areas, and a double-click
        // on a drag area maximizes - a full-screen timer mid-round. Never.
        maximizable: false,
        shadow: true,
        focus: true,
      });
      win.once("tauri://created", () => {
        this.open = true;
        resolve(true);
      });
      win.once("tauri://error", (e) => {
        console.error("timer pop-out failed", e);
        resolve(false);
      });
    });
  }

  /** Bring the popped-out timer to the front (the Timer shortcut while it's out). */
  async focus(): Promise<void> {
    if (!inTauri) return;
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await (await WebviewWindow.getByLabel(TIMER_LABEL))?.setFocus();
  }
}

export const timerPop = new TimerPop();

/**
 * A keydown as a Tauri accelerator ("Control+Alt+Space"), or null while only
 * modifiers are down or no Ctrl/Alt/Cmd is held. The one definition of what a
 * timer shortcut is: Settings records with it, the in-app timer matches with
 * it, and the pop-out registers the same strings system-wide.
 */
export function eventAccel(e: KeyboardEvent): string | null {
  const c = e.code;
  const key = /^Key[A-Z]$/.test(c) ? c.slice(3)
    : /^Digit\d$/.test(c) ? c.slice(5)
    : /^F\d{1,2}$/.test(c) ? c
    : ({ Space: "Space", Backspace: "Backspace", Enter: "Enter", Tab: "Tab",
         ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
         Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Backquote: "`" } as Record<string, string>)[c];
  if (!key) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  return [...mods, key].join("+");
}

// ---- inside the pop-out window ----------------------------------------------

export const isTimerWindow =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("timerwin");

/** The state handed over at pop-out, read from the window's URL. */
export function initialTimerState(): TimerState | null {
  try {
    const s = new URLSearchParams(window.location.search).get("s");
    return s ? (JSON.parse(s) as TimerState) : null;
  } catch {
    return null;
  }
}

async function currentBounds(): Promise<TimerWinBounds | null> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    const scale = await w.scaleFactor();
    const pos = (await w.outerPosition()).toLogical(scale);
    const size = (await w.innerSize()).toLogical(scale);
    return { x: Math.round(pos.x), y: Math.round(pos.y), w: Math.round(size.width), h: Math.round(size.height) };
  } catch {
    return null;
  }
}

/** Hand the timer back to the main window and close this one. */
export async function dockTimer(state: TimerState, show: boolean): Promise<void> {
  const { emitTo } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const msg: DockMessage = { state, show, bounds: await currentBounds() };
  await emitTo("main", DOCK_EVENT, msg);
  await getCurrentWindow().destroy();
}

/** Resize the pop-out to a preset, keeping it on screen. */
export async function setTimerSize(id: SizeId): Promise<void> {
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const s = SIZES[id];
  await getCurrentWindow().setSize(new LogicalSize(s.w, s.h));
}

/** Move the pop-out to a corner or edge of the screen it's on, clear of the taskbar. */
export async function setTimerPosition(id: PositionId): Promise<void> {
  const { getCurrentWindow, currentMonitor, PhysicalPosition } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const mon = await currentMonitor();
  if (!mon) return;
  const area = mon.workArea ?? { position: mon.position, size: mon.size };
  const size = await w.outerSize();
  const margin = Math.round(16 * mon.scaleFactor);
  const left = area.position.x + margin;
  const right = area.position.x + area.size.width - size.width - margin;
  const midX = area.position.x + Math.round((area.size.width - size.width) / 2);
  const top = area.position.y + margin;
  const bottom = area.position.y + area.size.height - size.height - margin;
  const x = id.endsWith("l") ? left : id.endsWith("r") ? right : midX;
  const y = id.startsWith("t") ? top : bottom;
  await w.setPosition(new PhysicalPosition(x, y));
}
