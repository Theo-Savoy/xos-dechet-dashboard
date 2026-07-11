import type { CallTargetPreset, DedupEntry, FilterTree, ResultatCall } from "../../crm";
import type {
  CallStats,
  ContactContext,
  ContactPreview,
  SessionContact,
  SessionDetail,
  SessionSummary,
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

export async function fetchSessions(token: string): Promise<SessionSummary[]> {
  const data = await apiFetch<{ sessions: SessionSummary[] }>(token, "/api/calls");
  return data.sessions;
}

export async function fetchStats(token: string): Promise<CallStats> {
  const data = await apiFetch<{ stats: CallStats }>(token, "/api/calls?stats=1");
  return data.stats;
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
): Promise<ContactContext> {
  const data = await apiFetch<{ context: ContactContext }>(
    token,
    `/api/calls?session_id=${sessionId}&context_contact_id=${contactId}`,
  );
  return data.context;
}

export type ContactListResult = {
  contacts: ContactPreview[];
  dedup: DedupEntry[];
};

export async function fetchContactList(
  token: string,
  filters: FilterTree,
  opts?: { presetId?: number; limit?: number },
): Promise<ContactListResult> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "list_contacts",
      filters,
      preset_id: opts?.presetId,
      limit: opts?.limit ?? 200,
    }),
  });
}

export async function createSession(
  token: string,
  name: string,
  contacts: ContactPreview[],
  scheduledFor?: string,
  sessionType?: string,
): Promise<{ session: SessionDetail; contacts: SessionContact[] }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "create_session",
      name,
      contacts,
      ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
      ...(sessionType ? { session_type: sessionType } : {}),
    }),
  });
}

export async function updateSession(
  token: string,
  sessionId: number,
  patch: { name?: string; scheduled_for?: string | null; session_type?: string },
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
): Promise<{ needs_event?: boolean }> {
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
    }),
  });
}

export async function skipContact(
  token: string,
  sessionId: number,
  contactId: number,
): Promise<void> {
  await apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "skip_contact",
      session_id: sessionId,
      contact_id: contactId,
    }),
  });
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
