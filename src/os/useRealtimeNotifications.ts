import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { UserNotification } from './notifications';

type RealtimeNotification = UserNotification & { recipient_id: string };

type UseRealtimeNotificationsOptions = {
  accessToken: string;
  onInsert: (notification: UserNotification) => void | Promise<void>;
  onStatus?: (status: string) => void;
  onEvent?: () => void;
};

/**
 * Subscribes to notifications for the currently authenticated profile only.
 * The API polling loop remains the fallback when Realtime is unavailable.
 */
export function useRealtimeNotifications({
  accessToken,
  onInsert,
  onStatus,
  onEvent,
}: UseRealtimeNotificationsOptions) {
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const subscribe = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user.id;
      if (cancelled || !userId) return;

      // Supabase Realtime private channels require both the `private: true`
      // config AND a recent auth token bound to the socket via setAuth —
      // otherwise postgres_changes events are silently dropped server-side.
      if (session.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      channel = supabase
        .channel(`user-notifications:${userId}`, {
          config: { private: true },
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_notifications',
            // The migration names this column recipient_id (not user_id).
            filter: `recipient_id=eq.${userId}`,
          },
          (payload) => {
            if (import.meta.env.DEV) {
              console.debug('[notifications] Realtime postgres_changes INSERT');
            }
            onEventRef.current?.();
            const row = payload.new as RealtimeNotification;
            // Keep this guard even with the server-side filter: a malformed
            // or misconfigured Realtime binding must never leak another row.
            if (row.recipient_id !== userId) return;
            void onInsertRef.current(row);
          },
        );
      // If Realtime is not enabled for this table, enable it in Supabase
      // Studio > Database > Replication for public.user_notifications.
      channel.subscribe((status) => {
        onStatusRef.current?.(String(status));
      });
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, [accessToken]);
}
