// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CleanerCockpit, type CleanerCockpitState } from '../CleanerCockpit';
import { CleanerShell } from './CleanerShell';
import {
  CLEANER_SHELL_STORAGE_KEY,
  closeModule,
  createInitialTabState,
  moduleAllowedForRole,
  openModule,
  type CleanerTabState,
} from './shellState';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    window.localStorage?.clear();
  } catch {
    // jsdom can expose an opaque-origin storage getter.
  }
});

function installStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

const readyCockpit: CleanerCockpitState = {
  status: 'ready',
  summaries: [
    {
      moduleId: 'opportunities',
      label: 'Opportunités',
      criticality: 'critical',
      anomalyCount: 12,
      affectedRecordCount: 8,
      resolvedPeriodCount: 3,
      previousPeriodDelta: 2,
      lastRefreshedAt: '2026-07-12T09:30:00.000Z',
    },
  ],
};

function renderShell(
  overrides: Partial<React.ComponentProps<typeof CleanerShell>> = {},
) {
  try {
    if (!window.localStorage) installStorage();
  } catch {
    installStorage();
  }
  return render(
    <CleanerShell
      role="commercial"
      accessToken="test-token"
      cockpit={readyCockpit}
      {...overrides}
    />,
  );
}

describe('CleanerShell navigation', () => {
  it('opens the Recettes tile and renders the sectors recipe tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            obsoleteSectors: [],
            activeSectors: [],
            suggestedMappings: {},
            accountsPerSector: {},
            capabilities: { canApplyMerge: false },
          }),
          { status: 200 },
        ),
      ),
    );
    renderShell({
      cockpit: {
        status: 'ready',
        summaries: [
          ...readyCockpit.summaries,
          {
            moduleId: 'recettes',
            label: 'Recettes',
            criticality: 'warning',
            anomalyCount: 0,
            affectedRecordCount: 0,
            resolvedPeriodCount: 0,
            previousPeriodDelta: null,
            lastRefreshedAt: null,
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Recettes' }));

    expect(screen.getByRole('tab', { name: 'Recettes' })).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Secteurs obsolètes' }),
    ).toBeTruthy();
  });

  it('completes a sector merge from Labo navigation against the mocked server', async () => {
    let recipeReads = 0;
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_input, init) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          if (body.action === 'preview_merge') {
            return new Response(
              JSON.stringify({
                obsoleteId: 'finance',
                activeId: 'transports',
                obsoleteLabel: 'Finance',
                activeLabel: 'Transports',
                accountIds: ['001-a'],
                accounts: [{ id: '001-a', name: 'Alpha', ownerId: 'sf-owner' }],
                accountCount: 1,
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({ updated: 1, failed: 0, accountIds: ['001-a'] }),
            { status: 200 },
          );
        }
        recipeReads += 1;
        return new Response(
          JSON.stringify({
            obsoleteSectors:
              recipeReads === 1
                ? [{ id: 'finance', label: 'Finance', accountCount: 1 }]
                : [],
            activeSectors: [
              { id: 'transports', label: 'Transports', accountCount: 4 },
            ],
            suggestedMappings: {},
            accountsPerSector: recipeReads === 1 ? { finance: ['001-a'] } : {},
            capabilities: { canApplyMerge: true },
          }),
          { status: 200 },
        );
      }),
    );
    renderShell({
      role: 'manager',
      cockpit: {
        status: 'ready',
        summaries: [
          {
            moduleId: 'recettes',
            label: 'Recettes',
            criticality: 'warning',
            anomalyCount: 1,
            affectedRecordCount: 1,
            resolvedPeriodCount: 0,
            previousPeriodDelta: null,
            lastRefreshedAt: null,
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Recettes' }));
    await screen.findByText('Finance');
    fireEvent.click(screen.getByRole('button', { name: 'Cible pour Finance' }));
    fireEvent.click(screen.getByRole('option', { name: 'Transports' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Prévisualiser Finance' }),
    );
    expect(await screen.findByText('Alpha')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmer ce preview' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer Finance' }));

    expect(await screen.findByText(/1 compte mis à jour/)).toBeTruthy();
    expect(screen.getByText('Aucun secteur obsolète détecté')).toBeTruthy();
  });

  it('keeps home fixed and renders the cockpit first', () => {
    renderShell();

    expect(screen.getByRole('heading', { name: 'Labo' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Accueil' })).toBeTruthy();
    expect(screen.getByTestId('cleaner-cockpit')).toBeTruthy();
    expect(screen.queryByLabelText('Fermer Accueil')).toBeNull();
  });

  it('opens native Opportunities and preserves the deep-link search filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'opp-1',
                name: 'stale',
                account: '',
                owner: '',
                stage: '',
                anomalies: [],
              },
            ],
            total: 1,
          }),
          { status: 200 },
        ),
      ),
    );
    renderShell({ params: { q: 'stale' } });

    await waitFor(() =>
      expect(
        screen.getByRole('searchbox', { name: 'Rechercher' }),
      ).toBeTruthy(),
    );
    expect(
      screen
        .getByRole('tab', { name: 'Opportunités' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      (
        screen.getByRole('searchbox', {
          name: 'Rechercher',
        }) as HTMLInputElement
      ).value,
    ).toBe('stale');
  });

  it('keeps one tab per module and reopens the existing tab', async () => {
    renderShell();

    fireEvent.click(
      screen.getByRole('button', { name: 'Ouvrir Opportunités' }),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Accueil' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Ouvrir Opportunités' }),
    );

    expect(screen.getAllByRole('tab', { name: 'Opportunités' })).toHaveLength(
      1,
    );
    await waitFor(() =>
      expect(screen.getByTestId('cleaner-module-opportunities')).toBeTruthy(),
    );
    expect(
      screen.getByTestId('cleaner-module-opportunities').closest('[hidden]'),
    ).toBeNull();
    expect(
      screen
        .getByRole('tab', { name: 'Opportunités' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('closes a tab without unmounting its module state', () => {
    renderShell();

    fireEvent.click(
      screen.getByRole('button', { name: 'Ouvrir Opportunités' }),
    );
    const module = screen.getByTestId('cleaner-module-opportunities');
    fireEvent.click(screen.getByLabelText('Fermer Opportunités'));

    expect(
      screen
        .getByRole('tab', { name: 'Accueil' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(module).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Ouvrir Opportunités' }),
    );
    expect(screen.getByTestId('cleaner-module-opportunities')).toBe(module);
  });

  it('persists the session tab state using the X OS storage convention', () => {
    const first = renderShell();
    fireEvent.click(
      screen.getByRole('button', { name: 'Ouvrir Opportunités' }),
    );
    first.unmount();

    expect(window.localStorage.getItem(CLEANER_SHELL_STORAGE_KEY)).toContain(
      'opportunities',
    );

    renderShell();
    expect(
      screen
        .getByRole('tab', { name: 'Opportunités' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('hides modules forbidden by role', () => {
    const state: CleanerTabState = {
      open: ['opportunities'],
      active: 'opportunities',
    };
    renderShell({
      role: 'commercial',
      initialState: state,
      visibleModuleIds: [],
    });

    expect(screen.queryByRole('tab', { name: 'Opportunités' })).toBeNull();
    expect(
      screen
        .getByRole('tab', { name: 'Accueil' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });
});

describe('CleanerShell state helpers', () => {
  it('opens once and closes without mutating unrelated state', () => {
    const initial = createInitialTabState();
    const opened = openModule(
      openModule(initial, 'opportunities'),
      'opportunities',
    );
    expect(opened).toEqual({
      open: ['opportunities'],
      active: 'opportunities',
    });
    expect(closeModule(opened, 'opportunities')).toEqual({
      open: [],
      active: 'home',
    });
  });

  it('rejects a module whose role list does not include the current role', () => {
    expect(moduleAllowedForRole(['manager', 'admin'], 'commercial')).toBe(
      false,
    );
    expect(moduleAllowedForRole(['manager', 'admin'], 'manager')).toBe(true);
  });
});

describe('CleanerCockpit', () => {
  it('shows factual totals and orders modules by criticality without a global score', () => {
    render(
      <CleanerCockpit
        state={{
          status: 'ready',
          summaries: [
            {
              ...readyCockpit.summaries[0],
              criticality: 'warning',
              label: 'B',
              moduleId: 'opportunities',
            },
            {
              ...readyCockpit.summaries[0],
              criticality: 'critical',
              label: 'A',
              moduleId: 'module-a',
              anomalyCount: 4,
              affectedRecordCount: 2,
            },
          ],
        }}
        onOpenModule={() => undefined}
      />,
    );

    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.queryByText(/score global|santé globale/i)).toBeNull();
    const modules = screen.getAllByTestId('cleaner-cockpit-module');
    expect(modules[0].textContent).toContain('A');
    expect(modules[1].textContent).toContain('B');
  });

  it('renders loading, empty and error states as factual states', () => {
    const { rerender } = render(
      <CleanerCockpit
        state={{ status: 'loading', summaries: [] }}
        onOpenModule={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/chargement/i);

    rerender(
      <CleanerCockpit
        state={{ status: 'empty', summaries: [] }}
        onOpenModule={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/aucune donnée/i);

    rerender(
      <CleanerCockpit
        state={{
          status: 'error',
          summaries: [],
          error: 'Service indisponible',
        }}
        onOpenModule={() => undefined}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Service indisponible',
    );
  });
});
