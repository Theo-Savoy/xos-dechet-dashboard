// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({
    data: {
      session: {
        access_token: 'cleaner-jwt',
        user: { email: 'commercial@xos.test', user_metadata: {} },
      },
    },
  }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession } },
}));

import { appRegistry, getAppManifest } from '../../os/registry';
import CleanerApp from './CleanerApp';

afterEach(() => {
  cleanup();
  getSession.mockClear();
  vi.unstubAllGlobals();
});

describe('Cleaner app manifest', () => {
  it("is registered with id 'cleaner'", () => {
    const manifest = getAppManifest('cleaner');
    expect(manifest).toBeDefined();
    expect(manifest?.id).toBe('cleaner');
  });

  it("has title 'Labo'", () => {
    const manifest = getAppManifest('cleaner');
    expect(manifest?.title).toBe('Labo');
  });

  it('keeps the desktop default size without changing the OS registry', () => {
    const manifest = getAppManifest('cleaner');
    expect(manifest?.defaultSize.w).toBeGreaterThanOrEqual(1000);
    expect(manifest?.defaultSize.h).toBeGreaterThanOrEqual(500);
    expect(manifest?.defaultSize.h).toBeLessThanOrEqual(600);
  });

  it('has a unique id among all registered apps', () => {
    const ids = appRegistry.map((app) => app.id);
    expect(ids.filter((id) => id === 'cleaner')).toHaveLength(1);
  });
});

describe('CleanerApp component', () => {
  it('boots the native Labo shell instead of the legacy iframe boundary', async () => {
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
    render(<CleanerApp params={{ q: 'stale' }} />);

    await waitFor(() =>
      expect(
        screen.getByRole('searchbox', { name: 'Rechercher' }),
      ).toBeTruthy(),
    );
    expect(screen.queryByTitle('Labo')).toBeNull();
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
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('keeps the session token in the native module context', async () => {
    render(<CleanerApp />);

    await waitFor(() =>
      expect(
        screen
          .getByTestId('cleaner-session-state')
          .getAttribute('data-access-token'),
      ).toBe('cleaner-jwt'),
    );
  });

  it('loads cockpit modules on the home tab without a deep-link query', async () => {
    window.localStorage?.clear();
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
                anomalies: [{ code: 'stale_stage' }],
              },
              {
                id: 'opp-2',
                name: 'blocked',
                account: '',
                owner: '',
                stage: '',
                anomalies: [],
              },
            ],
            total: 2,
          }),
          { status: 200 },
        ),
      ),
    );

    render(<CleanerApp />);

    await waitFor(() =>
      expect(screen.getAllByTestId('cleaner-cockpit-module')).toHaveLength(2),
    );
    expect(
      screen
        .getAllByTestId('cleaner-cockpit-module')
        .some((module) =>
          module.textContent?.includes('2 enregistrements concernés'),
        ),
    ).toBe(true);
    expect(
      screen.queryByText('Aucune donnée de nettoyage disponible.'),
    ).toBeNull();
  });

  it('keeps one cockpit tile per recipe when Opportunities has no items', async () => {
    window.localStorage?.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
        }),
      ),
    );

    render(<CleanerApp />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Ouvrir Secteurs obsolètes' }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole('button', {
        name: 'Ouvrir Opportunités suspectes ou abandonnées',
      }),
    ).toBeTruthy();
  });
});
