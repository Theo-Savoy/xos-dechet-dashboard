// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopToasts } from './DesktopToasts';
import { NotificationsProvider } from './notificationsStore';
import { ControlCenter } from './ControlCenter';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn().mockResolvedValue('ok'),
    })),
  },
}));

const goalHit = {
  id: 7,
  kind: 'session_goal_hit',
  title: 'Objectif atteint !',
  body: 'Bravo, 10 RDV obtenus.',
  payload: {},
  created_at: '2026-07-13T18:00:00.000Z',
  read_at: null,
};

const xpPalier = {
  id: 9,
  kind: 'xp_palier_atteint',
  title: 'Argent vitesse · 30 raccourcis cumulés',
  body: '',
  payload: { axe: 'vitesse', palier: 'argent' },
  created_at: '2026-07-13T18:00:00.000Z',
  read_at: null,
};

const streakPalier = {
  id: 10,
  kind: 'streak_palier_atteint',
  title: '14 jours d’affilée',
  body: '',
  payload: { type: 'classique', jours: 14 },
  created_at: '2026-07-13T18:00:00.000Z',
  read_at: null,
};

const goalReaction = {
  id: 8,
  kind: 'goal_reaction',
  title: 'Ada réagit',
  body: '🎉',
  payload: { emoji: '🎉' },
  created_at: '2026-07-13T18:00:00.000Z',
  read_at: null,
};

describe('DesktopToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders a toast for a session goal notification', () => {
    render(
      <NotificationsProvider initialNotifications={[goalHit]}>
        <DesktopToasts accessToken="token" />
      </NotificationsProvider>,
    );

    expect(screen.getByRole('status').textContent).toContain(
      'Objectif atteint !',
    );
    expect(screen.getByText('Bravo, 10 RDV obtenus.')).toBeTruthy();
  });

  it('renders an xp_palier_atteint toast with its emoji and success color', () => {
    render(
      <NotificationsProvider initialNotifications={[xpPalier]}>
        <DesktopToasts accessToken="token" />
      </NotificationsProvider>,
    );

    const toast = screen.getByRole('status');
    expect(toast.className).toContain('xos-desktop-toast--success');
    expect(toast.textContent).toContain('📈 Argent vitesse · 30 raccourcis cumulés');
    expect(screen.getByText('Palier')).toBeTruthy();
  });

  it('renders a streak_palier_atteint toast with the accent color', () => {
    render(
      <NotificationsProvider initialNotifications={[streakPalier]}>
        <DesktopToasts accessToken="token" />
      </NotificationsProvider>,
    );

    const toast = screen.getByRole('status');
    expect(toast.className).toContain('xos-desktop-toast--streak');
    expect(toast.textContent).toContain('🔥 14 jours d’affilée');
    expect(screen.getByText('Streak')).toBeTruthy();
  });

  it('dismisses a clicked toast and marks its notification read', () => {
    render(
      <NotificationsProvider initialNotifications={[goalHit]}>
        <DesktopToasts accessToken="token" />
      </NotificationsProvider>,
    );

    fireEvent.click(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(180));

    expect(screen.queryByRole('status')).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      '/api/notifications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'mark_read', ids: [goalHit.id] }),
      }),
    );
  });

  it('opens the inline reaction picker when a goal toast is activated', async () => {
    vi.useRealTimers();
    const freshGoalHit = { ...goalHit, created_at: new Date().toISOString() };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ notifications: [freshGoalHit], unread_count: 1 }),
            { status: 200 },
          ),
        ),
      ),
    );
    render(
      <NotificationsProvider initialNotifications={[freshGoalHit]}>
        <ControlCenter accessToken="token" />
        <DesktopToasts accessToken="token" />
      </NotificationsProvider>,
    );

    await screen.findByText(freshGoalHit.title);
    fireEvent.click(screen.getByRole('status'));

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Réagir 🎉' })).toBeTruthy();
  });

  it('auto-dismisses without marking the notification read', () => {
    render(
      <NotificationsProvider initialNotifications={[goalHit]}>
        <DesktopToasts accessToken="token" />
      </NotificationsProvider>,
    );

    act(() => vi.advanceTimersByTime(6180));

    expect(screen.queryByRole('status')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows reactions briefly and marks them read after the burst grace period', () => {
    render(
      <NotificationsProvider initialNotifications={[goalReaction]}>
        <DesktopToasts accessToken="token" />
      </NotificationsProvider>,
    );

    expect(screen.getByRole('status').textContent).toContain('Ada réagit');

    act(() => vi.advanceTimersByTime(500));
    expect(fetch).toHaveBeenCalledWith(
      '/api/notifications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'mark_read', ids: [goalReaction.id] }),
      }),
    );

    act(() => vi.advanceTimersByTime(1_180));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
