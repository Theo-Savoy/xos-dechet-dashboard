// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../crm/usePicklistValues', () => ({
  PicklistValuesProvider: ({ children }: { children: ReactNode }) => children,
  usePicklistValues: () => ({ values: [], loading: false, error: null }),
}));

import { OpportunitiesModule } from './OpportunitiesModule';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const opportunity = (id: string, name: string) => ({
  id,
  name,
  owner_id: '005000000000001',
  owner: 'Alice',
  account_owner_id: '005000000000002',
  account: 'Acme',
  stage: 'Qualification',
  close_date: '2026-06-01',
  type_vente: 'Catalogue',
  anomalies: [
    {
      ruleId: 'opportunity.close_date.past',
      severity: 'warning',
      score: 3,
      label: 'Close date passée',
      evidence: [],
    },
  ],
  score: 3,
});

describe('Opportunities command flow', () => {
  it('previews before execute, sends one idempotency key and keeps only failed selection', async () => {
    const items = [
      opportunity('006000000000001', 'Alpha'),
      opportunity('006000000000002', 'Beta'),
    ];
    const preview = {
      previewId: '42',
      fingerprint: 'fingerprint',
      expiresAt: '2026-07-13T10:00:00.000Z',
      changes: { stage: 'Fermée / Perdue', loss_reason: 'Budget' },
      eligible: items.map((item) => ({
        id: item.id,
        reason: 'eligible',
        before: { stage: item.stage },
        after: { stage: 'Fermée / Perdue' },
      })),
      excluded: [],
    };
    const executeResult = {
      previewId: '42',
      fingerprint: 'fingerprint',
      idempotencyKey: '8b8c2b83-9ec5-4c2b-b2a7-000000000001',
      commandId: 9,
      status: 'partial',
      updated: 1,
      failed: 1,
      results: [
        { id: items[0].id, success: true, error: null },
        { id: items[1].id, success: false, error: 'Scope refusé' },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items,
            total: 2,
            capabilities: {
              canViewTeam: true,
              canReassign: true,
              canBulkEdit: true,
              canBulkClose: true,
              canManageRules: false,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(preview), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(executeResult), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<OpportunitiesModule accessToken="token" />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sélectionner la page' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clore en perdue' }));
    fireEvent.change(screen.getByLabelText('Raison de perte'), {
      target: { value: 'Budget' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Prévisualiser les changements' }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Confirmer et exécuter' }),
      ).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmer et exécuter' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/partiel/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const executePayload = JSON.parse(
      fetchMock.mock.calls[2][1].body as string,
    );
    expect(executePayload).toMatchObject({
      module: 'opportunities',
      action: 'execute',
      previewId: '42',
      fingerprint: 'fingerprint',
    });
    expect(executePayload.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(screen.getByText('1 sélectionnée')).toBeTruthy();
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Sélectionner Beta',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(screen.getByText('Scope refusé')).toBeTruthy();
  });
});
