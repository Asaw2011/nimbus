// Timer alarm sounds: a few built-in tones synthesized with Web Audio (no audio
// files, so nothing to license and nothing to load), plus sounds the user
// imports, stored as blobs on disk.
//
// A sound id is either a built-in name ("beep", "chime", ...), "none", or
// "custom:<id>" for an imported file.

import { saveBlob, loadBlob } from "./blobs";

export const BUILTIN_SOUNDS = [
  { id: "beep", label: "Beep" },
  { id: "chime", label: "Chime" },
  { id: "bell", label: "Bell" },
  { id: "buzzer", label: "Buzzer" },
  { id: "digital", label: "Digital alarm" },
] as const;

export interface CustomSound {
  id: string;
  name: string;
}

/** Imported sounds are capped so a stray podcast can't bloat the app's data. */
export const MAX_SOUND_BYTES = 3 * 1024 * 1024;
const blobName = (id: string) => `timersound-${id}`;

/** One note: start offset and length in seconds, frequency, oscillator type,
 *  and whether it fades out (a bell) or stops flat (a beep). */
type Note = { at: number; len: number; hz: number; type: OscillatorType; decay?: boolean; gain?: number };

function pattern(id: string): Note[] {
  const rep = (n: number, every: number, f: (i: number) => Note[]) =>
    Array.from({ length: n }, (_, i) => f(i).map((x) => ({ ...x, at: x.at + i * every }))).flat();
  switch (id) {
    case "chime":
      return rep(2, 1.1, () => [
        { at: 0, len: 0.45, hz: 659, type: "sine", decay: true },
        { at: 0.45, len: 0.6, hz: 880, type: "sine", decay: true },
      ]);
    case "bell":
      return rep(2, 1.4, () => [
        { at: 0, len: 1.3, hz: 1047, type: "sine", decay: true },
        { at: 0, len: 0.9, hz: 1047 * 2.76, type: "sine", decay: true, gain: 0.35 },
        { at: 0, len: 0.6, hz: 1047 * 5.4, type: "sine", decay: true, gain: 0.15 },
      ]);
    case "buzzer":
      return rep(4, 0.45, () => [{ at: 0, len: 0.3, hz: 180, type: "square", gain: 0.6 }]);
    case "digital":
      return rep(2, 0.9, () =>
        rep(3, 0.14, () => [{ at: 0, len: 0.08, hz: 2000, type: "square", gain: 0.45 }]),
      );
    case "beep":
    default:
      return rep(3, 0.5, () => [{ at: 0, len: 0.35, hz: 880, type: "sine" }]);
  }
}

/** Stops whatever alarm is sounding. Safe to call when nothing is. */
export type StopAlarm = () => void;

/**
 * Sound the alarm. `volume` is 0–1. Returns a function that stops it early
 * (the timer calls it when you reset or start again).
 *
 * Never throws: with audio unavailable, the flashing display still says 0:00.
 */
export async function playAlarm(soundId: string, volume: number): Promise<StopAlarm> {
  const vol = Math.max(0, Math.min(1, volume));
  if (soundId === "none" || vol === 0) return () => {};
  try {
    if (soundId.startsWith("custom:")) {
      const url = await loadBlob<string>(blobName(soundId.slice(7)));
      if (typeof url === "string" && url.startsWith("data:")) {
        const audio = new Audio(url);
        audio.volume = vol;
        await audio.play();
        // Long files are cut off; an alarm, not a playlist.
        const cut = setTimeout(() => audio.pause(), 8000);
        return () => {
          clearTimeout(cut);
          audio.pause();
        };
      }
      soundId = "beep"; // the imported file is gone - fall back rather than stay silent
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.3 * vol; // 0.3 is loud enough over a room without clipping
    master.connect(ctx.destination);
    let end = 0;
    for (const n of pattern(soundId)) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = n.type;
      o.frequency.value = n.hz;
      const t0 = ctx.currentTime + n.at;
      const peak = n.gain ?? 1;
      g.gain.setValueAtTime(peak, t0);
      if (n.decay) g.gain.exponentialRampToValueAtTime(0.001, t0 + n.len);
      else g.gain.setValueAtTime(0, t0 + n.len);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + n.len + 0.02);
      end = Math.max(end, n.at + n.len);
    }
    const done = setTimeout(() => void ctx.close(), (end + 0.2) * 1000);
    return () => {
      clearTimeout(done);
      void ctx.close();
    };
  } catch {
    return () => {};
  }
}

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
  return saveBlob(blobName(id), null);
}
