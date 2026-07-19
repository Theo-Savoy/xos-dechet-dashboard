import { parisDayKey } from "../../lib/dates";
import type { SessionSummary } from "./types";

type SessionLifecycleFields = {
  status?: string | null;
  scheduled_for?: string | null;
  created_at?: string | null;
  rdv_goal?: number | null;
  engaged_at?: string | null;
};

export function shouldShowPreSession(session: SessionLifecycleFields): boolean {
  // A null value is the persisted "never engaged" marker. Undefined keeps
  // legacy sessions (created before the engagement columns) directly runnable.
  return session.status !== "completed" && session.engaged_at === null;
}

export function sessionDayKey(
  session: Pick<SessionLifecycleFields, "scheduled_for" | "created_at">,
  timeZone = "Europe/Paris",
): string {
  if (session.scheduled_for) return session.scheduled_for;
  if (!session.created_at) return "";
  const date = new Date(session.created_at);
  if (Number.isNaN(date.getTime())) return String(session.created_at).slice(0, 10);
  return parisDayKey(date, timeZone);
}

export function isStaleSession(
  session: Pick<SessionLifecycleFields, "status" | "scheduled_for" | "created_at">,
  today: string,
): boolean {
  return session.status === "active" && sessionDayKey(session) < today;
}

/** Jours calendaires depuis la dernière séance hub (hors séance en cours). */
export function computeDaysSinceLastSession(
  sessions: SessionSummary[],
  opts?: { excludeSessionId?: number; today?: string },
): number | null {
  const today = opts?.today ?? parisDayKey(new Date());
  const excludeId = opts?.excludeSessionId;
  let latestDay: string | null = null;
  for (const row of sessions) {
    if (excludeId != null && row.id === excludeId) continue;
    const day = sessionDayKey(row);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!latestDay || day > latestDay) latestDay = day;
  }
  if (!latestDay) return null;
  const from = new Date(`${latestDay}T12:00:00Z`).getTime();
  const to = new Date(`${today}T12:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
