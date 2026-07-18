import { useMemo, useState, type MouseEvent } from "react";
import { Button, GlassCard, Modal, Tag } from "../../components/ui";
import { ProgressBar } from "./ProgressBar";
import { DatePicker, SessionTypePicker } from "./formControls";
import { todayParisIso } from "./formControls.helpers";
import type { CallStats, PeriodKpis, SessionSummary, SessionType } from "./types";
import { SESSION_TYPE_OPTIONS, sessionTypeLabel } from "./types";
import { sessionDayKey } from "./sessionLifecycle";

type HubViewMode = "list" | "calendar";
type KpiPeriod = "week" | "month";
type ScheduleFilter = "upcoming" | "planned" | "done" | "all";

type SessionsViewProps = {
  sessions: SessionSummary[];
  stats: CallStats | null;
  recallCount: number;
  recallsLoading: boolean;
  loading: boolean;
  error: string | null;
  canPilotage?: boolean;
  onRefresh: () => void;
  onNewSession: () => void;
  onOpenSession: (sessionId: number, contactId?: number) => void;
  onOpenRecalls: () => void;
  onOpenPilotage?: () => void;
  onUpdateSession: (
    sessionId: number,
    patch: { name?: string; scheduled_for?: string | null; session_type?: SessionType },
  ) => Promise<void>;
  onDeleteSession: (sessionId: number) => Promise<void>;
  onShareSession?: (sessionId: number) => void;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatScheduledDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function emptyKpis(): PeriodKpis {
  return {
    calls: 0,
    decroche: 0,
    argumente: 0,
    rdv: 0,
    npa: 0,
    rate_decroche: 0,
    rate_argumente: 0,
    rate_rdv_per_decroche: 0,
    rate_rdv_per_argumente: 0,
  };
}

function pct(value: number): string {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function buildMonthGrid(year: number, monthIndex: number): (Date | null)[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, monthIndex, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isPlannedSession(session: SessionSummary, today: string): boolean {
  return session.status === "active" && Boolean(session.scheduled_for && session.scheduled_for > today);
}

function matchesSchedule(session: SessionSummary, filter: ScheduleFilter, today: string): boolean {
  if (filter === "all") return true;
  if (filter === "planned") return isPlannedSession(session, today);
  if (filter === "upcoming") return session.status === "active" && !isPlannedSession(session, today);
  return session.status === "completed";
}

function sortSessions(list: SessionSummary[], filter: ScheduleFilter): SessionSummary[] {
  const copy = [...list];
  copy.sort((a, b) => {
    const da = sessionDayKey(a);
    const db = sessionDayKey(b);
    if (filter === "done") return db.localeCompare(da) || b.created_at.localeCompare(a.created_at);
    // upcoming / all : prochaines d'abord, actives avant terminées
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return da.localeCompare(db) || a.created_at.localeCompare(b.created_at);
  });
  return copy;
}

export function SessionsView({
  sessions,
  stats,
  recallCount,
  recallsLoading,
  loading,
  error,
  canPilotage = false,
  onRefresh,
  onNewSession,
  onOpenSession,
  onOpenRecalls,
  onOpenPilotage,
  onUpdateSession,
  onDeleteSession,
  onShareSession,
}: SessionsViewProps) {
  const today = todayParisIso();
  const [viewMode, setViewMode] = useState<HubViewMode>("list");
  const [kpiPeriod, setKpiPeriod] = useState<KpiPeriod>("week");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("upcoming");
  const [typeFilter, setTypeFilter] = useState<SessionType | "all">("all");
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  const [editing, setEditing] = useState<SessionSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState<SessionType>("prospection");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [dayOverflow, setDayOverflow] = useState<{ key: string; sessions: SessionSummary[] } | null>(
    null,
  );

  const kpis = (kpiPeriod === "week" ? stats?.week : stats?.month) ?? emptyKpis();

  const scheduleCounts = useMemo(() => {
    let upcoming = 0;
    let planned = 0;
    let done = 0;
    for (const session of sessions) {
      if (matchesSchedule(session, "upcoming", today)) upcoming++;
      if (matchesSchedule(session, "planned", today)) planned++;
      if (matchesSchedule(session, "done", today)) done++;
    }
    return { upcoming, planned, done, all: sessions.length };
  }, [sessions, today]);

  const filteredSessions = useMemo(() => {
    const list = sessions.filter((session) => {
      if (!matchesSchedule(session, scheduleFilter, today)) return false;
      if (typeFilter !== "all" && session.session_type !== typeFilter) return false;
      return true;
    });
    return sortSessions(list, scheduleFilter);
  }, [sessions, scheduleFilter, today, typeFilter]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of filteredSessions) {
      const key = sessionDayKey(session);
      const list = map.get(key) ?? [];
      list.push(session);
      map.set(key, list);
    }
    return map;
  }, [filteredSessions]);

  const monthCells = useMemo(
    () => buildMonthGrid(calendarCursor.year, calendarCursor.month),
    [calendarCursor],
  );

  const monthLabel = new Date(calendarCursor.year, calendarCursor.month, 1).toLocaleDateString(
    "fr-FR",
    { month: "long", year: "numeric" },
  );

  const openEdit = (session: SessionSummary, e: MouseEvent) => {
    e.stopPropagation();
    setEditing(session);
    setEditName(session.name);
    setEditDate(session.scheduled_for ?? sessionDayKey(session));
    setEditType(session.session_type ?? "prospection");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await onUpdateSession(editing.id, {
        name: editName.trim(),
        scheduled_for: editDate || null,
        session_type: editType,
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (session: SessionSummary, e: MouseEvent) => {
    e.stopPropagation();
    setPendingDelete(session);
  };

  const executeDelete = async () => {
    if (!pendingDelete) return;
    const session = pendingDelete;
    setDeletingId(session.id);
    try {
      await onDeleteSession(session.id);
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  const jumpCalendarToday = () => {
    const [y, m] = today.split("-").map(Number);
    setCalendarCursor({ year: y, month: m - 1 });
  };

  const hasActiveFilters = scheduleFilter !== "upcoming" || typeFilter !== "all";
  const trulyEmpty = !loading && !error && sessions.length === 0;
  const filteredEmpty = !loading && !error && sessions.length > 0 && filteredSessions.length === 0;

  return (
    <div className="calls-view calls-hub">
      <header className="calls-view__header">
        <div>
          <Tag variant="accent">Combo</Tag>
          <h2>Prospection</h2>
        </div>
        <div className="calls-view__actions">
          {canPilotage && onOpenPilotage && (
            <Button variant="secondary" onClick={onOpenPilotage}>
              Pilotage
            </Button>
          )}
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            Actualiser
          </Button>
          <Button onClick={onNewSession}>Nouvelle séance</Button>
        </div>
      </header>

      <section className="calls-hub-kpis" aria-label="Indicateurs">
        <div className="calls-hub-kpis__toolbar">
          <div>
            <h3>Performance</h3>
            {stats && (
              <p className="calls-hub-kpis__meta">
                Aujourd&apos;hui {stats.calls_today} · Semaine {stats.calls_week} ·{" "}
                {stats.sessions_active} active{stats.sessions_active > 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="calls-seg" role="group" aria-label="Période KPIs">
            <Button variant="ghost"
              type="button"
              className={`calls-seg__btn${kpiPeriod === "week" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={kpiPeriod === "week"}
              onClick={() => setKpiPeriod("week")}
            >
              Semaine
            </Button>
            <Button variant="ghost"
              type="button"
              className={`calls-seg__btn${kpiPeriod === "month" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={kpiPeriod === "month"}
              onClick={() => setKpiPeriod("month")}
            >
              Mois
            </Button>
          </div>
        </div>
        <div className="calls-stats calls-hub-kpis__grid">
          <GlassCard className="calls-stat">
            <span>Appels</span>
            <strong className="xos-numeric">{kpis.calls}</strong>
          </GlassCard>
          <GlassCard className="calls-stat">
            <span>Taux décroché</span>
            <strong className="xos-numeric">{pct(kpis.rate_decroche)}</strong>
          </GlassCard>
          <GlassCard className="calls-stat">
            <span>Taux argumenté</span>
            <strong className="xos-numeric">{pct(kpis.rate_argumente)}</strong>
          </GlassCard>
          <GlassCard className="calls-stat">
            <span>RDV / décroché</span>
            <strong className="xos-numeric">{pct(kpis.rate_rdv_per_decroche)}</strong>
          </GlassCard>
        </div>
        <p className="calls-hub-kpis__secondary">
          RDV / argumenté <strong className="xos-numeric">{pct(kpis.rate_rdv_per_argumente)}</strong>
          <span aria-hidden="true"> · </span>
          NPA <strong className="xos-numeric">{kpis.npa}</strong>
        </p>
      </section>

      <section className="calls-hub-sessions" aria-label="Séances">
        <div className="calls-hub-toolbar">
          <div className="calls-hub-toolbar__primary">
            <div className="calls-seg" role="group" aria-label="Vue séances">
              <Button variant="ghost"
                type="button"
                className={`calls-seg__btn${viewMode === "list" ? " calls-seg__btn--active" : ""}`}
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                Liste
              </Button>
              <Button variant="ghost"
                type="button"
                className={`calls-seg__btn${viewMode === "calendar" ? " calls-seg__btn--active" : ""}`}
                aria-pressed={viewMode === "calendar"}
                onClick={() => setViewMode("calendar")}
              >
                Calendrier
              </Button>
              <Button variant="ghost"
                type="button"
                className="calls-seg__btn"
                onClick={onOpenRecalls}
              >
                Rappels
                {recallsLoading ? (
                  <span className="calls-seg__count">…</span>
                ) : recallCount > 0 ? (
                  <span className="calls-seg__count xos-numeric">{recallCount}</span>
                ) : null}
              </Button>
            </div>
            <div className="calls-seg" role="group" aria-label="Échéance">
              <Button variant="ghost"
                type="button"
                className={`calls-seg__btn${scheduleFilter === "upcoming" ? " calls-seg__btn--active" : ""}`}
                aria-pressed={scheduleFilter === "upcoming"}
                onClick={() => setScheduleFilter("upcoming")}
              >
                À venir
                <span className="calls-seg__count xos-numeric">{scheduleCounts.upcoming}</span>
              </Button>
              <Button variant="ghost"
                type="button"
                className={`calls-seg__btn${scheduleFilter === "planned" ? " calls-seg__btn--active" : ""}`}
                aria-pressed={scheduleFilter === "planned"}
                onClick={() => setScheduleFilter("planned")}
              >
                Planifiées
                <span className="calls-seg__count xos-numeric">{scheduleCounts.planned}</span>
              </Button>
              <Button variant="ghost"
                type="button"
                className={`calls-seg__btn${scheduleFilter === "done" ? " calls-seg__btn--active" : ""}`}
                aria-pressed={scheduleFilter === "done"}
                onClick={() => setScheduleFilter("done")}
              >
                Réalisées
                <span className="calls-seg__count xos-numeric">{scheduleCounts.done}</span>
              </Button>
              <Button variant="ghost"
                type="button"
                className={`calls-seg__btn${scheduleFilter === "all" ? " calls-seg__btn--active" : ""}`}
                aria-pressed={scheduleFilter === "all"}
                onClick={() => setScheduleFilter("all")}
              >
                Toutes
              </Button>
            </div>
          </div>
          <div className="calls-list-filter-chips" role="group" aria-label="Type de séance">
            <Button variant="ghost"
              type="button"
              className={`calls-list-filter-chip${typeFilter === "all" ? " calls-list-filter-chip--active" : ""}`}
              aria-pressed={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
            >
              Tous types
            </Button>
            {SESSION_TYPE_OPTIONS.map((opt) => (
              <Button variant="ghost"
                key={opt.value}
                type="button"
                className={`calls-list-filter-chip${typeFilter === opt.value ? " calls-list-filter-chip--active" : ""}`}
                aria-pressed={typeFilter === opt.value}
                onClick={() => setTypeFilter(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {loading && sessions.length === 0 && <p className="calls-state">Chargement des séances…</p>}
        {error && (
          <GlassCard className="calls-error">
            <p>{error}</p>
            <Button variant="secondary" onClick={onRefresh}>
              Réessayer
            </Button>
          </GlassCard>
        )}

        {trulyEmpty && (
          <GlassCard className="calls-empty calls-empty--hero">
            <Tag variant="accent">Prêt à prospecter</Tag>
            <h3>Aucune séance pour le moment</h3>
            <p>Composez une liste ciblée, planifiez une séance et suivez vos indicateurs ici.</p>
            <Button onClick={onNewSession}>Créer une première séance</Button>
          </GlassCard>
        )}

        {filteredEmpty && (
          <GlassCard className="calls-empty">
            <h3>Aucune séance pour ces filtres</h3>
            <p>
              {scheduleFilter === "upcoming"
                ? "Pas de séance à venir"
                : scheduleFilter === "planned"
                  ? "Pas de séance planifiée"
                : scheduleFilter === "done"
                  ? "Pas de séance réalisée"
                  : "Aucun résultat"}
              {typeFilter !== "all" ? ` · ${sessionTypeLabel(typeFilter)}` : ""}.
            </p>
            {hasActiveFilters && (
              <Button
                variant="secondary"
                onClick={() => {
                  setScheduleFilter("upcoming");
                  setTypeFilter("all");
                }}
              >
                Réinitialiser les filtres
              </Button>
            )}
          </GlassCard>
        )}

        {!error && viewMode === "list" && filteredSessions.length > 0 && (
          <ul className="calls-session-list">
            {filteredSessions.map((session) => (
              <li key={session.id}>
                <GlassCard
                  className={`calls-session-card calls-session-card--${session.session_type}${session.status === "completed" ? " calls-session-card--done" : ""}`}
                >
                  <div className="calls-session-card__body">
                    <Button variant="ghost"
                      type="button"
                      className="calls-session-card__open"
                      onClick={() => onOpenSession(session.id)}
                    >
                      <div className="calls-session-card__top">
                        <strong>{session.name}</strong>
                        <div className="calls-session-card__tags">
                          <Tag variant="muted">{sessionTypeLabel(session.session_type)}</Tag>
                          {isPlannedSession(session, today) ? (
                            <Tag variant="muted">Planifiée</Tag>
                          ) : (
                            <Tag variant={session.status === "active" ? "accent" : "default"}>
                              {session.status === "active" ? "En cours" : "Terminée"}
                            </Tag>
                          )}
                          {session.shared && (
                            <Tag variant="accent">
                              Partagée{session.member_count ? ` · ${session.member_count}` : ""}
                            </Tag>
                          )}
                          {session.is_owner === false && <Tag variant="muted">Invité</Tag>}
                        </div>
                      </div>
                      <span className="calls-session-card__date">
                        {session.scheduled_for
                          ? `Séance du ${formatScheduledDate(session.scheduled_for)}`
                          : formatDate(session.created_at)}
                      </span>
                      <ProgressBar called={session.called} total={session.total} />
                      <div className="calls-session-card__meta">
                        <span className="xos-numeric">
                          {session.called}/{session.total} traités
                        </span>
                        {session.skipped > 0 && (
                          <span>
                            {session.skipped} non contacté{session.skipped > 1 ? "s" : ""}
                          </span>
                        )}
                        {session.pending > 0 && session.status === "active" && (
                          <span className="xos-numeric">{session.pending} restants</span>
                        )}
                      </div>
                    </Button>
                    <div className="calls-session-card__actions">
                      {session.is_owner !== false && onShareSession && (
                        <Button
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onShareSession(session.id);
                          }}
                        >
                          Partager
                        </Button>
                      )}
                      <Button variant="secondary" onClick={(e) => openEdit(session, e)}>
                        Modifier
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={(e) => requestDelete(session, e)}
                        disabled={deletingId === session.id}
                      >
                        {deletingId === session.id ? "Suppression…" : "Supprimer"}
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              </li>
            ))}
          </ul>
        )}

        {!error && viewMode === "calendar" && !trulyEmpty && (
          <GlassCard className="calls-calendar">
            <div className="calls-calendar__nav">
              <Button
                variant="secondary"
                aria-label="Mois précédent"
                onClick={() =>
                  setCalendarCursor((c) => {
                    const d = new Date(c.year, c.month - 1, 1);
                    return { year: d.getFullYear(), month: d.getMonth() };
                  })
                }
              >
                ←
              </Button>
              <div className="calls-calendar__heading">
                <h3 className="calls-calendar__title">{monthLabel}</h3>
                <Button variant="ghost" type="button" className="calls-calendar__today-btn" onClick={jumpCalendarToday}>
                  Aujourd&apos;hui
                </Button>
              </div>
              <Button
                variant="secondary"
                aria-label="Mois suivant"
                onClick={() =>
                  setCalendarCursor((c) => {
                    const d = new Date(c.year, c.month + 1, 1);
                    return { year: d.getFullYear(), month: d.getMonth() };
                  })
                }
              >
                →
              </Button>
            </div>
            {filteredEmpty && (
              <p className="calls-calendar__empty-hint">Aucune séance pour ces filtres sur le calendrier.</p>
            )}
            <div className="calls-calendar__weekdays" aria-hidden="true">
              {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="calls-calendar__grid">
              {monthCells.map((date, index) => {
                if (!date) {
                  return (
                    <div key={`empty-${index}`} className="calls-calendar__cell calls-calendar__cell--empty" />
                  );
                }
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                const daySessions = sessionsByDay.get(key) ?? [];
                const isToday = key === today;
                return (
                  <div
                    key={key}
                    className={`calls-calendar__cell${isToday ? " calls-calendar__cell--today" : ""}${daySessions.length ? " calls-calendar__cell--has" : ""}`}
                  >
                    <span className="calls-calendar__day xos-numeric">{date.getDate()}</span>
                    <ul className="calls-calendar__events">
                      {daySessions.slice(0, 3).map((session) => (
                        <li key={session.id}>
                          <Button variant="ghost"
                            type="button"
                            className={`calls-calendar__event calls-calendar__event--${session.session_type}`}
                            onClick={() => onOpenSession(session.id)}
                            title={session.name}
                          >
                            {session.name}
                          </Button>
                        </li>
                      ))}
                      {daySessions.length > 3 && (
                        <li>
                          <Button variant="ghost"
                            type="button"
                            className="calls-calendar__more"
                            onClick={() => setDayOverflow({ key, sessions: daySessions })}
                          >
                            +{daySessions.length - 3}
                          </Button>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        )}
      </section>

      {dayOverflow && (
        <Modal
          open
          variant="glass"
          title={`Séances du ${new Date(`${dayOverflow.key}T12:00:00`).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
          })}`}
          onClose={() => setDayOverflow(null)}
        >
          <ul className="calls-day-overflow-list">
            {dayOverflow.sessions.map((session) => (
              <li key={session.id}>
                <Button variant="ghost"
                  type="button"
                  className="calls-day-overflow-list__item"
                  onClick={() => {
                    setDayOverflow(null);
                    onOpenSession(session.id);
                  }}
                >
                  <strong>{session.name}</strong>
                  <Tag variant="muted">{sessionTypeLabel(session.session_type)}</Tag>
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => setDayOverflow(null)}>
            Fermer
          </Button>
        </Modal>
      )}

      {editing && (
        <Modal
          open
          variant="glass"
          title="Modifier la séance"
          onClose={() => !saving && setEditing(null)}
        >
          <label className="calls-field">
            <span>Nom</span>
            <input
              className="calls-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
            />
          </label>
          <DatePicker label="Date" value={editDate} onChange={setEditDate} />
          <SessionTypePicker value={editType} onChange={setEditType} />
          <div className="calls-runner-actions">
            <Button onClick={() => void saveEdit()} disabled={saving || !editName.trim()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Annuler
            </Button>
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <Modal
          open
          variant="glass"
          title="Supprimer la séance"
          onClose={() => deletingId == null && setPendingDelete(null)}
        >
          <p className="calls-muted">
            Supprimer « <strong>{pendingDelete.name}</strong> » ? Cette action est irréversible.
          </p>
          <div className="calls-runner-actions">
            <Button
              onClick={() => void executeDelete()}
              disabled={deletingId === pendingDelete.id}
            >
              {deletingId === pendingDelete.id ? "Suppression…" : "Supprimer"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPendingDelete(null)}
              disabled={deletingId === pendingDelete.id}
            >
              Annuler
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
