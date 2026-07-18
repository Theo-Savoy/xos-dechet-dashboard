import { useCallback, useEffect, useRef, useState } from 'react';
import logoXos from '../assets/logo-xos.png';
import { Button } from '../components/ui';
import {
  fetchNotifications,
  markNotificationsRead,
  PICKER_REACTION_EMOJIS,
  QUICK_REACTION_EMOJIS,
  reactionEmoji,
  reactToNotification,
  type GoalReactionEmoji,
  type UserNotification,
} from './notifications';
import {
  useNotificationsStore,
  type FloatingReactionBurst,
} from './notificationsStore';
import { useRealtimeNotifications } from './useRealtimeNotifications';
import {
  NOTIFICATION_CLIENT_TTL_MS,
  shouldPollNotifications,
} from './ControlCenter.helpers';
import './controlCenter.css';

const REACTION_TTL_MS = 30 * 60 * 1000;

type ControlCenterProps = {
  accessToken: string;
  onOpenApp?: (appId: string, params: Record<string, string>) => void;
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export function ControlCenter({ accessToken, onOpenApp }: ControlCenterProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reactingId, setReactingId] = useState<number | null>(null);
  const [reactedAt, setReactedAt] = useState<Record<number, number>>({});
  const [consumedReactionIds, setConsumedReactionIds] = useState<Set<number>>(
    new Set(),
  );
  const [pickerOpenId, setPickerOpenId] = useState<number | null>(null);
  const {
    addBurst,
    addLocalBurst,
    controlCenterOpenRequest,
    markRealtimeEvent,
    realtimeHealthy,
    realtimeLastEventAt,
    reactedAt: sharedReactedAt,
    markReacted,
    setRealtimeHealthy,
    setNotifications,
  } = useNotificationsStore();
  const seenReactionIds = useRef(new Set<number>());
  const pendingReactionReadTimers = useRef(new Map<number, number>());
  const bootstrapped = useRef(false);
  const itemsRef = useRef<UserNotification[]>([]);
  const unreadRef = useRef(0);
  const pickerRootRef = useRef<HTMLDivElement>(null);
  const pickerButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const reactionButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const [pendingOpenNotificationId, setPendingOpenNotificationId] = useState<number | null>(null);

  const closePicker = useCallback(() => {
    if (pickerOpenId === null) return;
    const button = pickerButtonRefs.current.get(pickerOpenId);
    setPickerOpenId(null);
    button?.focus();
  }, [pickerOpenId]);

  const scheduleReactionRead = useCallback(
    (id: number) => {
      if (!accessToken || pendingReactionReadTimers.current.has(id)) return;
      const timer = window.setTimeout(() => {
        pendingReactionReadTimers.current.delete(id);
        void markNotificationsRead(accessToken, { ids: [id] })
          .then(() => {
            const readAt = new Date().toISOString();
            setItems((previous) =>
              previous.map((row) =>
                row.id === id ? { ...row, read_at: row.read_at ?? readAt } : row,
              ),
            );
            setNotifications((previous) =>
              previous.map((row) =>
                row.id === id ? { ...row, read_at: row.read_at ?? readAt } : row,
              ),
            );
            setUnread((count) => Math.max(0, count - 1));
          })
          .catch(() => {});
      }, 500);
      pendingReactionReadTimers.current.set(id, timer);
    },
    [accessToken, setNotifications],
  );

  const processNotifications = useCallback(
    (notifications: UserNotification[], unreadCount: number) => {
      itemsRef.current = notifications;
      unreadRef.current = unreadCount;
      setItems(notifications);
      setNotifications(notifications);
      setUnread(unreadCount);

      const unreadReactions = notifications.filter(
        (n) => n.kind === 'goal_reaction' && !n.read_at,
      );
      if (!bootstrapped.current) {
        for (const n of unreadReactions) seenReactionIds.current.add(n.id);
        bootstrapped.current = true;
      } else {
        const fresh: FloatingReactionBurst[] = [];
        const freshReactionIds: number[] = [];
        for (const n of unreadReactions) {
          if (seenReactionIds.current.has(n.id)) continue;
          seenReactionIds.current.add(n.id);
          const emoji = reactionEmoji(n);
          if (emoji) {
            fresh.push({ id: `n-${n.id}`, emoji });
            freshReactionIds.push(n.id);
          }
        }
        for (const burst of fresh) addBurst(burst);
        if (freshReactionIds.length > 0) {
          setConsumedReactionIds((previous) => {
            const next = new Set(previous);
            for (const id of freshReactionIds) next.add(id);
            return next;
          });
          for (const id of freshReactionIds) scheduleReactionRead(id);
        }
      }
    },
    [addBurst, scheduleReactionRead, setNotifications],
  );

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await fetchNotifications(accessToken);
      const notifications = Array.isArray(data.notifications)
        ? data.notifications
        : [];
      processNotifications(
        notifications,
        typeof data.unread_count === 'number' ? data.unread_count : 0,
      );
    } catch {
      /* ignore poll errors */
    }
  }, [accessToken, processNotifications]);

  const handleRealtimeInsert = useCallback(
    (notification: UserNotification) => {
      if (!accessToken) return;

      // Render the Realtime row immediately so the toast is not held behind
      // a second authenticated round trip. Reconcile with the API in the
      // background for the authoritative list and unread count.
      const alreadyPresent = itemsRef.current.some((item) => item.id === notification.id);
      if (!alreadyPresent) {
        processNotifications(
          [notification, ...itemsRef.current].slice(0, 40),
          unreadRef.current + 1,
        );
      }
      void fetchNotifications(accessToken)
        .then((data) => {
          const notifications = Array.isArray(data.notifications)
            ? data.notifications
            : [];
          const alreadyFetched = notifications.some(
            (item) => item.id === notification.id,
          );
          processNotifications(
            alreadyFetched
              ? notifications
              : [notification, ...notifications].slice(0, 40),
            typeof data.unread_count === 'number'
              ? data.unread_count + (alreadyFetched ? 0 : 1)
              : unreadRef.current,
          );
        })
        .catch(() => {});
    },
    [accessToken, processNotifications],
  );

  useRealtimeNotifications({
    accessToken,
    onInsert: handleRealtimeInsert,
    onEvent: markRealtimeEvent,
    onStatus: (status) => setRealtimeHealthy(status === 'SUBSCRIBED'),
  });

  useEffect(() => {
    if (controlCenterOpenRequest.sequence > 0) {
      setOpen(true);
      setPendingOpenNotificationId(controlCenterOpenRequest.notificationId);
    }
  }, [controlCenterOpenRequest]);

  useEffect(() => {
    if (!open || pendingOpenNotificationId === null) return;
    const item = items.find((candidate) => candidate.id === pendingOpenNotificationId);
    if (!item || item.kind !== 'session_goal_hit') return;
    setPickerOpenId(item.id);
    setPendingOpenNotificationId(null);
    window.setTimeout(() => {
      reactionButtonRefs.current.get(item.id)?.focus();
    }, 0);
  }, [items, open, pendingOpenNotificationId]);

  useEffect(() => {
    if (open) return;
    setPickerOpenId(null);
  }, [open]);

  useEffect(() => {
    if (pickerOpenId === null) return;
    const onPointer = (event: MouseEvent) => {
      if (!pickerRootRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        closePicker();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePicker();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [closePicker, pickerOpenId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (shouldPollNotifications(realtimeHealthy, realtimeLastEventAt)) {
        void refresh();
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, realtimeHealthy, realtimeLastEventAt]);

  useEffect(
    () => () => {
      for (const timer of pendingReactionReadTimers.current.values()) {
        window.clearTimeout(timer);
      }
      pendingReactionReadTimers.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [open, refresh]);

  const markOne = async (id: number) => {
    setItems((prev) =>
      prev.map((row) =>
        row.id === id
          ? { ...row, read_at: row.read_at ?? new Date().toISOString() }
          : row,
      ),
    );
    setUnread((n) => Math.max(0, n - 1));
    try {
      await markNotificationsRead(accessToken, { ids: [id] });
    } catch {
      void refresh();
    }
  };

  const markAll = async () => {
    setItems((prev) =>
      prev.map((row) => ({
        ...row,
        read_at: row.read_at ?? new Date().toISOString(),
      })),
    );
    setUnread(0);
    try {
      await markNotificationsRead(accessToken, { all: true });
    } catch {
      void refresh();
    }
  };

  const handleReact = async (
    item: UserNotification,
    emoji: GoalReactionEmoji,
  ) => {
    if (reactingId === item.id) return;
    setReactingId(item.id);
    addLocalBurst({ emoji });
    try {
      await reactToNotification(accessToken, item.id, emoji);
      const timestamp = Date.now();
      setReactedAt((previous) =>
        previous[item.id] !== undefined
          ? previous
          : { ...previous, [item.id]: timestamp },
      );
      markReacted(item.id, timestamp);
      if (!item.read_at) await markOne(item.id);
      else void refresh();
    } catch {
      void refresh();
    } finally {
      setReactingId(null);
    }
  };

  const visibleItems = items.filter((item) => {
    const createdAt = new Date(item.created_at).getTime();
    if (
      Number.isFinite(createdAt) &&
      Date.now() - createdAt > NOTIFICATION_CLIENT_TTL_MS
    ) {
      return false;
    }
    if (
      item.kind === 'goal_reaction' &&
      consumedReactionIds.has(item.id)
    ) {
      return false;
    }
    const timestamp = reactedAt[item.id] ?? sharedReactedAt[item.id];
    return timestamp === undefined || Date.now() - timestamp <= REACTION_TTL_MS;
  });

  return (
    <div className="xos-cc">
      <Button variant="icon"
        type="button"
        className={`xos-cc__trigger${unread > 0 ? ' xos-cc__trigger--badge' : ''}`}
        aria-expanded={open}
        aria-controls="xos-control-center"
        title="Centre de notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-5.5V11a7 7 0 1 0-14 0v5.5L3 18.5V20h18v-1.5l-2-2Z" />
        </svg>
        {unread > 0 && (
          <span className="xos-cc__badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </Button>

      {open && (
        <>
          <Button variant="ghost"
            type="button"
            className="xos-cc__backdrop"
            aria-label="Fermer le centre de notifications"
            onClick={() => setOpen(false)}
          />
          <aside
            id="xos-control-center"
            className="xos-cc__panel"
            aria-label="Notifications"
          >
            <header className="xos-cc__head">
              <div>
                <p className="xos-cc__eyebrow">Control Center</p>
                <h2>Notifications</h2>
              </div>
              <div className="xos-cc__head-actions">
                {unread > 0 && (
                  <Button variant="ghost"
                    type="button"
                    className="xos-cc__linkbtn"
                    onClick={() => void markAll()}
                  >
                    Tout marquer lu
                  </Button>
                )}
                <Button variant="icon"
                  type="button"
                  className="xos-cc__close"
                  aria-label="Fermer"
                  onClick={() => setOpen(false)}
                >
                  &times;
                </Button>
              </div>
            </header>

            <div
              className={`xos-cc__list${pickerOpenId !== null ? ' xos-cc__list--picker-open' : ''}`}
            >
              {loading && items.length === 0 && (
                <p className="xos-cc__empty">Chargement…</p>
              )}
              {!loading && visibleItems.length === 0 && (
                <p className="xos-cc__empty">
                  Aucune notification pour le moment.
                </p>
              )}
              {visibleItems.map((item) => {
                const eventUrl =
                  typeof item.payload?.sf_event_url === 'string'
                    ? item.payload.sf_event_url
                    : null;
                const unreadItem = !item.read_at;
                const goalHit = item.kind === 'session_goal_hit';
                const bigEmoji = reactionEmoji(item);
                const actionParams =
                  item.payload?.action === 'open_session' &&
                  typeof item.payload.app_id === 'string' &&
                  item.payload.params &&
                  typeof item.payload.params === 'object'
                    ? Object.fromEntries(
                        Object.entries(item.payload.params).filter(
                          ([key, value]) =>
                            typeof key === 'string' && typeof value === 'string',
                        ),
                      )
                    : null;
                return (
                  <article
                    key={item.id}
                    className={`xos-cc__item${unreadItem ? ' xos-cc__item--unread' : ''}${
                      bigEmoji ? ' xos-cc__item--reaction' : ''
                    }`}
                  >
                    <div className="xos-cc__item-top">
                      <img
                        src={logoXos}
                        alt=""
                        className="xos-cc__item-logo"
                        width={20}
                        height={8}
                      />
                      <span className="xos-cc__item-app">Combo</span>
                      <time
                        className="xos-cc__item-time"
                        dateTime={item.created_at}
                      >
                        {formatRelative(item.created_at)}
                      </time>
                    </div>
                    <h3 className="xos-cc__item-title">{item.title}</h3>
                    {bigEmoji ? (
                      <p
                        className="xos-cc__item-emoji"
                        aria-label={`Réaction ${bigEmoji}`}
                      >
                        {bigEmoji}
                      </p>
                    ) : (
                      <p className="xos-cc__item-body">{item.body}</p>
                    )}
                    <div className="xos-cc__item-actions">
                      {goalHit && (
                        <div
                          className="xos-cc__reacts"
                          role="group"
                          aria-label="Réagir"
                        >
                          {QUICK_REACTION_EMOJIS.map((emoji) => (
                            <Button variant="icon"
                              key={emoji}
                              ref={(button) => {
                                if (emoji === QUICK_REACTION_EMOJIS[0]) {
                                  if (button) reactionButtonRefs.current.set(item.id, button);
                                  else reactionButtonRefs.current.delete(item.id);
                                }
                              }}
                              type="button"
                              className="xos-cc__react"
                              disabled={reactingId === item.id}
                              aria-label={`Réagir ${emoji}`}
                              title={`Réagir ${emoji}`}
                              onClick={() => void handleReact(item, emoji)}
                            >
                              {emoji}
                            </Button>
                          ))}
                          <div
                            ref={
                              pickerOpenId === item.id
                                ? pickerRootRef
                                : undefined
                            }
                            className="xos-cc__react-picker"
                          >
                            <Button variant="icon"
                              ref={(button) => {
                                if (button) {
                                  pickerButtonRefs.current.set(item.id, button);
                                } else {
                                  pickerButtonRefs.current.delete(item.id);
                                }
                              }}
                              type="button"
                              className={`xos-cc__react xos-cc__react--more${pickerOpenId === item.id ? ' xos-cc__react--open' : ''}`}
                              disabled={reactingId === item.id}
                              aria-label="Plus de réactions"
                              aria-haspopup="menu"
                              aria-expanded={pickerOpenId === item.id}
                              aria-controls={`xos-reaction-picker-${item.id}`}
                              title="Plus de réactions"
                              onClick={() =>
                                setPickerOpenId((current) =>
                                  current === item.id ? null : item.id,
                                )
                              }
                            >
                              <span aria-hidden="true">+</span>
                            </Button>
                            {pickerOpenId === item.id && (
                              <div
                                id={`xos-reaction-picker-${item.id}`}
                                className="xos-cc__react-picker-menu"
                                role="menu"
                                aria-label="Autres réactions"
                              >
                                {PICKER_REACTION_EMOJIS.map((emoji) => (
                                  <Button variant="icon"
                                    key={emoji}
                                    type="button"
                                    role="menuitem"
                                    className="xos-cc__react-picker-item"
                                    disabled={reactingId === item.id}
                                    aria-label={`Réagir ${emoji}`}
                                    title={`Réagir ${emoji}`}
                                    onClick={() => {
                                      void handleReact(item, emoji);
                                      closePicker();
                                    }}
                                  >
                                    {emoji}
                                  </Button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {eventUrl && (
                        <a
                          className="xos-cc__sf"
                          href={eventUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Ouvrir le RDV dans Salesforce"
                          onClick={() => {
                            if (unreadItem) void markOne(item.id);
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="12" r="12" fill="#00A1E0" />
                            <path
                              fill="#fff"
                              d="M8.4 14.6c-.9 0-1.7-.3-2.3-.9-.6-.6-.9-1.4-.9-2.3 0-.9.3-1.7.9-2.3.6-.6 1.4-.9 2.3-.9.5 0 1 .1 1.4.3l-.5 1.1c-.3-.1-.6-.2-.9-.2-.5 0-1 .2-1.3.5-.3.3-.5.8-.5 1.3s.2 1 .5 1.3c.3.3.8.5 1.3.5.3 0 .6-.1.9-.2l.5 1.1c-.4.2-.9.3-1.4.3zm4.2.1c-.7 0-1.3-.2-1.8-.6-.5-.4-.8-1-.9-1.7h1.3c.1.4.3.7.6.9.3.2.6.3 1 .3.3 0 .6-.1.8-.2.2-.1.3-.3.3-.5 0-.2-.1-.3-.3-.4-.2-.1-.5-.2-1-.3-.7-.2-1.2-.4-1.5-.7-.3-.3-.5-.7-.5-1.2 0-.5.2-.9.6-1.2.4-.3.9-.5 1.5-.5.6 0 1.1.2 1.5.5.4.3.7.8.8 1.3h-1.3c-.1-.3-.2-.5-.5-.7-.2-.1-.5-.2-.8-.2-.3 0-.5.1-.7.2-.2.1-.2.3-.2.4 0 .2.1.3.3.4.2.1.6.3 1.1.4.7.2 1.2.4 1.5.7.3.3.5.7.5 1.2 0 .5-.2 1-.6 1.3-.4.4-1 .6-1.7.6zM17.2 14.6c-.5 0-.9-.1-1.3-.4-.4-.3-.6-.7-.7-1.2h1.2c.1.4.4.6.8.6.5 0 .8-.2.8-.6 0-.2-.1-.3-.3-.4-.2-.1-.5-.2-1-.3-.6-.2-1-.4-1.3-.7-.3-.3-.4-.7-.4-1.1 0-.5.2-.9.5-1.2.4-.3.8-.5 1.4-.5.5 0 .9.1 1.2.4.3.3.5.6.6 1.1h-1.2c0-.3-.3-.5-.6-.5-.4 0-.6.2-.6.5 0 .2.1.3.3.4.2.1.5.2.9.3.6.2 1 .4 1.3.7.3.3.4.7.4 1.1 0 .5-.2.9-.6 1.2-.3.3-.8.5-1.4.5z"
                            />
                          </svg>
                          Ouvrir le RDV
                        </a>
                      )}
                      {actionParams && onOpenApp && (
                        <Button variant="secondary"
                          type="button"
                          className="xos-cc__sf"
                          onClick={() => {
                            if (unreadItem) void markOne(item.id);
                            onOpenApp(item.payload.app_id as string, actionParams);
                          }}
                        >
                          Ouvrir la séance
                        </Button>
                      )}
                      {unreadItem && (
                        <Button variant="ghost"
                          type="button"
                          className="xos-cc__linkbtn"
                          onClick={() => void markOne(item.id)}
                        >
                          Marquer lu
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
