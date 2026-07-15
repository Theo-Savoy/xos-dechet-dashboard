import type { CallTargetPreset, DedupEntry, FilterTree, MaxPerCompany, ResultatCall } from "../../crm";
import type {
  AccountSearchResult,
  CallStats,
  ContactContext,
  ContactPreview,
  RecallInboxItem,
  SessionContact,
  SessionDetail,
  SessionSummary,
  TeamMember,
} from "./types";

export class CallsApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: string,
  ) {
    super(code);
    this.name = "CallsApiError";
  }
}

async function parseError(res: Response): Promise<{ code: string; details?: string }> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return {
      code: body.error ?? `http_${res.status}`,
      details: typeof body.message === "string" ? body.message : undefined,
    };
  } catch {
    return { code: `http_${res.status}` };
  }
}

async function apiFetch<T>(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const { code, details } = await parseError(res);
    throw new CallsApiError(res.status, code, details);
  }

  return res.json() as Promise<T>;
}

export type ComboHubPayload = {
  sessions: SessionSummary[];
  stats: CallStats;
  recall_count: number;
};

type HubCacheEntry = {
  token: string;
  at: number;
  data?: ComboHubPayload;
  promise?: Promise<ComboHubPayload>;
};

let hubCache: HubCacheEntry | null = null;
const HUB_CACHE_TTL_MS = 45_000;

export function invalidateComboHubCache() {
  hubCache = null;
}

/** Prefetch hub Combo (Desktop) — partage le cache avec CallManagerApp. */
export function prefetchComboHub(token: string): void {
  if (!token) return;
  void fetchComboHub(token).catch(() => {
    /* ignore */
  });
}

export async function fetchComboHub(
  token: string,
  opts?: { force?: boolean },
): Promise<ComboHubPayload> {
  const force = opts?.force === true;
  const now = Date.now();
  if (
    !force
    && hubCache
    && hubCache.token === token
    && hubCache.data
    && now - hubCache.at < HUB_CACHE_TTL_MS
  ) {
    return hubCache.data;
  }
  if (!force && hubCache && hubCache.token === token && hubCache.promise) {
    return hubCache.promise;
  }

  const promise = apiFetch<ComboHubPayload>(token, "/api/calls?resource=hub").then((data) => {
    hubCache = { token, at: Date.now(), data };
    return data;
  });
  hubCache = { token, at: now, promise };
  try {
    return await promise;
  } catch (err) {
    if (hubCache?.promise === promise) hubCache = null;
    throw err;
  }
}

export async function fetchSession(
  token: string,
  sessionId: number,
): Promise<{ session: SessionDetail; contacts: SessionContact[] }> {
  return apiFetch(token, `/api/calls?session_id=${sessionId}`);
}

export async function fetchContactContext(
  token: string,
  sessionId: number,
  contactId: number,
  opts?: { lite?: boolean },
): Promise<ContactContext> {
  const params = new URLSearchParams({
    session_id: String(sessionId),
    context_contact_id: String(contactId),
  });
  if (opts?.lite) params.set("context_lite", "1");
  const data = await apiFetch<{ context: ContactContext }>(
    token,
    `/api/calls?${params}`,
  );
  return data.context;
}

export type ContactListResult = {
  contacts: ContactPreview[];
  dedup: DedupEntry[];
  truncated: boolean;
  excluded_count?: number;
};

export type ContactCountResult = {
  count: number;
  capped: boolean;
};

export async function fetchContactList(
  token: string,
  filters: FilterTree,
  opts?: { presetId?: number; limit?: number; maxPerCompany?: MaxPerCompany | null },
): Promise<ContactListResult> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "list_contacts",
      filters,
      preset_id: opts?.presetId,
      limit: opts?.limit ?? 200,
      ...(opts?.maxPerCompany ? { max_per_company: opts.maxPerCompany } : {}),
    }),
  });
}

export async function fetchContactCount(
  token: string,
  filters: FilterTree,
): Promise<ContactCountResult> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "list_contacts",
      filters,
      count_only: true,
      limit: 2000,
    }),
  });
}

export async function fetchAccountsSearch(
  token: string,
  body: { q: string; filters?: Partial<FilterTree["entreprise"]>; limit?: number },
): Promise<AccountSearchResult> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({ action: "accounts_search", ...body }),
  });
}

export async function createSession(
  token: string,
  name: string,
  contacts: ContactPreview[],
  scheduledFor?: string,
  sessionType?: string,
  memberUserIds?: string[],
): Promise<{ session: SessionDetail; contacts: SessionContact[] }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "create_session",
      name,
      contacts,
      ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
      ...(sessionType ? { session_type: sessionType } : {}),
      ...(memberUserIds && memberUserIds.length > 0 ? { member_user_ids: memberUserIds } : {}),
    }),
  });
}

export type AudienceSessionGroup = {
  account_ids: string[];
  contacts: ContactPreview[];
};

export type CreatedAudienceSession = {
  id: number;
  name: string;
  contact_count: number;
  account_ids: string[];
};

export async function fetchCreateAudienceSessions(
  token: string,
  body: {
    groups: AudienceSessionGroup[];
    target_size: number;
    max_sessions: number;
    session_type?: string;
    scheduled_for?: string;
    name_prefix?: string;
  },
): Promise<{ sessions: CreatedAudienceSession[] }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({ action: "create_audience_sessions", ...body }),
  });
}

export async function updateSession(
  token: string,
  sessionId: number,
  patch: {
    name?: string;
    scheduled_for?: string | null;
    session_type?: string;
    rdv_goal?: number;
    engaged_at?: string;
  },
): Promise<SessionDetail> {
  const data = await apiFetch<{ session: SessionDetail }>(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "update_session",
      session_id: sessionId,
      ...patch,
    }),
  });
  return data.session;
}

export async function deleteSession(token: string, sessionId: number): Promise<void> {
  await apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({ action: "delete_session", session_id: sessionId }),
  });
}

export async function setSessionMembers(
  token: string,
  sessionId: number,
  memberUserIds: string[],
): Promise<TeamMember[]> {
  const data = await apiFetch<{ members: TeamMember[] }>(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "set_session_members",
      session_id: sessionId,
      member_user_ids: memberUserIds,
    }),
  });
  return data.members;
}

export async function claimContact(
  token: string,
  sessionId: number,
  contactId: number,
): Promise<{ claimed_by: string; claimed_at: string }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "claim_contact",
      session_id: sessionId,
      contact_id: contactId,
    }),
  });
}

export type LogCallOptions = {
  comments?: string;
  recallAt?: string | null;
  doNotCall?: boolean;
};

export async function logCall(
  token: string,
  sessionId: number,
  contactId: number,
  resultat: ResultatCall,
  options: LogCallOptions = {},
): Promise<{ needs_event?: boolean; recall_failed?: boolean; npa_failed?: boolean }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "log_call",
      session_id: sessionId,
      contact_id: contactId,
      resultat,
      comments: options.comments ?? "",
      ...(options.recallAt ? { recall_at: options.recallAt } : {}),
      ...(options.doNotCall ? { do_not_call: true } : {}),
    }),
  });
}

export async function logEvent(
  token: string,
  sessionId: number,
  contactId: number,
  start: string,
  durationMin: number,
  invitees: string[],
  options: { subject: string; ownerSfUserId?: string | null } = {
    subject: "Rdv découverte prospect",
  },
): Promise<void> {
  await apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "log_event",
      session_id: sessionId,
      contact_id: contactId,
      start,
      duration_min: durationMin,
      invitees,
      subject: options.subject,
      ...(options.ownerSfUserId ? { owner_sf_user_id: options.ownerSfUserId } : {}),
    }),
  });
}

/** Fire-and-forget team cheer when a commercial hits their RDV goal. */
export async function celebrateGoal(
  token: string,
  sessionId: number,
  goal: number,
  rdvCount: number,
): Promise<void> {
  await apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "celebrate_goal",
      session_id: sessionId,
      goal,
      rdv_count: rdvCount,
    }),
  });
}

export async function deferContacts(
  token: string,
  sessionId: number,
  contactIds: number[],
  scheduledFor: string,
  targetSessionId?: number | null,
  name?: string | null,
): Promise<{ target_session: SessionDetail; contacts?: SessionContact[] }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "defer_contacts",
      session_id: sessionId,
      contact_ids: contactIds,
      scheduled_for: scheduledFor,
      ...(typeof targetSessionId === "number" ? { target_session_id: targetSessionId } : {}),
      ...(name ? { name } : {}),
    }),
  });
}

export async function removeContact(
  token: string,
  sessionId: number,
  contactId: number,
): Promise<void> {
  await apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "remove_contact",
      session_id: sessionId,
      contact_id: contactId,
    }),
  });
}

export async function updateRecall(
  token: string,
  sessionId: number,
  contactId: number,
  recallAt: string | null,
): Promise<{ recall_at: string | null }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "update_recall",
      session_id: sessionId,
      contact_id: contactId,
      recall_at: recallAt,
    }),
  });
}

export async function fetchRecalls(token: string): Promise<RecallInboxItem[]> {
  const data = await apiFetch<{ recalls: RecallInboxItem[] }>(token, "/api/calls?resource=recalls");
  return data.recalls;
}

export async function completeSession(token: string, sessionId: number): Promise<void> {
  await apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({ action: "complete_session", session_id: sessionId }),
  });
}

export async function createFollowUpSession(
  token: string,
  sessionId: number,
): Promise<{ session: SessionDetail; contacts: SessionContact[] }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({ action: "create_follow_up_session", session_id: sessionId }),
  });
}

export async function fetchPresets(token: string): Promise<CallTargetPreset[]> {
  const data = await apiFetch<{ presets: CallTargetPreset[] }>(token, "/api/calls?resource=presets");
  return data.presets;
}

export async function fetchTeam(token: string): Promise<TeamMember[]> {
  const data = await apiFetch<{ team: TeamMember[] }>(token, "/api/calls?resource=team");
  return data.team;
}

export async function createPreset(
  token: string,
  name: string,
  filters: FilterTree,
  shared: boolean,
): Promise<CallTargetPreset> {
  const data = await apiFetch<{ preset: CallTargetPreset }>(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({ action: "save_preset", name, filters, shared }),
  });
  return data.preset;
}

export async function deletePreset(token: string, id: number): Promise<void> {
  await apiFetch(token, `/api/calls?resource=presets&id=${id}`, { method: "DELETE" });
}
