import { parisDayKey } from "../../lib/dates";

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
