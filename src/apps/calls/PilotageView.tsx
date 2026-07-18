import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useSession } from "../../auth/useSession";
import { WindowBootScreen } from "../../components/WindowBootScreen";
import { Button, GlassCard, Tag } from "../../components/ui";
import { todayParisIso as todayParisDate } from "../../lib/dates";
import { CallFunnelCard } from "./CallFunnelCard";
import { stagesFromPeriodKpis } from "./CallFunnelCard.helpers";
import { PilotageHeatmap } from "./PilotageHeatmap";
import {
  cockpitDataInSync,
  emptyKpis,
  filterSessionsModeKpis,
  mergeKpis,
  normalizeSessionId,
  selectionStaleForSessions,
} from "./pilotageKpis";
import type { PeriodKpis } from "./types";
import {
  fetchProspectionCockpit,
  prefetchProspectionCockpit,
  PilotageApiError,
  type CockpitCallerRow,
  type CockpitDayCallerRow,
  type CockpitDayRow,
  type CockpitPeriod,
  type CockpitRange,
  type CockpitSessionRow,
  type ProspectionCockpit,
} from "./pilotageApi";
import "./pilotage.css";

type DetailMode = "days" | "sessions";

const EMPTY_DAYS: CockpitDayRow[] = [];
const EMPTY_SESSIONS: CockpitSessionRow[] = [];

type CockpitSlice = {
  data: ProspectionCockpit | null;
  selectedSessionIds: Set<number>;
};

type CockpitSliceAction =
  | { type: "apply"; cockpit: ProspectionCockpit; resetSelection?: boolean }
  | { type: "selectAll"; sessionIds: number[] }
  | { type: "selectNone" }
  | { type: "toggle"; id: number }
  | { type: "clear" };

function cockpitSliceReducer(state: CockpitSlice, action: CockpitSliceAction): CockpitSlice {
  switch (action.type) {
    case "apply": {
      const nextIds = (action.cockpit.sessions ?? []).map((s) => normalizeSessionId(s.id));
      const nextSet = new Set(nextIds);
      let selectedSessionIds: Set<number>;
      if (action.resetSelection || !state.data) {
        selectedSessionIds = nextSet;
      } else {
        selectedSessionIds = new Set(
          [...state.selectedSessionIds].filter((id) => nextSet.has(id)),
        );
        if (selectedSessionIds.size === 0) selectedSessionIds = nextSet;
      }
      return { data: action.cockpit, selectedSessionIds };
    }
    case "selectAll":
      return {
        ...state,
        selectedSessionIds: new Set(action.sessionIds.map((id) => normalizeSessionId(id))),
      };
    case "selectNone":
      return { ...state, selectedSessionIds: new Set() };
    case "toggle": {
      const next = new Set(state.selectedSessionIds);
      const id = normalizeSessionId(action.id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...state, selectedSessionIds: next };
    }
    case "clear":
      return { data: null, selectedSessionIds: new Set() };
    default:
      return state;
  }
}

type CallerCard = {
  user_id: string;
  label: string;
  tracking?: string;
  sessions_active?: number;
  sessions_completed?: number;
  kpis: PeriodKpis;
};

function pct(value: number): string {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  prospection: "Prospection",
  suivi_clients: "Suivi clients",
  suivi_opportunites: "Suivi opportunités",
  relance: "Relance",
};

function callersFromSessions(
  sessions: CockpitSessionRow[],
  baseCallers: CockpitCallerRow[],
): CallerCard[] {
  const baseById = new Map(baseCallers.map((c) => [c.user_id, c]));
  const grouped = new Map<string, { label: string; kpis: PeriodKpis[] }>();

  for (const session of sessions) {
    const uid = session.owner.user_id ?? `sf:${session.owner.sf_user_id ?? session.owner.label}`;
    const existing = grouped.get(uid);
    if (existing) {
      existing.kpis.push(session.kpis);
    } else {
      grouped.set(uid, {
        label: baseById.get(uid)?.label ?? session.owner.label,
        kpis: [session.kpis],
      });
    }
  }

  return Array.from(grouped.entries())
    .map(([user_id, row]) => {
      const base = baseById.get(user_id);
      return {
        user_id,
        label: row.label,
        tracking: base?.tracking,
        sessions_active: base?.sessions_active,
        sessions_completed: base?.sessions_completed,
        kpis: mergeKpis(row.kpis),
      };
    })
    .sort((a, b) => b.kpis.calls - a.kpis.calls || a.label.localeCompare(b.label, "fr"));
}

function dayCallersToCards(rows: CockpitDayCallerRow[]): CallerCard[] {
  return rows
    .map((row) => ({
      user_id: row.user_id,
      label: row.label,
      kpis: row.kpis,
    }))
    .sort((a, b) => b.kpis.calls - a.kpis.calls || a.label.localeCompare(b.label, "fr"));
}

function FunnelStrip({ kpis }: { kpis: PeriodKpis }) {
  return (
    <section className="pilotage-kpis" aria-label="Indicateurs">
      <GlassCard className="pilotage-stat">
        <span>Appels</span>
        <strong className="xos-numeric">{kpis.calls}</strong>
      </GlassCard>
      <GlassCard className="pilotage-stat">
        <span>Taux décroché</span>
        <strong className="xos-numeric">{pct(kpis.rate_decroche)}</strong>
      </GlassCard>
      <GlassCard className="pilotage-stat">
        <span>Taux argumenté</span>
        <strong className="xos-numeric">{pct(kpis.rate_argumente)}</strong>
      </GlassCard>
      <GlassCard className="pilotage-stat">
        <span>RDV / décroché</span>
        <strong className="xos-numeric">{pct(kpis.rate_rdv_per_decroche)}</strong>
      </GlassCard>
      <GlassCard className="pilotage-stat pilotage-stat--accent">
        <span>RDV pris</span>
        <strong className="xos-numeric">{kpis.rdv}</strong>
      </GlassCard>
    </section>
  );
}

function KpiFootnote({
  kpis,
  extras,
}: {
  kpis: PeriodKpis;
  extras?: ReactNode;
}) {
  return (
    <p className="pilotage-secondary">
      RDV / décroché <strong className="xos-numeric">{pct(kpis.rate_rdv_per_decroche)}</strong>
      <span aria-hidden="true"> · </span>
      NPA <strong className="xos-numeric">{kpis.npa}</strong>
      {extras}
    </p>
  );
}

function cockpitCacheKey(period: CockpitPeriod, anchor: string | null): string {
  return `${period}:${anchor ?? "live"}`;
}

function shiftAnchor(anchor: string, period: CockpitPeriod, dir: -1 | 1): string {
  const [y, m, d] = anchor.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (period === "day") date.setUTCDate(date.getUTCDate() + dir);
  else if (period === "week") date.setUTCDate(date.getUTCDate() + dir * 7);
  else date.setUTCMonth(date.getUTCMonth() + dir);
  return date.toISOString().slice(0, 10);
}

function formatPeriodLabel(period: CockpitPeriod, range?: CockpitRange | null): string {
  if (!range?.start) {
    return period === "day" ? "aujourd’hui" : period === "week" ? "cette semaine" : "ce mois";
  }

  const start = new Date(range.start);
  const endExclusive = new Date(range.end);
  const end = new Date(endExclusive.getTime() - 1);

  if (period === "day") {
    return start.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      timeZone: "Europe/Paris",
    });
  }

  if (period === "month") {
    return start.toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
      timeZone: "Europe/Paris",
    });
  }

  const startDay = start.toLocaleDateString("fr-FR", {
    day: "numeric",
    timeZone: "Europe/Paris",
  });
  const endLabel = end.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Paris",
  });
  const startMonth = start.toLocaleDateString("fr-FR", {
    month: "short",
    timeZone: "Europe/Paris",
  });
  const endMonth = end.toLocaleDateString("fr-FR", {
    month: "short",
    timeZone: "Europe/Paris",
  });

  if (startMonth === endMonth) {
    return `${startDay}–${endLabel}`;
  }
  return `${startDay} ${startMonth}–${endLabel}`;
}

/** Label immédiat à partir de l’ancre (avant retour API). */
function formatAnchorLabel(period: CockpitPeriod, anchor: string): string {
  const [y, m, d] = anchor.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (period === "day") {
    return date.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  if (period === "month") {
    return date.toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const weekStart = new Date(date);
  const dow = weekStart.getUTCDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const startDay = weekStart.toLocaleDateString("fr-FR", { day: "numeric", timeZone: "UTC" });
  const endLabel = weekEnd.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const startMonth = weekStart.toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" });
  const endMonth = weekEnd.toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" });
  if (startMonth === endMonth) return `${startDay}–${endLabel}`;
  return `${startDay} ${startMonth}–${endLabel}`;
}

function CommercialCard({
  caller,
  selected,
  onSelect,
}: {
  caller: CallerCard;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button variant="ghost"
      type="button"
      className={`pilotage-caller-card${selected ? " pilotage-caller-card--selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="pilotage-caller-card__head">
        <strong>{caller.label}</strong>
        {caller.tracking === "sdr" && <Tag variant="muted">SDR</Tag>}
      </div>
      <div className="pilotage-caller-card__funnel" aria-label={`Résumé ${caller.label}`}>
        <div>
          <span>Appels</span>
          <strong className="xos-numeric">{caller.kpis.calls}</strong>
        </div>
        <div>
          <span>Décroch.</span>
          <strong className="xos-numeric">{pct(caller.kpis.rate_decroche)}</strong>
        </div>
        <div>
          <span>RDV</span>
          <strong className="xos-numeric">{caller.kpis.rdv}</strong>
        </div>
      </div>
    </Button>
  );
}

export function PilotageView({
  onBack,
  onPin,
}: {
  onBack: () => void;
  onPin?: () => Promise<void>;
}) {
  const { session, loading: sessionLoading } = useSession();
  const token = session?.access_token ?? null;
  const [period, setPeriod] = useState<CockpitPeriod>("day");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>("sessions");
  const [cockpitSlice, dispatchCockpit] = useReducer(cockpitSliceReducer, {
    data: null,
    selectedSessionIds: new Set<number>(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const dataRef = useRef<ProspectionCockpit | null>(null);
  const selectionScopeRef = useRef<string | null>(null);
  const stableKpisRef = useRef<PeriodKpis>(emptyKpis());
  const [pinned, setPinned] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);
  const [showAllRdv, setShowAllRdv] = useState(false);

  const data = cockpitSlice.data;
  const selectedSessionIds = cockpitSlice.selectedSessionIds;

  const RDV_PREVIEW_LIMIT = 5;

  const applyCockpit = useCallback((next: ProspectionCockpit, activePeriod: CockpitPeriod, scopeKey: string) => {
    const resetSelection = selectionScopeRef.current !== scopeKey;
    selectionScopeRef.current = scopeKey;
    dispatchCockpit({ type: "apply", cockpit: next, resetSelection });
    dataRef.current = next;
    if (resetSelection) {
      setExpandedDay(null);
      setSelectedCallerId(null);
      setShowAllRdv(false);
      if (activePeriod === "day") {
        setDetailMode("sessions");
      }
    }
  }, []);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (!token) return;
    const seq = ++loadSeq.current;
    const key = cockpitCacheKey(period, anchor);
    const force = opts?.force === true;

    if (!dataRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const next = await fetchProspectionCockpit(token, period, anchor, { force });
      if (seq !== loadSeq.current) return;
      applyCockpit(next, period, key);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (!dataRef.current) {
        if (err instanceof PilotageApiError && err.code === "forbidden") {
          setError("Réservé aux managers.");
        } else {
          setError("Impossible de charger le pilotage.");
        }
        dispatchCockpit({ type: "clear" });
        dataRef.current = null;
        selectionScopeRef.current = null;
      }
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [token, period, anchor, applyCockpit]);

  const prefetchCockpit = useCallback(
    (nextPeriod: CockpitPeriod, nextAnchor: string) => {
      if (!token) return;
      const today = todayParisDate();
      if (nextAnchor > today) return;
      prefetchProspectionCockpit(token, nextPeriod, nextAnchor);
    },
    [token],
  );

  const prefetchDay = useCallback(
    (date: string) => {
      prefetchCockpit("day", date);
    },
    [prefetchCockpit],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Précharge les périodes adjacentes pour que ‹ › soit instantané.
  useEffect(() => {
    if (!token || !data) return;
    const base = anchor ?? data.range?.anchor ?? todayParisDate();
    const prev = shiftAnchor(base, period, -1);
    const next = shiftAnchor(base, period, 1);
    prefetchCockpit(period, prev);
    prefetchCockpit(period, next);
    if (period !== "day") {
      prefetchCockpit("day", base);
    }
  }, [token, data, period, anchor, prefetchCockpit]);

  const sessions = data?.sessions ?? EMPTY_SESSIONS;
  const byDay = data?.by_day ?? EMPTY_DAYS;

  const selectedSessions = useMemo(() => {
    const picked = sessions.filter((s) => selectedSessionIds.has(normalizeSessionId(s.id)));
    if (selectionStaleForSessions(sessions, selectedSessionIds)) {
      return sessions;
    }
    return picked;
  }, [sessions, selectedSessionIds]);

  const filtered = useMemo(() => {
    if (!data) {
      return { kpis: emptyKpis(), callers: [] as CallerCard[] };
    }

    if (detailMode === "sessions") {
      const { kpis, allCallers } = filterSessionsModeKpis(data, sessions, selectedSessionIds);
      if (allCallers) {
        return { kpis, callers: data.by_caller as CallerCard[] };
      }
      return {
        kpis,
        callers: callersFromSessions(selectedSessions, data.by_caller),
      };
    }

    if (expandedDay) {
      const day = byDay.find((d) => d.date === expandedDay);
      if (day) {
        return {
          kpis: day.kpis,
          callers: dayCallersToCards(day.by_caller),
        };
      }
    }

    return {
      kpis: data.team_kpis,
      callers: data.by_caller as CallerCard[],
    };
  }, [data, detailMode, sessions, selectedSessionIds, selectedSessions, expandedDay, byDay]);

  const kpis = useMemo(() => {
    const computed = filtered.kpis;
    if (data && !cockpitDataInSync(data, period, anchor)) {
      return stableKpisRef.current;
    }
    stableKpisRef.current = computed;
    return computed;
  }, [filtered.kpis, data, period, anchor]);

  const selectedCaller = useMemo(
    () => filtered.callers.find((c) => c.user_id === selectedCallerId) ?? null,
    [filtered.callers, selectedCallerId],
  );

  const selectAllSessions = () => {
    dispatchCockpit({
      type: "selectAll",
      sessionIds: sessions.map((s) => normalizeSessionId(s.id)),
    });
  };

  const selectNoSessions = () => {
    dispatchCockpit({ type: "selectNone" });
  };

  const toggleSession = (id: number) => {
    dispatchCockpit({ type: "toggle", id });
  };

  if (sessionLoading || (loading && !data && !error)) {
    return <WindowBootScreen label="Pilotage" />;
  }

  if (!token) {
    return <div className="pilotage-app pilotage-app__state">Session requise.</div>;
  }

  if (error && !data) {
    return (
      <div className="pilotage-app pilotage-app__state">
        <p>{error}</p>
        <Button variant="secondary" onClick={() => void load({ force: true })}>Réessayer</Button>
      </div>
    );
  }

  const effectiveAnchor = anchor ?? data?.range?.anchor ?? todayParisDate();
  const rangeMatchesAnchor =
    !anchor || data?.range?.anchor === anchor || (data?.range?.anchor == null && anchor == null);
  const periodLabel =
    rangeMatchesAnchor && data?.range
      ? formatPeriodLabel(period, data.range)
      : formatAnchorLabel(period, effectiveAnchor);
  const todayStr = todayParisDate();
  const canGoNext = shiftAnchor(effectiveAnchor, period, 1) <= todayStr;
  const heatmapDays = data?.heatmap ?? [];
  const rdvAttributions = data?.rdv_attributions ?? [];
  const hasMoreRdv = rdvAttributions.length > RDV_PREVIEW_LIMIT;
  const visibleRdvAttributions = showAllRdv
    ? rdvAttributions
    : rdvAttributions.slice(0, RDV_PREVIEW_LIMIT);

  const goPrev = () => {
    const prev = shiftAnchor(effectiveAnchor, period, -1);
    prefetchCockpit(period, prev);
    setAnchor(prev);
  };
  const goNext = () => {
    const next = shiftAnchor(effectiveAnchor, period, 1);
    if (next <= todayStr) {
      prefetchCockpit(period, next);
      setAnchor(next);
    }
  };
  const selectHeatmapDay = (date: string) => {
    prefetchDay(date);
    setPeriod("day");
    setAnchor(date);
  };

  return (
    <div className="calls-view pilotage-app">
      <header className="calls-view__header pilotage-header">
        <div>
          <Tag variant="accent">Combo</Tag>
          <h2>Pilotage</h2>
          <p className="pilotage-header__sub">
            L’équipe en un coup d’œil · {periodLabel}
          </p>
        </div>
        <div className="calls-view__actions pilotage-header__actions">
          <div className="pilotage-period-nav" role="group" aria-label="Navigation période">
            <Button variant="ghost"
              type="button"
              className="calls-seg__btn"
              onClick={goPrev}
              onMouseEnter={() => prefetchCockpit(period, shiftAnchor(effectiveAnchor, period, -1))}
              onFocus={() => prefetchCockpit(period, shiftAnchor(effectiveAnchor, period, -1))}
              aria-label="Période précédente"
            >
              ‹
            </Button>
            <span className="pilotage-period-nav__label">{periodLabel}</span>
            <Button variant="ghost"
              type="button"
              className="calls-seg__btn"
              onClick={goNext}
              disabled={!canGoNext}
              onMouseEnter={() => {
                const next = shiftAnchor(effectiveAnchor, period, 1);
                if (next <= todayStr) prefetchCockpit(period, next);
              }}
              onFocus={() => {
                const next = shiftAnchor(effectiveAnchor, period, 1);
                if (next <= todayStr) prefetchCockpit(period, next);
              }}
              aria-label="Période suivante"
            >
              ›
            </Button>
          </div>
          <div className="calls-seg" role="group" aria-label="Période">
            <Button variant="ghost"
              type="button"
              className={`calls-seg__btn${period === "day" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={period === "day"}
              onClick={() => setPeriod("day")}
            >
              Jour
            </Button>
            <Button variant="ghost"
              type="button"
              className={`calls-seg__btn${period === "week" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={period === "week"}
              onClick={() => setPeriod("week")}
            >
              Semaine
            </Button>
            <Button variant="ghost"
              type="button"
              className={`calls-seg__btn${period === "month" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={period === "month"}
              onClick={() => setPeriod("month")}
            >
              Mois
            </Button>
          </div>
          <div className="calls-seg" role="group" aria-label="Détail">
            <Button variant="ghost"
              type="button"
              className={`calls-seg__btn${detailMode === "days" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={detailMode === "days"}
              disabled={period === "day" && byDay.length <= 1}
              title={
                period === "day" && byDay.length <= 1
                  ? "Un seul jour — passez par Séances"
                  : undefined
              }
              onClick={() => {
                setDetailMode("days");
                setSelectedCallerId(null);
              }}
            >
              Jours
            </Button>
            <Button variant="ghost"
              type="button"
              className={`calls-seg__btn${detailMode === "sessions" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={detailMode === "sessions"}
              onClick={() => {
                setDetailMode("sessions");
                setExpandedDay(null);
                setSelectedCallerId(null);
              }}
            >
              Séances
            </Button>
          </div>
          <Button variant="secondary" onClick={() => void load({ force: true })} disabled={loading && !data}>
            Actualiser
          </Button>
          {onPin && (
            <Button
              variant="secondary"
              disabled={pinned}
              onClick={() => {
                void onPin()
                  .then(() => setPinned(true))
                  .catch(() => {});
              }}
            >
              {pinned ? "Épinglé ✓" : "Épingler au bureau"}
            </Button>
          )}
          <Button variant="secondary" onClick={onBack}>
            Retour
          </Button>
        </div>
      </header>

      {error && <p className="pilotage-error" role="alert">{error}</p>}

      <FunnelStrip kpis={kpis} />

      <div className="pilotage-compact-row">
        <PilotageHeatmap
          days={heatmapDays}
          selectedDate={period === "day" ? effectiveAnchor : null}
          onSelectDay={selectHeatmapDay}
          onPrefetchDay={prefetchDay}
        />

        {detailMode === "sessions" && (
          <section className="pilotage-compact-card pilotage-sessions-compact" aria-label="Séances">
            <div className="pilotage-compact-card__head">
              <div>
                <h3>Séances</h3>
                <p className="pilotage-compact-card__hint">Cochez pour filtrer.</p>
              </div>
              <div className="calls-seg pilotage-sessions-compact__actions" role="group" aria-label="Sélection séances">
                <Button variant="ghost"
                  type="button"
                  className="calls-seg__btn"
                  onClick={selectAllSessions}
                  disabled={sessions.length === 0 || selectedSessionIds.size === sessions.length}
                >
                  Tout
                </Button>
                <Button variant="ghost"
                  type="button"
                  className="calls-seg__btn"
                  onClick={selectNoSessions}
                  disabled={sessions.length === 0 || selectedSessionIds.size === 0}
                >
                  Aucun
                </Button>
              </div>
            </div>

            {sessions.length === 0 ? (
              <p className="pilotage-empty">Aucune séance sur la période.</p>
            ) : (
              <ul className="pilotage-session-list pilotage-sessions-compact__list">
                {sessions.map((session) => {
                  const checked = selectedSessionIds.has(session.id);
                  return (
                    <li key={session.id}>
                      <label
                        className={`pilotage-session-chip${checked ? " pilotage-session-chip--checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSession(session.id)}
                        />
                        <span className="pilotage-session-chip__body">
                          <span className="pilotage-session-chip__title">
                            <strong>{session.name}</strong>
                            {session.shared && <Tag variant="accent">Partagée</Tag>}
                          </span>
                          <span className="pilotage-session-chip__meta">
                            <span>{session.owner.label}</span>
                            <span className="pilotage-muted">
                              {SESSION_TYPE_LABEL[session.session_type] || session.session_type}
                            </span>
                            <span className="xos-numeric">
                              {session.kpis.calls} · {pct(session.kpis.rate_decroche)} · {session.kpis.rdv} RDV
                            </span>
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {detailMode === "days" && (
        <GlassCard className="pilotage-panel">
          <div className="pilotage-panel__toolbar">
            <div>
              <h3>Par jour</h3>
              <p className="pilotage-panel__hint">Choisissez un jour pour zoomer.</p>
            </div>
            {expandedDay && (
              <Button
                variant="secondary"
                onClick={() => {
                  setExpandedDay(null);
                  setSelectedCallerId(null);
                }}
              >
                Toute la période
              </Button>
            )}
          </div>

          {byDay.length === 0 ? (
            <p className="pilotage-empty">Aucune activité sur la période.</p>
          ) : (
            <ul className="pilotage-day-list">
              {byDay.map((day) => {
                const open = expandedDay === day.date;
                return (
                  <li key={day.date} className={`pilotage-day-row${open ? " pilotage-day-row--open" : ""}`}>
                    <Button variant="ghost"
                      type="button"
                      className="pilotage-day-row__btn"
                      aria-expanded={open}
                      onClick={() => {
                        setExpandedDay((prev) => (prev === day.date ? null : day.date));
                        setSelectedCallerId(null);
                      }}
                    >
                      <span className="pilotage-day-row__label">
                        <strong>{day.label}</strong>
                        <span className="pilotage-muted xos-numeric">{day.date}</span>
                      </span>
                      <span className="pilotage-day-row__kpis xos-numeric">
                        <span>{day.kpis.calls} appels</span>
                        <span>{pct(day.kpis.rate_decroche)} décroché</span>
                        <span>{day.kpis.rdv} RDV</span>
                      </span>
                    </Button>
                    {open && day.by_caller.length > 0 && (
                      <div className="pilotage-day-row__callers">
                        {day.by_caller.map((c) => (
                          <span key={c.user_id} className="pilotage-day-caller-pill">
                            <strong>{c.label}</strong>
                            <span className="xos-numeric">
                              {c.kpis.calls} · {pct(c.kpis.rate_decroche)} · {c.kpis.rdv} RDV
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </GlassCard>
      )}

      <div className="pilotage-funnel-block">
        <CallFunnelCard stages={stagesFromPeriodKpis(kpis)} />
        <KpiFootnote
          kpis={kpis}
          extras={
            <>
              {detailMode === "sessions" && sessions.length > 0 && (
                <>
                  <span aria-hidden="true"> · </span>
                  {selectedSessions.length}/{sessions.length} séance
                  {sessions.length > 1 ? "s" : ""}
                </>
              )}
              {detailMode === "days" && expandedDay && (
                <>
                  <span aria-hidden="true"> · </span>
                  {byDay.find((d) => d.date === expandedDay)?.label ?? expandedDay}
                </>
              )}
            </>
          }
        />
      </div>

      <GlassCard className="pilotage-panel">
        <h3>Équipe</h3>
        <p className="pilotage-panel__hint">Répartition par commercial — cliquez pour le détail.</p>

        {filtered.callers.length === 0 ? (
          <p className="pilotage-empty">Aucune activité sur la période.</p>
        ) : (
          <div className="pilotage-caller-grid">
            {filtered.callers.map((caller) => (
              <CommercialCard
                key={caller.user_id}
                caller={caller}
                selected={selectedCallerId === caller.user_id}
                onSelect={() =>
                  setSelectedCallerId((prev) => (prev === caller.user_id ? null : caller.user_id))
                }
              />
            ))}
          </div>
        )}

        {selectedCaller && (
          <div className="pilotage-caller-detail" role="region" aria-label={`Détail ${selectedCaller.label}`}>
            <div className="pilotage-caller-detail__head">
              <strong>{selectedCaller.label}</strong>
              {selectedCaller.tracking === "sdr" && <Tag variant="muted">SDR</Tag>}
              <Button variant="secondary" onClick={() => setSelectedCallerId(null)}>
                Fermer
              </Button>
            </div>
            <CallFunnelCard
              stages={stagesFromPeriodKpis(selectedCaller.kpis)}
              title={selectedCaller.label}
              compact
            />
            <KpiFootnote
              kpis={selectedCaller.kpis}
              extras={
                typeof selectedCaller.sessions_active === "number" ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    Séances en cours{" "}
                    <strong className="xos-numeric">{selectedCaller.sessions_active}</strong>
                  </>
                ) : null
              }
            />
          </div>
        )}
      </GlassCard>

      <div className="pilotage-grid">
        <GlassCard className="pilotage-panel">
          <h3>RDV par commercial</h3>
          <p className="pilotage-panel__hint">Chez qui le RDV est au calendrier.</p>
          {(data?.by_rdv_owner.length ?? 0) === 0 ? (
            <p className="pilotage-empty">Aucun RDV sur la période.</p>
          ) : (
            <table className="pilotage-table">
              <thead>
                <tr>
                  <th>Commercial</th>
                  <th>RDV</th>
                  <th>Dont via SDR</th>
                </tr>
              </thead>
              <tbody>
                {data?.by_rdv_owner.map((row) => (
                  <tr key={row.sf_user_id || row.label}>
                    <td><strong>{row.label}</strong></td>
                    <td className="xos-numeric">{row.rdv}</td>
                    <td className="xos-numeric">{row.from_sdr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>

        <GlassCard className="pilotage-panel">
          <div className="pilotage-panel__toolbar">
            <div>
              <h3>Derniers RDV</h3>
              <p className="pilotage-panel__hint">Qui a appelé, à qui le RDV revient.</p>
            </div>
            {hasMoreRdv && (
              <Button variant="ghost"
                type="button"
                className="calls-seg__btn"
                onClick={() => setShowAllRdv((open) => !open)}
              >
                {showAllRdv ? "Réduire" : `Tout voir (${rdvAttributions.length})`}
              </Button>
            )}
          </div>
          {rdvAttributions.length === 0 ? (
            <p className="pilotage-empty">Aucun RDV sur la période.</p>
          ) : (
            <table className="pilotage-table">
              <thead>
                <tr>
                  <th>Quand</th>
                  <th>Contact</th>
                  <th>Appelant</th>
                  <th>Pour</th>
                  <th>Séance</th>
                </tr>
              </thead>
              <tbody>
                {visibleRdvAttributions.map((row) => (
                  <tr key={row.session_contact_id}>
                    <td className="xos-numeric">{formatWhen(row.called_at)}</td>
                    <td>
                      <strong>{row.contact_name}</strong>
                      {row.account_name && (
                        <span className="pilotage-muted"> · {row.account_name}</span>
                      )}
                    </td>
                    <td>{row.caller.label}</td>
                    <td>
                      <strong>{row.rdv_owner_label}</strong>
                      {row.caller.sf_user_id
                        && row.rdv_owner_sf_user_id
                        && row.caller.sf_user_id !== row.rdv_owner_sf_user_id && (
                          <Tag variant="accent">SDR</Tag>
                      )}
                    </td>
                    <td className="pilotage-muted">{row.session_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
