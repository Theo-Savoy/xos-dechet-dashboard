import type { RecallInboxItem, SessionContact, SessionDetail } from "./types";

/** Synthetic session id for the infinite recall queue (not persisted). */
export const RECALL_QUEUE_SESSION_ID = -1;

export const RECALL_QUEUE_SESSION: SessionDetail = {
  id: RECALL_QUEUE_SESSION_ID,
  name: "Rappels",
  status: "active",
  created_at: "1970-01-01T00:00:00.000Z",
  scheduled_for: null,
  session_type: "relance",
};

export type RecallDateFilter = "today" | "overdue" | "upcoming" | "all";

export type RecallSessionFilter = "all" | number;

export function recallsToSessionContacts(recalls: RecallInboxItem[]): SessionContact[] {
  return recalls.map((item, index) => ({
    id: item.id,
    position: index,
    sf_contact_id: item.sf_contact_id || `recall-${item.session_id}-${item.id}`,
    sf_account_id: item.sf_account_id ?? null,
    contact_name: item.contact_name,
    account_name: item.account_name,
    phone: item.phone,
    email: item.email ?? null,
    title: item.title ?? null,
    linkedin_url: item.linkedin_url ?? null,
    status: "pending",
    outcome: item.outcome,
    comments: null,
    sf_task_id: null,
    sf_event_id: null,
    called_at: null,
    recall_at: item.recall_at,
    attempt_count: item.attempt_count ?? 0,
    origin_session_id: item.session_id,
    origin_session_name: item.session_name,
    previous_callers: item.previous_callers,
  }));
}

export function matchesRecallDateFilter(
  recallAt: string | null | undefined,
  filter: RecallDateFilter,
  today: string,
): boolean {
  if (!recallAt) return filter === "all";
  if (filter === "all") return true;
  if (filter === "today") return recallAt === today;
  if (filter === "overdue") return recallAt < today;
  return recallAt > today;
}

export function matchesRecallSessionFilter(
  originSessionId: number | null | undefined,
  filter: RecallSessionFilter,
): boolean {
  if (filter === "all") return true;
  return originSessionId === filter;
}

export function listRecallOriginSessions(
  contacts: Array<{ origin_session_id?: number | null; origin_session_name?: string | null }>,
): Array<{ id: number; name: string; count: number }> {
  const byId = new Map<number, { id: number; name: string; count: number }>();
  for (const contact of contacts) {
    const id = contact.origin_session_id;
    if (typeof id !== "number" || id < 1) continue;
    const existing = byId.get(id);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byId.set(id, {
      id,
      name: contact.origin_session_name?.trim() || `Séance #${id}`,
      count: 1,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function countRecallDateFilters(recalls: RecallInboxItem[], today: string) {
  const counts = { today: 0, overdue: 0, upcoming: 0, all: recalls.length };
  for (const item of recalls) {
    if (item.recall_at === today) counts.today += 1;
    else if (item.recall_at < today) counts.overdue += 1;
    else counts.upcoming += 1;
  }
  return counts;
}
