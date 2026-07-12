import { readSoundsEnabled } from "./comboKeyboard";
import type { RdvHeat } from "./rdvCelebrate";

type SoundKind = "tick" | "success" | "recall" | "warn" | "whoosh" | "demo" | "rdv" | "goal";

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

function tone(
  frequency: number,
  durationSec: number,
  type: OscillatorType,
  gainValue: number,
  when = 0,
): void {
  const context = ctx();
  if (!context) return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  const t0 = context.currentTime + when;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainValue, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(t0);
  osc.stop(t0 + durationSec + 0.02);
}

export async function unlockComboAudio(): Promise<void> {
  const context = ctx();
  if (!context) return;
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      /* ignore */
    }
  }
}

/** Fanfare RDV qui grossit clairement avec la heat (1 soft → 5 objectif). */
export function playRdvCelebrateSound(heat: RdvHeat, enabled = readSoundsEnabled()): void {
  if (!enabled) return;
  void unlockComboAudio();
  const g = 0.038 + heat * 0.014;

  if (heat <= 1) {
    // Soft plink — 2 notes
    tone(587.33, 0.11, "triangle", g);
    tone(880, 0.16, "sine", g * 0.75, 0.1);
    return;
  }
  if (heat === 2) {
    // Petite montée majeure
    tone(523.25, 0.1, "triangle", g);
    tone(659.25, 0.11, "triangle", g * 0.95, 0.09);
    tone(783.99, 0.14, "triangle", g * 0.85, 0.2);
    tone(1046.5, 0.22, "sine", g * 0.65, 0.34);
    return;
  }
  if (heat === 3) {
    // Arpège + octave — rythme plus affirmé
    tone(392, 0.09, "triangle", g * 0.8);
    tone(523.25, 0.1, "triangle", g, 0.08);
    tone(659.25, 0.1, "triangle", g * 0.95, 0.17);
    tone(783.99, 0.12, "triangle", g * 0.85, 0.28);
    tone(1046.5, 0.18, "sine", g * 0.7, 0.42);
    tone(1318.5, 0.2, "sine", g * 0.5, 0.6);
    tone(783.99, 0.14, "triangle", g * 0.35, 0.78);
    return;
  }
  if (heat === 4) {
    // Cascade + double résolution
    tone(349.23, 0.1, "triangle", g * 0.75);
    tone(440, 0.1, "triangle", g * 0.85, 0.08);
    tone(523.25, 0.1, "triangle", g * 0.95, 0.17);
    tone(659.25, 0.11, "triangle", g, 0.28);
    tone(783.99, 0.12, "triangle", g * 0.9, 0.4);
    tone(987.77, 0.14, "sine", g * 0.75, 0.54);
    tone(1174.7, 0.18, "sine", g * 0.6, 0.7);
    tone(1568, 0.2, "sine", g * 0.4, 0.9);
    tone(1174.7, 0.16, "triangle", g * 0.35, 1.12);
    tone(1568, 0.22, "sine", g * 0.28, 1.28);
    return;
  }
  // heat 5 — objectif : fanfare longue, clinquant, accord final
  tone(261.63, 0.12, "triangle", g * 0.65);
  tone(329.63, 0.12, "triangle", g * 0.75, 0.1);
  tone(392, 0.12, "triangle", g * 0.85, 0.2);
  tone(523.25, 0.13, "triangle", g, 0.32);
  tone(659.25, 0.13, "triangle", g * 0.95, 0.46);
  tone(783.99, 0.14, "triangle", g * 0.9, 0.6);
  tone(1046.5, 0.18, "sine", g * 0.8, 0.76);
  tone(1318.5, 0.2, "sine", g * 0.65, 0.96);
  tone(1568, 0.22, "sine", g * 0.5, 1.18);
  tone(2093, 0.28, "sine", g * 0.35, 1.4);
  // Accord final (C majeur)
  tone(523.25, 0.45, "sine", g * 0.28, 1.55);
  tone(659.25, 0.45, "sine", g * 0.22, 1.55);
  tone(783.99, 0.5, "sine", g * 0.2, 1.55);
  tone(1046.5, 0.55, "sine", g * 0.16, 1.55);
}

export function playComboSound(kind: SoundKind, enabled = readSoundsEnabled()): void {
  if (!enabled) return;
  void unlockComboAudio();
  switch (kind) {
    case "tick":
      tone(880, 0.05, "square", 0.035);
      break;
    case "success":
      tone(523.25, 0.07, "triangle", 0.05);
      tone(659.25, 0.1, "triangle", 0.045, 0.05);
      break;
    case "recall":
      tone(392, 0.08, "sine", 0.04);
      tone(523.25, 0.12, "sine", 0.035, 0.07);
      break;
    case "warn":
      tone(180, 0.12, "sawtooth", 0.03);
      break;
    case "whoosh":
      tone(220, 0.08, "sine", 0.025);
      tone(440, 0.1, "sine", 0.02, 0.04);
      break;
    case "demo":
      tone(392, 0.09, "triangle", 0.04);
      tone(494, 0.09, "triangle", 0.035, 0.08);
      tone(587, 0.12, "triangle", 0.03, 0.16);
      break;
    case "rdv":
      playRdvCelebrateSound(2, true);
      break;
    case "goal":
      playRdvCelebrateSound(5, true);
      break;
    default:
      break;
  }
}
