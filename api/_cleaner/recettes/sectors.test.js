import { describe, expect, it, vi } from 'vitest';

import {
  applySectorMerge,
  loadSectorRecipe,
  previewSectorMerge,
  sectorId,
} from './sectors.js';

function account(id, industry, ownerId = 'sf-owner') {
  return {
    Id: id,
    Name: `Account ${id}`,
    Industry: industry,
    OwnerId: ownerId,
  };
}

function context(overrides = {}) {
  return {
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'manager@test' },
    profile: { fullName: 'Manager Test' },
    role: 'manager',
    sfUserId: 'sf-owner',
    teamSfUserIds: ['sf-owner'],
    supabase: { from: vi.fn() },
    fetchSFToken: vi.fn().mockResolvedValue({ accessToken: 'sf-token' }),
    searchContacts: vi.fn().mockResolvedValue({
      records: [
        account('001-old', 'Finance'),
        account('001-live', 'Transports'),
      ],
    }),
    updateSObjects: vi.fn().mockResolvedValue({
      records: [{ id: '001-old', success: true, errors: [] }],
    }),
    journalCleanerAction: vi.fn().mockResolvedValue({
      data: { id: 12 },
      error: null,
    }),
    ...overrides,
  };
}

describe('sectors recipe server slice', () => {
  it('allows a manager to read Account sectors and separates obsolete values from the canonical 50', async () => {
    const ctx = context();

    const result = await loadSectorRecipe(ctx, { limit: 50 });

    expect(ctx.searchContacts).toHaveBeenCalledWith(
      'sf-token',
      expect.stringContaining('FROM Account'),
    );
    expect(ctx.searchContacts.mock.calls[0][1]).toContain('Industry');
    expect(result.obsoleteSectors).toEqual([
      { id: sectorId('Finance'), label: 'Finance', accountCount: 1 },
    ]);
    expect(result.activeSectors).toHaveLength(50);
    expect(result.activeSectors).toContainEqual(
      expect.objectContaining({ label: 'Transports', accountCount: 1 }),
    );
    expect(result.accountsPerSector[sectorId('Finance')]).toEqual(['001-old']);
  });

  it('rejects commercial users from reading the organization-wide recipe', async () => {
    const ctx = context({ role: 'commercial' });

    await expect(loadSectorRecipe(ctx)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
      message:
        'Cette recette nécessite un accès manager ou admin. Veuillez contacter votre administrateur.',
    });
    expect(ctx.fetchSFToken).not.toHaveBeenCalled();
    expect(ctx.searchContacts).not.toHaveBeenCalled();
  });

  it('includes obsolete accounts owned by every commercial in the organization', async () => {
    const ctx = context({
      searchContacts: vi.fn().mockResolvedValue({
        records: [
          account('001-owner-a', 'Finance', 'sf-owner-a'),
          account('001-owner-b', 'Finance', 'sf-owner-b'),
          account('001-owner-c', 'Finance', 'sf-owner-c'),
        ],
      }),
    });

    const result = await loadSectorRecipe(ctx);

    expect(result.obsoleteSectors).toContainEqual({
      id: sectorId('Finance'),
      label: 'Finance',
      accountCount: 3,
    });
    expect(result.accountsPerSector[sectorId('Finance')]).toEqual([
      '001-owner-a',
      '001-owner-b',
      '001-owner-c',
    ]);
    expect(ctx.searchContacts.mock.calls[0][1]).not.toMatch(
      /OwnerId\s*(?:=|IN\b)/i,
    );
  });

  it('previews only account ids in the obsolete organization sector', async () => {
    const ctx = context();

    const result = await previewSectorMerge(ctx, {
      obsoleteId: sectorId('Finance'),
      activeId: sectorId('Transports'),
    });

    expect(result).toMatchObject({
      obsoleteId: sectorId('Finance'),
      activeId: sectorId('Transports'),
      accountIds: ['001-old'],
      accountCount: 1,
    });
    expect(ctx.updateSObjects).not.toHaveBeenCalled();
  });

  it('requires manager/admin capability before writing', async () => {
    const ctx = context({ role: 'commercial' });

    await expect(
      applySectorMerge(ctx, {
        obsoleteId: sectorId('Finance'),
        activeId: sectorId('Transports'),
      }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(ctx.updateSObjects).not.toHaveBeenCalled();
  });

  it('rejects an apply when the confirmed preview account set is stale', async () => {
    const ctx = context();

    await expect(
      applySectorMerge(ctx, {
        obsoleteId: sectorId('Finance'),
        activeId: sectorId('Transports'),
        expectedAccountIds: ['001-different'],
      }),
    ).rejects.toMatchObject({ code: 'stale_preview', status: 409 });
    expect(ctx.updateSObjects).not.toHaveBeenCalled();
  });

  it('updates Accounts and creates one merge journal entry with the required payload', async () => {
    const ctx = context();

    const result = await applySectorMerge(ctx, {
      obsoleteId: sectorId('Finance'),
      activeId: sectorId('Transports'),
      expectedAccountIds: ['001-old'],
    });

    expect(ctx.updateSObjects).toHaveBeenCalledWith('sf-token', 'Account', [
      { id: '001-old', Industry: 'Transports' },
    ]);
    expect(ctx.journalCleanerAction).toHaveBeenCalledTimes(1);
    expect(ctx.journalCleanerAction).toHaveBeenCalledWith(
      ctx.supabase,
      expect.objectContaining({
        source: 'recette_sectors',
        moduleId: 'recettes',
        actionType: 'recette_sectors_apply_merge',
        changes: {
          obsolete_id: sectorId('Finance'),
          active_id: sectorId('Transports'),
          account_count: 1,
        },
      }),
    );
    expect(result).toMatchObject({ updated: 1, failed: 0 });
  });
});
