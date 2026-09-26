// Timer alarm sounds.
//
// Built-in sounds are SYNTHESIZED (nothing to license, nothing to load), but
// designed like real instruments: FM bells with decaying brightness, a
// mechanical alarm-clock bell struck by a hammer, a marimba with its mallet
// click, all through a small room reverb. Each is rendered ONCE into an audio
// buffer and then played as a seamless LOOP, so it rings until the timer is
// stopped - with no timer driving it, which matters in a backgrounded window.
//
// ⚠ ONE shared AudioContext, woken by a click. A context created without a
// user gesture starts SUSPENDED and plays late - whenever the browser lets it,
// or the next time you click in that window. That was the 1–2s delay at 0:00,
// and a suspended alarm sounding later was the stray beep mid-countdown. So
// the context is created/resumed from the Start click (`primeAlarm`), and the
// alarm at 0:00 just starts an already-rendered buffer on a running context.

import { saveBlob, loadBlob } from "./blobs";

export const BUILTIN_SOUNDS = [
  { id: "chime", label: "Chime" },
  { id: "alarmclock", label: "Alarm clock" },
  { id: "marimba", label: "Marimba" },
  { id: "digital", label: "Digital watch" },
  { id: "soft", label: "Soft rise" },
] as const;
export const DEFAULT_SOUND = "chime";

export interface CustomSound {
  id: string;
  name: string;
}

/** Imported sounds are capped so a stray podcast can't bloat the app's data. */
export const MAX_SOUND_BYTES = 3 * 1024 * 1024;
const blobName = (id: string) => `timersound-${id}`;

/** Stops whatever alarm is sounding. Safe to call when nothing is. */
export type StopAlarm = () => void;

// ---- the shared context ---------------------------------------------------

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();

function audioCtx(): AudioContext | null {
  try {
    if (!ctx || ctx.state === "closed") {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
    }
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Call from a CLICK (Start, a preset, Play in Settings): wakes the audio
 * context while the browser allows it, and renders the chosen sound ahead of
 * time so 0:00 plays instantly.
 */
export function primeAlarm(soundId: string): void {
  const c = audioCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  void bufferFor(normalizeSound(soundId));
}

/** An id this build knows; anything else (a removed sound, an old save) → the default. */
export function normalizeSound(id: string): string {
  if (id === "none" || id.startsWith("custom:")) return id;
  return BUILTIN_SOUNDS.some((s) => s.id === id) ? id : DEFAULT_SOUND;
}

async function bufferFor(id: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(id);
  if (hit) return hit;
  const c = audioCtx();
  if (!c) return null;
  let buf: AudioBuffer | null = null;
  if (id.startsWith("custom:")) {
    const url = await loadBlob<string>(blobName(id.slice(7)));
    if (typeof url !== "string" || !url.startsWith("data:")) return null;
    try {
      const bytes = await (await fetch(url)).arrayBuffer();
      buf = await c.decodeAudioData(bytes);
    } catch {
      return null;
    }
  } else if (id !== "none") {
    buf = await render(id, c.sampleRate);
  }
  if (buf) buffers.set(id, buf);
  return buf;
}

/**
 * Sound the alarm, LOOPING until the returned function is called. `volume` is
 * 0–1. Never throws: with audio unavailable, the flashing display still says
 * 0:00.
 */
export async function playAlarm(soundId: string, volume: number): Promise<StopAlarm> {
  const vol = Math.max(0, Math.min(1, volume));
  const id = normalizeSound(soundId);
  if (id === "none" || vol === 0) return () => {};
  const c = audioCtx();
  if (!c) return () => {};
  if (c.state === "suspended") void c.resume();
  let buf = await bufferFor(id);
  if (!buf && id.startsWith("custom:")) buf = await bufferFor(DEFAULT_SOUND); // file gone: don't stay silent
  if (!buf) return () => {};
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(c.destination);
    src.start();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      // A 60ms fade instead of a hard cut, which clicks.
      const t = c.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.06);
      src.stop(t + 0.07);
    };
  } catch {
    return () => {};
  }
}

// ---- sound design ------------------------------------------------------------
//
// Each sound is one loop cycle, long enough to include its own reverb tail so
// the loop point falls in near-silence and never clicks.

async function render(id: string, rate: number): Promise<AudioBuffer> {
  const cycle = { chime: 2.6, alarmclock: 1.9, marimba: 2.4, digital: 1.4, soft: 2.6 }[id] ?? 2.6;
  const oc = new OfflineAudioContext(2, Math.ceil(cycle * rate), rate);
  const dry = oc.createGain();
  const wet = oc.createGain();
  const out = oc.createGain();
  out.gain.value = 0.9;
  const verb = oc.createConvolver();
  verb.buffer = impulse(oc, id === "digital" ? 0.35 : 1.1, id === "digital" ? 0.08 : 0.28);
  dry.connect(out);
  dry.connect(verb);
  verb.connect(wet);
  wet.connect(out);
  // A gentle high cut keeps everything warm instead of piercing.
  const warm = oc.createBiquadFilter();
  warm.type = "lowpass";
  warm.frequency.value = id === "digital" ? 5200 : 7500;
  out.connect(warm);
  warm.connect(oc.destination);
  wet.gain.value = id === "digital" ? 0.15 : 0.35;

  switch (id) {
    case "alarmclock":
      alarmClock(oc, dry);
      break;
    case "marimba":
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => marimbaNote(oc, dry, f, 0.18 + i * 0.22));
      break;
    case "digital":
      for (let i = 0; i < 4; i++) watchBeep(oc, dry, 0.05 + i * 0.16);
      break;
    case "soft":
      softSwell(oc, dry, 0.05);
      break;
    case "chime":
    default:
      // E6, G#6, B6 - a bright major arpeggio, then the top note again.
      [1318.5, 1661.2, 1975.5].forEach((f, i) => fmBell(oc, dry, f, 0.05 + i * 0.18, 1.6));
      break;
  }
  return oc.startRendering();
}

/** A room: exponentially decaying stereo noise, darker as it fades. */
function impulse(oc: BaseAudioContext, seconds: number, level: number): AudioBuffer {
  const n = Math.ceil(seconds * oc.sampleRate);
  const buf = oc.createBuffer(2, n, oc.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * (0.6 - 0.5 * t); // darkens over the tail
      d[i] = lp * level * Math.pow(1 - t, 3);
    }
  }
  return buf;
}

/** Classic FM bell (carrier:modulator 1:3.5): bright on the strike, mellowing
 *  as it rings - the thing that makes a bell sound like a bell. */
function fmBell(oc: BaseAudioContext, dest: AudioNode, f: number, at: number, len: number): void {
  const car = oc.createOscillator();
  const mod = oc.createOscillator();
  const modGain = oc.createGain();
  const amp = oc.createGain();
  car.frequency.value = f;
  mod.frequency.value = f * 3.5;
  modGain.gain.setValueAtTime(f * 2.2, at);
  modGain.gain.exponentialRampToValueAtTime(f * 0.05, at + len * 0.6);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(0.32, at + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + len);
  mod.connect(modGain);
  modGain.connect(car.frequency);
  car.connect(amp);
  amp.connect(dest);
  mod.start(at);
  car.start(at);
  mod.stop(at + len);
  car.stop(at + len);
}

/** A mechanical twin-bell alarm clock: a hammer striking ~18 times a second
 *  for a second, then a breath. Each strike rings a few inharmonic partials. */
function alarmClock(oc: BaseAudioContext, dest: AudioNode): void {
  const partials = [2350, 2350 * 2.32, 2350 * 3.86];
  const strikes = 20;
  for (let i = 0; i < strikes; i++) {
    const at = 0.03 + i * 0.055;
    const bellF = i % 2 === 0 ? 1 : 1.06; // two bells, slightly apart
    partials.forEach((p, k) => {
      const o = oc.createOscillator();
      const g = oc.createGain();
      o.type = "sine";
      o.frequency.value = p * bellF;
      const peak = [0.16, 0.07, 0.035][k];
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16 - k * 0.04);
      o.connect(g);
      g.connect(dest);
      o.start(at);
      o.stop(at + 0.17);
    });
  }
}

/** Marimba: a round fundamental, the bar's 4th-harmonic overtone that dies
 *  fast, and a short mallet knock. */
function marimbaNote(oc: BaseAudioContext, dest: AudioNode, f: number, at: number): void {
  const voices: Array<[number, number, number]> = [
    [1, 0.34, 0.9],
    [4, 0.09, 0.18],
    [9.2, 0.035, 0.04],
  ];
  for (const [mult, peak, len] of voices) {
    const o = oc.createOscillator();
    const g = oc.createGain();
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g);
    g.connect(dest);
    o.start(at);
    o.stop(at + len + 0.01);
  }
}

/** A real digital watch: a small piezo at ~4 kHz. Square wave, but band-passed
 *  so it chirps rather than rasps. */
function watchBeep(oc: BaseAudioContext, dest: AudioNode, at: number): void {
  const o = oc.createOscillator();
  const bp = oc.createBiquadFilter();
  const g = oc.createGain();
  o.type = "square";
  o.frequency.value = 4096;
  bp.type = "bandpass";
  bp.frequency.value = 4096;
  bp.Q.value = 6;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.5, at + 0.004);
  g.gain.setValueAtTime(0.5, at + 0.07);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
  o.connect(bp);
  bp.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + 0.09);
}

/** A soft two-note swell (A4 + E5) with a slow vibrato: noticeable without
 *  being startling. */
function softSwell(oc: BaseAudioContext, dest: AudioNode, at: number): void {
  for (const [f, peak] of [
    [440, 0.2],
    [659.25, 0.13],
    [880, 0.05],
  ] as Array<[number, number]>) {
    const o = oc.createOscillator();
    const lfo = oc.createOscillator();
    const lfoGain = oc.createGain();
    const g = oc.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    lfo.frequency.value = 5;
    lfoGain.gain.value = f * 0.006;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.45);
    g.gain.setValueAtTime(peak, at + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.0);
    o.connect(g);
    g.connect(dest);
    o.start(at);
    lfo.start(at);
    o.stop(at + 2.05);
    lfo.stop(at + 2.05);
  }
}

// ---- imported sounds -----------------------------------------------------------

/**
 * Import an audio file as a timer sound. Stored on disk (big blobs skip the
 * localStorage cache), so it survives restarts. Returns its entry, or throws a
 * user-readable message.
 */
export async function importSound(file: File): Promise<CustomSound> {
  if (!file.type.startsWith("audio/")) throw new Error("That isn't an audio file.");
  if (file.size > MAX_SOUND_BYTES) throw new Error("That file is over 3 MB. Pick a shorter sound.");
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
  const id = Math.random().toString(36).slice(2, 10);
  await saveBlob(blobName(id), url);
  return { id, name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Sound" };
}

/** Forget an imported sound's audio. */
export function deleteSound(id: string): Promise<void> {
  buffers.delete(`custom:${id}`);
  return saveBlob(blobName(id), null);
}
