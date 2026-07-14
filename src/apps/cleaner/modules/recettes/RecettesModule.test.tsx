// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecettesModule } from './RecettesModule';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RecettesModule', () => {
  it('lists every recipe before opening one', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [], total: 0 }), {
            status: 200,
          }),
        ),
    );

    render(<RecettesModule accessToken="token" role="manager" />);

    expect(
      screen.getByRole('heading', { name: 'Recettes du Labo' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Secteurs obsolètes/ }),
    ).toBeTruthy();
    expect(screen.queryByText('Nettoyage')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    );

    expect(await screen.findByText('Nettoyage')).toBeTruthy();
    expect(screen.getByText('Synthèse')).toBeTruthy();
    expect(screen.getByText('Historique')).toBeTruthy();
  });

  it('hides the Secteurs recipe from commercial roles', () => {
    render(<RecettesModule accessToken="token" role="commercial" />);

    expect(
      screen.getByRole('button', {
        name: /Opportunités suspectes ou abandonnées/,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Secteurs obsolètes/ }),
    ).toBeNull();
  });
});
