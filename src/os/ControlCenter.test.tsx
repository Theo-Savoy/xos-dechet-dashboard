// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlCenter } from './ControlCenter';
import { NotificationsProvider, useNotificationsStore } from './notificationsStore';

const goalHit = {
  id: 42,
  kind: 'session_goal_hit',
  title: 'Objectif atteint !',
  body: 'Bravo, 10 RDV obtenus.',
  payload: {},
  created_at: new Date().toISOString(),
  read_at: null,
};

const goalReaction = {
  id: 43,
  kind: 'goal_reaction',
  title: 'Ada réagit',
  body: '🎉',
  payload: { emoji: '🎉' },
  created_at: new Date().toISOString(),
  read_at: null,
};

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

describe('ControlCenter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve(new Response('{}', { status: 200 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ notifications: [goalHit], unread_count: 1 }),
            { status: 200 },
          ),
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function postedEmojis(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => {
        if (typeof init?.body !== 'string') return null;
        try {
          const body = JSON.parse(init.body) as { emoji?: unknown };
          return typeof body.emoji === 'string' ? body.emoji : null;
        } catch {
          return null;
        }
      })
      .filter((emoji): emoji is string => emoji !== null);
  }

  async function openGoalHit() {
    const user = userEvent.setup();
    render(
      <NotificationsProvider>
        <ControlCenter accessToken="token" />
      </NotificationsProvider>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Centre de notifications' }),
    );
    await waitFor(() => expect(screen.getByText(goalHit.title)).toBeTruthy());
    return user;
  }

  it('dispatches the selected quick reaction emoji', async () => {
    const user = await openGoalHit();

    await user.click(screen.getByRole('button', { name: 'Réagir 🔥' }));

    await waitFor(() => expect(postedEmojis()).toContain('🔥'));
  });

  it('opens the picker from the more reactions button', async () => {
    const user = await openGoalHit();
    const moreButton = screen.getByRole('button', {
      name: 'Plus de réactions',
    });

    await user.click(moreButton);

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    expect(moreButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('dispatches a picker reaction and closes the picker', async () => {
    const user = await openGoalHit();

    await user.click(
      screen.getByRole('button', { name: 'Plus de réactions' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Réagir 🎉' }));

    await waitFor(() => expect(postedEmojis()).toContain('🎉'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the picker on Escape and returns focus to its trigger', async () => {
    const user = await openGoalHit();
    const moreButton = screen.getByRole('button', {
      name: 'Plus de réactions',
    });

    await user.click(moreButton);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(moreButton);
  });

  it('closes the picker when clicking outside and returns focus to its trigger', async () => {
    const user = await openGoalHit();
    const moreButton = screen.getByRole('button', {
      name: 'Plus de réactions',
    });

    await user.click(moreButton);
    await user.click(screen.getByRole('heading', { name: 'Notifications' }));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(moreButton);
  });

  it('hides a reacted item after the thirty-minute TTL', async () => {
    render(
      <NotificationsProvider>
        <ControlCenter accessToken="token" />
      </NotificationsProvider>,
    );

    screen.getByRole('button', { name: 'Centre de notifications' }).click();
    await waitFor(() => expect(screen.getByText(goalHit.title)).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByTitle('Réagir 👏'));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 10_000);
    expect(screen.queryByText(goalHit.title)).toBeTruthy();
    // A polling render re-evaluates the locally persisted reaction timestamp.
    act(() => {
      screen.getByRole('button', { name: 'Centre de notifications' }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'Centre de notifications' }).click();
    });

    expect(screen.queryByText(goalHit.title)).toBeNull();
  });

  it('hides a fresh reaction after triggering its burst and marks it read after 0.5s', async () => {
    const initialResponse = new Response(
      JSON.stringify({ notifications: [], unread_count: 0 }),
      { status: 200 },
    );
    const reactionResponse = new Response(
      JSON.stringify({ notifications: [goalReaction], unread_count: 1 }),
      { status: 200 },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initialResponse)
      .mockResolvedValueOnce(reactionResponse)
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <NotificationsProvider>
        <ControlCenter accessToken="token" />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(
      screen.getByRole('button', { name: 'Centre de notifications' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(goalReaction.title)).toBeNull();
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    expect(fetchMock.mock.calls.some(([, init]) => {
      if (init?.method !== 'POST' || typeof init.body !== 'string') return false;
      return init.body === JSON.stringify({ action: 'mark_read', ids: [goalReaction.id] });
    })).toBe(true);
  });

  it('does not poll while realtime has received an event recently', async () => {
    function MarkRealtimeHealthy() {
      const { markRealtimeEvent } = useNotificationsStore();
      useEffect(() => {
        markRealtimeEvent();
      }, [markRealtimeEvent]);
      return null;
    }

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ notifications: [], unread_count: 0 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NotificationsProvider>
        <MarkRealtimeHealthy />
        <ControlCenter accessToken="token" />
      </NotificationsProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => vi.advanceTimersByTime(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
