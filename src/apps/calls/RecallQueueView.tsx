import { useEffect, useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  DEFAULT_RECALL_DAYS,
  RECALL_ELIGIBLE_RESULTATS,
  RELANCE_DEFAULT_RESULTATS,
  type ResultatCall,
} from "../../crm";
import { EventPanel } from "./EventPanel";
import { DatePicker, formatIsoDateFr, todayParisIso } from "./formControls";
import type { ContactContext, RecallInboxItem } from "./types";
import { RESULTAT_OPTIONS } from "./types";
import type { LogPayload } from "./RunnerView";

const RECALL_DAYS_KEY = "xos-calls-default-recall-days";

type RecallFilter = "today" | "overdue" | "upcoming" | "all";

type RecallQueueViewProps = {
  recalls: RecallInboxItem[];
  loading: boolean;
  error: string | null;
  contactContext: ContactContext | null;
  contextContactId: number | null;
  contextLoading: boolean;
  onBack: () => void;
  onFocusContact: (item: RecallInboxItem) => void;
  onLogAndNext: (item: RecallInboxItem, payload: LogPayload) => void;
  onLogRdvAndNext: (
    item: RecallInboxItem,
    payload: LogPayload,
    event: { start: string; durationMin: number; invitees: string[] },
  ) => void;
};

const RECALL_PRESETS: { days: number; label: string }[] = [
  { days: 0, label: "Aujourd'hui" },
  { days: 1, label: "+1 j" },
  { days: 3, label: "+3 j" },
  { days: 7, label: "+7 j" },
  { days: 14, label: "+14 j" },
];

function addDaysIso(days: number): string {
  const [y, m, d] = todayParisIso().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function readDefaultRecallDays(): number {
  try {
    const raw = localStorage.getItem(RECALL_DAYS_KEY);
    const value = raw ? Number(raw) : DEFAULT_RECALL_DAYS;
    return Number.isInteger(value) && value >= 0 && value <= 90 ? value : DEFAULT_RECALL_DAYS;
  } catch {
    return DEFAULT_RECALL_DAYS;
  }
}

function recallKey(item: RecallInboxItem): string {
  return `${item.session_id}-${item.id}`;
}

function matchesFilter(item: RecallInboxItem, filter: RecallFilter, today: string): boolean {
  if (filter === "all") return true;
  if (filter === "today") return item.recall_at === today;
  if (filter === "overdue") return item.recall_at < today;
  return item.recall_at > today;
}

function ResultButtons({
  value,
  onChange,
}: {
  value: ResultatCall;
  onChange: (value: ResultatCall) => void;
}) {
  return (
    <div className="calls-result-grid" role="group" aria-label="Résultat de l'appel">
      {RESULTAT_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`calls-result-btn${value === opt.value ? " calls-result-btn--active" : ""}`}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function QueueRecallFields({
  resultat,
  scheduleRecall,
  onScheduleRecallChange,
  recallAt,
  onRecallAtChange,
  onDefaultRecallDaysChange,
}: {
  resultat: ResultatCall;
  scheduleRecall: boolean;
  onScheduleRecallChange: (value: boolean) => void;
  recallAt: string;
  onRecallAtChange: (value: string) => void;
  onDefaultRecallDaysChange: (days: number) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const autoRecall = RELANCE_DEFAULT_RESULTATS.includes(resultat);
  if (!RECALL_ELIGIBLE_RESULTATS.includes(resultat)) return null;

  const activePreset = RECALL_PRESETS.find((preset) => addDaysIso(preset.days) === recallAt)?.days;
  const showPicker = customOpen || activePreset == null;

  return (
    <div className="calls-recall" role="group" aria-label="Rappel">
      <div className="calls-recall__head">
        <p className="calls-recall__title">Rappel</p>
        {(autoRecall || scheduleRecall) && (
          <span className="calls-recall__summary">{formatIsoDateFr(recallAt)}</span>
        )}
      </div>
      {!autoRecall && (
        <label className="calls-checkbox calls-checkbox--tight">
          <input
            type="checkbox"
            checked={scheduleRecall}
            onChange={(e) => onScheduleRecallChange(e.target.checked)}
          />
          Planifier un rappel
        </label>
      )}
      {(autoRecall || scheduleRecall) && (
        <div className="calls-recall__body">
          <div className="calls-recall__presets" role="group" aria-label="Délai de rappel">
            {RECALL_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                className={`calls-recall__chip${activePreset === preset.days ? " calls-recall__chip--active" : ""}`}
                aria-pressed={activePreset === preset.days}
                onClick={() => {
                  setCustomOpen(false);
                  onDefaultRecallDaysChange(preset.days);
                  onRecallAtChange(addDaysIso(preset.days));
                }}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={`calls-recall__chip${showPicker && activePreset == null ? " calls-recall__chip--active" : ""}`}
              aria-pressed={showPicker && activePreset == null}
              onClick={() => setCustomOpen(true)}
            >
              Date…
            </button>
          </div>
          {showPicker && (
            <DatePicker
              label="Date de rappel"
              value={recallAt}
              onChange={(next) => {
                setCustomOpen(true);
                onRecallAtChange(next);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function RecallQueueView({
  recalls,
  loading,
  error,
  contactContext,
  contextContactId,
  contextLoading,
  onBack,
  onFocusContact,
  onLogAndNext,
  onLogRdvAndNext,
}: RecallQueueViewProps) {
  const today = todayParisIso();
  const [filter, setFilter] = useState<RecallFilter>("today");
  const [mode, setMode] = useState<"list" | "detail">("list");
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ResultatCall>(RESULTAT_OPTIONS[0].value);
  const [comments, setComments] = useState("");
  const [defaultRecallDays, setDefaultRecallDays] = useState(readDefaultRecallDays);
  const [recallAt, setRecallAt] = useState(() => addDaysIso(readDefaultRecallDays()));
  const [doNotCall, setDoNotCall] = useState(false);
  const [scheduleRecall, setScheduleRecall] = useState(true);
  const [listQuery, setListQuery] = useState("");

  const counts = useMemo(() => {
    const base = { today: 0, overdue: 0, upcoming: 0, all: recalls.length };
    for (const item of recalls) {
      if (item.recall_at === today) base.today += 1;
      else if (item.recall_at < today) base.overdue += 1;
      else base.upcoming += 1;
    }
    return base;
  }, [recalls, today]);

  const filtered = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return recalls.filter((item) => {
      if (!matchesFilter(item, filter, today)) return false;
      if (!q) return true;
      const haystack = [item.contact_name, item.account_name, item.title, item.phone, item.session_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [recalls, filter, today, listQuery]);

  const focused = useMemo(() => {
    if (focusedKey == null) return filtered[0] ?? null;
    return filtered.find((item) => recallKey(item) === focusedKey) ?? filtered[0] ?? null;
  }, [filtered, focusedKey]);

  const canRecall = RECALL_ELIGIBLE_RESULTATS.includes(resultat) && !doNotCall;
  const willSendRecall = canRecall && (RELANCE_DEFAULT_RESULTATS.includes(resultat) || scheduleRecall);
  const contextApplies = focused != null && contextContactId === focused.id;

  useEffect(() => {
    if (filter === "today" && counts.today === 0 && counts.overdue > 0) {
      setFilter("overdue");
    }
  }, [filter, counts.today, counts.overdue]);

  useEffect(() => {
    if (focusedKey != null && filtered.some((item) => recallKey(item) === focusedKey)) return;
    setFocusedKey(filtered[0] ? recallKey(filtered[0]) : null);
  }, [filtered, focusedKey]);

  useEffect(() => {
    if (!focused) return;
    onFocusContact(focused);
  }, [focused?.id, focused?.session_id, onFocusContact]);

  useEffect(() => {
    setResultat(RESULTAT_OPTIONS[0].value);
    setComments("");
    setDoNotCall(false);
    setScheduleRecall(true);
    setRecallAt(addDaysIso(defaultRecallDays));
  }, [focused?.id, focused?.session_id, defaultRecallDays]);

  useEffect(() => {
    setScheduleRecall(RELANCE_DEFAULT_RESULTATS.includes(resultat));
  }, [resultat]);

  const handleDefaultRecallDays = (days: number) => {
    setDefaultRecallDays(days);
    setRecallAt(addDaysIso(days));
    try {
      localStorage.setItem(RECALL_DAYS_KEY, String(days));
    } catch {
      /* ignore */
    }
  };

  const openDetail = (item: RecallInboxItem) => {
    setFocusedKey(recallKey(item));
    onFocusContact(item);
    setMode("detail");
  };

  const advancePast = (item: RecallInboxItem) => {
    const key = recallKey(item);
    const rest = filtered.filter((row) => recallKey(row) !== key);
    setFocusedKey(rest[0] ? recallKey(rest[0]) : null);
  };

  const handleSubmit = () => {
    if (!focused) return;
    if (resultat === "RDV planifié") return;
    const current = focused;
    onLogAndNext(current, {
      resultat,
      comments,
      recallAt: willSendRecall ? recallAt : null,
      doNotCall,
    });
    advancePast(current);
  };

  const handleRdvSubmit = (start: string, durationMin: number, invitees: string[]) => {
    if (!focused) return;
    const current = focused;
    onLogRdvAndNext(
      current,
      {
        resultat: "RDV planifié",
        comments,
        recallAt: null,
        doNotCall,
      },
      { start, durationMin, invitees },
    );
    advancePast(current);
  };

  return (
    <div className="calls-view calls-view--runner calls-view--recalls">
      <header className="calls-view__header">
        <div>
          <Tag variant="accent">File de rappels</Tag>
          <h2>Rappels</h2>
        </div>
        <div className="calls-view__actions">
          <div className="calls-mode-toggle" role="group" aria-label="Mode d'affichage">
            <button
              type="button"
              className={`calls-mode-toggle__btn${mode === "list" ? " calls-mode-toggle__btn--active" : ""}`}
              aria-pressed={mode === "list"}
              onClick={() => setMode("list")}
            >
              Liste
            </button>
            <button
              type="button"
              className={`calls-mode-toggle__btn${mode === "detail" ? " calls-mode-toggle__btn--active" : ""}`}
              aria-pressed={mode === "detail"}
              onClick={() => setMode("detail")}
              disabled={!focused}
            >
              Fiche
            </button>
          </div>
          <Button variant="secondary" onClick={onBack}>
            Quitter
          </Button>
        </div>
      </header>

      <div className="calls-recall-queue__filters" role="group" aria-label="Filtrer les rappels">
        {(
          [
            ["today", "Aujourd'hui", counts.today],
            ["overdue", "En retard", counts.overdue],
            ["upcoming", "À venir", counts.upcoming],
            ["all", "Tous", counts.all],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className={`calls-list-filter-chip${filter === value ? " calls-list-filter-chip--active" : ""}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span className="xos-numeric">{count}</span>
          </button>
        ))}
      </div>

      {error && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">{error}</p>
        </GlassCard>
      )}

      {mode === "list" ? (
        <GlassCard className="calls-cockpit-list">
          <div className="calls-cockpit-list__toolbar">
            <h3>Contacts à rappeler</h3>
            <label className="calls-field calls-field--inline">
              <span className="calls-muted">Rechercher</span>
              <input
                type="search"
                className="calls-input"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="Nom, entreprise, séance…"
                aria-label="Rechercher un rappel"
              />
            </label>
          </div>
          {filtered.length === 0 ? (
            <p className="calls-muted">
              {recalls.length === 0
                ? "Inbox zero — aucun rappel planifié."
                : "Aucun rappel pour ce filtre."}
            </p>
          ) : (
            <div className="calls-table-wrap">
              <table className="calls-table calls-table--runner">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Entreprise</th>
                    <th>Rappel</th>
                    <th>Séance d&apos;origine</th>
                    <th>Dernier résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const overdue = item.recall_at < today;
                    const active = focused != null && recallKey(item) === recallKey(focused);
                    return (
                      <tr
                        key={recallKey(item)}
                        className={active ? "calls-table__row--active" : undefined}
                        onClick={() => openDetail(item)}
                      >
                        <td>
                          <button type="button" className="calls-table__link" onClick={() => openDetail(item)}>
                            {item.contact_name}
                          </button>
                          {item.phone && <small className="calls-muted">{item.phone}</small>}
                        </td>
                        <td>{item.account_name ?? "—"}</td>
                        <td>
                          <Tag variant={overdue ? "alert" : "accent"}>{formatIsoDateFr(item.recall_at)}</Tag>
                          {overdue && <small className="calls-muted"> En retard</small>}
                        </td>
                        <td>
                          <span className="calls-recall-queue__origin">{item.session_name}</span>
                        </td>
                        <td>{item.outcome ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      ) : focused ? (
        <div className="calls-cockpit-detail">
          <GlassCard className="calls-contact-card">
            <div className="calls-contact-card__top">
              <div>
                <Tag variant="accent">{focused.session_name}</Tag>
                <h3>{focused.contact_name}</h3>
                <p className="calls-muted">
                  {focused.account_name ?? "—"}
                  {focused.title ? ` · ${focused.title}` : ""}
                </p>
              </div>
              <Tag variant={focused.recall_at < today ? "alert" : "accent"}>
                Rappel {formatIsoDateFr(focused.recall_at)}
              </Tag>
            </div>
            <dl className="calls-contact-meta">
              <div>
                <dt>Téléphone</dt>
                <dd>{focused.phone ?? "—"}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{focused.email ?? "—"}</dd>
              </div>
              <div>
                <dt>Dernier résultat</dt>
                <dd>{focused.outcome ?? "—"}</dd>
              </div>
              <div>
                <dt>Tentatives</dt>
                <dd className="xos-numeric">{focused.attempt_count ?? 0}</dd>
              </div>
            </dl>
            {contextLoading && <p className="calls-state">Chargement du contexte CRM…</p>}
            {contextApplies && contactContext && (
              <div className="calls-context-inline">
                {contactContext.contact_record_url && (
                  <a href={contactContext.contact_record_url} target="_blank" rel="noopener noreferrer">
                    Ouvrir dans Salesforce
                  </a>
                )}
              </div>
            )}
          </GlassCard>

          <GlassCard className="calls-log-form">
            <h3>Journaliser le rappel</h3>
            <div className="calls-fb-control">
              <div className="calls-fb-control__label">
                <span>Résultat</span>
              </div>
              <ResultButtons value={resultat} onChange={setResultat} />
            </div>

            {canRecall && (
              <QueueRecallFields
                resultat={resultat}
                scheduleRecall={scheduleRecall}
                onScheduleRecallChange={setScheduleRecall}
                recallAt={recallAt}
                onRecallAtChange={setRecallAt}
                onDefaultRecallDaysChange={handleDefaultRecallDays}
              />
            )}

            <label className="calls-checkbox">
              <input
                type="checkbox"
                checked={doNotCall}
                onChange={(e) => setDoNotCall(e.target.checked)}
              />
              Ne pas rappeler (NPA)
            </label>

            <label className="calls-field">
              <span>Commentaires</span>
              <textarea
                className="calls-textarea"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                placeholder="Notes sur l'appel…"
              />
            </label>

            {resultat === "RDV planifié" ? (
              <EventPanel
                contactName={focused.contact_name}
                loading={loading}
                onSubmit={handleRdvSubmit}
                submitLabel="Logguer appel + RDV & suivant"
                heading="Détails du RDV"
                className="calls-event-panel--inline"
              />
            ) : (
              <div className="calls-runner-actions">
                <Button onClick={handleSubmit} disabled={loading}>
                  {loading ? "Enregistrement…" : "Logguer & suivant"}
                </Button>
                <Button variant="secondary" onClick={() => setMode("list")} disabled={loading}>
                  Voir la liste
                </Button>
              </div>
            )}
          </GlassCard>
        </div>
      ) : (
        <GlassCard className="calls-empty">
          <p>Aucun rappel à traiter pour ce filtre.</p>
          <Button variant="secondary" onClick={() => setMode("list")}>
            Voir la liste
          </Button>
        </GlassCard>
      )}
    </div>
  );
}
