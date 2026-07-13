import { readSoundsEnabled } from "./comboKeyboard";

export const COMBO_SOUND_PREFS_KEY = "xos-combo-sound-groups";

/** Groupes de sons configurables indépendamment du mute global. */
export type ComboSoundGroup = "log" | "rdv" | "result" | "navigation" | "warn" | "demo";

export type ComboSoundPrefs = Record<ComboSoundGroup, boolean>;

export const COMBO_SOUND_GROUP_LABELS: Record<ComboSoundGroup, string> = {
  log: "Journalisation",
  rdv: "Fanfare RDV",
  result: "Choix du résultat",
  navigation: "Navigation & interface",
  warn: "Alertes",
  demo: "Démo",
};

export const COMBO_SOUND_GROUP_HINTS: Record<ComboSoundGroup, string> = {
  log: "Validation d’appel, avec ou sans rappel",
  rdv: "Célébration quand un RDV est enregistré",
  result: "Touches 1–5 et sélection du résultat",
  navigation: "K/J, modes, command bar, aide…",
  warn: "NPA et avertissements",
  demo: "Tutoriel d’introduction",
};

export const DEFAULT_SOUND_PREFS: ComboSoundPrefs = {
  log: true,
  rdv: true,
  result: true,
  navigation: true,
  warn: true,
  demo: true,
};

/** Tout sauf journalisation + fanfare RDV. */
export const LOG_ONLY_SOUND_PREFS: ComboSoundPrefs = {
  log: true,
  rdv: true,
  result: false,
  navigation: false,
  warn: false,
  demo: false,
};

const GROUPS: ComboSoundGroup[] = ["log", "rdv", "result", "navigation", "warn", "demo"];

export function readSoundPrefs(): ComboSoundPrefs {
  try {
    const raw = window.localStorage?.getItem(COMBO_SOUND_PREFS_KEY);
    if (!raw) return { ...DEFAULT_SOUND_PREFS };
    const parsed = JSON.parse(raw) as Partial<ComboSoundPrefs>;
    return { ...DEFAULT_SOUND_PREFS, ...pickKnownGroups(parsed) };
  } catch {
    return { ...DEFAULT_SOUND_PREFS };
  }
}

function pickKnownGroups(source: Partial<ComboSoundPrefs>): Partial<ComboSoundPrefs> {
  const out: Partial<ComboSoundPrefs> = {};
  for (const key of GROUPS) {
    if (typeof source[key] === "boolean") out[key] = source[key];
  }
  return out;
}

export function writeSoundPrefs(prefs: ComboSoundPrefs): void {
  try {
    window.localStorage?.setItem(COMBO_SOUND_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function isSoundGroupEnabled(group: ComboSoundGroup, masterEnabled = readSoundsEnabled()): boolean {
  if (!masterEnabled) return false;
  return readSoundPrefs()[group];
}
