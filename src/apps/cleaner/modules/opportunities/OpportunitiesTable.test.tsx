// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpportunitiesTable } from './OpportunitiesTable';
import {
  sortOpportunityItems,
  type OpportunityWorkspaceState,
} from './filterState';
import type { OpportunityWorkspaceItem } from './api';

const item = (
  id: string,
  overrides: Partial<OpportunityWorkspaceItem> = {},
): OpportunityWorkspaceItem => ({
  id,
  name: id === 'opp-a' ? 'Alpha' : 'Beta',
  account: 'Acme',
  owner: 'Alice',
  stage: 'Qualification',
  close_date: '2026-07-01',
  amount: 100,
  probability: 50,
  last_activity: '2026-07-10',
  category: 'dechet',
  score: 20,
  anomalies: [
    {
      ruleId: 'close_date_overdue_over_1_year',
      severity: 'critical',
      score: 12,
      label: '',
      evidence: [],
    },
    {
      ruleId: 'amount_missing',
      severity: 'critical',
      score: 6,
      label: '',
      evidence: [],
    },
  ],
  salesforce_url: `https://example.salesforce.com/${id}`,
  ...overrides,
});

const initialState = (): OpportunityWorkspaceState => ({
  filters: {
    search: '',
    owners: [],
    categories: [],
    saleTypes: [],
    reasonFamilies: {},
  },
  sort: { key: 'score', direction: 'desc' },
  page: 1,
  selectedIds: new Set(),
  activeView: 'cleaning',
});

function renderHarness(
  items = [item('opp-a'), item('opp-b')],
  selectedIds = new Set<string>(),
) {
  const onOpenDetail = vi.fn();

  function Harness() {
    const [state, setState] = useState(() => ({
      ...initialState(),
      selectedIds,
    }));
    const sorted = sortOpportunityItems(items, state.sort);
    return (
      <OpportunitiesTable
        items={sorted}
        state={state}
        pageCount={1}
        onSort={(key) =>
          setState((current) => ({
            ...current,
            sort: {
              key,
              direction:
                current.sort.key === key && current.sort.direction === 'asc'
                  ? 'desc'
                  : 'asc',
            },
          }))
        }
        onToggleSelection={vi.fn()}
        onTogglePage={vi.fn()}
        onPageChange={vi.fn()}
        onOpenDetail={onOpenDetail}
      />
    );
  }

  return { ...render(<Harness />), onOpenDetail };
}

describe('OpportunitiesTable', () => {
  afterEach(cleanup);

  it('toggles a sortable header and exposes its current direction', () => {
    renderHarness();

    const nameSort = screen.getByRole('button', { name: 'Trier par Nom' });
    fireEvent.click(nameSort);
    expect(
      screen
        .getByRole('columnheader', { name: 'Nom' })
        .getAttribute('aria-sort'),
    ).toBe('ascending');
    expect(screen.getAllByRole('row')[1].textContent).toContain('Alpha');

    fireEvent.click(nameSort);
    expect(
      screen
        .getByRole('columnheader', { name: 'Nom' })
        .getAttribute('aria-sort'),
    ).toBe('descending');
    expect(screen.getAllByRole('row')[1].textContent).toContain('Beta');
  });

  it('maps rule ids to friendly reason chips and links the Salesforce record', () => {
    renderHarness([
      item('opp-a', {
        anomalies: [
          {
            ruleId: 'close_date_overdue_over_1_year',
            severity: 'critical',
            score: 12,
            label: '',
            evidence: [],
          },
          {
            ruleId: 'amount_missing',
            severity: 'critical',
            score: 6,
            label: '',
            evidence: [],
          },
        ],
      }),
    ]);

    expect(
      screen.getByText("Date de clôture dépassée de plus d'un an"),
    ).toBeTruthy();
    expect(screen.getByText('Montant absent')).toBeTruthy();
    expect(screen.queryByText('close_date_overdue_over_1_year')).toBeNull();
    expect(
      screen.getByRole('link', { name: /Salesforce/i }).getAttribute('target'),
    ).toBe('_blank');
    expect(
      screen.getByRole('link', { name: /Salesforce/i }).getAttribute('rel'),
    ).toBe('noopener noreferrer');
  });

  it('marks the page selector indeterminate when only some rows are selected', () => {
    renderHarness([item('opp-a'), item('opp-b')], new Set(['opp-a']));

    const pageSelector = screen.getByRole('checkbox', {
      name: 'Sélectionner la page',
    }) as HTMLInputElement;
    expect(pageSelector.indeterminate).toBe(true);
    expect(pageSelector.getAttribute('aria-checked')).toBe('mixed');
  });

  it('collapses extra reasons behind an expandable compact pill', () => {
    renderHarness([
      item('opp-a', {
        anomalies: [
          'close_date_overdue_over_1_year',
          'amount_missing',
          'probability_zero',
          'owner_inactive',
        ].map((ruleId) => ({
          ruleId,
          severity: 'critical' as const,
          score: 1,
          label: '',
          evidence: [],
        })),
      }),
    ]);

    expect(screen.getByText('+2 autres')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /autres raisons/i }));
    expect(screen.getByText('Propriétaire inactif')).toBeTruthy();
  });

  it('groups more than three reasons under legacy family headings', () => {
    renderHarness([
      item('opp-a', {
        anomalies: [
          'close_date_overdue_over_1_year',
          'amount_missing',
          'probability_zero',
          'owner_inactive',
        ].map((ruleId) => ({
          ruleId,
          severity: 'critical' as const,
          score: 1,
          label: '',
          evidence: [],
        })),
      }),
    ]);

    expect(screen.getByText('⏰ Close date dépassée')).toBeTruthy();
    expect(screen.getByText('💰 Absence de montant')).toBeTruthy();
    expect(screen.getByText('📉 Probabilité')).toBeTruthy();
    expect(screen.getByText('👤 Propriétaire inactif / ancien')).toBeTruthy();
  });

  it('opens the score explanation from the score header', () => {
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: /aide du score/i }));

    expect(
      screen.getByRole('dialog', { name: /Calcul du Score d'Hygiène/i }),
    ).toBeTruthy();
    expect(screen.getByText(/\+1 pt par mois de retard/i)).toBeTruthy();
  });
});
