// Zoom gestures for the flow grid and the speech doc.
//
// Zoom can arrive four different ways depending on the machine, so all four are
// handled and normalized into the same clamped scale factor:
//
//  1. ctrl+wheel — what Chromium (and WebView2) synthesizes for a precision
//     touchpad pinch, and what a real mouse wheel sends with Ctrl held.
//  2. WebKit `gesture*` events — macOS WKWebView / Safari.
//  3. Two-finger pointer pinch — touchscreens (and 2-in-1 laptops).
//  4. The zoomIn/zoomOut/zoomReset keybinds — the fallback that always works
//     even when the webview swallows the gesture ones. Handled by each surface
//     (FlowView.onkeydown, SpeechDoc.docKeydown) so they zoom whichever one
//     you're in, and stay rebindable in Settings.
//
// Zoom updates LIVE during a gesture and `commit`s once it settles, so we don't
// hammer the settings blob (and disk) on every frame.

export interface PinchOpts {
  /** Current zoom. */
  get: () => number;
  /** Live update (no persist). */
  set: (z: number) => void;
  /** Persist the settled zoom. */
  commit: () => void;
  min?: number;
  max?: number;
}

/** Biggest per-event delta we'll act on, in pixels. A mouse wheel notch reports
 *  ±100–120 while a touchpad pinch reports ±1–5; without this cap one notch
 *  jumped straight to the zoom limit instead of stepping. */
const MAX_STEP_PX = 60;
/** Scale per pixel of delta. A capped wheel notch ≈ 1.16×, a touchpad tick
 *  ≈ 1.008× — coarse input steps visibly, fine input stays smooth. */
const SCALE_PER_PX = 0.0025;

/** Wheel delta in pixels, whatever unit the device reports it in. */
function deltaPx(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 16; // lines
  if (e.deltaMode === 2) return e.deltaY * 400; // pages
  return e.deltaY;
}

/** The zoom factor for one wheel/pinch event, with the step capped. */
function wheelFactor(e: WheelEvent): number {
  const px = Math.max(-MAX_STEP_PX, Math.min(MAX_STEP_PX, deltaPx(e)));
  return Math.exp(-px * SCALE_PER_PX);
}

export function pinchZoom(node: HTMLElement, opts: PinchOpts) {
  let o = opts;
  const clamp = (z: number) => Math.min(o.max ?? 2.5, Math.max(o.min ?? 0.5, z));

  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Persist once the gesture settles rather than on every frame. */
  const settle = () => {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commitTimer = null;
      o.commit();
    }, 250);
  };

  // ---- 1. ctrl+wheel (Chromium touchpad pinch, and Ctrl + mouse wheel) ----
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return; // a real pinch; plain scroll is left alone
    e.preventDefault();
    o.set(clamp(o.get() * wheelFactor(e)));
    settle();
  };

  // ---- 2. WebKit gesture events (Safari / WKWebView). `scale` is relative. ----
  let base = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    base = o.get();
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    o.set(clamp(base * (e as unknown as { scale: number }).scale));
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    o.commit();
  };

  // ---- 3. two-finger pointer pinch (touchscreens) ----
  const touches = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  const spread = (): number => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      pinchStartDist = spread();
      pinchStartZoom = o.get();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2 || pinchStartDist <= 0) return;
    e.preventDefault();
    o.set(clamp((pinchStartZoom * spread()) / pinchStartDist));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    if (touches.size < 2 && pinchStartDist > 0) {
      pinchStartDist = 0;
      o.commit();
    }
  };

  node.addEventListener("wheel", onWheel, { passive: false });
  node.addEventListener("gesturestart", onGestureStart);
  node.addEventListener("gesturechange", onGestureChange);
  node.addEventListener("gestureend", onGestureEnd);
  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove, { passive: false });
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerUp);

  return {
    update(next: PinchOpts) {
      o = next;
    },
    destroy() {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
      node.removeEventListener("gestureend", onGestureEnd);
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
      if (commitTimer) clearTimeout(commitTimer);
    },
  };
}

