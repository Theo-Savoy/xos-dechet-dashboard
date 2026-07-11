import { useMemo, useState, type MouseEvent } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import { ProgressBar } from "./ProgressBar";
import type { CallStats, PeriodKpis, SessionSummary, SessionType } from "./types";
import { SESSION_TYPE_OPTIONS, sessionTypeLabel } from "./types";

type HubViewMode = "list" | "calendar";
type KpiPeriod = "week" | "month";

type SessionsViewProps = {
  sessions: SessionSummary[];
  stats: CallStats | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNewSession: () => void;
  onOpenSession: (sessionId: number) => void;
  onUpdateSession: (
    sessionId: number,
    patch: { name?: string; scheduled_for?: string | null; session_type?: SessionType },
  ) => Promise<void>;
  onDeleteSession: (sessionId: number) => Promise<void>;
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

function sessionDayKey(session: SessionSummary): string {
  if (session.scheduled_for) return session.scheduled_for;
  return session.created_at.slice(0, 10);
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
  const startPad = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, monthIndex, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function SessionsView({
  sessions,
  stats,
  loading,
  error,
  onRefresh,
  onNewSession,
  onOpenSession,
  onUpdateSession,
  onDeleteSession,
}: SessionsViewProps) {
  const [viewMode, setViewMode] = useState<HubViewMode>("list");
  const [kpiPeriod, setKpiPeriod] = useState<KpiPeriod>("week");
  const [typeFilter, setTypeFilter] = useState<SessionType | "all">("all");
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [editing, setEditing] = useState<SessionSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState<SessionType>("prospection");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const kpis = (kpiPeriod === "week" ? stats?.week : stats?.month) ?? emptyKpis();

  const filteredSessions = useMemo(
    () =>
      typeFilter === "all"
        ? sessions
        : sessions.filter((session) => session.session_type === typeFilter),
    [sessions, typeFilter],
  );

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

  const confirmDelete = async (session: SessionSummary, e: MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Supprimer la séance « ${session.name} » ?`)) return;
    setDeletingId(session.id);
    try {
      await onDeleteSession(session.id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="calls-view calls-hub">
      <header className="calls-view__header">
        <div>
          <Tag variant="accent">Call Manager</Tag>
          <h2>Hub prospection</h2>
        </div>
        <div className="calls-view__actions">
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            Actualiser
          </Button>
          <Button onClick={onNewSession}>Nouvelle séance</Button>
        </div>
      </header>

      <section className="calls-hub-kpis" aria-label="Indicateurs">
        <div className="calls-hub-kpis__toolbar">
          <h3>Performance</h3>
          <div className="calls-list-filter-chips" role="group" aria-label="Période KPIs">
            <button
              type="button"
              className={`calls-list-filter-chip${kpiPeriod === "week" ? " calls-list-filter-chip--active" : ""}`}
              aria-pressed={kpiPeriod === "week"}
              onClick={() => setKpiPeriod("week")}
            >
              Semaine
            </button>
            <button
              type="button"
              className={`calls-list-filter-chip${kpiPeriod === "month" ? " calls-list-filter-chip--active" : ""}`}
              aria-pressed={kpiPeriod === "month"}
              onClick={() => setKpiPeriod("month")}
            >
              Mois
            </button>
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
          <GlassCard className="calls-stat">
            <span>RDV / argumenté</span>
            <strong className="xos-numeric">{pct(kpis.rate_rdv_per_argumente)}</strong>
          </GlassCard>
          <GlassCard className="calls-stat">
            <span>NPA</span>
            <strong className="xos-numeric">{kpis.npa}</strong>
          </GlassCard>
        </div>
        {stats && (
          <p className="calls-hub-kpis__meta">
            Aujourd&apos;hui {stats.calls_today} · Semaine {stats.calls_week} ·{" "}
            {stats.sessions_active} active{stats.sessions_active > 1 ? "s" : ""} ·{" "}
            {stats.sessions_completed} terminée{stats.sessions_completed > 1 ? "s" : ""}
          </p>
        )}
      </section>

      <div className="calls-hub-toolbar">
        <div className="calls-list-filter-chips" role="group" aria-label="Vue séances">
          <button
            type="button"
            className={`calls-list-filter-chip${viewMode === "list" ? " calls-list-filter-chip--active" : ""}`}
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode("list")}
          >
            Liste
          </button>
          <button
            type="button"
            className={`calls-list-filter-chip${viewMode === "calendar" ? " calls-list-filter-chip--active" : ""}`}
            aria-pressed={viewMode === "calendar"}
            onClick={() => setViewMode("calendar")}
          >
            Calendrier
          </button>
        </div>
        <div className="calls-list-filter-chips" role="group" aria-label="Type de séance">
          <button
            type="button"
            className={`calls-list-filter-chip${typeFilter === "all" ? " calls-list-filter-chip--active" : ""}`}
            aria-pressed={typeFilter === "all"}
            onClick={() => setTypeFilter("all")}
          >
            Tous
          </button>
          {SESSION_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`calls-list-filter-chip${typeFilter === opt.value ? " calls-list-filter-chip--active" : ""}`}
              aria-pressed={typeFilter === opt.value}
              onClick={() => setTypeFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="calls-state">Chargement des séances…</p>}
      {error && (
        <GlassCard className="calls-error">
          <p>{error}</p>
          <Button variant="secondary" onClick={onRefresh}>
            Réessayer
          </Button>
        </GlassCard>
      )}

      {!loading && !error && filteredSessions.length === 0 && (
        <GlassCard className="calls-empty calls-empty--hero">
          <Tag variant="accent">Prêt à prospecter</Tag>
          <h3>Aucune séance pour le moment</h3>
          <p>Composez une liste ciblée, planifiez une séance et suivez vos KPIs ici.</p>
          <Button onClick={onNewSession}>Créer une première séance</Button>
        </GlassCard>
      )}

      {!loading && !error && viewMode === "list" && filteredSessions.length > 0 && (
        <ul className="calls-session-list">
          {filteredSessions.map((session) => (
            <li key={session.id}>
              <GlassCard
                className="calls-session-card"
                role="button"
                tabIndex={0}
                onClick={() => onOpenSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenSession(session.id);
                  }
                }}
              >
                <div className="calls-session-card__top">
                  <strong>{session.name}</strong>
                  <div className="calls-session-card__tags">
                    <Tag variant="accent">{sessionTypeLabel(session.session_type)}</Tag>
                    <Tag variant={session.status === "active" ? "accent" : "default"}>
                      {session.status === "active" ? "En cours" : "Terminée"}
                    </Tag>
                  </div>
                </div>
                <span className="calls-session-card__date">
                  {session.scheduled_for
                    ? `Séance du ${formatScheduledDate(session.scheduled_for)}`
                    : formatDate(session.created_at)}
                </span>
                <ProgressBar called={session.called} total={session.total} />
                {session.skipped > 0 && (
                  <small className="calls-session-card__skipped">
                    {session.skipped} non joint{session.skipped > 1 ? "s" : ""}
                  </small>
                )}
                <div className="calls-session-card__actions">
                  <Button variant="secondary" onClick={(e) => openEdit(session, e)}>
                    Modifier
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={(e) => void confirmDelete(session, e)}
                    disabled={deletingId === session.id}
                  >
                    {deletingId === session.id ? "Suppression…" : "Supprimer"}
                  </Button>
                </div>
              </GlassCard>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && viewMode === "calendar" && (
        <GlassCard className="calls-calendar">
          <div className="calls-calendar__nav">
            <Button
              variant="secondary"
              onClick={() =>
                setCalendarCursor((c) => {
                  const d = new Date(c.year, c.month - 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              ←
            </Button>
            <h3 className="calls-calendar__title">{monthLabel}</h3>
            <Button
              variant="secondary"
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
          <div className="calls-calendar__weekdays" aria-hidden="true">
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calls-calendar__grid">
            {monthCells.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="calls-calendar__cell calls-calendar__cell--empty" />;
              }
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
              const daySessions = sessionsByDay.get(key) ?? [];
              const isToday = key === new Date().toISOString().slice(0, 10);
              return (
                <div
                  key={key}
                  className={`calls-calendar__cell${isToday ? " calls-calendar__cell--today" : ""}${daySessions.length ? " calls-calendar__cell--has" : ""}`}
                >
                  <span className="calls-calendar__day xos-numeric">{date.getDate()}</span>
                  <ul className="calls-calendar__events">
                    {daySessions.slice(0, 3).map((session) => (
                      <li key={session.id}>
                        <button
                          type="button"
                          className={`calls-calendar__event calls-calendar__event--${session.session_type}`}
                          onClick={() => onOpenSession(session.id)}
                          title={session.name}
                        >
                          {session.name}
                        </button>
                      </li>
                    ))}
                    {daySessions.length > 3 && (
                      <li className="calls-calendar__more">+{daySessions.length - 3}</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {editing && (
        <div className="calls-modal" role="dialog" aria-modal="true" aria-labelledby="edit-session-title">
          <GlassCard className="calls-modal__panel">
            <h3 id="edit-session-title">Modifier la séance</h3>
            <label className="calls-field">
              <span>Nom</span>
              <input
                className="calls-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </label>
            <label className="calls-field">
              <span>Date</span>
              <input
                type="date"
                className="calls-input"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </label>
            <label className="calls-field">
              <span>Type</span>
              <select
                className="calls-input"
                value={editType}
                onChange={(e) => setEditType(e.target.value as SessionType)}
              >
                {SESSION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="calls-runner-actions">
              <Button onClick={() => void saveEdit()} disabled={saving || !editName.trim()}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
                Annuler
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
