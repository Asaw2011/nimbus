<script lang="ts">
  // Floating debate timer: a count-up stopwatch plus five adjustable countdown
  // presets (edited in Settings). Draggable; flashes and beeps at 0:00.
  //
  // Driven by setInterval, NOT requestAnimationFrame. Two reasons, both of which
  // matter in an actual round:
  //   1. rAF stops entirely while the window is backgrounded or minimized. The
  //      countdown's "hit zero" check lives on this tick, so on rAF the alarm
  //      would simply never fire if you tabbed away — the one moment you need it.
  //   2. rAF runs ~60×/s to render a display that changes 10×/s at most, waking
  //      Svelte's reactivity every frame for nothing.
  // Elapsed time is computed from Date.now() regardless, so the clock stays
  // correct across any tick jitter or throttling.
  import { onDestroy } from "svelte";
  import { settings } from "../model/settings.svelte";

  let { onclose }: { onclose: () => void } = $props();

  type Mode = "countdown" | "stopwatch";
  const TICK_MS = 100; // fine enough for the stopwatch's tenths column

  let mode = $state<Mode>("countdown");
  let running = $state(false);
  let accumMs = $state(0); // time banked from previous runs (while paused)
  let startedAt = 0; // Date.now() when the current run started
  let targetMs = $state((settings.timerPresets[0]?.seconds ?? 300) * 1000);
  let activePreset = $state<number | null>(0);
  let now = $state(Date.now());
  let tick: ReturnType<typeof setInterval> | null = null;

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

  function beep() {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.12;
      o.start();
      setTimeout(() => { o.stop(); void ctx.close(); }, 600);
    } catch { /* audio unavailable — the flashing display still signals 0:00 */ }
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
      // Keep the panel reachable — never let it be dragged off-screen.
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

  onDestroy(stopTick);
</script>

<div
  bind:this={panel}
  class="timer"
  style={pos ? `left:${pos.x}px; top:${pos.y}px; right:auto; bottom:auto;` : ""}
>
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
    <button class="t-x" title="Close" onclick={onclose}>✕</button>
  </div>

  <div class="t-display" class:running class:finished>{fmt(displayMs)}</div>

  <div class="t-controls">
    <button class="t-btn primary" onclick={toggle}>{running ? "Pause" : "Start"}</button>
    <button class="t-btn" onclick={reset}>Reset</button>
    <button class="t-btn" class:on={mode === "stopwatch"} onclick={useStopwatch}>Stopwatch</button>
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
  <div class="t-hint">Adjust presets in Settings.</div>
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
</style>
