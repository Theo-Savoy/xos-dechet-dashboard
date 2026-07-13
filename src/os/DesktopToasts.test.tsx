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

const goalHit = {
  id: 7,
  kind: 'session_goal_hit',
  title: 'Objectif atteint !',
  body: 'Bravo, 10 RDV obtenus.',
  payload: {},
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
