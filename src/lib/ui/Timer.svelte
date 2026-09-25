<script lang="ts">
  // Floating debate timer: a count-up stopwatch plus five adjustable countdown
  // presets (edited in Settings). Draggable; flashes and beeps at 0:00.
  //
  // Driven by setInterval, NOT requestAnimationFrame. Two reasons, both of which
  // matter in an actual round:
  //   1. rAF stops entirely while the window is backgrounded or minimized. The
  //      countdown's "hit zero" check lives on this tick, so on rAF the alarm
  //      would simply never fire if you tabbed away - the one moment you need it.
  //   2. rAF runs ~60×/s to render a display that changes 10×/s at most, waking
  //      Svelte's reactivity every frame for nothing.
  // Elapsed time is computed from Date.now() regardless, so the clock stays
  // correct across any tick jitter or throttling.
  //
  // It also runs as the POP-OUT timer (`popout`): the only thing in its own
  // small always-on-top window. See timerWindow.svelte.ts for the handoff.
  import { onDestroy, untrack } from "svelte";
  import { settings } from "../model/settings.svelte";
  import { playAlarm, type StopAlarm } from "../model/timerSound";
  import {
    SIZES,
    POSITIONS,
    setTimerSize,
    setTimerPosition,
    type SizeId,
    type TimerState,
  } from "./timerWindow.svelte";

  let {
    onclose,
    popout = false,
    initial = null,
    onpopout,
    ondock,
  }: {
    /** Close the timer. In the pop-out, hands the state back too. */
    onclose: (state: TimerState) => void;
    /** Running as the pop-out window's whole content. */
    popout?: boolean;
    /** A timer handed over from the other window, carried on exactly. */
    initial?: TimerState | null;
    /** In the app: send this timer to its own always-on-top window. */
    onpopout?: (state: TimerState) => void;
    /** In the pop-out: hand the timer back into the app. */
    ondock?: (state: TimerState) => void;
  } = $props();

  type Mode = "countdown" | "stopwatch";
  const TICK_MS = 100; // fine enough for the stopwatch's tenths column

  const start0 = untrack(() => initial);
  let mode = $state<Mode>(start0?.mode ?? "countdown");
  let running = $state(false);
  let accumMs = $state(start0?.accumMs ?? 0); // time banked from previous runs (while paused)
  let startedAt = 0; // Date.now() when the current run started
  let targetMs = $state(start0?.targetMs ?? (settings.timerPresets[0]?.seconds ?? 300) * 1000);
  let activePreset = $state<number | null>(start0 ? start0.activePreset : 0);
  let now = $state(Date.now());
  let tick: ReturnType<typeof setInterval> | null = null;
  let stopAlarm: StopAlarm = () => {};

  /** Everything the other window needs to carry on this timer exactly. */
  function snapshot(): TimerState {
    return { mode, running, accumMs, startedAt, targetMs, activePreset };
  }

  // A handed-over RUNNING timer resumes from its original start time - the
  // clock kept going while it moved windows, and so does the countdown.
  if (start0?.running) {
    startedAt = start0.startedAt;
    running = true;
    tick = setInterval(onTick, TICK_MS);
  }

  function elapsedMs(): number {
    return accumMs + (running ? now - startedAt : 0);
  }
  const displayMs = $derived(
    mode === "countdown" ? Math.max(0, targetMs - elapsedMs()) : elapsedMs(),
  );
  const finished = $derived(mode === "countdown" && targetMs > 0 && displayMs === 0);

  function stopTick() {
    if (tick) { clearInterval(tick); tick = null; }
  }
  function onTick() {
    now = Date.now();
    if (mode === "countdown" && running && elapsedMs() >= targetMs) {
      running = false;
      accumMs = targetMs; // pin to exactly 0:00 rather than a tick past it
      stopTick();
      beep();
    }
  }
  function start() {
    if (running) return;
    if (mode === "countdown" && targetMs <= 0) return;
    stopAlarm();
    startedAt = Date.now();
    now = startedAt;
    running = true;
    stopTick();
    tick = setInterval(onTick, TICK_MS);
  }
  function pause() {
    if (!running) return;
    accumMs = elapsedMs();
    running = false;
    stopTick();
  }
  function toggle() { running ? pause() : start(); }
  function reset() {
    stopAlarm();
    running = false;
    stopTick();
    accumMs = 0;
    now = Date.now();
  }
  function pickPreset(i: number) {
    const p = settings.timerPresets[i];
    if (!p) return;
    reset();
    mode = "countdown";
    activePreset = i;
    targetMs = p.seconds * 1000;
  }
  function useStopwatch() {
    reset();
    mode = "stopwatch";
    activePreset = null;
    targetMs = 0;
  }

  /** The alarm at 0:00, in the sound and volume chosen in Settings → Timer.
   *  Audio unavailable → the flashing display still signals 0:00. */
  function beep() {
    stopAlarm();
    void playAlarm(settings.timerSound, settings.timerVolume).then((stop) => (stopAlarm = stop));
  }

  // ── pop-out controls ──────────────────────────────────────────────
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  let placing = $state(false);

  async function startResize(e: PointerEvent) {
    e.preventDefault();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startResizeDragging("SouthEast");
  }

  // Space starts/pauses and R resets, in the pop-out where there's nothing else
  // to type into.
  function onPopKey(e: KeyboardEvent) {
    if (!popout || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "r" || e.key === "R") reset();
    else if (e.key === "Escape") placing = false;
  }

  function fmt(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    const base = `${m}:${s.toString().padStart(2, "0")}`;
    if (mode === "stopwatch") return `${base}.${Math.floor((ms % 1000) / 100)}`;
    return base;
  }

  // ── dragging ──────────────────────────────────────────────────────
  let panel = $state<HTMLDivElement>();
  let pos = $state<{ x: number; y: number } | null>(null);
  function startDrag(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    const move = (ev: PointerEvent) => {
      // Keep the panel reachable - never let it be dragged off-screen.
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      pos = {
        x: Math.min(Math.max(0, ev.clientX - offX), Math.max(0, maxX)),
        y: Math.min(Math.max(0, ev.clientY - offY), Math.max(0, maxY)),
      };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  onDestroy(() => {
    stopTick();
    stopAlarm();
  });
</script>

<svelte:window onkeydown={onPopKey} />

<div
  bind:this={panel}
  class="timer"
  class:pop={popout}
  style={!popout && pos ? `left:${pos.x}px; top:${pos.y}px; right:auto; bottom:auto;` : ""}
>
  {#if popout}
    <!-- The top strip drags the window (Tauri drag region); the small buttons
         set its size and place, dock it back, or close it. -->
    <div class="p-head" data-tauri-drag-region>
      <div class="p-sizes" role="group" aria-label="Timer size">
        {#each Object.keys(SIZES) as id (id)}
          <button class="p-btn" title={SIZES[id as SizeId].label} onclick={() => setTimerSize(id as SizeId)}>{id}</button>
        {/each}
      </div>
      <button class="p-btn" class:on={placing} title="Move to a corner or edge of the screen" onclick={() => (placing = !placing)}>
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="6.5" y="2.5" width="3" height="3" fill="currentColor"/></svg>
      </button>
      <span class="p-sp" data-tauri-drag-region></span>
      <button class="p-btn" title="Dock back into Nimbus" onclick={() => ondock?.(snapshot())}>
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1.5v6m0 0L3.5 5M6 7.5 8.5 5M2 10.5h8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="p-btn" title="Close the timer" onclick={() => onclose(snapshot())}>✕</button>
    </div>
    {#if placing}
      <div class="p-place" role="group" aria-label="Timer position">
        {#each POSITIONS as p (p.id)}
          <button
            class="p-spot"
            title={p.label}
            onclick={() => { placing = false; void setTimerPosition(p.id); }}
          ><span class="dot {p.id}"></span></button>
        {/each}
      </div>
    {/if}
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="t-head" onpointerdown={startDrag}>
      <span class="t-title">Timer</span>
      <span class="t-mode">
        {mode === "stopwatch"
          ? "Stopwatch"
          : activePreset !== null
            ? settings.timerPresets[activePreset]?.label
            : "Countdown"}
      </span>
      <span class="t-sp"></span>
      {#if inTauri && onpopout}
        <button class="t-x" title="Pop out: keep the timer on top of CardMirror and other apps" onclick={() => onpopout(snapshot())}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M7 1.5h3.5V5M10.5 1.5 6 6M5 2.5H2.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      {/if}
      <button class="t-x" title="Close" onclick={() => onclose(snapshot())}>✕</button>
    </div>
  {/if}

  <div class="t-display" class:running class:finished data-tauri-drag-region={popout ? "" : undefined}>{fmt(displayMs)}</div>

  <div class="t-controls">
    <button class="t-btn primary" onclick={toggle}>{running ? "Pause" : "Start"}</button>
    <button class="t-btn" onclick={reset}>Reset</button>
    <button class="t-btn sw" class:on={mode === "stopwatch"} onclick={useStopwatch}>Stopwatch</button>
  </div>

  <div class="t-presets">
    {#each settings.timerPresets as p, i (i)}
      <button
        class="t-preset"
        class:on={mode === "countdown" && activePreset === i}
        title="Countdown {Math.floor(p.seconds / 60)}:{(p.seconds % 60).toString().padStart(2, '0')}"
        onclick={() => pickPreset(i)}
      >
        <span class="tp-label">{p.label}</span>
        <span class="tp-time">{Math.floor(p.seconds / 60)}:{(p.seconds % 60).toString().padStart(2, "0")}</span>
      </button>
    {/each}
  </div>
  <div class="t-hint">{popout ? "Space starts/pauses · R resets" : "Adjust presets in Settings."}</div>
  {#if popout}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="p-grip" title="Drag to resize" onpointerdown={startResize}></div>
  {/if}
</div>

<style>
  .timer {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 55;
    width: 220px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  .t-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
    cursor: grab;
  }
  .t-title { font-weight: 700; font-size: 13px; }
  .t-mode { font-size: 11px; color: var(--text-dim); }
  .t-sp { flex: 1; }
  .t-x { background: none; border: none; color: var(--text-dim); font-size: 13px; cursor: pointer; }
  .t-x:hover { color: var(--text); }
  .t-display {
    font-variant-numeric: tabular-nums;
    font-size: 40px;
    font-weight: 700;
    text-align: center;
    padding: 10px 0 6px;
    letter-spacing: 0.02em;
    color: var(--text);
  }
  .t-display.running { color: var(--accent); }
  .t-display.finished {
    color: #fff;
    background: var(--mark-dropped, #c0392b);
    animation: flash 0.6s steps(1) infinite;
  }
  @keyframes flash { 50% { background: transparent; color: var(--mark-dropped, #c0392b); } }
  .t-controls { display: flex; gap: 6px; padding: 0 10px 8px; }
  .t-btn {
    flex: 1;
    padding: 5px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .t-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .t-btn.primary:hover { filter: brightness(1.06); }
  .t-btn.on { background: color-mix(in srgb, var(--accent) 16%, var(--bg)); border-color: var(--accent); }
  .t-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 0 10px 6px; }
  .t-preset {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 4px 7px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .t-preset:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .t-preset.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .tp-label { font-size: 11px; font-weight: 600; }
  .tp-time { font-size: 11px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .t-hint { font-size: 10px; color: var(--text-dim); text-align: center; padding: 0 0 8px; }

  /* ── the pop-out window ────────────────────────────────────────────
     The timer fills its window, and what it shows follows the window's real
     size (container queries), so the XS/S/M/L presets and dragging an edge
     give the same result. Smallest: just the time. */
  .timer.pop {
    position: fixed;
    inset: 0;
    width: auto;
    border: none;
    border-radius: 0;
    box-shadow: none;
    display: flex;
    flex-direction: column;
    container-type: size;
  }
  .p-head {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 4px;
    border-bottom: 1px solid var(--border);
    cursor: grab;
    flex-shrink: 0;
  }
  .p-sizes { display: flex; gap: 2px; }
  .p-sp { flex: 1; align-self: stretch; }
  .p-btn {
    min-width: 20px;
    height: 18px;
    padding: 0 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
  }
  .p-btn:hover, .p-btn.on { color: var(--text); border-color: var(--border); background: var(--bg); }
  .p-place {
    position: absolute;
    inset: 25px 4px 4px;
    z-index: 3;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 4px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .p-spot {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    cursor: pointer;
    min-height: 0;
  }
  .p-spot:hover { border-color: var(--accent); }
  .dot { position: absolute; width: 8px; height: 8px; border-radius: 2px; background: var(--accent); }
  .dot.tl { top: 4px; left: 4px; }
  .dot.t { top: 4px; left: calc(50% - 4px); }
  .dot.tr { top: 4px; right: 4px; }
  .dot.bl { bottom: 4px; left: 4px; }
  .dot.b { bottom: 4px; left: calc(50% - 4px); }
  .dot.br { bottom: 4px; right: 4px; }
  .timer.pop .t-display {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: clamp(16px, min(24cqw, 42cqh), 140px);
    cursor: grab;
  }
  .p-grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 12px;
    height: 12px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, var(--border) 50%);
    z-index: 4;
  }
  /* Below Large: the hint, then the presets go (they need a Large window). */
  @container (max-height: 240px) {
    .timer.pop .t-hint { display: none; }
  }
  @container (max-height: 250px) {
    .timer.pop .t-presets { display: none; }
  }
  /* Small: just Start/Reset under the time. */
  @container (max-height: 120px) {
    .timer.pop .t-controls { padding: 0 6px 5px; gap: 4px; }
    .timer.pop .t-btn { padding: 2px 4px; font-size: 11px; }
    .timer.pop .t-btn.sw { display: none; }
    .timer.pop .t-display { font-size: clamp(16px, min(24cqw, 34cqh), 140px); }
  }
  /* Very small: only the time. The control strip floats over it on hover. */
  @container (max-height: 80px) {
    .timer.pop .t-controls { display: none; }
    .timer.pop .p-head {
      position: absolute;
      inset: 0 0 auto;
      z-index: 2;
      background: var(--panel);
      opacity: 0;
      transition: opacity 0.12s;
    }
    .timer.pop:hover .p-head { opacity: 1; }
    .timer.pop .t-display { font-size: clamp(16px, min(24cqw, 70cqh), 140px); }
    .timer.pop .p-place { inset: 2px; }
  }
</style>
