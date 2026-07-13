export type SectorSampleAccount = {
  id: string;
  name: string | null;
  recordUrl: string;
};

export type SectorSummary = {
  id: string;
  label: string;
  accountCount: number;
  sampleAccounts?: SectorSampleAccount[];
};

export type SectorRecipeState = {
  obsoleteSectors: SectorSummary[];
  activeSectors: SectorSummary[];
  suggestedMappings: Record<string, string>;
  accountsPerSector: Record<string, string[]>;
  capabilities: { canApplyMerge: boolean };
};

export type SectorMergePreview = {
  obsoleteId: string;
  activeId: string;
  obsoleteLabel: string;
  activeLabel: string;
  accountIds: string[];
  accounts: Array<{ id: string; name: string | null; ownerId: string | null }>;
  accountCount: number;
};

export type SectorMergeResult = {
  updated: number;
  failed: number;
  accountIds: string[];
};

export type SectorJobStatus = {
  ok: true;
  jobId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  total: number;
  processed: number;
  errors: Array<{ obsoleteId: string; message: string }>;
  results: Array<SectorMergePreview | SectorMergeResult>;
  error?: string | null;
};

export type SectorJournalEntry = {
  id: number | string;
  kind: string;
  obsoleteId: string | null;
  activeId: string | null;
  obsoleteLabel: string | null;
  activeLabel: string | null;
  accountCount: number;
  actorId: string;
  actorLabel: string;
  createdAt: string;
};

class SectorRecipeApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'SectorRecipeApiError';
  }
}

function messageFrom(body: unknown, status: number) {
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return `Le service Recettes a répondu ${status}.`;
}

async function request<T>(
  accessToken: string | undefined,
  init: RequestInit & { path: string },
): Promise<T> {
  if (!accessToken)
    throw new SectorRecipeApiError(
      'Session expirée : authentification requise.',
      401,
    );
  let response: Response;
  try {
    response = await fetch(init.path, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new SectorRecipeApiError(
      error instanceof Error
        ? `Impossible de joindre le service Recettes. ${error.message}`
        : 'Impossible de joindre le service Recettes.',
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SectorRecipeApiError(
      'La réponse du service Recettes est invalide.',
      response.status,
    );
  }
  if (!response.ok)
    throw new SectorRecipeApiError(
      messageFrom(body, response.status),
      response.status,
    );
  return body as T;
}

export async function fetchSectorRecipe(
  accessToken: string | undefined,
): Promise<SectorRecipeState> {
  const body = await request<SectorRecipeState>(accessToken, {
    method: 'GET',
    path: '/api/cleaner?module=recettes&resource=sectors&limit=50',
  });
  if (
    !Array.isArray(body?.obsoleteSectors) ||
    !Array.isArray(body?.activeSectors) ||
    !body?.suggestedMappings ||
    !body?.accountsPerSector
  )
    throw new SectorRecipeApiError(
      'La réponse de la recette Secteurs est invalide.',
    );
  return body;
}

async function postMerge<T>(
  accessToken: string | undefined,
  action: 'preview_merge' | 'apply_merge',
  obsoleteId: string,
  activeId: string,
): Promise<T> {
  return request<T>(accessToken, {
    method: 'POST',
    path: '/api/cleaner',
    body: JSON.stringify({
      module: 'recettes',
      resource: 'sectors',
      action,
      obsoleteId,
      activeId,
    }),
  });
}

export function previewSectorMerge(
  accessToken: string | undefined,
  obsoleteId: string,
  activeId: string,
) {
  return postMerge<SectorMergePreview>(
    accessToken,
    'preview_merge',
    obsoleteId,
    activeId,
  );
}

export function applySectorMerge(
  accessToken: string | undefined,
  obsoleteId: string,
  activeId: string,
  expectedAccountIds: string[],
) {
  return request<SectorMergeResult>(accessToken, {
    method: 'POST',
    path: '/api/cleaner',
    body: JSON.stringify({
      module: 'recettes',
      resource: 'sectors',
      action: 'apply_merge',
      obsoleteId,
      activeId,
      expectedAccountIds,
    }),
  });
}

type SectorMapping = Record<string, string>;

async function startBulk(
  accessToken: string | undefined,
  action: 'bulk_preview' | 'bulk_apply',
  mapping: SectorMapping,
) {
  return request<{ ok: true; jobId: string }>(accessToken, {
    method: 'POST',
    path: '/api/cleaner',
    body: JSON.stringify({
      module: 'recettes',
      resource: 'sectors',
      action,
      obsoleteIds: Object.keys(mapping),
      mapping,
    }),
  });
}

export function bulkPreviewSectors(
  accessToken: string | undefined,
  mapping: SectorMapping,
) {
  return startBulk(accessToken, 'bulk_preview', mapping);
}

export function bulkApplySectors(
  accessToken: string | undefined,
  mapping: SectorMapping,
) {
  return startBulk(accessToken, 'bulk_apply', mapping);
}

export function getSectorJobStatus(
  accessToken: string | undefined,
  jobId: string,
) {
  return request<SectorJobStatus>(accessToken, {
    method: 'GET',
    path: `/api/cleaner?module=recettes&resource=sectors&action=status&jobId=${encodeURIComponent(jobId)}`,
  });
}

export async function undoSectorMergeApi(
  accessToken: string | undefined,
  journalId: number | string,
) {
  return request<{ restored: number; failed: number }>(accessToken, {
    method: 'POST',
    path: '/api/cleaner',
    body: JSON.stringify({
      module: 'recettes',
      resource: 'sectors',
      action: 'undo_merge',
      journalId,
    }),
  });
}

export async function pollJobStatus(
  accessToken: string | undefined,
  jobId: string,
  onProgress?: (status: SectorJobStatus) => void,
) {
  for (;;) {
    const status = await getSectorJobStatus(accessToken, jobId);
    onProgress?.(status);
    if (status.status === 'done' || status.status === 'error') return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export async function fetchSectorJournal(
  accessToken: string | undefined,
  limit = 50,
) {
  const body = await request<{ ok: true; items: SectorJournalEntry[] }>(
    accessToken,
    {
      method: 'GET',
      path: `/api/cleaner?module=recettes&resource=sectors&action=journal&limit=${limit}`,
    },
  );
  return body.items;
}
