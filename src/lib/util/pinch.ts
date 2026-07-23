// Pinch-to-zoom Svelte action. Works on macOS WKWebView (Tauri) via the WebKit
// `gesture*` events, and on Chromium/web builds via ctrl+wheel (the trackpad
// pinch convention). Updates zoom LIVE while pinching and calls `commit` once
// the gesture settles, so we don't hammer disk on every frame.

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

export function pinchZoom(node: HTMLElement, opts: PinchOpts) {
  let o = opts;
  const clamp = (z: number) => Math.min(o.max ?? 2.5, Math.max(o.min ?? 0.5, z));

  // WebKit gesture events (Safari / WKWebView). `scale` is relative to start.
  let base = 1;
  const onGestureStart = (e: Event) => { e.preventDefault(); base = o.get(); };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    o.set(clamp(base * (e as unknown as { scale: number }).scale));
  };
  const onGestureEnd = (e: Event) => { e.preventDefault(); o.commit(); };

  // ctrl+wheel = trackpad pinch on Chromium and some setups.
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return; // a real pinch; plain scroll is left alone
    e.preventDefault();
    o.set(clamp(o.get() * (1 - e.deltaY * 0.01)));
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => o.commit(), 250);
  };

  node.addEventListener("gesturestart", onGestureStart);
  node.addEventListener("gesturechange", onGestureChange);
  node.addEventListener("gestureend", onGestureEnd);
  node.addEventListener("wheel", onWheel, { passive: false });

  return {
    update(next: PinchOpts) { o = next; },
    destroy() {
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
      node.removeEventListener("gestureend", onGestureEnd);
      node.removeEventListener("wheel", onWheel);
      if (commitTimer) clearTimeout(commitTimer);
    },
  };
}
