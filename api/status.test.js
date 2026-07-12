import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockVerifyJWT,
  mockFetchSFToken,
  mockGetProfile,
  mockInvalidateProfileCache,
} = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
  mockFetchSFToken: vi.fn(),
  mockGetProfile: vi.fn(),
  mockInvalidateProfileCache: vi.fn(),
}));

vi.mock('./_auth.js', () => ({
  respond: (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  verifyJWT: mockVerifyJWT,
}));
vi.mock('./_crm/salesforce.js', () => ({ fetchSFToken: mockFetchSFToken }));
vi.mock('./_calls/profileCache.js', () => ({
  getProfile: mockGetProfile,
  invalidateProfileCache: mockInvalidateProfileCache,
}));

const mockDb = vi.fn();
const chain = {
  then(onFulfilled, onRejected) {
    return Promise.resolve(mockDb()).then(onFulfilled, onRejected);
  },
  select() {
    return this;
  },
  eq() {
    return this;
  },
  order() {
    return this;
  },
  upsert() {
    return this;
  },
  update() {
    return this;
  },
  delete() {
    return this;
  },
};
const mockFrom = vi.fn(() => chain);
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mockFrom }),
}));

import { GET, POST } from './status.js';
import { DEFAULT_CLEANER_SETTINGS } from './_cleaner/core/settings.js';

function request(method, body) {
  return new Request('https://xos.test/api/status', {
    method,
    headers: {
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockDb.mockReset();
  mockFrom.mockClear();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
  mockVerifyJWT.mockResolvedValue({
    id: 'user-1',
    email: 'ada@xos-learning.fr',
  });
  mockGetProfile.mockResolvedValue({
    fullName: 'Ada Lovelace',
    sfUserId: '005xx',
    role: 'manager',
  });
  mockFetchSFToken.mockResolvedValue({ accessToken: 'sf-token' });
  mockDb.mockResolvedValue({ data: [], error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (String(url).includes('/limits')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              DailyApiRequests: { Max: 15000, Remaining: 14900 },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ version: 'history/2026-07-11.json' }), {
          status: 200,
        }),
      );
    }),
  );
});

describe('GET /api/status', () => {
  it('returns 401 without a JWT', async () => {
    mockVerifyJWT.mockResolvedValue(null);
    expect((await GET(request('GET'))).status).toBe(401);
  });

  it('returns the authenticated profile, Salesforce limits and native deployment freshness', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: 'manager',
      profile: {
        email: 'ada@xos-learning.fr',
        fullName: 'Ada Lovelace',
        sfUserId: '005xx',
        sfLinked: false,
      },
      salesforce: {
        connected: true,
        userLinked: false,
        dailyApiRequests: { max: 15000, remaining: 14900 },
      },
      cache: { cleaner: { version: 'native' } },
      version: 'abc123',
      capabilities: { manageSettings: true, manageRoles: false },
      settings: [],
      profiles: [],
    });
  });

  it('returns cleaner_v2 defaults, effective value and normalization warnings to managers', async () => {
    mockDb.mockResolvedValue({
      data: [
        {
          id: 3,
          key: 'cleaner_v2',
          value: { ...DEFAULT_CLEANER_SETTINGS, amountImplausibleMax: 250 },
        },
      ],
      error: null,
    });
    const response = await GET(request('GET'));
    await expect(response.json()).resolves.toMatchObject({
      cleanerSettings: {
        key: 'cleaner_v2',
        defaults: DEFAULT_CLEANER_SETTINGS,
        effective: { ...DEFAULT_CLEANER_SETTINGS, amountImplausibleMax: 250 },
        warnings: [],
      },
    });
  });

  it('returns exact cleaner_v2 defaults when no value is stored', async () => {
    mockDb.mockResolvedValue({ data: [], error: null });
    const response = await GET(request('GET'));
    await expect(response.json()).resolves.toMatchObject({
      cleanerSettings: {
        defaults: DEFAULT_CLEANER_SETTINGS,
        effective: DEFAULT_CLEANER_SETTINGS,
        warnings: [],
      },
    });
  });

  it('does not expose a cleaner history setting to a commercial', async () => {
    mockGetProfile.mockResolvedValue({
      fullName: 'Ada',
      sfUserId: 'sf-self',
      role: 'commercial',
    });
    const response = await GET(request('GET'));
    await expect(response.json()).resolves.not.toHaveProperty(
      'settings.cleaner_v2',
    );
  });

  it('reports disconnected when the user OAuth token does not work', async () => {
    mockGetProfile.mockResolvedValue({
      fullName: 'Ada Lovelace',
      sfUserId: '005xx',
      role: 'manager',
      userLinked: true,
      sfAuthConnectedAt: '2026-07-01T00:00:00Z',
    });
    mockFetchSFToken.mockResolvedValue({ error: 'sf_auth_error' });

    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      salesforce: {
        connected: false,
        userLinked: true,
        dailyApiRequests: null,
      },
    });
  });
});

describe('POST /api/status', () => {
  it('refuses settings updates from a commercial', async () => {
    mockGetProfile.mockResolvedValue({
      fullName: 'Ada',
      sfUserId: null,
      role: 'commercial',
    });
    const response = await POST(
      request('POST', {
        action: 'update_settings',
        operation: 'upsert',
        key: 'cleaner_late_days',
        value: 14,
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('forbids a commercial from writing cleaner_v2', async () => {
    mockGetProfile.mockResolvedValue({
      fullName: 'Ada',
      sfUserId: 'sf-self',
      role: 'commercial',
    });
    const response = await POST(
      request('POST', {
        action: 'update_settings',
        operation: 'upsert',
        key: 'cleaner_v2',
        value: DEFAULT_CLEANER_SETTINGS,
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'forbidden',
    });
  });

  it('allows a manager to upsert a setting', async () => {
    mockDb.mockResolvedValue({
      data: { id: 1, key: 'cleaner_v2', value: DEFAULT_CLEANER_SETTINGS },
      error: null,
    });
    const response = await POST(
      request('POST', {
        action: 'update_settings',
        operation: 'upsert',
        key: 'cleaner_v2',
        value: DEFAULT_CLEANER_SETTINGS,
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      setting: { key: 'cleaner_v2', value: DEFAULT_CLEANER_SETTINGS },
    });
  });

  it.each([
    ['cleaner_late_days', 14, 'legacy_setting_rejected'],
    [
      'cleaner_v2',
      { ...DEFAULT_CLEANER_SETTINGS, unknown: 1 },
      'invalid_cleaner_v2',
    ],
    [
      'cleaner_v2',
      { ...DEFAULT_CLEANER_SETTINGS, amountImplausibleMax: 0 },
      'invalid_cleaner_v2',
    ],
    [
      'cleaner_v2',
      {
        ...DEFAULT_CLEANER_SETTINGS,
        score: { ...DEFAULT_CLEANER_SETTINGS.score, overdueCap: Number.NaN },
      },
      'invalid_cleaner_v2',
    ],
  ])('rejects invalid cleaner settings (%s)', async (key, value, error) => {
    const response = await POST(
      request('POST', {
        action: 'update_settings',
        operation: 'upsert',
        key,
        value,
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error });
  });

  it('allows only admins to set roles and never their own role', async () => {
    const managerResponse = await POST(
      request('POST', {
        action: 'set_role',
        profileId: 'user-2',
        role: 'commercial',
      }),
    );
    expect(managerResponse.status).toBe(403);

    mockGetProfile.mockResolvedValue({
      fullName: 'Admin',
      sfUserId: null,
      role: 'admin',
    });
    const selfResponse = await POST(
      request('POST', {
        action: 'set_role',
        profileId: 'user-1',
        role: 'commercial',
      }),
    );
    expect(selfResponse.status).toBe(400);
    await expect(selfResponse.json()).resolves.toEqual({
      error: 'admin_cannot_demote_self',
    });

    mockDb.mockResolvedValue({
      data: { id: 'user-2', role: 'manager' },
      error: null,
    });
    const adminResponse = await POST(
      request('POST', {
        action: 'set_role',
        profileId: 'user-2',
        role: 'manager',
      }),
    );
    expect(adminResponse.status).toBe(200);
  });
});
