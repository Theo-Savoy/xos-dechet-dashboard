/** Modèle streaks Combo (classique/productif/intense). Pas d'UI, pas de notifs — voir docs/specs/combo-gamification-v1.md §2.4. */

export const INTENSE_STREAK_THRESHOLD = 20;

export type ComboStreakId = "classique" | "productif" | "intense";

export type ComboStreaksState = Record<ComboStreakId, number>;

const EMPTY_STREAKS_STATE: ComboStreaksState = { classique: 0, productif: 0, intense: 0 };

export function comboStreaksStorageKey(userId: string): string {
  return `xos-combo-streaks:${userId}`;
}

/** BUG-01 : `comboEvents.recordSessionComplete` est l'unique écrivain de ce store. */
export function loadStreaks(userId: string): ComboStreaksState {
  try {
    const raw = window.localStorage?.getItem(comboStreaksStorageKey(userId));
    if (!raw) return { ...EMPTY_STREAKS_STATE };
    const parsed = JSON.parse(raw) as Partial<ComboStreaksState>;
    return {
      classique: typeof parsed.classique === "number" ? parsed.classique : 0,
      productif: typeof parsed.productif === "number" ? parsed.productif : 0,
      intense: typeof parsed.intense === "number" ? parsed.intense : 0,
    };
  } catch {
    return { ...EMPTY_STREAKS_STATE };
  }
}

export function saveStreaks(userId: string, streaks: ComboStreaksState): void {
  try {
    window.localStorage?.setItem(comboStreaksStorageKey(userId), JSON.stringify(streaks));
  } catch {
    /* ignore */
  }
}

export interface StreakResult {
  currentDays: number;
  bestEver: number;
}

export interface SessionStreakResult {
  currentSessions: number;
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Streak "classique" : jours calendaires consécutifs avec ≥ 1 log_call. Aujourd'hui compte, hier compte (streak pas encore cassé), un jour manquant casse. */
export function computeStreak(logDates: string[], todayParis: string): StreakResult {
  const days = new Set(logDates);
  return { currentDays: computeCurrentDays(days, todayParis), bestEver: computeBestEver(days) };
}

function computeCurrentDays(days: Set<string>, todayParis: string): number {
  let cursor = todayParis;
  if (!days.has(cursor)) {
    const yesterday = shiftDate(todayParis, -1);
    if (!days.has(yesterday)) return 0;
    cursor = yesterday;
  }

  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = shiftDate(cursor, -1);
  }
  return count;
}

function computeBestEver(days: Set<string>): number {
  const sorted = Array.from(days).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sorted) {
    run = prev && shiftDate(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

function trailingRun(values: number[], meetsThreshold: (value: number) => boolean): number {
  let count = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (!meetsThreshold(values[i])) break;
    count++;
  }
  return count;
}

/** Streak "productif" : séances consécutives (les plus récentes) avec ≥ 3 RDV chacune. */
export function computeProductifStreak(sessionRdvs: number[]): SessionStreakResult {
  return { currentSessions: trailingRun(sessionRdvs, (rdvs) => rdvs >= 3) };
}

/** Streak "intense" : séances consécutives (les plus récentes) à ≥ threshold appels. */
export function computeIntenseStreak(sessionCalls: number[], threshold: number = INTENSE_STREAK_THRESHOLD): SessionStreakResult {
  return { currentSessions: trailingRun(sessionCalls, (calls) => calls >= threshold) };
}
