import { RESULTAT_CALL_VALUES, type ResultatCall } from "../../crm";

export const COMBO_DEMO_SEEN_KEY = "xos-combo-demo-seen";
export const COMBO_SOUNDS_KEY = "xos-combo-sounds";

export type ComboActionId =
  | "result-1"
  | "result-2"
  | "result-3"
  | "result-4"
  | "result-5"
  | "toggle-recall"
  | "recall-0"
  | "recall-1"
  | "recall-3"
  | "recall-7"
  | "recall-14"
  | "toggle-npa"
  | "log-next"
  | "nav-next"
  | "nav-prev"
  | "mode-list"
  | "mode-fiche"
  | "call"
  | "defer"
  | "remove"
  | "help"
  | "command-bar"
  | "replay-demo"
  | "toggle-sounds";

export type ComboActionSection = "Résultats" | "Rappel" | "Session" | "Navigation" | "Aide";

export type ComboActionDef = {
  id: ComboActionId;
  label: string;
  section: ComboActionSection;
  /** Affichage humain du raccourci (ex. ⌘↵). */
  shortcutLabel?: string;
  keywords?: string[];
};

export const RECALL_SHORTCUT_PRESETS = [
  { id: "recall-0" as const, days: 0, shiftDigit: "1" },
  { id: "recall-1" as const, days: 1, shiftDigit: "2" },
  { id: "recall-3" as const, days: 3, shiftDigit: "3" },
  { id: "recall-7" as const, days: 7, shiftDigit: "4" },
  { id: "recall-14" as const, days: 14, shiftDigit: "5" },
];

export const COMBO_ACTIONS: ComboActionDef[] = [
  {
    id: "result-1",
    label: RESULTAT_CALL_VALUES[0],
    section: "Résultats",
    shortcutLabel: "1",
    keywords: ["non décroché", "resultat"],
  },
  {
    id: "result-2",
    label: RESULTAT_CALL_VALUES[1],
    section: "Résultats",
    shortcutLabel: "2",
    keywords: ["répondeur", "message", "resultat"],
  },
  {
    id: "result-3",
    label: RESULTAT_CALL_VALUES[2],
    section: "Résultats",
    shortcutLabel: "3",
    keywords: ["décroché", "resultat"],
  },
  {
    id: "result-4",
    label: RESULTAT_CALL_VALUES[3],
    section: "Résultats",
    shortcutLabel: "4",
    keywords: ["argumenté", "resultat"],
  },
  {
    id: "result-5",
    label: RESULTAT_CALL_VALUES[4],
    section: "Résultats",
    shortcutLabel: "5",
    keywords: ["rdv", "planifié", "resultat"],
  },
  {
    id: "toggle-recall",
    label: "Planifier / retirer le rappel",
    section: "Rappel",
    shortcutLabel: "R",
    keywords: ["rappel", "relance"],
  },
  {
    id: "recall-0",
    label: "Rappel aujourd'hui",
    section: "Rappel",
    shortcutLabel: "⇧1",
    keywords: ["aujourd'hui", "rappel"],
  },
  {
    id: "recall-1",
    label: "Rappel +1 j",
    section: "Rappel",
    shortcutLabel: "⇧2",
    keywords: ["rappel"],
  },
  {
    id: "recall-3",
    label: "Rappel +3 j",
    section: "Rappel",
    shortcutLabel: "⇧3",
    keywords: ["rappel"],
  },
  {
    id: "recall-7",
    label: "Rappel +7 j",
    section: "Rappel",
    shortcutLabel: "⇧4",
    keywords: ["rappel", "semaine"],
  },
  {
    id: "recall-14",
    label: "Rappel +14 j",
    section: "Rappel",
    shortcutLabel: "⇧5",
    keywords: ["rappel"],
  },
  {
    id: "toggle-npa",
    label: "Ne pas rappeler (NPA)",
    section: "Session",
    shortcutLabel: "N",
    keywords: ["npa", "ne pas appeler"],
  },
  {
    id: "log-next",
    label: "Logguer & suivant",
    section: "Session",
    shortcutLabel: "⌘↵",
    keywords: ["log", "consigner", "suivant"],
  },
  {
    id: "defer",
    label: "Non contacté",
    section: "Session",
    shortcutLabel: "D",
    keywords: ["defer", "reporter", "follow-up"],
  },
  {
    id: "remove",
    label: "Retirer",
    section: "Session",
    shortcutLabel: "⌫",
    keywords: ["supprimer", "retirer", "rappels"],
  },
  {
    id: "call",
    label: "Appeler",
    section: "Session",
    keywords: ["tel", "téléphoner", "appeler"],
  },
  {
    id: "nav-next",
    label: "Contact suivant",
    section: "Navigation",
    shortcutLabel: "K",
    keywords: ["suivant", "next"],
  },
  {
    id: "nav-prev",
    label: "Contact précédent",
    section: "Navigation",
    shortcutLabel: "J",
    keywords: ["précédent", "prev"],
  },
  {
    id: "mode-list",
    label: "Vue liste",
    section: "Navigation",
    shortcutLabel: "L",
    keywords: ["liste"],
  },
  {
    id: "mode-fiche",
    label: "Vue fiche",
    section: "Navigation",
    shortcutLabel: "F",
    keywords: ["fiche", "detail"],
  },
  {
    id: "command-bar",
    label: "Command bar",
    section: "Aide",
    shortcutLabel: "⌘K",
    keywords: ["commande", "palette", "actions"],
  },
  {
    id: "help",
    label: "Aide raccourcis",
    section: "Aide",
    shortcutLabel: "?",
    keywords: ["aide", "help", "raccourcis"],
  },
  {
    id: "replay-demo",
    label: "Revoir la démo Combo",
    section: "Aide",
    keywords: ["démo", "onboarding", "tutoriel"],
  },
  {
    id: "toggle-sounds",
    label: "Activer / couper les sons",
    section: "Aide",
    keywords: ["son", "mute", "audio", "réglages", "sons", "log"],
  },
];

export function resultatFromDigit(digit: string): ResultatCall | null {
  const index = Number(digit) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= RESULTAT_CALL_VALUES.length) return null;
  return RESULTAT_CALL_VALUES[index];
}

/** Physique Digit1–5 (AZERTY : &é"'( sans Shift) — l’étiquette UI reste 1–5. */
export function digitFromKeyboardCode(code: string): string | null {
  const match = /^Digit([1-5])$/.exec(code);
  return match?.[1] ?? null;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function readSoundsEnabled(): boolean {
  try {
    const raw = window.localStorage?.getItem(COMBO_SOUNDS_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    } catch {
      /* ignore */
    }
  }
  return true;
}

export function writeSoundsEnabled(enabled: boolean): void {
  try {
    window.localStorage?.setItem(COMBO_SOUNDS_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function hasSeenComboDemo(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return true;
    return window.localStorage.getItem(COMBO_DEMO_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markComboDemoSeen(): void {
  try {
    window.localStorage?.setItem(COMBO_DEMO_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function filterComboActions(query: string): ComboActionDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return COMBO_ACTIONS;
  return COMBO_ACTIONS.filter((action) => {
    const haystack = [action.label, action.shortcutLabel, action.section, ...(action.keywords ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function isModKey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}
