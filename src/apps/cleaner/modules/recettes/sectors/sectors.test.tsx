// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchSectorRecipe, previewSectorMerge, applySectorMerge } = vi.hoisted(
  () => ({
    fetchSectorRecipe: vi.fn(),
    previewSectorMerge: vi.fn(),
    applySectorMerge: vi.fn(),
  }),
);

vi.mock('./api', () => ({
  fetchSectorRecipe,
  previewSectorMerge,
  applySectorMerge,
}));

import { SectorsRecipeView } from './SectorsRecipeView';

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('SectorsRecipeView', () => {
  it('renders the three KPI cards and obsolete sectors', async () => {
    fetchSectorRecipe.mockResolvedValue(state);

    render(<SectorsRecipeView accessToken="jwt" />);

    expect(await screen.findByText('Finance')).toBeTruthy();
    expect(screen.getAllByTestId('sector-recipe-kpi')).toHaveLength(3);
    expect(
      screen.getByRole('heading', { name: 'Secteurs obsolètes' }),
    ).toBeTruthy();
    expect(screen.getByText('Comptes concernés')).toBeTruthy();
    expect(screen.getByText('Secteurs actifs')).toBeTruthy();
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
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    render(<SectorsRecipeView accessToken="jwt" />);
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
      screen.getByRole('button', { name: 'Confirmer ce preview' }),
    );
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(applyButton);

    await waitFor(() =>
      expect(applySectorMerge).toHaveBeenCalledWith(
        'jwt',
        'finance',
        'transports',
        ['001-a', '001-b'],
      ),
    );
    expect(confirm).toHaveBeenCalledWith(
      'Vous allez remplacer 2 comptes du secteur Finance par Transports. Continuer ?',
    );
    expect(await screen.findByText(/2 comptes mis à jour/)).toBeTruthy();
    expect(fetchSectorRecipe).toHaveBeenCalledTimes(2);
  });
});
