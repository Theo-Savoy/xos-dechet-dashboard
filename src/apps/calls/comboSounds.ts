import { readSoundsEnabled } from "./comboKeyboard";
import { type ComboSoundGroup, isSoundGroupEnabled } from "./comboSoundPrefs";
import type { RdvHeat } from "./rdvCelebrate";

export type SoundKind =
  | "result-pick"
  | "nav"
  | "success"
  | "recall"
  | "warn"
  | "whoosh"
  | "demo";

type PlayOptions = {
  master?: boolean;
  group?: ComboSoundGroup;
};

const KIND_DEFAULT_GROUP: Record<SoundKind, ComboSoundGroup> = {
  "result-pick": "result",
  nav: "navigation",
  success: "log",
  recall: "log",
  warn: "warn",
  whoosh: "navigation",
  demo: "demo",
};

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
  soft = false,
): void {
  const context = ctx();
  if (!context) return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  const t0 = context.currentTime + when;
  const attack = soft ? 0.02 : 0.015;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainValue, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
  if (soft) {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    filter.Q.value = 0.7;
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }
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

function shouldPlay(group: ComboSoundGroup, master?: boolean): boolean {
  return isSoundGroupEnabled(group, master ?? readSoundsEnabled());
}

/** Fanfare RDV qui grossit clairement avec la heat (1 soft → 5 objectif). */
export function playRdvCelebrateSound(heat: RdvHeat, master = readSoundsEnabled()): void {
  if (!shouldPlay("rdv", master)) return;
  void unlockComboAudio();
  const g = 0.032 + heat * 0.012;

  if (heat <= 1) {
    tone(587.33, 0.11, "triangle", g, 0, true);
    tone(880, 0.16, "sine", g * 0.75, 0.1, true);
    return;
  }
  if (heat === 2) {
    tone(523.25, 0.1, "triangle", g, 0, true);
    tone(659.25, 0.11, "triangle", g * 0.95, 0.09, true);
    tone(783.99, 0.14, "triangle", g * 0.85, 0.2, true);
    tone(1046.5, 0.22, "sine", g * 0.65, 0.34, true);
    return;
  }
  if (heat === 3) {
    tone(392, 0.09, "triangle", g * 0.8, 0, true);
    tone(523.25, 0.1, "triangle", g, 0.08, true);
    tone(659.25, 0.1, "triangle", g * 0.95, 0.17, true);
    tone(783.99, 0.12, "triangle", g * 0.85, 0.28, true);
    tone(1046.5, 0.18, "sine", g * 0.7, 0.42, true);
    tone(1318.5, 0.2, "sine", g * 0.5, 0.6, true);
    tone(783.99, 0.14, "triangle", g * 0.35, 0.78, true);
    return;
  }
  if (heat === 4) {
    tone(349.23, 0.1, "triangle", g * 0.75, 0, true);
    tone(440, 0.1, "triangle", g * 0.85, 0.08, true);
    tone(523.25, 0.1, "triangle", g * 0.95, 0.17, true);
    tone(659.25, 0.11, "triangle", g, 0.28, true);
    tone(783.99, 0.12, "triangle", g * 0.9, 0.4, true);
    tone(987.77, 0.14, "sine", g * 0.75, 0.54, true);
    tone(1174.7, 0.18, "sine", g * 0.6, 0.7, true);
    tone(1568, 0.2, "sine", g * 0.4, 0.9, true);
    tone(1174.7, 0.16, "triangle", g * 0.35, 1.12, true);
    tone(1568, 0.22, "sine", g * 0.28, 1.28, true);
    return;
  }
  tone(261.63, 0.12, "triangle", g * 0.65, 0, true);
  tone(329.63, 0.12, "triangle", g * 0.75, 0.1, true);
  tone(392, 0.12, "triangle", g * 0.85, 0.2, true);
  tone(523.25, 0.13, "triangle", g, 0.32, true);
  tone(659.25, 0.13, "triangle", g * 0.95, 0.46, true);
  tone(783.99, 0.14, "triangle", g * 0.9, 0.6, true);
  tone(1046.5, 0.18, "sine", g * 0.8, 0.76, true);
  tone(1318.5, 0.2, "sine", g * 0.65, 0.96, true);
  tone(1568, 0.22, "sine", g * 0.5, 1.18, true);
  tone(2093, 0.28, "sine", g * 0.35, 1.4, true);
  tone(523.25, 0.45, "sine", g * 0.28, 1.55, true);
  tone(659.25, 0.45, "sine", g * 0.22, 1.55, true);
  tone(783.99, 0.5, "sine", g * 0.2, 1.55, true);
  tone(1046.5, 0.55, "sine", g * 0.16, 1.55, true);
}

export function playComboSound(kind: SoundKind, options: PlayOptions = {}): void {
  const group = options.group ?? KIND_DEFAULT_GROUP[kind];
  if (!shouldPlay(group, options.master)) return;
  void unlockComboAudio();
  switch (kind) {
    case "result-pick":
      // Doux — sine filtré, pas de square strident
      tone(392, 0.07, "sine", 0.016, 0, true);
      tone(493.88, 0.09, "sine", 0.013, 0.045, true);
      break;
    case "nav":
      tone(520, 0.035, "sine", 0.01, 0, true);
      break;
    case "success":
      tone(392, 0.08, "sine", 0.022, 0, true);
      tone(523.25, 0.11, "sine", 0.018, 0.06, true);
      break;
    case "recall":
      tone(349.23, 0.09, "sine", 0.018, 0, true);
      tone(440, 0.12, "sine", 0.015, 0.07, true);
      break;
    case "warn":
      tone(220, 0.1, "triangle", 0.018, 0, true);
      tone(185, 0.12, "triangle", 0.014, 0.09, true);
      break;
    case "whoosh":
      tone(220, 0.07, "sine", 0.014, 0, true);
      tone(330, 0.09, "sine", 0.011, 0.035, true);
      break;
    case "demo":
      tone(392, 0.09, "triangle", 0.032, 0, true);
      tone(494, 0.09, "triangle", 0.028, 0.08, true);
      tone(587, 0.12, "triangle", 0.024, 0.16, true);
      break;
    default:
      break;
  }
}
