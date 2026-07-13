// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeNotifications } from './useRealtimeNotifications';
import { NotificationsProvider, useNotificationsStore } from './notificationsStore';

const { getSession, channel, on, subscribe, unsubscribe } = vi.hoisted(() => {
  const callbacks: Array<(payload: { new: unknown }) => void> = [];
  const channelObject = {
    on: vi.fn((_event: string, _filter: unknown, callback: (payload: { new: unknown }) => void) => {
      callbacks.push(callback);
      return channelObject;
    }),
    subscribe: vi.fn(() => channelObject),
    unsubscribe: vi.fn().mockResolvedValue('ok'),
  };
  return {
    callbacks,
    getSession: vi.fn().mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'token' } },
    }),
    channel: vi.fn(() => channelObject),
    on: channelObject.on,
    subscribe: channelObject.subscribe,
    unsubscribe: channelObject.unsubscribe,
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession }, channel, realtime: { setAuth: vi.fn() } },
}));

const incoming = {
  id: 99,
  recipient_id: 'user-1',
  kind: 'goal_reaction',
  title: 'Ada réagit',
  body: '🎉',
  payload: { emoji: '🎉' },
  created_at: '2026-07-13T18:00:00.000Z',
  read_at: null,
};

function Harness() {
  const { notifications, setNotifications } = useNotificationsStore();
  useRealtimeNotifications({
    accessToken: 'token',
    onInsert: (notification) => {
      setNotifications((previous) => [notification, ...previous]);
    },
  });
  return <output>{notifications.map((notification) => notification.title).join(',')}</output>;
}

function StatusHarness({
  onStatus,
  onEvent,
}: {
  onStatus: (status: string) => void;
  onEvent: () => void;
}) {
  useRealtimeNotifications({
    accessToken: 'token',
    onInsert: () => {},
    onStatus,
    onEvent,
  });
  return null;
}

describe('useRealtimeNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('subscribes for the authenticated recipient and adds INSERT notifications', async () => {
    render(
      <NotificationsProvider>
        <Harness />
      </NotificationsProvider>,
    );

    await waitFor(() => expect(on).toHaveBeenCalled());
    expect(channel).toHaveBeenCalledWith('user-notifications:user-1', {
      config: { private: true },
    });
    expect(on.mock.calls[0]?.[1]).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'user_notifications',
      filter: 'recipient_id=eq.user-1',
    });

    const callback = on.mock.calls[0]?.[2] as
      | ((payload: { new: unknown }) => void)
      | undefined;
    expect(callback).toBeDefined();
    act(() => callback?.({ new: incoming }));
    vi.advanceTimersByTime(100);
    await waitFor(() => expect(screen.getByText(incoming.title)).toBeTruthy());

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('reports channel status and postgres changes to health observers', async () => {
    const onStatus = vi.fn();
    const onEvent = vi.fn();
    render(
      <NotificationsProvider>
        <StatusHarness onStatus={onStatus} onEvent={onEvent} />
      </NotificationsProvider>,
    );

    await waitFor(() => expect(on).toHaveBeenCalled());
    const subscribeCall = (subscribe as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls[0];
    const subscribeCallback = subscribeCall?.[0] as
      | ((status: string) => void)
      | undefined;
    subscribeCallback?.('SUBSCRIBED');
    expect(onStatus).toHaveBeenCalledWith('SUBSCRIBED');

    const insertCallback = on.mock.calls[0]?.[2] as
      | ((payload: { new: unknown }) => void)
      | undefined;
    act(() => insertCallback?.({ new: incoming }));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
