import { apiFetch, ApiError } from '../../../../lib/apiClient';
import type { CleanerCapabilities } from '../../contracts';
import type { OpportunityDiagnostic } from './types';

export type OpportunityWorkspaceItem = OpportunityDiagnostic & {
  loss_reason?: string | null;
  primary_rule_id?: string | null;
  salesforce_url?: string | null;
  history?: Array<Record<string, unknown>>;
};

export type OpportunityWorkspaceResponse = {
  items: OpportunityWorkspaceItem[];
  total: number;
  nextCursor?: string | null;
  capabilities?: CleanerCapabilities;
  metadata?: { fetchedAt?: string | null; [key: string]: unknown };
};

export type OpportunityAnalyticsResponse = {
  analytics: Record<string, unknown>;
  workspace?: OpportunityWorkspaceResponse;
};

export type OpportunityHistoryItem = Record<string, unknown> & {
  id?: string | number;
  actor?: string | null;
  actor_label?: string | null;
  at?: string | null;
  module_id?: string | null;
  action_type?: string | null;
  source?: string | null;
  source_id?: string | null;
  command_id?: string | number | null;
  idempotency_key?: string | null;
  replayed?: boolean;
  cleaner_action_targets?: Array<Record<string, unknown>>;
  result?: Record<string, unknown>;
};

export type OpportunityHistoryResponse = {
  items: OpportunityHistoryItem[];
  nextCursor?: string | null;
  previousCursor?: string | null;
};

export type OpportunityCommandChanges = Partial<{
  owner_id: string;
  close_date: string;
  stage: string;
  type_vente: string;
  loss_reason: string;
}>;

export type OpportunityCommandEligible = {
  id: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type OpportunityCommandPreview = {
  previewId: string;
  fingerprint: string;
  expiresAt: string;
  changes: OpportunityCommandChanges;
  eligible: OpportunityCommandEligible[];
  excluded: Array<{ id: string; reason: string }>;
};

export type OpportunityCommandResult = {
  previewId: string;
  fingerprint: string;
  idempotencyKey: string;
  commandId: string | number;
  status: 'succeeded' | 'failed' | 'partial';
  updated: number;
  failed: number;
  results: Array<{
    id: string;
    success: boolean;
    error: string | null;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }>;
  auditError?: string;
  replayed?: boolean;
};

class OpportunityApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unauthorized'
      | 'timeout'
      | 'http_error'
      | 'invalid_response'
      | 'network_error'
      | 'schema_cache',
    public readonly status: number | null = null,
    public readonly details: unknown = undefined,
  ) {
    super(message);
    this.name = 'OpportunityApiError';
  }
}

function bodyMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    if (typeof (body as { message?: unknown }).message === 'string')
      return (body as { message: string }).message;
    if (typeof (body as { error?: unknown }).error === 'string')
      return (body as { error: string }).error;
  }
  return `Le service Opportunités a répondu ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsePreview(
  body: unknown,
  status: number,
): OpportunityCommandPreview {
  if (
    !isRecord(body) ||
    typeof body.previewId !== 'string' ||
    typeof body.fingerprint !== 'string' ||
    typeof body.expiresAt !== 'string' ||
    !isRecord(body.changes) ||
    !Array.isArray(body.eligible) ||
    !Array.isArray(body.excluded)
  ) {
    throw new OpportunityApiError(
      'La réponse du preview Opportunités est invalide.',
      'invalid_response',
      status,
      body,
    );
  }
  return body as unknown as OpportunityCommandPreview;
}

function parseResult(body: unknown, status: number): OpportunityCommandResult {
  if (
    !isRecord(body) ||
    typeof body.previewId !== 'string' ||
    typeof body.fingerprint !== 'string' ||
    typeof body.idempotencyKey !== 'string' ||
    !['succeeded', 'failed', 'partial'].includes(String(body.status)) ||
    !Array.isArray(body.results)
  ) {
    throw new OpportunityApiError(
      "La réponse de l'exécution Opportunités est invalide.",
      'invalid_response',
      status,
      body,
    );
  }
  return body as unknown as OpportunityCommandResult;
}

async function postOpportunityCommand<T>(
  accessToken: string | undefined,
  payload: Record<string, unknown>,
  parse: (body: unknown, status: number) => T,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  if (!accessToken)
    throw new OpportunityApiError(
      'Session expirée : authentification requise.',
      'unauthorized',
      401,
    );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10000,
  );

  try {
    let body: unknown;
    try {
      body = await apiFetch<unknown>(accessToken, '/api/cleaner', {
        method: 'POST',
        body: JSON.stringify({ module: 'opportunities', ...payload }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw new OpportunityApiError(
          bodyMessage(error.body, error.status),
          error.status === 401 ? 'unauthorized' : 'http_error',
          error.status,
          error.body,
        );
      }
      if (controller.signal.aborted)
        throw new OpportunityApiError(
          "Le service Opportunités a dépassé le délai d'attente.",
          'timeout',
          504,
        );
      const detail =
        error instanceof Error && error.message ? ` ${error.message}` : '';
      throw new OpportunityApiError(
        `Impossible de joindre le service Opportunités.${detail}`,
        'network_error',
        null,
      );
    }
    return parse(body, 200);
  } finally {
    clearTimeout(timeout);
  }
}

export function generateIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function')
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function fetchOpportunityWorkspace(
  accessToken: string | undefined,
  options: { timeoutMs?: number } = {},
): Promise<OpportunityWorkspaceResponse> {
  if (!accessToken)
    throw new OpportunityApiError(
      'Session expirée : authentification requise.',
      'unauthorized',
      401,
    );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10000,
  );

  try {
    let body: unknown;
    try {
      body = await apiFetch<unknown>(
        accessToken,
        '/api/cleaner?module=opportunities&resource=workspace&limit=200',
        { signal: controller.signal },
      );
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401)
          throw new OpportunityApiError(
            'Session expirée : reconnectez-vous pour charger les opportunités.',
            'unauthorized',
            401,
          );
        throw new OpportunityApiError(
          bodyMessage(error.body, error.status),
          'http_error',
          error.status,
        );
      }
      if (controller.signal.aborted)
        throw new OpportunityApiError(
          "Le service Opportunités a dépassé le délai d'attente.",
          'timeout',
          504,
        );
      const detail =
        error instanceof Error && error.message ? ` ${error.message}` : '';
      throw new OpportunityApiError(
        `Impossible de joindre le service Opportunités.${detail}`,
        'network_error',
        null,
      );
    }
    if (
      !body ||
      typeof body !== 'object' ||
      !Array.isArray((body as OpportunityWorkspaceResponse).items)
    ) {
      throw new OpportunityApiError(
        "La réponse du service Opportunités ne contient pas de tableau d'items.",
        'invalid_response',
        200,
      );
    }
    return body as OpportunityWorkspaceResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpportunityGet<T>(
  accessToken: string | undefined,
  path: string,
  parse: (body: unknown, status: number) => T,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  if (!accessToken)
    throw new OpportunityApiError(
      'Session expirée : authentification requise.',
      'unauthorized',
      401,
    );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10000,
  );
  try {
    let body: unknown;
    try {
      body = await apiFetch<unknown>(accessToken, path, { signal: controller.signal });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401)
          throw new OpportunityApiError(
            bodyMessage(error.body, error.status),
            'unauthorized',
            401,
            error.body,
          );
        const code =
          isRecord(error.body) &&
          (error.body.error === 'schema_cache' || error.body.code === 'schema_cache')
            ? 'schema_cache'
            : 'http_error';
        throw new OpportunityApiError(
          bodyMessage(error.body, error.status),
          code,
          error.status,
          error.body,
        );
      }
      if (controller.signal.aborted)
        throw new OpportunityApiError(
          "Le service Opportunités a dépassé le délai d'attente.",
          'timeout',
          504,
        );
      const detail =
        error instanceof Error && error.message ? ` ${error.message}` : '';
      throw new OpportunityApiError(
        `Impossible de joindre le service Opportunités.${detail}`,
        'network_error',
        null,
      );
    }
    return parse(body, 200);
  } finally {
    clearTimeout(timeout);
  }
}

function parseAnalytics(
  body: unknown,
  status: number,
): OpportunityAnalyticsResponse {
  if (!isRecord(body) || !isRecord(body.analytics)) {
    throw new OpportunityApiError(
      'La réponse analytics Opportunités est invalide.',
      'invalid_response',
      status,
      body,
    );
  }
  return body as OpportunityAnalyticsResponse;
}

function parseHistory(
  body: unknown,
  status: number,
): OpportunityHistoryResponse {
  if (
    !isRecord(body) ||
    !Array.isArray(body.items) ||
    (body.nextCursor !== undefined &&
      body.nextCursor !== null &&
      typeof body.nextCursor !== 'string')
  ) {
    throw new OpportunityApiError(
      'La réponse historique Opportunités est invalide.',
      'invalid_response',
      status,
      body,
    );
  }
  return body as OpportunityHistoryResponse;
}

export function fetchOpportunityAnalytics(
  accessToken: string | undefined,
  options: { period?: string; timeoutMs?: number } = {},
): Promise<OpportunityAnalyticsResponse> {
  const params = new URLSearchParams({
    module: 'opportunities',
    resource: 'analytics',
  });
  if (options.period) params.set('period', options.period);
  return fetchOpportunityGet(
    accessToken,
    `/api/cleaner?${params.toString()}`,
    parseAnalytics,
    options,
  );
}

export function fetchOpportunityHistory(
  accessToken: string | undefined,
  options: {
    cursor?: string | null;
    page?: number;
    limit?: number;
    timeoutMs?: number;
  } = {},
): Promise<OpportunityHistoryResponse> {
  const params = new URLSearchParams({
    module: 'opportunities',
    resource: 'history',
    limit: String(options.limit ?? 25),
  });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.page && options.page > 1)
    params.set('page', String(options.page));
  return fetchOpportunityGet(
    accessToken,
    `/api/cleaner?${params.toString()}`,
    parseHistory,
    options,
  );
}

export function previewOpportunityCommand(
  accessToken: string | undefined,
  command: { ids: string[]; changes: OpportunityCommandChanges },
  options: { timeoutMs?: number } = {},
): Promise<OpportunityCommandPreview> {
  return postOpportunityCommand(
    accessToken,
    { action: 'preview', ids: command.ids, changes: command.changes },
    parsePreview,
    options,
  );
}

export function executeOpportunityCommand(
  accessToken: string | undefined,
  command: { previewId: string; fingerprint: string; idempotencyKey: string },
  options: { timeoutMs?: number } = {},
): Promise<OpportunityCommandResult> {
  return postOpportunityCommand(
    accessToken,
    {
      action: 'execute',
      previewId: command.previewId,
      fingerprint: command.fingerprint,
      idempotencyKey: command.idempotencyKey,
    },
    parseResult,
    options,
  );
}
