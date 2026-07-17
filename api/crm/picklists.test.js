import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyJWT, mockFetchSFToken, mockGetServiceClient } = vi.hoisted(
  () => ({
    mockVerifyJWT: vi.fn(),
    mockFetchSFToken: vi.fn(),
    mockGetServiceClient: vi.fn(),
  }),
);

vi.mock('../_auth.js', () => ({
  verifyJWT: mockVerifyJWT,
  respond: (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

vi.mock('../_crm/salesforce.js', () => ({
  fetchSFToken: mockFetchSFToken,
}));

vi.mock('../_calls/http.js', () => ({
  getServiceClient: mockGetServiceClient,
}));

import { __resetPicklistCache, GET } from './picklists.js';

const FIELD = 'Raison_de_perte_V2__c';

function request(field) {
  const selectedField = arguments.length === 0 ? FIELD : field;
  const query =
    selectedField === undefined
      ? ''
      : `?field=${encodeURIComponent(selectedField)}`;
  return new Request(`https://xos.test/api/crm/picklists${query}`, {
    headers: { Authorization: 'Bearer token' },
  });
}

function describeResponse() {
  return {
    fields: [
      {
        name: FIELD,
        controllerName: 'StageName',
        picklistValues: [
          {
            label: 'Budget insuffisant',
            value: 'Budget insuffisant',
            active: true,
            defaultValue: false,
          },
          {
            label: 'Priorité différente',
            value: 'Priorité différente',
            active: true,
            defaultValue: true,
          },
          {
            label: 'Ancienne valeur',
            value: 'Ancienne valeur',
            active: false,
            defaultValue: false,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-18T08:30:00.000Z'));
  vi.clearAllMocks();
  __resetPicklistCache();
  mockVerifyJWT.mockResolvedValue({ id: 'user-1' });
  mockGetServiceClient.mockReturnValue({ from: vi.fn() });
  mockFetchSFToken.mockResolvedValue({ accessToken: 'sf-token' });
  vi.stubEnv('SF_INSTANCE_URL', 'https://example.my.salesforce.com');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(describeResponse()), { status: 200 }),
    ),
  );
});

describe('GET /api/crm/picklists', () => {
  it('fetches and parses active values from the Salesforce describe response on a cache miss', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      field: FIELD,
      values: [
        { label: 'Budget insuffisant', active: true, default: false },
        { label: 'Priorité différente', active: true, default: true },
      ],
      controllerName: 'StageName',
      cachedAt: '2026-07-18T08:30:00.000Z',
    });
    expect(mockFetchSFToken).toHaveBeenCalledWith({
      client: mockGetServiceClient.mock.results[0].value,
      userId: 'user-1',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.my.salesforce.com/services/data/v67.0/sobjects/Opportunity/describe',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sf-token' },
      }),
    );
  });

  it('returns the one-hour server cache without refetching Salesforce', async () => {
    const first = await GET(request());
    vi.setSystemTime(new Date('2026-07-18T09:29:59.000Z'));
    const second = await GET(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockFetchSFToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(second.json()).resolves.toMatchObject({
      field: FIELD,
      cachedAt: '2026-07-18T08:30:00.000Z',
    });
  });

  it('returns 401 without a valid JWT', async () => {
    mockVerifyJWT.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(mockFetchSFToken).not.toHaveBeenCalled();
  });

  it('returns 400 when field is missing', async () => {
    const response = await GET(request(undefined));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'missing_field' });
    expect(mockFetchSFToken).not.toHaveBeenCalled();
  });

  it('returns 400 when field contains special characters', async () => {
    const response = await GET(request('Raison_de_perte_V2__c;DROP'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_field' });
    expect(mockFetchSFToken).not.toHaveBeenCalled();
  });
});
