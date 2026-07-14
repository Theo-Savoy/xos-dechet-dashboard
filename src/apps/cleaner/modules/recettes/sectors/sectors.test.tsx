// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchSectorRecipe, bulkApplySectors, getSectorJobStatus, fetchSectorJournal } = vi.hoisted(
  () => ({
    fetchSectorRecipe: vi.fn(),
    bulkApplySectors: vi.fn(),
    getSectorJobStatus: vi.fn(),
    fetchSectorJournal: vi.fn(),
  }),
);

vi.mock('./api', () => ({
  fetchSectorRecipe,
  bulkApplySectors,
  getSectorJobStatus,
  fetchSectorJournal,
}));

vi.mock('../recetteJobStore', () => ({
  useRecetteJob: () => ({
    jobId: null,
    status: 'idle',
    progress: { processed: 0, total: 0, errors: [] },
    error: null,
    start: vi.fn(),
    reset: vi.fn(),
  }),
}));

import { SectorsRecipeView } from './SectorsRecipeView';

describe('SectorsRecipeView (V17d dry-run only)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the mapping table and confirms the obsolete sector list', async () => {
    fetchSectorRecipe.mockResolvedValue({
      obsoleteSectors: [
        { id: 'assurance', label: 'Assurance', accountCount: 143 },
      ],
      activeSectors: [
        { id: 'banque-finance', label: 'Banque / Finance', accountCount: 0 },
      ],
      suggestedMappings: { assurance: 'banque-finance' },
      accountsPerSector: { assurance: ['001-A'] },
      capabilities: { canApplyMerge: true },
    });

    render(<SectorsRecipeView accessToken="token" />);

    await waitFor(() =>
      expect(screen.getAllByText(/Obsolète/).length).toBeGreaterThan(0),
    );
    // The obsolete sector label is rendered somewhere in the table.
    expect(screen.getByText(/Assurance/)).toBeTruthy();
  });

  it('shows a partial-results banner when the Account query was truncated', async () => {
    fetchSectorRecipe.mockResolvedValue({
      obsoleteSectors: [
        { id: 'assurance', label: 'Assurance', accountCount: 143 },
      ],
      activeSectors: [
        { id: 'banque-finance', label: 'Banque / Finance', accountCount: 0 },
      ],
      suggestedMappings: { assurance: 'banque-finance' },
      accountsPerSector: { assurance: ['001-A'] },
      capabilities: { canApplyMerge: true },
      truncated: true,
    });

    render(<SectorsRecipeView accessToken="token" />);

    expect(
      await screen.findByText(/Résultats partiels/i),
    ).toBeTruthy();
  });

  it('shows an empty-state card when no obsolete sectors exist', async () => {
    fetchSectorRecipe.mockResolvedValue({
      obsoleteSectors: [],
      activeSectors: [],
      suggestedMappings: {},
      accountsPerSector: {},
      capabilities: { canApplyMerge: true },
    });

    render(<SectorsRecipeView accessToken="token" />);

    await waitFor(() =>
      expect(screen.getAllByText(/Aucun secteur obsolète/).length).toBeGreaterThan(0),
    );
  });

  it('opens the confirmation modal with the dry-run hint before applying', async () => {
    fetchSectorRecipe.mockResolvedValue({
      obsoleteSectors: [
        { id: 'assurance', label: 'Assurance', accountCount: 10 },
      ],
      activeSectors: [
        { id: 'banque-finance', label: 'Banque / Finance', accountCount: 0 },
      ],
      suggestedMappings: { assurance: 'banque-finance' },
      accountsPerSector: { assurance: ['001-A'] },
      capabilities: { canApplyMerge: true },
    });
    bulkApplySectors.mockResolvedValue({ ok: true, jobId: 'job-x' });

    render(<SectorsRecipeView accessToken="token" />);

    // Wait for the row to appear, click "Fusionner N secteurs".
    const bouton = await screen.findByRole('button', {
      name: /fusionner 1 secteur/i,
    });
    bouton.click();

    // The confirmation modal opens with the dry-run hint.
    await waitFor(() =>
      expect(screen.getAllByText(/dry-run/i).length).toBeGreaterThan(0),
    );
    // bulkApplySectors must NOT have been called yet (modal is a gate).
    expect(bulkApplySectors).not.toHaveBeenCalled();
  });
});
