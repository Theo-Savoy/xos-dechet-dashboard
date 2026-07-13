import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockVerifyJWT,
  mockGetServiceClient,
  mockGetProfile,
  mockLoadWorkspace,
} = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
  mockGetServiceClient: vi.fn(),
  mockGetProfile: vi.fn(),
  mockLoadWorkspace: vi.fn(),
}));

vi.mock('../../_auth.js', () => ({ verifyJWT: mockVerifyJWT }));
vi.mock('../../_calls/http.js', () => ({
  getServiceClient: mockGetServiceClient,
}));
vi.mock('../../_calls/profileCache.js', () => ({ getProfile: mockGetProfile }));
vi.mock('../opportunities/read.js', () => ({
  loadOpportunityWorkspace: mockLoadWorkspace,
}));

import {
  authorizeContext,
  capabilitiesForRole,
  scopeOpportunityItems,
} from './authorization.js';
import { POST } from '../../cleaner.js';

const commandId = '006000000000001';

function request(body) {
  return new Request('https://app.test/api/cleaner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeSupabase() {
  const chain = {
    insert() {
      return chain;
    },
    select() {
      return chain;
    },
    single: async () => ({
      data: { id: 1 },
      error: null,
    }),
  };
  return { from: () => chain };
}

describe('Cleaner authorization', () => {
  beforeEach(() => {
    mockVerifyJWT.mockReset();
    mockGetServiceClient.mockReset();
    mockGetProfile.mockReset();
    mockLoadWorkspace.mockReset();
    mockVerifyJWT.mockResolvedValue({ id: 'user-1', email: 'commercial@test' });
    mockGetServiceClient.mockReturnValue(makeSupabase());
    mockGetProfile.mockResolvedValue({
      fullName: 'Commercial',
      sfUserId: '005000000000001',
      role: 'commercial',
    });
    mockLoadWorkspace.mockResolvedValue({
      items: [
        {
          id: commandId,
          owner_id: '005000000000001',
          anomalies: [{ ruleId: 'close_date_overdue_under_3_months' }],
          close_date: '2026-06-01',
          stage: 'Projet qualifié / AO reçu',
          type_vente: 'Catalogue',
          loss_reason: null,
          is_closed: false,
        },
      ],
      nextCursor: null,
    });
  });

  it('exposes own-scope write capabilities for a commercial without reassignment', () => {
    expect(capabilitiesForRole('commercial')).toMatchObject({
      canViewTeam: false,
      canReadOwn: true,
      canReassign: false,
      canBulkEdit: true,
      canBulkClose: true,
      canManageRules: false,
      canApplyRecipes: false,
    });
  });

  it('exposes team write capabilities for managers and admins while limiting rule management to admins', () => {
    expect(capabilitiesForRole('manager')).toMatchObject({
      canViewTeam: true,
      canReadOwn: true,
      canReassign: true,
      canBulkEdit: true,
      canBulkClose: true,
      canManageRules: false,
      canApplyRecipes: true,
    });
    expect(capabilitiesForRole('admin')).toMatchObject({
      canViewTeam: true,
      canReadOwn: true,
      canReassign: true,
      canBulkEdit: true,
      canBulkClose: true,
      canManageRules: true,
      canApplyRecipes: true,
    });
  });

  it('rejects a commercial reassignment through the POST command boundary', async () => {
    const response = await POST(
      request({
        action: 'preview',
        ids: [commandId],
        changes: { owner_id: '005000000000003' },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'forbidden',
    });
  });

  it('rejects a mixed commercial-owned and cross-tenant selection before changing records', async () => {
    mockLoadWorkspace.mockResolvedValue({
      items: [
        {
          id: commandId,
          owner_id: '005000000000001',
          anomalies: [{ ruleId: 'close_date_overdue_under_3_months' }],
          close_date: '2026-06-01',
          stage: 'Projet qualifié / AO reçu',
          type_vente: 'Catalogue',
          loss_reason: null,
          is_closed: false,
        },
        {
          id: '006000000000002',
          owner_id: '005000000000009',
          anomalies: [{ ruleId: 'close_date_overdue_under_3_months' }],
          close_date: '2026-06-01',
          stage: 'Projet qualifié / AO reçu',
          type_vente: 'Catalogue',
          loss_reason: null,
          is_closed: false,
        },
      ],
      nextCursor: null,
    });

    const response = await POST(
      request({
        action: 'preview',
        ids: [commandId, '006000000000002'],
        changes: { close_date: '2026-08-01' },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/^(forbidden|out_of_scope)$/),
    });
  });

  it('rejects an absent user and an unknown role with structured statuses', () => {
    expect(authorizeContext({ role: 'commercial' })).toMatchObject({
      ok: false,
      status: 401,
      error: 'unauthorized',
    });
    expect(
      authorizeContext({ user: { id: 'u' }, role: 'director' }),
    ).toMatchObject({
      ok: false,
      status: 403,
      error: 'forbidden',
    });
  });

  it('cannot widen commercial scope with query parameters', () => {
    const context = {
      user: { id: 'u' },
      role: 'commercial',
      sfUserId: 'sf-self',
      teamSfUserIds: ['sf-self', 'sf-other'],
    };
    const items = [
      { id: 'one', owner_id: 'sf-self' },
      { id: 'two', owner_id: 'sf-other' },
    ];

    expect(
      scopeOpportunityItems(items, context, { ownerId: 'sf-other' }),
    ).toEqual([items[0]]);
  });

  it('uses the explicit team owner ids for manager scope', () => {
    expect(
      scopeOpportunityItems(
        [
          { id: 'one', owner_id: 'sf-a' },
          { id: 'two', owner_id: 'sf-b' },
          { id: 'three', owner_id: 'sf-outside' },
        ],
        {
          user: { id: 'manager' },
          role: 'manager',
          teamSfUserIds: ['sf-a', 'sf-b'],
        },
      ).map((item) => item.id),
    ).toEqual(['one', 'two']);
  });
});
