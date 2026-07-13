// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpportunityWorkspaceItem } from './api';
import { OpportunitiesFilters } from './OpportunitiesFilters';
import {
  createInitialOpportunityFilters,
  type OpportunityFilters,
} from './filterState';

const item = (
  overrides: Partial<OpportunityWorkspaceItem> = {},
): OpportunityWorkspaceItem => ({
  id: 'opp-1',
  name: 'Alpha',
  account: 'Acme',
  owner: ' Alice ',
  category: 'close_date_overdue_over_1_year',
  type_vente: ' New business ',
  stage: 'Qualification',
  score: 10,
  anomalies: [
    {
      ruleId: 'close_date_overdue_over_1_year',
      severity: 'critical',
      score: 10,
      label: '',
      evidence: [],
    },
  ],
  ...overrides,
});

function renderFilters(
  filters: OpportunityFilters = createInitialOpportunityFilters(),
  items = [item()],
) {
  const onChange = vi.fn();
  render(
    <OpportunitiesFilters
      items={items}
      filters={filters}
      onChange={onChange}
      onReset={vi.fn()}
    />,
  );
  return { onChange, filters };
}

describe('OpportunitiesFilters', () => {
  afterEach(cleanup);

  it('selecting an Owner option dispatches the trimmed owner filter', () => {
    const { onChange, filters } = renderFilters();

    fireEvent.click(screen.getByRole('button', { name: 'Owner' }));
    fireEvent.click(screen.getByRole('option', { name: 'Alice' }));

    expect(onChange).toHaveBeenCalledWith({ ...filters, owners: ['Alice'] });
  });

  it('shows the French category label in the trigger instead of the rule id', () => {
    const filters = {
      ...createInitialOpportunityFilters(),
      categories: ['close_date_overdue_over_1_year'],
    };
    renderFilters(filters);

    const trigger = screen.getByRole('button', { name: 'Catégorie' });
    expect(trigger.textContent).toContain(
      "Date de clôture dépassée de plus d'un an",
    );
    expect(trigger.textContent).not.toContain('close_date_overdue_over_1_year');
  });

  it('shows French reason labels when the Raisons menu opens', () => {
    renderFilters();

    fireEvent.click(screen.getByRole('button', { name: 'Raisons' }));

    expect(
      screen.getByText("Date de clôture dépassée de plus d'un an"),
    ).toBeTruthy();
    expect(screen.queryByText('close_date_overdue_over_1_year')).toBeNull();
  });

  it('toggling a reason checkbox updates filters.reasonFamilies', () => {
    const { onChange, filters } = renderFilters();

    fireEvent.click(screen.getByRole('button', { name: 'Raisons' }));
    const reasonCheckbox = screen.getByRole('checkbox', {
      name: "Date de clôture dépassée de plus d'un an",
    });
    expect(reasonCheckbox.classList.contains('xos-checkbox__input')).toBe(true);
    fireEvent.click(reasonCheckbox);

    expect(onChange).toHaveBeenCalledWith({
      ...filters,
      reasonFamilies: {
        closedate: ['close_date_overdue_over_1_year'],
      },
    });
  });
});
