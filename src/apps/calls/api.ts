import type {
  CallOutcome,
  CallStats,
  CallsListFilters,
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

export async function fetchContactList(
  token: string,
  filters: CallsListFilters,
): Promise<ContactPreview[]> {
  const data = await apiFetch<{ contacts: ContactPreview[] }>(token, "/api/calls-list", {
    method: "POST",
    body: JSON.stringify({ filters }),
  });
  return data.contacts;
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
  outcome: CallOutcome,
  comments: string,
): Promise<void> {
  await apiFetch(token, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      action: "log_call",
      session_id: sessionId,
      contact_id: contactId,
      outcome,
      comments,
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
