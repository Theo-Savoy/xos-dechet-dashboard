// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppManifest } from '../../os/registry';

const { getSession, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession, signOut } },
}));
import HubApp from './HubApp';

const managerPayload = {
  role: 'manager',
  capabilities: { manageSettings: true, manageRoles: false },
  profile: {
    email: 'ada@xos-learning.fr',
    fullName: 'Ada Lovelace',
    sfUserId: '005xx',
  },
  salesforce: {
    connected: true,
    dailyApiRequests: { max: 15000, remaining: 14900 },
  },
  cache: { cleaner: { version: 'history/latest.json' } },
  version: 'abc123',
  settings: [],
  cleanerSettings: {
    key: 'cleaner_v2',
    defaults: {
      amountImplausibleMax: 100,
      closeDateCriticalDays: 90,
      opportunityOldDays: 365,
      opportunityVeryOldDays: 730,
      score: {
        overduePointEveryDays: 30,
        overdueCap: 12,
        neverActive: 8,
        inactive30Days: 2,
        inactive90Days: 5,
        inactive365Days: 5,
        amountMissing: 6,
        amountImplausible: 10,
        probabilityZero: 3,
        ownerInactive: 10,
        formerEmployee: 8,
        oldOpportunity: 2,
        veryOldOpportunity: 4,
        stalledStage: 3,
        amountPointEvery: 10000,
        amountCap: 5,
      },
    },
    effective: {
      amountImplausibleMax: 250,
      closeDateCriticalDays: 90,
      opportunityOldDays: 365,
      opportunityVeryOldDays: 730,
      score: {
        overduePointEveryDays: 30,
        overdueCap: 12,
        neverActive: 8,
        inactive30Days: 2,
        inactive90Days: 5,
        inactive365Days: 5,
        amountMissing: 6,
        amountImplausible: 10,
        probabilityZero: 3,
        ownerInactive: 10,
        formerEmployee: 8,
        oldOpportunity: 2,
        veryOldOpportunity: 4,
        stalledStage: 3,
        amountPointEvery: 10000,
        amountCap: 5,
      },
    },
    warnings: [],
  },
};

const targetsPayload = {
  quarter: { label: 'FY27-Q1', from: '2026-07-01', to: '2026-09-30' },
  seasonality: { as_of: '2026-07-01', sample_years: [2024, 2025, 2026] },
  month_template: [
    { month: '07', weight: 0.2 },
    { month: '08', weight: 0.3 },
    { month: '09', weight: 0.5 },
  ],
  rows: [
    {
      sf_user_id: '005xx',
      name: 'Ada Lovelace',
      email: 'ada@xos-learning.fr',
      role: 'commercial',
      quarterly_target: 60000,
      monthly_indicative: [
        {
          month: '07',
          label: 'Juil.',
          weight: 0.2,
          raw: 12000,
          indicative: 10000,
        },
        {
          month: '08',
          label: 'Août',
          weight: 0.3,
          raw: 18000,
          indicative: 25000,
        },
        {
          month: '09',
          label: 'Sept.',
          weight: 0.5,
          raw: 30000,
          indicative: 25000,
        },
      ],
    },
  ],
};

beforeEach(() => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'token' } },
  });
  signOut.mockResolvedValue({ error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/api/weekly-targets')) {
        return Promise.resolve(
          new Response(JSON.stringify(targetsPayload), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(managerPayload), { status: 200 }),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Hub app', () => {
  it('is registered for managers and admins only (dock gating)', () => {
    const manifest = getAppManifest('hub');
    expect(manifest?.id).toBe('hub');
    expect(manifest?.roles).toEqual(['manager', 'admin']);
  });

  it('renders manager settings from the status payload and does not expose role management', async () => {
    render(<HubApp />);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(await screen.findByText('Trimestre en cours')).toBeTruthy();
    expect(await screen.findByText(/Juil\./)).toBeTruthy();
    expect(screen.queryByText('Accès & rôles')).toBeNull();
    expect(
      screen.getByText(/100 utilisés \/ 15.000 — 14.900 restants/),
    ).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/status',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('renders typed cleaner_v2 fields and shows field validation errors', async () => {
    render(<HubApp />);
    expect(
      (
        (await screen.findByLabelText(
          'Montant incohérent au-delà de',
        )) as HTMLInputElement
      ).value,
    ).toBe('250');
    expect(screen.queryByLabelText('Clé du paramètre')).toBeNull();

    fireEvent.change(screen.getByLabelText('Montant incohérent au-delà de'), {
      target: { value: '0' },
    });
    expect(screen.getByText(/doit être compris/i)).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Enregistrer les seuils',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('shows saving lock and server errors for cleaner_v2', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : input.toString();
        if (init?.method === 'POST') return new Promise(() => {});
        if (url.endsWith('/api/weekly-targets'))
          return Promise.resolve(
            new Response(JSON.stringify(targetsPayload), { status: 200 }),
          );
        return Promise.resolve(
          new Response(JSON.stringify(managerPayload), { status: 200 }),
        );
      },
    );
    render(<HubApp />);
    await screen.findByLabelText('Montant incohérent au-delà de');
    fireEvent.change(screen.getByLabelText('Montant incohérent au-delà de'), {
      target: { value: '300' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Enregistrer les seuils' }),
    );
    expect(
      (
        screen.getByRole('button', {
          name: /Enregistrement/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('shows a structured server error after a rejected cleaner_v2 save', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : input.toString();
        if (init?.method === 'POST')
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: 'invalid_cleaner_v2',
                message: 'Seuil refusé',
              }),
              { status: 400 },
            ),
          );
        if (url.endsWith('/api/weekly-targets'))
          return Promise.resolve(
            new Response(JSON.stringify(targetsPayload), { status: 200 }),
          );
        return Promise.resolve(
          new Response(JSON.stringify(managerPayload), { status: 200 }),
        );
      },
    );
    render(<HubApp />);
    await screen.findByLabelText('Montant incohérent au-delà de');
    fireEvent.change(screen.getByLabelText('Montant incohérent au-delà de'), {
      target: { value: '300' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Enregistrer les seuils' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Seuil refusé'),
    );
  });

  it('does not render a logout button anymore (moved to the desktop menubar)', async () => {
    render(<HubApp />);
    await screen.findByText('Compte');
    expect(screen.queryByRole('button', { name: 'Déconnexion' })).toBeNull();
  });
});
