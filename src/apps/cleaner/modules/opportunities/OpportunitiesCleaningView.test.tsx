// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CleanerCapabilities } from '../../contracts';
import type { OpportunityWorkspaceItem } from './api';
import { OpportunitiesCleaningView } from './OpportunitiesCleaningView';
import {
  createInitialOpportunityFilters,
  type OpportunityWorkspaceState,
} from './filterState';

const capabilities: CleanerCapabilities = {
  canViewTeam: false,
  canReassign: false,
  canBulkEdit: false,
  canBulkClose: false,
  canManageRules: false,
};

const item = (
  id: string,
  severity?: 'critical' | 'warning',
): OpportunityWorkspaceItem => ({
  id,
  name: id,
  category: 'amount',
  score: severity === 'critical' ? 12 : severity ? 5 : 0,
  anomalies: severity
    ? [
        {
          ruleId: 'amount_missing',
          severity,
          score: severity === 'critical' ? 12 : 5,
          label: 'Montant absent',
          evidence: [],
        },
      ]
    : [],
});

const initialState = (): OpportunityWorkspaceState => ({
  filters: createInitialOpportunityFilters(),
  sort: { key: 'score', direction: 'desc' },
  page: 1,
  selectedIds: new Set(),
  activeView: 'cleaning',
});

function renderView(
  items: OpportunityWorkspaceItem[],
  state: OpportunityWorkspaceState = initialState(),
  onStateChange = vi.fn(),
) {
  return render(
    <OpportunitiesCleaningView
      capabilities={capabilities}
      items={items}
      state={state}
      onStateChange={onStateChange}
      detail={null}
      onOpenDetail={vi.fn()}
      onCloseDetail={vi.fn()}
    />,
  );
}

describe('OpportunitiesCleaningView', () => {
  afterEach(cleanup);

  it('renders KPI buttons with counts derived from the filtered items', () => {
    renderView([item('critical', 'critical'), item('warning', 'warning'), item('healthy')]);

    expect(
      screen.getByRole('button', { name: /3 opportunités à examiner/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Opportunités critiques \(1\)/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /Opportunités avec avertissement \(1\)/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Opportunités sans anomalie \(1\)/i }),
    ).toBeTruthy();
  });

  it("sets the criticality filter when clicking the 'Critiques' KPI", () => {
    const onStateChange = vi.fn();
    renderView([item('critical', 'critical'), item('healthy')], initialState(), onStateChange);

    fireEvent.click(
      screen.getByRole('button', { name: /Opportunités critiques \(1\)/i }),
    );

    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ criticality: 'critical' }),
      }),
    );
  });

  it('renders the clean empty state when no filtered opportunities need cleaning', () => {
    renderView([]);

    expect(
      screen.getByText(
        /Aucune opportunité ne nécessite de nettoyage/,
      ),
    ).toBeTruthy();
  });
});
