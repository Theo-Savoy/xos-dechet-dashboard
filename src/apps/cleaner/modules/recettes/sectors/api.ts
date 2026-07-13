export type SectorSummary = {
  id: string;
  label: string;
  accountCount: number;
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
