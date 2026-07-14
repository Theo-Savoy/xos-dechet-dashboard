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

  it('disables the merge button while the fusion job is running', async () => {
    fetchSectorRecipe.mockResolvedValue({
      obsoleteSectors: [
        { id: 'assurance', label: 'Assurance', accountCount: 5 },
      ],
      activeSectors: [
        { id: 'banque-finance', label: 'Banque / Finance', accountCount: 0 },
      ],
      suggestedMappings: { assurance: 'banque-finance' },
      accountsPerSector: { assurance: ['001-A'] },
      capabilities: { canApplyMerge: true },
    });
    bulkApplySectors.mockResolvedValue({ ok: true, jobId: 'job-1' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'done', total: 1, processed: 1, errors: [] }),
          { status: 200 },
        ),
      ),
    );

    render(<SectorsRecipeView accessToken="token" />);

    const bouton = await screen.findByRole('button', {
      name: /fusionner 1 secteur/i,
    });
    bouton.click();
    (await screen.findByRole('button', { name: 'Fusionner' })).click();

    const running = await screen.findByRole(
      'button',
      { name: /fusion en cours/i },
      { timeout: 3000 },
    );
    expect(running.hasAttribute('disabled')).toBe(true);

    await waitFor(
      () => expect(screen.getByText(/1 fusion réussie/)).toBeTruthy(),
      { timeout: 3000 },
    );
    // Once the job completes, the button re-enables for a fresh run.
    expect(
      screen
        .getByRole('button', { name: /fusionner 1 secteur/i })
        .hasAttribute('disabled'),
    ).toBe(false);

    vi.unstubAllGlobals();
  });
});
