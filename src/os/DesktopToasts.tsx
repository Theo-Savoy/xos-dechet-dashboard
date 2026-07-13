import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Tag } from '../components/ui/Tag';
import {
  markNotificationsRead,
  reactionEmoji,
  type UserNotification,
} from './notifications';
import { useNotificationsStore } from './notificationsStore';
import './desktopToasts.css';

const TOAST_DURATION_MS = 6_000;
const TOAST_EXIT_MS = 180;
const MAX_VISIBLE_TOASTS = 4;

type ToastState = {
  notification: UserNotification;
  phase: 'visible' | 'leaving';
};

function isToastNotification(item: UserNotification): boolean {
  return item.kind === 'session_goal_hit' || item.kind === 'goal_reaction';
}

export function DesktopToasts({ accessToken }: { accessToken: string }) {
  const { notifications, requestOpenControlCenter } = useNotificationsStore();
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const seenToastIds = useRef(new Set<number>());
  const exitTimers = useRef(new Map<number, number>());

  useEffect(() => {
    const fresh = notifications.filter(
      (notification) =>
        isToastNotification(notification) &&
        !seenToastIds.current.has(notification.id),
    );
    if (fresh.length === 0) return;

    for (const notification of fresh) seenToastIds.current.add(notification.id);
    setToasts((previous) =>
      [
        ...previous,
        ...fresh.map((notification) => ({
          notification,
          phase: 'visible' as const,
        })),
      ].slice(-MAX_VISIBLE_TOASTS),
    );
  }, [notifications]);

  const dismissToast = useCallback(
    (id: number, markRead: boolean) => {
      if (markRead) {
        void markNotificationsRead(accessToken, { ids: [id] }).catch(() => {});
      }
      setToasts((previous) =>
        previous.map((toast) =>
          toast.notification.id === id ? { ...toast, phase: 'leaving' } : toast,
        ),
      );
      const timer = window.setTimeout(() => {
        exitTimers.current.delete(id);
        setToasts((previous) =>
          previous.filter((toast) => toast.notification.id !== id),
        );
      }, TOAST_EXIT_MS);
      const existingTimer = exitTimers.current.get(id);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      exitTimers.current.set(id, timer);
    },
    [accessToken],
  );

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.phase === 'visible')
      .map((toast) =>
        window.setTimeout(
          () => dismissToast(toast.notification.id, false),
          TOAST_DURATION_MS,
        ),
      );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [dismissToast, toasts]);

  useEffect(
    () => () => {
      for (const timer of exitTimers.current.values())
        window.clearTimeout(timer);
      exitTimers.current.clear();
    },
    [],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="xos-desktop-toasts" aria-label="Notifications récentes">
      {toasts.map(({ notification, phase }) => {
        const emoji = reactionEmoji(notification);
        const handleClick = () => {
          dismissToast(notification.id, true);
          requestOpenControlCenter();
        };
        return (
          <GlassCard
            key={notification.id}
            className={`xos-desktop-toast xos-desktop-toast--${phase}`}
            role="status"
            aria-live="polite"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleClick();
              }
            }}
          >
            <div className="xos-desktop-toast__head">
              <Tag variant="accent">Combo</Tag>
              <span className="xos-desktop-toast__kind">
                {notification.kind === 'goal_reaction'
                  ? 'Réaction'
                  : 'Objectif'}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="xos-desktop-toast__close"
                aria-label="Fermer la notification"
                onClick={(event) => {
                  event.stopPropagation();
                  dismissToast(notification.id, true);
                }}
              >
                &times;
              </Button>
            </div>
            <h2 className="xos-desktop-toast__title">{notification.title}</h2>
            {emoji ? (
              <p
                className="xos-desktop-toast__emoji"
                aria-label={`Réaction ${emoji}`}
              >
                {emoji}
              </p>
            ) : (
              <p className="xos-desktop-toast__body">{notification.body}</p>
            )}
            <p className="xos-desktop-toast__hint">
              Voir dans le Centre de notifications
            </p>
          </GlassCard>
        );
      })}
    </div>
  );
}
