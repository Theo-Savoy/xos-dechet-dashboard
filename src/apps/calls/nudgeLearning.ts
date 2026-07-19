export type ShortcutId =
  | "K"
  | "J"
  | "L"
  | "F"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "cmd-enter"
  | "cmd-k"
  | "?";

export type LearningNudgePhase = "intensive" | "reguliere" | "espacee" | "acceptee";

export type LearningState = {
  mouseCount: number;
  /** BUG-05 : total de clics cumulé depuis toujours, jamais remis à zéro (contrairement à mouseCount). */
  totalMouseCount: number;
  nudgesSeen: number;
  lastNudgeAt: string | null;
  phase: LearningNudgePhase;
};

export type LearningStore = Record<string, LearningState>;

export const NUDGE_LEARNING_KEY_PREFIX = "xos-combo-nudge-learning:";
export const NUDGE_LEARNING_SESSION_PREFIX = "xos-combo-nudge-learning-session:";
export const NUDGE_LEARNING_WEEK_PREFIX = "xos-combo-nudge-learning-week:";

/**
 * BUG-04 : seuil de la phase intensive par raccourci — la spec (§2.5) exige
 * 3 clics pour Vue liste (L) et Vue fiche (F), 5 pour tous les autres.
 * cmd-k est désactivé (0) : ⌘K ouvre la command bar, jamais nudgé.
 */
const INTENSIVE_THRESHOLDS: Record<ShortcutId, number> = {
  K: 5,
  J: 5,
  L: 3,
  F: 3,
  "1": 5,
  "2": 5,
  "3": 5,
  "4": 5,
  "5": 5,
  "cmd-enter": 5,
  "cmd-k": 0,
  "?": 5,
};
const REGULIERE_THRESHOLD = 10;
const ESPACEE_THRESHOLD = 30;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

let localStore: StorageLike | null = null;
let sessionStore: StorageLike | null = null;
let nowMs = () => Date.now();

const pendingDismiss = new Map<string, boolean>();

function storageKey(userId: string): string {
  return `${NUDGE_LEARNING_KEY_PREFIX}${userId}`;
}

function sessionFlagKey(userId: string, shortcutId: ShortcutId): string {
  return `${NUDGE_LEARNING_SESSION_PREFIX}${userId}:${shortcutId}`;
}

function weekFlagKey(userId: string, shortcutId: ShortcutId): string {
  return `${NUDGE_LEARNING_WEEK_PREFIX}${userId}:${shortcutId}`;
}

function pendingKey(userId: string, shortcutId: ShortcutId): string {
  return `${userId}:${shortcutId}`;
}

function getLocalStorage(): StorageLike | null {
  if (localStore) return localStore;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

function getSessionStorage(): StorageLike | null {
  if (sessionStore) return sessionStore;
  if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
  return null;
}

export function __setLocalStorage(adapter: StorageLike | null): void {
  localStore = adapter;
}

export function __setSessionStorage(adapter: StorageLike | null): void {
  sessionStore = adapter;
}

export function __setNowProvider(provider: () => number): void {
  nowMs = provider;
}

export function __resetNudgeLearningInternals(): void {
  pendingDismiss.clear();
  nowMs = () => Date.now();
}

export function derivePhase(nudgesSeen: number): LearningNudgePhase {
  if (nudgesSeen >= 3) return "acceptee";
  if (nudgesSeen === 2) return "espacee";
  if (nudgesSeen === 1) return "reguliere";
  return "intensive";
}

export function defaultLearningState(): LearningState {
  return {
    mouseCount: 0,
    totalMouseCount: 0,
    nudgesSeen: 0,
    lastNudgeAt: null,
    phase: "intensive",
  };
}

function readStore(userId: string): LearningStore {
  const storage = getLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LearningStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(userId: string, store: LearningStore): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(userId), JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function normalizeState(state: Partial<LearningState> | undefined): LearningState {
  const nudgesSeen =
    typeof state?.nudgesSeen === "number" && state.nudgesSeen >= 0
      ? Math.floor(state.nudgesSeen)
      : 0;
  const mouseCount =
    typeof state?.mouseCount === "number" && state.mouseCount >= 0
      ? Math.floor(state.mouseCount)
      : 0;
  return {
    mouseCount,
    // Migration douce des états déjà persistés sans totalMouseCount (BUG-05).
    totalMouseCount:
      typeof state?.totalMouseCount === "number" && state.totalMouseCount >= 0
        ? Math.floor(state.totalMouseCount)
        : mouseCount,
    nudgesSeen,
    lastNudgeAt: typeof state?.lastNudgeAt === "string" ? state.lastNudgeAt : null,
    phase: derivePhase(nudgesSeen),
  };
}

export function loadLearningState(
  shortcutId: ShortcutId,
  userId: string,
): LearningState {
  const store = readStore(userId);
  return normalizeState(store[shortcutId]);
}

function saveLearningState(
  shortcutId: ShortcutId,
  userId: string,
  state: LearningState,
): void {
  const store = readStore(userId);
  store[shortcutId] = normalizeState(state);
  writeStore(userId, store);
}

function isReguliereShownThisSession(
  userId: string,
  shortcutId: ShortcutId,
): boolean {
  const storage = getSessionStorage();
  return storage?.getItem(sessionFlagKey(userId, shortcutId)) === "1";
}

function markReguliereShownThisSession(
  userId: string,
  shortcutId: ShortcutId,
): void {
  const storage = getSessionStorage();
  storage?.setItem(sessionFlagKey(userId, shortcutId), "1");
}

function isEspaceeShownThisWeek(userId: string, shortcutId: ShortcutId): boolean {
  const storage = getLocalStorage();
  const raw = storage?.getItem(weekFlagKey(userId, shortcutId));
  if (!raw) return false;
  const shownAt = Number(raw);
  if (!Number.isFinite(shownAt)) return false;
  return nowMs() - shownAt < WEEK_MS;
}

function markEspaceeShownThisWeek(userId: string, shortcutId: ShortcutId): void {
  const storage = getLocalStorage();
  storage?.setItem(weekFlagKey(userId, shortcutId), String(nowMs()));
}

export function shouldShowNudge(
  shortcutId: ShortcutId,
  userId: string,
  currentMouseCount?: number,
): boolean {
  const state = loadLearningState(shortcutId, userId);
  const mouseCount = currentMouseCount ?? state.mouseCount;
  return evaluateShouldShow(shortcutId, userId, { ...state, mouseCount });
}

function evaluateShouldShow(
  shortcutId: ShortcutId,
  userId: string,
  state: LearningState,
): boolean {
  if (pendingDismiss.get(pendingKey(userId, shortcutId))) return false;
  if (state.nudgesSeen >= 3) return false;

  if (state.nudgesSeen === 0) {
    return state.mouseCount >= INTENSIVE_THRESHOLDS[shortcutId];
  }

  if (state.nudgesSeen === 1) {
    if (isReguliereShownThisSession(userId, shortcutId)) return false;
    return state.mouseCount >= REGULIERE_THRESHOLD;
  }

  if (state.nudgesSeen === 2) {
    if (isEspaceeShownThisWeek(userId, shortcutId)) return false;
    // BUG-05 : seuil cumulatif depuis toujours (30 clics au total), pas 30
    // de plus depuis le dernier nudge — sinon le 3e nudge n'arrive qu'à 45.
    return state.totalMouseCount >= ESPACEE_THRESHOLD;
  }

  return false;
}

export function registerMouseClick(
  shortcutId: ShortcutId,
  userId: string,
): { shouldShow: boolean; state: LearningState } {
  const state = loadLearningState(shortcutId, userId);
  state.mouseCount += 1;
  state.totalMouseCount += 1;
  state.phase = derivePhase(state.nudgesSeen);

  const shouldShow = evaluateShouldShow(shortcutId, userId, state);
  if (shouldShow) {
    pendingDismiss.set(pendingKey(userId, shortcutId), true);
    if (state.nudgesSeen === 1) {
      markReguliereShownThisSession(userId, shortcutId);
    }
    if (state.nudgesSeen === 2) {
      markEspaceeShownThisWeek(userId, shortcutId);
    }
  }

  saveLearningState(shortcutId, userId, state);
  return { shouldShow, state };
}

export function markNudgeSeen(shortcutId: ShortcutId, userId: string): void {
  const state = loadLearningState(shortcutId, userId);
  state.nudgesSeen += 1;
  state.lastNudgeAt = new Date(nowMs()).toISOString();
  state.mouseCount = 0;
  state.phase = derivePhase(state.nudgesSeen);
  pendingDismiss.delete(pendingKey(userId, shortcutId));
  saveLearningState(shortcutId, userId, state);
}

/**
 * BUG-06 : à appeler quand l'utilisateur utilise le raccourci clavier
 * lui-même — passe directement en phase "acceptee" (silence définitif),
 * sans repasser par resetLearning ni remettre les compteurs à zéro.
 */
export function markAdopted(shortcutId: ShortcutId, userId: string): void {
  const state = loadLearningState(shortcutId, userId);
  state.nudgesSeen = 3;
  state.phase = "acceptee";
  pendingDismiss.delete(pendingKey(userId, shortcutId));
  saveLearningState(shortcutId, userId, state);
}

export function resetLearning(shortcutId: ShortcutId, userId: string): void {
  const store = readStore(userId);
  delete store[shortcutId];
  writeStore(userId, store);
  pendingDismiss.delete(pendingKey(userId, shortcutId));
  getSessionStorage()?.removeItem(sessionFlagKey(userId, shortcutId));
  getLocalStorage()?.removeItem(weekFlagKey(userId, shortcutId));
}
