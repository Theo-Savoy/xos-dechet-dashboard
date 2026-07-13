// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchSectorRecipe, previewSectorMerge, applySectorMerge, bulkPreviewSectors, bulkApplySectors, getSectorJobStatus, fetchSectorJournal } = vi.hoisted(
  () => ({
    fetchSectorRecipe: vi.fn(),
    previewSectorMerge: vi.fn(),
    applySectorMerge: vi.fn(),
    bulkPreviewSectors: vi.fn(),
    bulkApplySectors: vi.fn(),
    getSectorJobStatus: vi.fn(),
    fetchSectorJournal: vi.fn(),
  }),
);

vi.mock('./api', () => ({
  fetchSectorRecipe,
  previewSectorMerge,
  applySectorMerge,
  bulkPreviewSectors,
  bulkApplySectors,
  getSectorJobStatus,
  fetchSectorJournal,
}));

import { SectorsRecipeView } from './SectorsRecipeView';
import { RecetteJobProvider } from '../recetteJobStore';

function renderRecipe() {
  return render(<RecetteJobProvider pollInterval={1}><SectorsRecipeView accessToken="jwt" /></RecetteJobProvider>);
}

const state = {
  obsoleteSectors: [{ id: 'finance', label: 'Finance', accountCount: 2 }],
  activeSectors: [
    { id: 'transports', label: 'Transports', accountCount: 5 },
    { id: 'banque-finance', label: 'Banque / finance', accountCount: 8 },
  ],
  suggestedMappings: { finance: 'banque-finance' },
  accountsPerSector: { finance: ['001-a', '001-b'] },
  capabilities: { canApplyMerge: true },
};

const emptyState = {
  ...state,
  obsoleteSectors: [],
  activeSectors: [
    { id: 'transports', label: 'Transports', accountCount: 500 },
    { id: 'banque-finance', label: 'Banque / finance', accountCount: 400 },
    { id: 'industrie', label: 'Industrie', accountCount: 300 },
    { id: 'sante', label: 'Santé', accountCount: 450 },
    { id: 'services', label: 'Services', accountCount: 350 },
    ...Array.from({ length: 45 }, (_, index) => ({
      id: `canonical-${index}`,
      label: `Secteur canonique ${index + 1}`,
      accountCount: 0,
    })),
  ],
  suggestedMappings: {},
  accountsPerSector: {},
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('SectorsRecipeView', () => {
  it('renders the three KPI cards and obsolete sectors', async () => {
    fetchSectorRecipe.mockResolvedValue(state);

    renderRecipe();

    expect(await screen.findByText('Finance')).toBeTruthy();
    expect(screen.getAllByTestId('sector-recipe-kpi')).toHaveLength(3);
    expect(
      screen.getByRole('heading', { name: 'Secteurs obsolètes' }),
    ).toBeTruthy();
    expect(screen.getByText('Comptes concernés')).toBeTruthy();
    expect(screen.getByText('Secteurs actifs')).toBeTruthy();
  });

  it('renders an informative empty state with the analyzed sector stats', async () => {
    fetchSectorRecipe.mockResolvedValue(emptyState);

    renderRecipe();

    expect(
      await screen.findByRole('heading', {
        name: 'Aucun secteur obsolète — votre base est alignée sur la nomenclature',
      }),
    ).toBeTruthy();
    expect(screen.getByText('5 secteurs distincts utilisés')).toBeTruthy();
    expect(screen.getByText('50 secteurs canoniques disponibles')).toBeTruthy();
    expect(screen.getByText('2000 comptes analysés')).toBeTruthy();
  });

  it('opens and closes the list of used sectors from the empty state disclosure', async () => {
    fetchSectorRecipe.mockResolvedValue(emptyState);

    renderRecipe();

    await screen.findByRole('heading', {
      name: 'Aucun secteur obsolète — votre base est alignée sur la nomenclature',
    });
    const disclosure = screen.getByTestId(
      'used-sectors-disclosure',
    ) as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);

    fireEvent.click(
      screen.getByText('Voir la liste des secteurs utilisés'),
    );
    expect(disclosure.open).toBe(true);
    expect(screen.getByText('Transports — 500 comptes')).toBeTruthy();

    fireEvent.click(
      screen.getByText('Voir la liste des secteurs utilisés'),
    );
    expect(disclosure.open).toBe(false);
  });

  it('previews, confirms, applies and refreshes a merge through the full recipe flow', async () => {
    fetchSectorRecipe.mockResolvedValueOnce(state).mockResolvedValueOnce({
      ...state,
      obsoleteSectors: [],
      accountsPerSector: {},
    });
    previewSectorMerge.mockResolvedValue({
      obsoleteId: 'finance',
      activeId: 'transports',
      obsoleteLabel: 'Finance',
      activeLabel: 'Transports',
      accountIds: ['001-a', '001-b'],
      accounts: [
        { id: '001-a', name: 'Alpha', ownerId: 'sf-owner' },
        { id: '001-b', name: 'Beta', ownerId: 'sf-owner' },
      ],
      accountCount: 2,
    });
    applySectorMerge.mockResolvedValue({
      updated: 2,
      failed: 0,
      accountIds: ['001-a', '001-b'],
    });
    const nativeConfirm = vi.spyOn(window, 'confirm');

    renderRecipe();
    await screen.findByText('Finance');

    fireEvent.click(screen.getByRole('button', { name: 'Cible pour Finance' }));
    fireEvent.click(screen.getByRole('option', { name: 'Transports' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Prévisualiser Finance' }),
    );

    expect(await screen.findByText('Alpha')).toBeTruthy();
    const applyButton = screen.getByRole('button', {
      name: 'Appliquer Finance',
    });
    expect((applyButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      screen.getByRole('button', { name: /Confirmer l'aperçu/ }),
    );
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(applyButton);
    expect(await screen.findByRole('dialog', { name: 'Confirmer la fusion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));

    await waitFor(() =>
      expect(applySectorMerge).toHaveBeenCalledWith(
        'jwt',
        'finance',
        'transports',
        ['001-a', '001-b'],
      ),
    );
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(await screen.findByText(/2 fusions réussies, 0 échecs/)).toBeTruthy();
    expect(fetchSectorRecipe).toHaveBeenCalledTimes(2);
  });

  it('runs one bulk preview then opens a single custom confirmation modal for bulk apply', async () => {
    fetchSectorRecipe.mockResolvedValue(state);
    bulkPreviewSectors.mockResolvedValue({ ok: true, jobId: 'preview-job' });
    bulkApplySectors.mockResolvedValue({ ok: true, jobId: 'apply-job' });
    getSectorJobStatus.mockResolvedValue({ ok: true, jobId: 'preview-job', status: 'done', total: 1, processed: 1, errors: [], results: [] });
    renderRecipe();
    await screen.findByText('Finance');

    fireEvent.click(screen.getByRole('button', { name: 'Bulk preview' }));
    await waitFor(() => expect(bulkPreviewSectors).toHaveBeenCalledWith('jwt', { finance: 'banque-finance' }));
    const bulkApply = screen.getByRole('button', { name: 'Bulk apply' });
    await waitFor(() => expect((bulkApply as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(bulkApply);

    expect(screen.getAllByRole('dialog', { name: 'Confirmer la fusion groupée' })).toHaveLength(1);
    expect(screen.getByText(/fusionner 1 secteurs obsolètes/)).toBeTruthy();
  });
});
