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

export function countRecallDateFilters(recalls: RecallInboxItem[], today: string) {
  const counts = { today: 0, overdue: 0, upcoming: 0, all: recalls.length };
  for (const item of recalls) {
    if (item.recall_at === today) counts.today += 1;
    else if (item.recall_at < today) counts.overdue += 1;
    else counts.upcoming += 1;
  }
  return counts;
}
