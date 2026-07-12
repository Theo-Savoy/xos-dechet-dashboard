const RDV_GOAL_KEY_PREFIX = "xos-combo-rdv-goal:";

export type RdvHeat = 1 | 2 | 3 | 4 | 5;

export const RDV_GOAL_PRESETS = [3, 5, 8, 10] as const;

export function rdvGoalStorageKey(sessionId: number): string {
  return `${RDV_GOAL_KEY_PREFIX}${sessionId}`;
}

export function readRdvGoal(sessionId: number): number | null {
  try {
    const raw = window.localStorage?.getItem(rdvGoalStorageKey(sessionId));
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 99) return null;
    return n;
  } catch {
    return null;
  }
}

export function writeRdvGoal(sessionId: number, goal: number | null): void {
  try {
    const key = rdvGoalStorageKey(sessionId);
    if (goal == null) window.localStorage?.removeItem(key);
    else window.localStorage?.setItem(key, String(goal));
  } catch {
    /* ignore */
  }
}

/** Intensité visuelle : 1 soft → 4 heat → 5 objectif atteint. */
export function rdvHeatLevel(count: number, goalJustHit: boolean): RdvHeat {
  if (goalJustHit) return 5;
  if (count >= 8) return 4;
  if (count >= 5) return 3;
  if (count >= 3) return 2;
  return 1;
}

export function countSessionRdvs(contacts: { outcome: string | null }[]): number {
  return contacts.filter((c) => c.outcome === "RDV planifié").length;
}
