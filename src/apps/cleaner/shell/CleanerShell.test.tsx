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
      moduleId: 'recettes',
      recipeId: 'opportunities',
      label: 'Opportunités suspectes ou abandonnées',
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
  it('opens the Secteurs cockpit tile inside the Recettes top-level tab', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal('fetch', fetchMock);
    renderShell({
      cockpit: {
        status: 'ready',
        summaries: [
          {
            moduleId: 'recettes',
            recipeId: 'sectors',
            label: 'Secteurs obsolètes',
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

    fireEvent.click(
      screen.getByRole('button', { name: /Secteurs obsolètes/ }),
    );

    expect(screen.getByRole('tab', { name: 'Recettes' })).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: /Secteurs obsolètes/ }),
    ).toBeTruthy();
    // Token propagation is verified via the fetch spy rather than a DOM node:
    // the shell must forward the accessToken prop as a Bearer header.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers?.Authorization).toBe('Bearer test-token');
  });

  it('completes a sector merge from Labo navigation with the V17d dry-run flow', async () => {
    let recipeReads = 0;
    let jobPolls = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_input, init) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          if (body.action === 'bulk_apply') {
            return new Response(JSON.stringify({ ok: true, jobId: 'job-1' }), {
              status: 200,
            });
          }
          return new Response(JSON.stringify({ updated: 1, failed: 0 }), {
            status: 200,
          });
        }
        const url =
          typeof _input === 'string'
            ? _input
            : _input?.url || '';
        if (url.includes('action=status')) {
          jobPolls += 1;
          return new Response(
            JSON.stringify({
              status: jobPolls >= 2 ? 'done' : 'running',
              total: 1,
              processed: jobPolls,
              errors: [],
            }),
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
            suggestedMappings: { finance: 'transports' },
            accountsPerSector:
              recipeReads === 1 ? { finance: ['001-a'] } : {},
            capabilities: { canApplyMerge: true },
          }),
          { status: 200 },
        );
      });
    vi.stubGlobal('fetch', fetchMock);
    renderShell({
      role: 'manager',
      cockpit: {
        status: 'ready',
        summaries: [
          {
            moduleId: 'recettes',
            recipeId: 'sectors',
            label: 'Secteurs obsolètes',
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

    // Open the recipe from the cockpit tile (legacy path still works).
    fireEvent.click(
      screen.getByRole('button', { name: /Secteurs obsolètes/ }),
    );
    await screen.findByText(/Finance/);
    // The new flow exposes a single 'Fusionner N secteurs' button — no
    // separate preview / confirm step. Clicking it opens a confirmation
    // modal that runs the dry-run server-side.
    fireEvent.click(
      await screen.findByRole('button', { name: /Fusionner 1 secteur/ }),
    );
    expect(
      await screen.findByText(/serveur lance un dry-run/i),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Fusionner' }),
    );
    // The success modal appears after the job completes.
    expect(
      await screen.findByText(/1 fusion réussie/, {}, { timeout: 6000 }),
    ).toBeTruthy();
  });

  it('keeps home fixed and renders only the recipes grid', () => {
    renderShell();

    expect(screen.getByRole('heading', { name: 'Labo' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Accueil' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recettes du Labo' })).toBeTruthy();
    expect(screen.queryByTestId('cleaner-cockpit')).toBeNull();
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
        .getByRole('tab', { name: 'Recettes' })
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
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Accueil' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    );

    expect(screen.getAllByRole('tab', { name: 'Recettes' })).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId('cleaner-recipe-opportunities')).toBeTruthy(),
    );
    expect(
      screen.getByTestId('cleaner-recipe-opportunities').closest('[hidden]'),
    ).toBeNull();
    expect(
      screen
        .getByRole('tab', { name: 'Recettes' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('closes a tab without unmounting its module state', () => {
    renderShell();

    fireEvent.click(
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    );
    const module = screen.getByTestId('cleaner-recipe-opportunities');
    fireEvent.click(screen.getByLabelText('Fermer Recettes'));

    expect(
      screen
        .getByRole('tab', { name: 'Accueil' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(module).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    );
    expect(screen.getByTestId('cleaner-recipe-opportunities')).toBe(module);
  });

  it('persists the session tab state using the X OS storage convention', () => {
    const first = renderShell();
    fireEvent.click(
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    );
    first.unmount();

    expect(window.localStorage.getItem(CLEANER_SHELL_STORAGE_KEY)).toContain(
      'recettes',
    );

    renderShell();
    expect(
      screen
        .getByRole('tab', { name: 'Recettes' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('hides modules forbidden by role', () => {
    const state: CleanerTabState = {
      open: ['recettes'],
      active: 'recettes',
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
    const opened = openModule(openModule(initial, 'recettes'), 'recettes');
    expect(opened).toEqual({
      open: ['recettes'],
      active: 'recettes',
    });
    expect(closeModule(opened, 'recettes')).toEqual({
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
              moduleId: 'recettes',
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
