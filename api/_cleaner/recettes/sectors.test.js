import { describe, expect, it, vi } from 'vitest';

import {
  applySectorMerge,
  fetchSectorJournal,
  getSectorJobStatus,
  loadSectorRecipe,
  previewSectorMerge,
  startBulkSectorJob,
  sectorId,
  undoSectorMerge,
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
    recordSectorJournal: vi
      .fn()
      .mockResolvedValue({ data: { id: 13 }, error: null }),
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
      expect.objectContaining({
        id: sectorId('Finance'),
        label: 'Finance',
        accountCount: 1,
      }),
    ]);
    expect(result.obsoleteSectors[0].sampleAccounts).toEqual([
      expect.objectContaining({ id: '001-old', name: 'Account 001-old' }),
    ]);
    expect(result.activeSectors).toHaveLength(50);
    expect(result.activeSectors).toContainEqual(
      expect.objectContaining({ label: 'Transports', accountCount: 1 }),
    );
    expect(result.accountsPerSector[sectorId('Finance')]).toEqual(['001-old']);
    expect(result.truncated).toBe(false);
  });

  it('flags truncated=true when the Account query hits the SOQL cap (2000 records)', async () => {
    const records = Array.from({ length: 2000 }, (_, index) =>
      account(`001-${index}`, 'Finance'),
    );
    const ctx = context({
      searchContacts: vi.fn().mockResolvedValue({ records, truncated: true }),
    });

    const result = await loadSectorRecipe(ctx);

    expect(result.truncated).toBe(true);
  });

  it('keeps colliding Salesforce labels distinct from the canonical target id', async () => {
    const ctx = context({
      searchContacts: vi.fn().mockResolvedValue({
        records: [account('001-variant', 'Tourisme-Hôtellerie')],
      }),
    });

    const result = await loadSectorRecipe(ctx);

    expect(result.obsoleteSectors).toContainEqual(
      expect.objectContaining({
        id: 'obsolete-tourisme-hotellerie',
        label: 'Tourisme-Hôtellerie',
      }),
    );
    expect(result.suggestedMappings['obsolete-tourisme-hotellerie']).toBe(
      sectorId('Tourisme / hôtellerie'),
    );
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

    expect(result.obsoleteSectors).toContainEqual(
      expect.objectContaining({
        id: sectorId('Finance'),
        label: 'Finance',
        accountCount: 3,
      }),
    );
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
    expect(ctx.recordSectorJournal).toHaveBeenCalledWith({
      kind: 'recette_sectors_apply_merge',
      payload: expect.objectContaining({
        obsoleteId: sectorId('Finance'),
        activeId: sectorId('Transports'),
        accountCount: 1,
      }),
    });
    expect(result).toMatchObject({ updated: 1, failed: 0 });
  });

  it('runs a bulk apply with an internal dry-run sweep and exposes progress by job id', async () => {
    const ctx = context({
      role: 'admin',
      searchContacts: vi.fn().mockResolvedValue({
        records: [
          account('001-finance', 'Finance'),
          account('001-health', 'Health'),
        ],
      }),
    });

    const { jobId } = startBulkSectorJob(ctx, {
      action: 'bulk_apply',
      obsoleteIds: ['finance', 'health'],
      mapping: {
        finance: 'banque-finance',
        health: 'sante-pharmacie-biotech',
      },
    });
    let status;
    await vi.waitFor(() => {
      status = getSectorJobStatus(ctx, jobId);
      expect(status.status).toBe('done');
    });

    expect(status).toMatchObject({ total: 2, processed: 2, errors: [] });
    // The dry-run sweep runs first, then the apply. Each step pushes
    // its own results; we expect at least one entry per obsolete id.
    expect(status.results.length).toBeGreaterThanOrEqual(2);
    // The apply call must have been issued for both items.
    expect(ctx.updateSObjects).toHaveBeenCalled();
  });

  it('aborts bulk apply when a dry-run item is invalid and reports the failed obsolete id', async () => {
    // V17d dry-run design: the dry-run sweep validates every mapping
    // before any write. If any mapping is invalid, the whole job
    // aborts without touching Salesforce.
    const ctx = context({
      searchContacts: vi
        .fn()
        .mockResolvedValue({ records: [account('001-old', 'Finance')] }),
    });

    const { jobId } = startBulkSectorJob(ctx, {
      action: 'bulk_apply',
      obsoleteIds: ['finance', 'missing'],
      mapping: { finance: 'banque-finance', missing: 'transports' },
    });
    let status;
    await vi.waitFor(() => {
      status = getSectorJobStatus(ctx, jobId);
      expect(status.status).toBe('done');
    });

    expect(status).toMatchObject({ total: 2, processed: 2 });
    expect(status.errors).toEqual([
      expect.objectContaining({ obsoleteId: 'missing' }),
    ]);
    // The dry-run failed for 'missing', so no Salesforce write is
    // attempted for any item.
    expect(ctx.updateSObjects).not.toHaveBeenCalled();
  });

  it('requires manager/admin capability before starting a bulk apply', () => {
    expect(() =>
      startBulkSectorJob(context({ role: 'commercial' }), {
        action: 'bulk_apply',
        obsoleteIds: ['finance'],
        mapping: { finance: 'banque-finance' },
      }),
    ).toThrow(expect.objectContaining({ code: 'forbidden', status: 403 }));
  });

  it('fetches the most recent recipe journal entries', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          id: 9,
          kind: 'recette_sectors_apply_merge',
          payload: {
            obsoleteId: 'finance',
            activeId: 'banque-finance',
            accountCount: 4,
          },
          actor_id: 'actor-1',
          created_at: '2026-07-13T10:00:00Z',
          actor: { full_name: 'Marie Martin', email: 'marie@example.com' },
        },
      ],
      error: null,
    });
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const ctx = context({ supabase: { from: vi.fn(() => ({ select })) } });

    const entries = await fetchSectorJournal(ctx, 50);

    expect(ctx.supabase.from).toHaveBeenCalledWith('recette_journal');
    expect(entries).toEqual([
      expect.objectContaining({
        obsoleteId: 'finance',
        activeId: 'banque-finance',
        accountCount: 4,
        actorLabel: 'Marie Martin',
      }),
    ]);
  });

  it('refuses to undo a merge that was already undone', async () => {
    const ctx = context();
    const entryMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 12,
        kind: 'recette_sectors_apply_merge',
        actor_id: ctx.user.id,
        payload: {
          obsoleteLabel: 'Finance',
          activeLabel: 'Transports',
          snapshot: [{ id: '001-old', industry: 'Finance' }],
        },
      },
      error: null,
    });
    const entryEq = vi.fn(() => ({ maybeSingle: entryMaybeSingle }));
    const entrySelect = vi.fn(() => ({ eq: entryEq }));

    const undoMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 99 }, error: null });
    const undoEq2 = vi.fn(() => ({ maybeSingle: undoMaybeSingle }));
    const undoEq1 = vi.fn(() => ({ eq: undoEq2 }));
    const undoSelect = vi.fn(() => ({ eq: undoEq1 }));

    ctx.supabase.from = vi
      .fn()
      .mockReturnValueOnce({ select: entrySelect })
      .mockReturnValueOnce({ select: undoSelect });

    await expect(
      undoSectorMerge(ctx, { journalId: 12 }),
    ).rejects.toMatchObject({ code: 'already_undone', status: 409 });
    expect(ctx.updateSObjects).not.toHaveBeenCalled();
  });
});
