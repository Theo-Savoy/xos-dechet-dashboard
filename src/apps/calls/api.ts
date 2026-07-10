import type { CallTargetPreset, DedupEntry, FilterTree, ResultatCall } from "../../crm";
import type {
  CallStats,
  ContactPreview,
  SessionContact,
  SessionDetail,
  SessionSummary,
} from "./types";

export class CallsApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
    this.name = "CallsApiError";
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
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
    const code = await parseError(res);
    throw new CallsApiError(res.status, code);
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

export type ContactListResult = {
  contacts: ContactPreview[];
  dedup: DedupEntry[];
};

export async function fetchContactList(
  token: string,
  filters: FilterTree,
  opts?: { presetId?: number; limit?: number },
): Promise<ContactListResult> {
  return apiFetch(token, "/api/calls-list", {
    method: "POST",
    body: JSON.stringify({
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
): Promise<{ session: SessionDetail; contacts: SessionContact[] }> {
  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({ action: "create_session", name, contacts }),
  });
}

export async function logCall(
  token: string,
  sessionId: number,
  contactId: number,
  resultat: ResultatCall,
  comments: string,
  durationSec: number | null,
): Promise<{ needs_event?: boolean }> {
  if (durationSec !== null && (!Number.isInteger(durationSec) || durationSec < 0)) {
    throw new Error("La durée doit être un entier positif ou nul.");
  }

  return apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "log_call",
      session_id: sessionId,
      contact_id: contactId,
      resultat,
      comments,
      ...(durationSec === null ? {} : { duration_sec: durationSec }),
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
  const data = await apiFetch<{ presets: CallTargetPreset[] }>(token, "/api/presets");
  return data.presets;
}

export async function createPreset(
  token: string,
  name: string,
  filters: FilterTree,
  shared: boolean,
): Promise<CallTargetPreset> {
  const data = await apiFetch<{ preset: CallTargetPreset }>(token, "/api/presets", {
    method: "POST",
    body: JSON.stringify({ name, filters, shared }),
  });
  return data.preset;
}

export async function deletePreset(token: string, id: number): Promise<void> {
  await apiFetch(token, `/api/presets?id=${id}`, { method: "DELETE" });
}
