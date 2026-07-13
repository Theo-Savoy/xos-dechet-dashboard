// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpportunitiesModule } from './OpportunitiesModule';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: id === 'opp-1' ? 'Alpha' : id === 'opp-2' ? 'Beta' : 'Gamma',
  account: id === 'opp-1' ? 'Acme' : 'Globex',
  owner: id === 'opp-3' ? 'Bob' : 'Alice',
  stage: id === 'opp-2' ? 'Proposal' : 'Qualification',
  amount: id === 'opp-1' ? 100 : id === 'opp-2' ? 300 : 200,
  probability: 50,
  close_date: '2026-08-15',
  last_activity: '2026-07-10',
  type_vente: id === 'opp-3' ? 'Renewal' : 'New business',
  category: id === 'opp-3' ? 'owner' : 'amount',
  score: id === 'opp-2' ? 20 : 10,
  anomalies: [
    {
      ruleId:
        id === 'opp-3'
          ? 'opportunity.owner.inactive'
          : 'opportunity.amount.missing',
      severity: 'critical',
      score: 10,
      label: id === 'opp-3' ? 'Propriétaire inactif' : 'Montant manquant',
      evidence: [
        { field: 'amount', actual: null, expected: 'Un montant est requis' },
      ],
    },
  ],
  salesforce_url: `https://example.my.salesforce.com/${id}`,
  history: [
    {
      date: '2026-07-01',
      action: 'Diagnostic',
      detail: 'Détecté',
      before: '—',
      after: 'À corriger',
    },
  ],
  ...overrides,
});

function mockWorkspace(items = [item('opp-1'), item('opp-2'), item('opp-3')]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items,
          total: items.length,
          nextCursor: null,
          metadata: { fetchedAt: '2026-07-13T09:00:00.000Z' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ),
  );
}

describe('OpportunitiesModule', () => {
  it('renders the dominant table with all required columns and factual KPIs', async () => {
    mockWorkspace();
    render(<OpportunitiesModule accessToken="token" />);

    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'Nom' })).toBeTruthy(),
    );
    for (const label of [
      'Catégorie',
      'Score',
      'Compte',
      'Owner',
      'Étape',
      'Close date',
      'Retard',
      'Montant',
      'Probabilité',
      'Dernière activité',
      'Raisons',
      'Lien SF',
      'Type de vente',
      'Actions',
      'Evidence',
    ]) {
      expect(screen.getByRole('columnheader', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('Opportunités à examiner')).toBeTruthy();
    expect(screen.queryByText(/score global|santé globale/i)).toBeNull();
  });

  it('supports search, deterministic sort, pagination and owner/category/type filters', async () => {
    mockWorkspace();
    render(<OpportunitiesModule accessToken="token" />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher' }), {
      target: { value: 'Beta' },
    });
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Trier par Montant/i }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('Alpha');
    fireEvent.click(screen.getByRole('button', { name: /Trier par Montant/i }));
    expect(screen.getAllByRole('row').slice(1)[0].textContent).toContain(
      'Beta',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Owner' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bob' }));
    expect(screen.getByText('Gamma')).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Catégorie' }));
    fireEvent.click(screen.getByRole('option', { name: 'amount' }));
    expect(screen.queryByText('Gamma')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Catégorie' }));
    fireEvent.click(
      screen.getByRole('option', { name: 'Toutes les catégories' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Type de vente' }));
    fireEvent.click(screen.getByRole('option', { name: 'Renewal' }));
    expect(screen.getByText('Gamma')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Owner' }));
    fireEvent.click(screen.getByRole('option', { name: 'Tous les owners' }));
    fireEvent.click(screen.getByRole('button', { name: 'Type de vente' }));
    fireEvent.click(screen.getByRole('option', { name: 'Tous les types' }));
    expect(
      screen
        .getByRole('button', { name: 'Page suivante' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('uses 25-row pages and groups the reason selector by legacy families', async () => {
    const items = Array.from({ length: 26 }, (_, index) =>
      item(`opp-${index + 1}`, {
        name: `Opportunity ${index + 1}`,
        score: index === 25 ? 1 : 10,
        anomalies:
          index === 0
            ? [
                {
                  ruleId: 'opportunity.close_date.past',
                  severity: 'warning',
                  score: 3,
                  label: 'Date de clôture dépassée',
                  evidence: [],
                },
                {
                  ruleId: 'opportunity.amount.missing',
                  severity: 'critical',
                  score: 6,
                  label: 'Montant absent',
                  evidence: [],
                },
              ]
            : [],
      }),
    );
    mockWorkspace(items);
    render(<OpportunitiesModule accessToken="token" />);

    await waitFor(() => expect(screen.getByText('Opportunity 1')).toBeTruthy());
    expect(
      screen.getByText((_, element) => element?.textContent === 'Page 1 / 2'),
    ).toBeTruthy();
    expect(screen.getByText('Critiques')).toBeTruthy();
    expect(screen.getByText('Avertissements')).toBeTruthy();
    expect(screen.getByText('Sans anomalie')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Raisons' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Raisons' }));
    expect(screen.getByText('⏰ Close date dépassée')).toBeTruthy();
    expect(screen.getByText('💰 Absence de montant')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Traitées' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }));
    expect(
      screen.getByText((_, element) => element?.textContent === 'Page 2 / 2'),
    ).toBeTruthy();
    expect(screen.getByText('Opportunity 26')).toBeTruthy();
  });

  it('selects one row, the current page and all filtered rows, preserving selection across views', async () => {
    mockWorkspace([
      item('opp-1'),
      item('opp-2'),
      item('opp-3'),
      ...Array.from({ length: 23 }, (_, index) =>
        item(`opp-extra-${index + 1}`, { name: `Extra ${index + 1}` }),
      ),
    ]);
    render(<OpportunitiesModule accessToken="token" />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sélectionner Alpha' }),
    );
    expect(screen.getByText('1 sélectionnée')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Synthèse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nettoyage' }));
    expect(screen.getByText('1 sélectionnée')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sélectionner la page' }),
    );
    expect(screen.getByText('25 sélectionnées')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: /Sélectionner les 26 résultats filtrés/i,
      }),
    );
    expect(screen.getByText('26 sélectionnées')).toBeTruthy();
  });

  it('opens detail from row content but not from a checkbox', async () => {
    mockWorkspace([item('opp-1')]);
    render(<OpportunitiesModule accessToken="token" />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sélectionner Alpha' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Alpha' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Un montant est requis')).toBeTruthy();
    expect(screen.getByText('Valeur actuelle')).toBeTruthy();
    expect(screen.getByText('Valeur attendue')).toBeTruthy();
    expect(screen.getByText(/Avant : — · Après : À corriger/)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Voir dans Salesforce' })
        .getAttribute('href'),
    ).toContain('opp-1');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le détail' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows loading, empty and error states and exposes internal view tabs', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [] }), { status: 200 }),
        ),
    );
    render(<OpportunitiesModule accessToken="token" />);
    expect(screen.getByRole('status')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/Aucune opport|ne nécessite|Aucune donnée/)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Historique' })).toBeTruthy();

    cleanup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Service indisponible')),
    );
    render(<OpportunitiesModule accessToken="token" />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Service indisponible',
      ),
    );
  });
});
