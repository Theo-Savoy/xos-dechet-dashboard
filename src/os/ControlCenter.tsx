import { useCallback, useEffect, useRef, useState } from "react";
import logoXos from "../assets/logo-xos.png";
import {
  FloatingReactions,
  type FloatingReactionBurst,
} from "./FloatingReactions";
import {
  fetchNotifications,
  GOAL_REACTION_EMOJIS,
  markNotificationsRead,
  reactToNotification,
  type GoalReactionEmoji,
  type UserNotification,
} from "./notifications";
import "./controlCenter.css";

type ControlCenterProps = {
  accessToken: string;
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

function reactionEmoji(item: UserNotification): string | null {
  if (item.kind !== "goal_reaction") return null;
  const fromPayload = typeof item.payload?.emoji === "string" ? item.payload.emoji : null;
  if (fromPayload) return fromPayload;
  return item.body?.trim() || null;
}

export function ControlCenter({ accessToken }: ControlCenterProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reactingId, setReactingId] = useState<number | null>(null);
  const [bursts, setBursts] = useState<FloatingReactionBurst[]>([]);
  const seenReactionIds = useRef(new Set<number>());
  const bootstrapped = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await fetchNotifications(accessToken);
      setItems(data.notifications);
      setUnread(data.unread_count);

      const unreadReactions = data.notifications.filter(
        (n) => n.kind === "goal_reaction" && !n.read_at,
      );
      if (!bootstrapped.current) {
        for (const n of unreadReactions) seenReactionIds.current.add(n.id);
        bootstrapped.current = true;
      } else {
        const fresh: FloatingReactionBurst[] = [];
        for (const n of unreadReactions) {
          if (seenReactionIds.current.has(n.id)) continue;
          seenReactionIds.current.add(n.id);
          const emoji = reactionEmoji(n);
          if (emoji) fresh.push({ id: `n-${n.id}`, emoji });
        }
        if (fresh.length > 0) {
          setBursts((prev) => [...prev, ...fresh]);
        }
      }
    } catch {
      /* ignore poll errors */
    }
  }, [accessToken]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [open, refresh]);

  const markOne = async (id: number) => {
    setItems((prev) =>
      prev.map((row) => (row.id === id ? { ...row, read_at: row.read_at ?? new Date().toISOString() } : row)),
    );
    setUnread((n) => Math.max(0, n - 1));
    try {
      await markNotificationsRead(accessToken, { ids: [id] });
    } catch {
      void refresh();
    }
  };

  const markAll = async () => {
    setItems((prev) => prev.map((row) => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await markNotificationsRead(accessToken, { all: true });
    } catch {
      void refresh();
    }
  };

  const handleReact = async (item: UserNotification, emoji: GoalReactionEmoji) => {
    if (reactingId === item.id) return;
    setReactingId(item.id);
    try {
      await reactToNotification(accessToken, item.id, emoji);
      if (!item.read_at) await markOne(item.id);
      else void refresh();
    } catch {
      void refresh();
    } finally {
      setReactingId(null);
    }
  };

  return (
    <div className="xos-cc">
      <FloatingReactions
        bursts={bursts}
        onDone={(id) => setBursts((prev) => prev.filter((b) => b.id !== id))}
      />
      <button
        type="button"
        className={`xos-cc__trigger${unread > 0 ? " xos-cc__trigger--badge" : ""}`}
        aria-expanded={open}
        aria-controls="xos-control-center"
        title="Centre de notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-5.5V11a7 7 0 1 0-14 0v5.5L3 18.5V20h18v-1.5l-2-2Z" />
        </svg>
        {unread > 0 && <span className="xos-cc__badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="xos-cc__backdrop"
            aria-label="Fermer le centre de notifications"
            onClick={() => setOpen(false)}
          />
          <aside id="xos-control-center" className="xos-cc__panel" aria-label="Notifications">
            <header className="xos-cc__head">
              <div>
                <p className="xos-cc__eyebrow">Control Center</p>
                <h2>Notifications</h2>
              </div>
              <div className="xos-cc__head-actions">
                {unread > 0 && (
                  <button type="button" className="xos-cc__linkbtn" onClick={() => void markAll()}>
                    Tout marquer lu
                  </button>
                )}
                <button type="button" className="xos-cc__close" aria-label="Fermer" onClick={() => setOpen(false)}>
                  &times;
                </button>
              </div>
            </header>

            <div className="xos-cc__list">
              {loading && items.length === 0 && <p className="xos-cc__empty">Chargement…</p>}
              {!loading && items.length === 0 && (
                <p className="xos-cc__empty">Aucune notification pour le moment.</p>
              )}
              {items.map((item) => {
                const eventUrl =
                  typeof item.payload?.sf_event_url === "string" ? item.payload.sf_event_url : null;
                const unreadItem = !item.read_at;
                const goalHit = item.kind === "session_goal_hit";
                const bigEmoji = reactionEmoji(item);
                return (
                  <article
                    key={item.id}
                    className={`xos-cc__item${unreadItem ? " xos-cc__item--unread" : ""}${
                      bigEmoji ? " xos-cc__item--reaction" : ""
                    }`}
                  >
                    <div className="xos-cc__item-top">
                      <img src={logoXos} alt="" className="xos-cc__item-logo" width={20} height={8} />
                      <span className="xos-cc__item-app">Combo</span>
                      <time className="xos-cc__item-time" dateTime={item.created_at}>
                        {formatRelative(item.created_at)}
                      </time>
                    </div>
                    <h3 className="xos-cc__item-title">{item.title}</h3>
                    {bigEmoji ? (
                      <p className="xos-cc__item-emoji" aria-label={`Réaction ${bigEmoji}`}>
                        {bigEmoji}
                      </p>
                    ) : (
                      <p className="xos-cc__item-body">{item.body}</p>
                    )}
                    <div className="xos-cc__item-actions">
                      {goalHit && (
                        <div className="xos-cc__reacts" role="group" aria-label="Réagir">
                          {GOAL_REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="xos-cc__react"
                              disabled={reactingId === item.id}
                              title={`Réagir ${emoji}`}
                              onClick={() => void handleReact(item, emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
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
                          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                            <circle cx="12" cy="12" r="12" fill="#00A1E0" />
                            <path
                              fill="#fff"
                              d="M8.4 14.6c-.9 0-1.7-.3-2.3-.9-.6-.6-.9-1.4-.9-2.3 0-.9.3-1.7.9-2.3.6-.6 1.4-.9 2.3-.9.5 0 1 .1 1.4.3l-.5 1.1c-.3-.1-.6-.2-.9-.2-.5 0-1 .2-1.3.5-.3.3-.5.8-.5 1.3s.2 1 .5 1.3c.3.3.8.5 1.3.5.3 0 .6-.1.9-.2l.5 1.1c-.4.2-.9.3-1.4.3zm4.2.1c-.7 0-1.3-.2-1.8-.6-.5-.4-.8-1-.9-1.7h1.3c.1.4.3.7.6.9.3.2.6.3 1 .3.3 0 .6-.1.8-.2.2-.1.3-.3.3-.5 0-.2-.1-.3-.3-.4-.2-.1-.5-.2-1-.3-.7-.2-1.2-.4-1.5-.7-.3-.3-.5-.7-.5-1.2 0-.5.2-.9.6-1.2.4-.3.9-.5 1.5-.5.6 0 1.1.2 1.5.5.4.3.7.8.8 1.3h-1.3c-.1-.3-.2-.5-.5-.7-.2-.1-.5-.2-.8-.2-.3 0-.5.1-.7.2-.2.1-.2.3-.2.4 0 .2.1.3.3.4.2.1.6.3 1.1.4.7.2 1.2.4 1.5.7.3.3.5.7.5 1.2 0 .5-.2 1-.6 1.3-.4.4-1 .6-1.7.6zM17.2 14.6c-.5 0-.9-.1-1.3-.4-.4-.3-.6-.7-.7-1.2h1.2c.1.4.4.6.8.6.5 0 .8-.2.8-.6 0-.2-.1-.3-.3-.4-.2-.1-.5-.2-1-.3-.6-.2-1-.4-1.3-.7-.3-.3-.4-.7-.4-1.1 0-.5.2-.9.5-1.2.4-.3.8-.5 1.4-.5.5 0 .9.1 1.2.4.3.3.5.6.6 1.1h-1.2c0-.3-.3-.5-.6-.5-.4 0-.6.2-.6.5 0 .2.1.3.3.4.2.1.5.2.9.3.6.2 1 .4 1.3.7.3.3.4.7.4 1.1 0 .5-.2.9-.6 1.2-.3.3-.8.5-1.4.5z"
                            />
                          </svg>
                          Ouvrir le RDV
                        </a>
                      )}
                      {unreadItem && (
                        <button type="button" className="xos-cc__linkbtn" onClick={() => void markOne(item.id)}>
                          Marquer lu
                        </button>
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
