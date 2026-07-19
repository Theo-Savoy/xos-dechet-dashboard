import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Tag } from '../components/ui/Tag';
import {
  GAMIFICATION_TOAST_EMOJI,
  GAMIFICATION_TOAST_LABEL,
  isGamificationToastKind,
  markNotificationsRead,
  reactionEmoji,
  type UserNotification,
} from './notifications';
import { useNotificationsStore } from './notificationsStore';
import './desktopToasts.css';

const TOAST_DURATION_MS = 6_000;
const REACTION_TOAST_DURATION_MS = 1_500;
const REACTION_READ_GRACE_MS = 500;
const TOAST_EXIT_MS = 180;
const MAX_VISIBLE_TOASTS = 4;
const REACTION_TTL_MS = 30 * 60 * 1000;

type ToastState = {
  notification: UserNotification;
  phase: 'visible' | 'leaving';
};

function isToastNotification(item: UserNotification): boolean {
  return (
    item.kind === 'session_goal_hit' ||
    item.kind === 'goal_reaction' ||
    isGamificationToastKind(item.kind)
  );
}

function gamificationToastColorClass(kind: string): string | null {
  if (kind === 'xp_palier_atteint' || kind === 'badge_one_timer') {
    return 'xos-desktop-toast--success';
  }
  if (kind === 'streak_palier_atteint') return 'xos-desktop-toast--streak';
  return null;
}

function isReactedExpired(timestamp: number | undefined): boolean {
  return timestamp !== undefined && Date.now() - timestamp > REACTION_TTL_MS;
}

export function DesktopToasts({ accessToken }: { accessToken: string }) {
  const { notifications, reactedAt, requestOpenControlCenter } =
    useNotificationsStore();
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const seenToastIds = useRef(new Set<number>());
  const exitTimers = useRef(new Map<number, number>());
  const reactionReadTimers = useRef(new Map<number, number>());

  useEffect(() => {
    const fresh = notifications.filter(
      (notification) =>
        isToastNotification(notification) &&
        !isReactedExpired(reactedAt[notification.id]) &&
        !seenToastIds.current.has(notification.id),
    );
    if (fresh.length === 0) return;

    for (const notification of fresh) {
      seenToastIds.current.add(notification.id);
      if (
        notification.kind === 'goal_reaction' &&
        !reactionReadTimers.current.has(notification.id)
      ) {
        const timer = window.setTimeout(() => {
          reactionReadTimers.current.delete(notification.id);
          void markNotificationsRead(accessToken, {
            ids: [notification.id],
          }).catch(() => {});
        }, REACTION_READ_GRACE_MS);
        reactionReadTimers.current.set(notification.id, timer);
      }
    }
    setToasts((previous) =>
      [
        ...previous,
        ...fresh.map((notification) => ({
          notification,
          phase: 'visible' as const,
        })),
      ].slice(-MAX_VISIBLE_TOASTS),
    );
  }, [accessToken, notifications, reactedAt]);

  const dismissToast = useCallback(
    (id: number, markRead: boolean) => {
      const reactionTimer = reactionReadTimers.current.get(id);
      if (reactionTimer !== undefined) {
        window.clearTimeout(reactionTimer);
        reactionReadTimers.current.delete(id);
      }
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
          toast.notification.kind === 'goal_reaction'
            ? REACTION_TOAST_DURATION_MS
            : TOAST_DURATION_MS,
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
      for (const timer of reactionReadTimers.current.values())
        window.clearTimeout(timer);
      reactionReadTimers.current.clear();
    },
    [],
  );

  const visibleToasts = toasts.filter(
    ({ notification }) => !isReactedExpired(reactedAt[notification.id]),
  );
  if (visibleToasts.length === 0) return null;

  return (
    <div className="xos-desktop-toasts" aria-label="Notifications récentes">
      {visibleToasts.map(({ notification, phase }) => {
        const emoji = reactionEmoji(notification);
        const gamificationKind = isGamificationToastKind(notification.kind)
          ? notification.kind
          : null;
        const colorClass = gamificationKind
          ? gamificationToastColorClass(gamificationKind)
          : null;
        const handleClick = () => {
          dismissToast(notification.id, true);
          requestOpenControlCenter(notification.id);
        };
        return (
          <GlassCard
            key={notification.id}
            className={`xos-desktop-toast xos-desktop-toast--${phase}${colorClass ? ` ${colorClass}` : ''}`}
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
                {gamificationKind
                  ? GAMIFICATION_TOAST_LABEL[gamificationKind]
                  : notification.kind === 'goal_reaction'
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
            <h2 className="xos-desktop-toast__title">
              {gamificationKind &&
                `${GAMIFICATION_TOAST_EMOJI[gamificationKind]} `}
              {notification.title}
            </h2>
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
