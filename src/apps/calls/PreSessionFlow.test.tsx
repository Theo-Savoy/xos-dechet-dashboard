// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreSessionFlow } from './PreSessionFlow';
import type { SessionContact, SessionDetail } from './types';

const callsCss = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync('src/apps/calls/calls.css', 'utf8');
});

const preSessionFlowSource = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync('src/apps/calls/PreSessionFlow.tsx', 'utf8');
});

afterEach(cleanup);

const session: SessionDetail = {
  id: 1,
  name: 'Séance test',
  status: 'active',
  created_at: '2026-07-10T10:00:00Z',
};

const contact: SessionContact = {
  id: 1,
  position: 1,
  sf_contact_id: '003000000000001',
  sf_account_id: '001000000000001',
  contact_name: 'Alice Martin',
  account_name: 'Acme',
  phone: '0102030405',
  title: 'Responsable formation',
  linkedin_url: null,
  status: 'pending',
  outcome: null,
  comments: null,
  sf_task_id: null,
  sf_event_id: null,
  called_at: null,
};

describe('PreSessionFlow', () => {
  it('closes on Escape and restores focus to the element that opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onCancel = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <PreSessionFlow
          session={session}
          contacts={[contact]}
          onLaunch={vi.fn().mockResolvedValue(undefined)}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      ) : null;
    }

    render(<Harness />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('offers objectives as accessible selection chips from 1 to 8', async () => {
    const user = userEvent.setup();
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choisir le cap' }));
    expect(screen.getAllByRole('button', { name: /RDV$/ })).toHaveLength(8);
    expect(
      screen
        .getByRole('button', { name: '5 RDV' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: '6 RDV' }));
    expect(
      screen
        .getByRole('button', { name: '6 RDV' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText(/Cap choisi : 6 RDV/)).toBeTruthy();
  });

  it('centralizes phase focus and moves it only after phase changes', async () => {
    const user = userEvent.setup();
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    const reviewTitle = screen.getByRole('heading', {
      name: 'Tout ce qui est actionnable est en ligne.',
    });
    expect(document.activeElement).not.toBe(reviewTitle);
    expect(
      screen.getByRole('list', { name: 'Étapes de préparation' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('listitem', { name: /Matière.*en cours/i }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Choisir le cap' }));
    const objectiveTitle = screen.getByRole('heading', {
      name: 'Le cap guide chaque appel.',
    });
    await waitFor(() => expect(document.activeElement).toBe(objectiveTitle));

    await user.click(screen.getByRole('button', { name: 'Retour' }));
    const returnedReviewTitle = screen.getByRole('heading', {
      name: 'Tout ce qui est actionnable est en ligne.',
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(returnedReviewTitle),
    );

    await user.click(screen.getByRole('button', { name: 'Choisir le cap' }));
    await user.click(screen.getByRole('button', { name: 'Lancer le départ' }));
    const warmupTitle = screen.getByRole('heading', {
      name: 'Prépare le premier appel.',
    });
    await waitFor(() => expect(document.activeElement).toBe(warmupTitle));

    expect(preSessionFlowSource).not.toContain('phaseTitleRef');
    expect(preSessionFlowSource).not.toContain('previousPhaseRef');
  });

  it('lets a valid objective start the accessible warmup countdown', async () => {
    const user = userEvent.setup();
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choisir le cap' }));
    await user.click(screen.getByRole('button', { name: '6 RDV' }));
    await user.click(screen.getByRole('button', { name: 'Lancer le départ' }));

    expect(screen.getByRole('status').textContent).toContain('3');
    expect(screen.getByText(/contact.*prêt.*à appeler/)).toBeTruthy();
  });

  it('automatically hands off at GO exactly once', async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn().mockResolvedValue(undefined);
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choisir le cap' }));
    await user.click(screen.getByRole('button', { name: 'Lancer le départ' }));

    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(screen.getByRole('status').textContent).toContain('GO');
    expect(screen.getByText('Ouverture de la séance…')).toBeTruthy();
    expect(
      screen.getByRole('dialog').querySelector('.calls-pre-session')?.className,
    ).toContain('calls-pre-session--handoff');
    expect(
      screen.queryByRole('button', { name: 'Entrer dans la séance' }),
    ).toBeNull();
    expect(onLaunch).toHaveBeenCalledWith(5);

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it('keeps launch failures visible and allows one deliberate retry', async () => {
    const user = userEvent.setup();
    const onLaunch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Choisir le cap' }));
    await user.click(screen.getByRole('button', { name: 'Lancer le départ' }));
    await screen.findByRole(
      'alert',
      { name: 'Échec du départ' },
      { timeout: 3000 },
    );

    expect(
      screen.getByText(
        'Le départ n’a pas abouti. Vérifie la connexion puis relance.',
      ),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Relancer le départ' }),
    );
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(2), {
      timeout: 1000,
    });
  });

  it('uses launch-gate copy for the intelligence and objective stages', async () => {
    const user = userEvent.setup();
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Matière prête')).toBeTruthy();
    expect(screen.queryByText('Manifeste')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Choisir le cap' }));
    expect(screen.getByText('Cap de la séance')).toBeTruthy();
    expect(screen.getByText('Objectif verrouillé au départ.')).toBeTruthy();
    expect(screen.queryByText(/Combien de rendez-vous veux-tu/)).toBeNull();
  });

  it('shows the recall nudge with a link when recalls are due today', () => {
    const onOpenRecalls = vi.fn();
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        recallQueueCount={3}
        onOpenRecalls={onOpenRecalls}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('note', { name: 'Suggestion de départ' }).textContent,
    ).toContain('Commence par les rappels : 3 dûs aujourd\'hui');
    fireEvent.click(screen.getByRole('button', { name: 'Voir les rappels' }));
    expect(onOpenRecalls).toHaveBeenCalledTimes(1);
  });

  it('shows the inactivity nudge when the last session was over 7 days ago', () => {
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        daysSinceLastSession={9}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/Ça fait/)).toBeTruthy();
    expect(screen.getByText(/on reprend avec tes presets/)).toBeTruthy();
  });

  it('stays silent when there is nothing to suggest', () => {
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        recallQueueCount={0}
        daysSinceLastSession={2}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('note', { name: 'Suggestion de départ' })).toBeNull();
  });

  it('exposes the pre-session responsive safeguards in the calls stylesheet', async () => {
    expect(callsCss).toContain('.calls-pre-session');
    expect(callsCss).toContain('max-height: calc(100dvh - 2rem)');
    expect(callsCss).toContain('.calls-pre-session__accounts');
    expect(callsCss).toContain('backdrop-filter: blur(28px) saturate(145%)');
    expect(callsCss).toMatch(
      /\.calls-pre-session__underlay\s*{[^}]*filter: blur\(14px\)/,
    );
    expect(callsCss).toContain('.calls-stat__progress');
    expect(callsCss).toContain('.calls-stat--rdv-heat-1');
    expect(callsCss).toContain('calls-pre-session-handoff');
    expect(callsCss).toContain('prefers-reduced-motion: reduce');
  });
});
