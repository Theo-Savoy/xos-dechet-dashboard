import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockVerifyJWT,
  mockGetServiceClient,
  mockGetProfile,
  mockLoadWorkspace,
  mockComputeAnalytics,
  mockListHistory,
  mockLoadSectorRecipe,
  mockPreviewSectorMerge,
  mockApplySectorMerge,
  mockStartBulkSectorJob,
  mockGetSectorJobStatus,
  mockFetchSectorJournal,
} = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
  mockGetServiceClient: vi.fn(),
  mockGetProfile: vi.fn(),
  mockLoadWorkspace: vi.fn(),
  mockComputeAnalytics: vi.fn(),
  mockListHistory: vi.fn(),
  mockLoadSectorRecipe: vi.fn(),
  mockPreviewSectorMerge: vi.fn(),
  mockApplySectorMerge: vi.fn(),
  mockStartBulkSectorJob: vi.fn(),
  mockGetSectorJobStatus: vi.fn(),
  mockFetchSectorJournal: vi.fn(),
}));

vi.mock('./_auth.js', () => ({ verifyJWT: mockVerifyJWT }));
vi.mock('./_calls/http.js', () => ({ getServiceClient: mockGetServiceClient }));
vi.mock('./_calls/profileCache.js', () => ({ getProfile: mockGetProfile }));
vi.mock('./_cleaner/opportunities/read.js', () => ({
  loadOpportunityWorkspace: mockLoadWorkspace,
}));
vi.mock('./_cleaner/opportunities/analytics.js', () => ({
  computeOpportunityAnalytics: mockComputeAnalytics,
}));
vi.mock('./_cleaner/core/audit.js', () => ({
  listCleanerHistory: mockListHistory,
}));
vi.mock('./_cleaner/recettes/sectors.js', () => ({
  loadSectorRecipe: mockLoadSectorRecipe,
  previewSectorMerge: mockPreviewSectorMerge,
  applySectorMerge: mockApplySectorMerge,
  startBulkSectorJob: mockStartBulkSectorJob,
  getSectorJobStatus: mockGetSectorJobStatus,
  fetchSectorJournal: mockFetchSectorJournal,
}));

import { CleanerError } from './_cleaner/core/errors.js';
import { GET, POST } from './cleaner.js';

function request(query = '', token = 'jwt') {
  return new Request(
    `https://app.test/api/cleaner${query ? `?${query}` : ''}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
}

function postRequest(body, token = 'jwt') {
  return new Request('https://app.test/api/cleaner', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const client = {
  from: () => ({
    select: () => Promise.resolve({ data: [], error: null }),
  }),
};

beforeEach(() => {
  mockVerifyJWT.mockReset();
  mockGetServiceClient.mockReset();
  mockGetProfile.mockReset();
  mockLoadWorkspace.mockReset();
  mockComputeAnalytics.mockReset();
  mockListHistory.mockReset();
  mockLoadSectorRecipe.mockReset();
  mockPreviewSectorMerge.mockReset();
  mockApplySectorMerge.mockReset();
  mockStartBulkSectorJob.mockReset();
  mockGetSectorJobStatus.mockReset();
  mockFetchSectorJournal.mockReset();
  mockStartBulkSectorJob.mockReturnValue({ jobId: 'job-1' });
  mockGetSectorJobStatus.mockReturnValue({ status: 'running', total: 2, processed: 1, errors: [] });
  mockFetchSectorJournal.mockResolvedValue([]);
  mockGetServiceClient.mockReturnValue(client);
  mockVerifyJWT.mockResolvedValue({ id: 'user-1', email: 'ada@example.test' });
  mockGetProfile.mockResolvedValue({
    fullName: 'Ada',
    sfUserId: 'sf-self',
    role: 'commercial',
  });
  mockLoadWorkspace.mockResolvedValue({
    items: [],
    total: 0,
    nextCursor: null,
    filters: {},
    metadata: {},
  });
  mockComputeAnalytics.mockReturnValue({ totals: { totalItems: 0 } });
  mockListHistory.mockResolvedValue({
    data: [],
    error: null,
    nextCursor: null,
  });
  mockLoadSectorRecipe.mockResolvedValue({
    obsoleteSectors: [],
    activeSectors: [],
    suggestedMappings: {},
    accountsPerSector: {},
    capabilities: { canApplyMerge: false },
  });
  mockPreviewSectorMerge.mockResolvedValue({ accountIds: ['001-a'] });
  mockApplySectorMerge.mockResolvedValue({ updated: 1, failed: 0 });
});

describe('GET /api/cleaner', () => {
  it('routes the sectors recipe without loading the Opportunities workspace', async () => {
    const response = await GET(
      request('module=recettes&resource=sectors&limit=50'),
    );

    expect(response.status).toBe(200);
    expect(mockLoadSectorRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'commercial' }),
      expect.objectContaining({
        module: 'recettes',
        resource: 'sectors',
        limit: 50,
      }),
    );
    expect(mockLoadWorkspace).not.toHaveBeenCalled();
  });

  it('returns 401 unauthorized with private no-store headers', async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const response = await GET(
      request('module=opportunities&resource=workspace'),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('rejects an invalid resource before delegation', async () => {
    const response = await GET(request('module=opportunities&resource=write'));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_resource',
    });
    expect(mockLoadWorkspace).not.toHaveBeenCalled();
  });

  it('passes the commercial self scope to the workspace and never trusts an owner query', async () => {
    const response = await GET(
      request('module=opportunities&resource=workspace&limit=2'),
    );
    expect(response.status).toBe(200);
    expect(mockLoadWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'commercial',
        sfUserId: 'sf-self',
        teamSfUserIds: ['sf-self'],
        query: expect.objectContaining({ limit: 2 }),
      }),
    );
  });

  it('includes bulk edit capability in the commercial workspace response', async () => {
    const response = await GET(
      request('module=opportunities&resource=workspace'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        canBulkEdit: true,
        canBulkClose: true,
        canReassign: false,
        canManageRules: false,
      },
    });
  });

  it('loads manager team scope and preserves cursor pagination', async () => {
    mockGetProfile.mockResolvedValue({
      fullName: 'Manager',
      sfUserId: 'sf-manager',
      role: 'manager',
    });
    const teamClient = {
      from: (table) => ({
        select: () =>
          table === 'profiles'
            ? Promise.resolve({
                data: [{ sf_user_id: 'sf-a' }, { sf_user_id: 'sf-b' }],
                error: null,
              })
            : Promise.resolve({ data: [], error: null }),
      }),
    };
    mockGetServiceClient.mockReturnValue(teamClient);
    const response = await GET(
      request(
        'module=opportunities&resource=workspace&cursor=eyJvZmZzZXQiOjJ9',
      ),
    );
    expect(response.status).toBe(200);
    expect(mockLoadWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'manager',
        teamSfUserIds: ['sf-a', 'sf-b'],
        query: expect.objectContaining({ cursor: 'eyJvZmZzZXQiOjJ9' }),
      }),
    );
  });

  it('returns analytics derived from the workspace items and no-store', async () => {
    const workspace = {
      items: [{ id: 'opp-1' }, { id: 'opp-2' }],
      total: 2,
      nextCursor: null,
      filters: {},
      metadata: {},
    };
    mockLoadWorkspace.mockResolvedValue(workspace);
    mockComputeAnalytics.mockReturnValue({
      totals: { totalItems: 2, anomalies: 3 },
    });
    const response = await GET(
      request('module=opportunities&resource=analytics'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mockComputeAnalytics).toHaveBeenCalledWith(
      workspace.items,
      [],
      expect.any(Object),
    );
    await expect(response.json()).resolves.toMatchObject({
      analytics: { totals: { totalItems: 2 } },
      workspace,
    });
  });

  it('delegates history with the role scope', async () => {
    const response = await GET(
      request('module=opportunities&resource=history&limit=5'),
    );
    expect(response.status).toBe(200);
    expect(mockListHistory).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        moduleId: 'opportunities',
        actorId: 'user-1',
        role: 'commercial',
        sfOwnerId: 'sf-self',
        limit: 5,
      }),
    );
  });

  it('maps timeout and structured failures without changing no-store', async () => {
    mockLoadWorkspace.mockRejectedValue(
      new CleanerError('timeout', 'Salesforce timeout', 504),
    );
    const response = await GET(
      request('module=opportunities&resource=workspace'),
    );
    expect(response.status).toBe(504);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ error: 'timeout' });
  });

  it('returns service_unavailable as a retryable 503 when Supabase is unavailable', async () => {
    mockGetServiceClient.mockReturnValue(null);

    const response = await GET(
      request('module=opportunities&resource=workspace'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'service_unavailable',
    });
  });
});

describe('POST /api/cleaner recipes', () => {
  it('routes preview_merge to the read-only recipe action', async () => {
    const response = await POST(
      postRequest({
        module: 'recettes',
        resource: 'sectors',
        action: 'preview_merge',
        obsoleteId: 'finance',
        activeId: 'transports',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPreviewSectorMerge).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'commercial' }),
      expect.objectContaining({
        obsoleteId: 'finance',
        activeId: 'transports',
      }),
    );
    expect(mockApplySectorMerge).not.toHaveBeenCalled();
  });

  it('starts a bulk recipe job and returns its job id', async () => {
    // V17d: only 'bulk_apply' is accepted; the dry-run sweep runs inside
    // the job before any Salesforce write.
    const response = await POST(postRequest({
      module: 'recettes', resource: 'sectors', action: 'bulk_apply',
      obsoleteIds: ['finance'], mapping: { finance: 'banque-finance' },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, jobId: 'job-1' });
    expect(mockStartBulkSectorJob).toHaveBeenCalledOnce();
  });
});

describe('GET /api/cleaner recipe jobs and journal', () => {
  it('returns an owned job status with the ok envelope', async () => {
    const response = await GET(request('module=recettes&resource=sectors&action=status&jobId=job-1'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: 'running', processed: 1 });
    expect(mockGetSectorJobStatus).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'user-1' }) }), 'job-1');
  });

  it('returns the latest journal entries with the ok envelope', async () => {
    mockFetchSectorJournal.mockResolvedValue([{ id: 1, obsoleteId: 'finance' }]);
    const response = await GET(request('module=recettes&resource=sectors&action=journal&limit=50'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, items: [{ id: 1, obsoleteId: 'finance' }] });
  });
});
