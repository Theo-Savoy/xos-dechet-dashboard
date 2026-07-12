import { readSoundsEnabled } from "./comboKeyboard";

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
      // Petite fanfare — C–E–G–C aigu
      tone(523.25, 0.09, "triangle", 0.055);
      tone(659.25, 0.1, "triangle", 0.05, 0.07);
      tone(783.99, 0.11, "triangle", 0.045, 0.14);
      tone(1046.5, 0.16, "sine", 0.04, 0.22);
      break;
    case "goal":
      tone(392, 0.1, "triangle", 0.05);
      tone(523.25, 0.1, "triangle", 0.05, 0.08);
      tone(659.25, 0.11, "triangle", 0.05, 0.16);
      tone(784, 0.12, "triangle", 0.045, 0.24);
      tone(1046.5, 0.2, "sine", 0.04, 0.34);
      break;
    default:
      break;
  }
}
