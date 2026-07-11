import { useEffect, useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  DEFAULT_RECALL_DAYS,
  PIPE_DECROCHE,
  RELANCE_DEFAULT_RESULTATS,
  type ResultatCall,
} from "../../crm";
import { EventPanel } from "./EventPanel";
import { DatePicker, formatIsoDateFr, todayParisIso } from "./formControls";
import { ProgressBar } from "./ProgressBar";
import type { ContactContext, SessionContact, SessionDetail, SessionSummary } from "./types";
import { RESULTAT_OPTIONS, sessionTypeLabel } from "./types";

const RECALL_DAYS_KEY = "xos-calls-default-recall-days";

type RunnerMode = "list" | "detail";

type LogPayload = {
  resultat: ResultatCall;
  comments: string;
  recallAt: string | null;
  doNotCall: boolean;
};

type DeferPayload = {
  scheduledFor: string;
  targetSessionId: number | null;
};

type ListStatusFilter = "all" | "pending" | "called" | "skipped";

type RunnerViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  hubSessions: SessionSummary[];
  currentContact: SessionContact | null;
  loading: boolean;
  error: string | null;
  awaitingEvent: SessionContact | null;
  contactContext: ContactContext | null;
  contextLoading: boolean;
  onBack: () => void;
  onFocusContact: (contactId: number) => void;
  onLogAndNext: (contactId: number, payload: LogPayload) => void;
  onLogRdvAndNext: (
    contactId: number,
    payload: LogPayload,
    event: { start: string; durationMin: number; invitees: string[] },
  ) => void;
  onLogMany: (contactIds: number[], payload: LogPayload) => void;
  onLogEvent: (start: string, durationMin: number, invitees: string[]) => void;
  onDeferContacts: (contactIds: number[], payload: DeferPayload) => void;
};

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

function listStatusDisplay(contact: SessionContact): {
  label: string;
  variant: "success" | "warning" | "accent" | "muted" | "default";
} {
  if (contact.status === "pending") return { label: "À faire", variant: "accent" };
  if (contact.status === "skipped") return { label: "Non contacté", variant: "warning" };
  if (contact.outcome === "RDV planifié") return { label: contact.outcome, variant: "success" };
  if (contact.outcome === "Appel non décroché" || contact.outcome === "Message répondeur") {
    return { label: contact.outcome, variant: "warning" };
  }
  if (contact.outcome) return { label: contact.outcome, variant: "accent" };
  return { label: "Appelé", variant: "default" };
}

function computeKpis(contacts: SessionContact[]) {
  const total = contacts.length;
  const remaining = contacts.filter((c) => c.status === "pending").length;
  const called = contacts.filter((c) => c.status === "called");
  const decroches = called.filter((c) => c.outcome && PIPE_DECROCHE.includes(c.outcome)).length;
  const argumentes = called.filter((c) => c.outcome === "Appel argumenté").length;
  const rdv = called.filter((c) => c.outcome === "RDV planifié").length;
  return { total, remaining, decroches, argumentes, rdv };
}

function ResultButtons({
  value,
  onChange,
  disabledValues = [],
}: {
  value: ResultatCall;
  onChange: (value: ResultatCall) => void;
  disabledValues?: ResultatCall[];
}) {
  return (
    <div className="calls-result-grid" role="group" aria-label="Résultat de l'appel">
      {RESULTAT_OPTIONS.map((opt) => {
        const disabled = disabledValues.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            className={`calls-result-btn${value === opt.value ? " calls-result-btn--active" : ""}`}
            aria-pressed={value === opt.value}
            disabled={disabled}
            title={disabled ? "Sélectionnez un seul contact pour planifier un RDV" : undefined}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function RunnerView({
  session,
  contacts,
  hubSessions,
  currentContact,
  loading,
  error,
  awaitingEvent,
  contactContext,
  contextLoading,
  onBack,
  onFocusContact,
  onLogAndNext,
  onLogRdvAndNext,
  onLogMany,
  onLogEvent,
  onDeferContacts,
}: RunnerViewProps) {
  const [mode, setMode] = useState<RunnerMode>("list");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [listStatusFilter, setListStatusFilter] = useState<ListStatusFilter>("all");
  const [listQuery, setListQuery] = useState("");
  const [resultat, setResultat] = useState<ResultatCall>(RESULTAT_OPTIONS[0].value);
  const [bulkResultat, setBulkResultat] = useState<ResultatCall>(RESULTAT_OPTIONS[0].value);
  const [comments, setComments] = useState("");
  const [bulkComments, setBulkComments] = useState("");
  const [defaultRecallDays, setDefaultRecallDays] = useState(readDefaultRecallDays);
  const [recallAt, setRecallAt] = useState(() => addDaysIso(readDefaultRecallDays()));
  const [bulkRecallAt, setBulkRecallAt] = useState(() => addDaysIso(readDefaultRecallDays()));
  const [doNotCall, setDoNotCall] = useState(false);
  const [bulkDoNotCall, setBulkDoNotCall] = useState(false);
  const [deferIds, setDeferIds] = useState<number[] | null>(null);
  const [deferDate, setDeferDate] = useState(() => addDaysIso(readDefaultRecallDays()));
  const [deferTargetId, setDeferTargetId] = useState<number | null>(null);

  const kpis = useMemo(() => computeKpis(contacts), [contacts]);
  const needsRecall = RELANCE_DEFAULT_RESULTATS.includes(resultat) && !doNotCall;
  const bulkNeedsRecall = RELANCE_DEFAULT_RESULTATS.includes(bulkResultat) && !bulkDoNotCall;
  const pendingContacts = useMemo(() => contacts.filter((c) => c.status === "pending"), [contacts]);
  const statusCounts = useMemo(
    () => ({
      all: contacts.length,
      pending: contacts.filter((c) => c.status === "pending").length,
      called: contacts.filter((c) => c.status === "called").length,
      skipped: contacts.filter((c) => c.status === "skipped").length,
    }),
    [contacts],
  );
  const filteredContacts = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (listStatusFilter !== "all" && contact.status !== listStatusFilter) return false;
      if (!q) return true;
      const haystack = [
        contact.contact_name,
        contact.title,
        contact.account_name,
        contact.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [contacts, listStatusFilter, listQuery]);
  const pendingSelected = useMemo(
    () => [...selectedIds].filter((id) => pendingContacts.some((c) => c.id === id)),
    [selectedIds, pendingContacts],
  );
  const allPendingSelected =
    pendingContacts.length > 0 && pendingContacts.every((c) => selectedIds.has(c.id));
  const singleSelectedId = pendingSelected.length === 1 ? pendingSelected[0] : null;
  const singleSelectedContact = singleSelectedId
    ? contacts.find((c) => c.id === singleSelectedId) ?? null
    : null;
  const deferCandidates = useMemo(
    () =>
      hubSessions.filter(
        (s) =>
          s.id !== session.id
          && s.status === "active"
          && s.scheduled_for === deferDate,
      ),
    [hubSessions, session.id, deferDate],
  );

  const focusedContact = useMemo(() => {
    if (awaitingEvent) return awaitingEvent;
    if (focusedId != null) {
      return contacts.find((c) => c.id === focusedId) ?? currentContact;
    }
    return currentContact;
  }, [awaitingEvent, focusedId, contacts, currentContact]);

  const sfContactUrl =
    contactContext?.contact_record_url ?? focusedContact?.sf_contact_url ?? null;

  useEffect(() => {
    if (awaitingEvent) setMode("detail");
  }, [awaitingEvent?.id]);

  useEffect(() => {
    if (currentContact && (focusedId == null || !contacts.some((c) => c.id === focusedId && c.status === "pending"))) {
      setFocusedId(currentContact.id);
    }
  }, [currentContact?.id, contacts, focusedId]);

  useEffect(() => {
    setResultat(RESULTAT_OPTIONS[0].value);
    setComments("");
    setDoNotCall(false);
    setRecallAt(addDaysIso(defaultRecallDays));
  }, [focusedContact?.id, defaultRecallDays]);

  useEffect(() => {
    // Drop selections that are no longer pending after a bulk action.
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => pendingContacts.some((c) => c.id === id)));
      return next.size === current.size ? current : next;
    });
  }, [pendingContacts]);

  const openDetail = (contactId: number) => {
    setFocusedId(contactId);
    onFocusContact(contactId);
    setMode("detail");
  };

  const toggleSelected = (contactId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const toggleSelectAllPending = () => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(pendingContacts.map((c) => c.id)));
  };

  const handleDefaultRecallDays = (days: number) => {
    setDefaultRecallDays(days);
    setRecallAt(addDaysIso(days));
    setBulkRecallAt(addDaysIso(days));
    try {
      localStorage.setItem(RECALL_DAYS_KEY, String(days));
    } catch {
      /* ignore */
    }
  };

  const handleSubmit = () => {
    if (!focusedContact || focusedContact.status !== "pending") return;
    if (resultat === "RDV planifié") return;
    onLogAndNext(focusedContact.id, {
      resultat,
      comments,
      recallAt: needsRecall ? recallAt : null,
      doNotCall,
    });
  };

  const handleRdvSubmit = (start: string, durationMin: number, invitees: string[]) => {
    if (!focusedContact || focusedContact.status !== "pending") return;
    onLogRdvAndNext(
      focusedContact.id,
      {
        resultat: "RDV planifié",
        comments,
        recallAt: null,
        doNotCall,
      },
      { start, durationMin, invitees },
    );
  };

  const handleBulkLog = () => {
    if (pendingSelected.length === 0) return;
    onLogMany(pendingSelected, {
      resultat: bulkResultat,
      comments: bulkComments,
      recallAt: bulkNeedsRecall ? bulkRecallAt : null,
      doNotCall: bulkDoNotCall,
    });
    setSelectedIds(new Set());
    setBulkComments("");
    setBulkDoNotCall(false);
    setBulkRecallAt(addDaysIso(defaultRecallDays));
  };

  const openDefer = (ids: number[]) => {
    if (ids.length === 0) return;
    setDeferIds(ids);
    setDeferDate(addDaysIso(defaultRecallDays));
    setDeferTargetId(null);
  };

  const confirmDefer = () => {
    if (!deferIds?.length) return;
    onDeferContacts(deferIds, {
      scheduledFor: deferDate,
      targetSessionId: deferTargetId,
    });
    setDeferIds(null);
    setSelectedIds(new Set());
  };

  const handleBulkRdvSubmit = (start: string, durationMin: number, invitees: string[]) => {
    if (!singleSelectedId) return;
    onLogRdvAndNext(
      singleSelectedId,
      {
        resultat: "RDV planifié",
        comments: bulkComments,
        recallAt: null,
        doNotCall: bulkDoNotCall,
      },
      { start, durationMin, invitees },
    );
    setSelectedIds(new Set());
    setBulkComments("");
    setBulkDoNotCall(false);
  };

  const called = contacts.filter((c) => c.status === "called").length;

  return (
    <div className="calls-view calls-view--runner">
      <header className="calls-view__header">
        <div>
          <Tag variant="accent">Cockpit</Tag>
          <h2>{session.name}</h2>
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
            >
              Fiche
            </button>
          </div>
          <Button variant="secondary" onClick={onBack}>
            Quitter
          </Button>
        </div>
      </header>

      <div className="calls-cockpit-kpis" aria-label="Indicateurs de séance">
        <GlassCard className="calls-stat">
          <span>Contacts</span>
          <strong className="xos-numeric">{kpis.total}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>Restant</span>
          <strong className="xos-numeric">{kpis.remaining}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>Décrochés</span>
          <strong className="xos-numeric">{kpis.decroches}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>Argumentés</span>
          <strong className="xos-numeric">{kpis.argumentes}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>RDV</span>
          <strong className="xos-numeric">{kpis.rdv}</strong>
        </GlassCard>
      </div>

      <ProgressBar called={called} total={contacts.length} label="Progression de la séance" />

      {error && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">{error}</p>
        </GlassCard>
      )}

      {mode === "list" ? (
        <div className="calls-cockpit-list-wrap">
          {pendingSelected.length > 0 && (
            <GlassCard className="calls-bulk-bar">
              <div className="calls-bulk-bar__head">
                <strong>
                  {pendingSelected.length} contact{pendingSelected.length > 1 ? "s" : ""} sélectionné
                  {pendingSelected.length > 1 ? "s" : ""}
                </strong>
                <span className="calls-muted">
                  {singleSelectedId
                    ? "Consigner, planifier un RDV, ou reporter en follow-up"
                    : "Même résultat pour toute la sélection"}
                </span>
              </div>
              <div className="calls-fb-control">
                <div className="calls-fb-control__label">
                  <span>Résultat</span>
                </div>
                <ResultButtons
                  value={bulkResultat}
                  onChange={setBulkResultat}
                  disabledValues={singleSelectedId ? [] : ["RDV planifié"]}
                />
              </div>
              <details className="calls-bulk-options">
                <summary>Options (rappel, NPA, commentaires)</summary>
                {bulkNeedsRecall && (
                  <div className="calls-fb-row">
                    <DatePicker label="Date de rappel" value={bulkRecallAt} onChange={setBulkRecallAt} />
                    <label className="calls-field">
                      <span>Défaut rappel (jours)</span>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        className="calls-input"
                        value={defaultRecallDays}
                        onChange={(e) => handleDefaultRecallDays(Number(e.target.value) || 0)}
                      />
                    </label>
                  </div>
                )}
                <label className="calls-checkbox">
                  <input
                    type="checkbox"
                    checked={bulkDoNotCall}
                    onChange={(e) => setBulkDoNotCall(e.target.checked)}
                  />
                  Ne pas rappeler (NPA)
                </label>
                <label className="calls-field">
                  <span>Commentaires (optionnel)</span>
                  <textarea
                    className="calls-textarea"
                    value={bulkComments}
                    onChange={(e) => setBulkComments(e.target.value)}
                    rows={2}
                    placeholder="Note commune pour la sélection…"
                  />
                </label>
              </details>
              {bulkResultat === "RDV planifié" && singleSelectedContact ? (
                <EventPanel
                  contactName={singleSelectedContact.contact_name}
                  loading={loading}
                  onSubmit={handleBulkRdvSubmit}
                  submitLabel="Logguer appel + RDV & suivant"
                  heading={`Détails du RDV — ${singleSelectedContact.contact_name}`}
                  className="calls-event-panel--inline"
                />
              ) : (
                <div className="calls-runner-actions">
                  <Button onClick={handleBulkLog} disabled={loading || bulkResultat === "RDV planifié"}>
                    {loading
                      ? "Enregistrement…"
                      : `Consigner pour ${pendingSelected.length}`}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => openDefer(pendingSelected)}
                    disabled={loading}
                  >
                    Non contacté
                  </Button>
                </div>
              )}
            </GlassCard>
          )}

          {deferIds && (
            <div className="calls-defer-panel" role="region" aria-label="Reporter en follow-up">
              <strong>
                Non contacté — {deferIds.length} contact{deferIds.length > 1 ? "s" : ""}
              </strong>
              <p className="calls-defer-panel__empty">
                Associer à une séance existante à cette date, ou en créer une nouvelle.
              </p>
              <DatePicker label="Date de follow-up" value={deferDate} onChange={(d) => { setDeferDate(d); setDeferTargetId(null); }} />
              {deferCandidates.length > 0 ? (
                <ul className="calls-defer-panel__candidates">
                  {deferCandidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className={`calls-defer-panel__candidate${deferTargetId === candidate.id ? " calls-defer-panel__candidate--active" : ""}`}
                        onClick={() => setDeferTargetId(candidate.id)}
                      >
                        <span>
                          <strong>{candidate.name}</strong>
                          <small> · {sessionTypeLabel(candidate.session_type)}</small>
                        </span>
                        <span className="xos-numeric">{candidate.pending} restants</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="calls-defer-panel__empty">Aucune séance active à cette date.</p>
              )}
              <div className="calls-runner-actions">
                <Button
                  onClick={confirmDefer}
                  disabled={loading}
                >
                  {loading
                    ? "Enregistrement…"
                    : deferTargetId
                      ? "Associer à la séance"
                      : "Créer une séance de relance"}
                </Button>
                {deferTargetId != null && (
                  <Button variant="secondary" onClick={() => setDeferTargetId(null)} disabled={loading}>
                    Créer plutôt une nouvelle
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setDeferIds(null)} disabled={loading}>
                  Annuler
                </Button>
              </div>
            </div>
          )}

          <GlassCard className="calls-cockpit-list">
            <div className="calls-cockpit-list__toolbar">
              <h3>Liste de la séance</h3>
              <div className="calls-preview__actions">
                <Button
                  variant="secondary"
                  disabled={loading || pendingContacts.length === 0}
                  onClick={toggleSelectAllPending}
                >
                  {allPendingSelected ? "Tout désélectionner" : "Tout sélectionner"}
                </Button>
              </div>
            </div>
            <div className="calls-cockpit-list__filters">
              <div className="calls-list-filter-chips" role="group" aria-label="Filtrer par statut">
                {(
                  [
                    ["all", "Tous", statusCounts.all],
                    ["pending", "À faire", statusCounts.pending],
                    ["called", "Appelés", statusCounts.called],
                    ["skipped", "Non contactés", statusCounts.skipped],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    className={`calls-list-filter-chip${listStatusFilter === value ? " calls-list-filter-chip--active" : ""}`}
                    aria-pressed={listStatusFilter === value}
                    onClick={() => setListStatusFilter(value)}
                  >
                    {label}
                    <span className="calls-list-filter-chip__count xos-numeric">{count}</span>
                  </button>
                ))}
              </div>
              <input
                type="search"
                className="calls-input calls-cockpit-list__search"
                placeholder="Filtrer nom, poste, entreprise, tél…"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                aria-label="Filtrer la liste"
              />
            </div>
            <ul className="calls-cockpit-list__rows">
              <li className="calls-cockpit-list__header" aria-hidden="true">
                <span />
                <span>Contact</span>
                <span>Poste</span>
                <span>Entreprise</span>
                <span>Téléphone</span>
                <span>Statut</span>
                <span>Rappel</span>
              </li>
              {filteredContacts.map((contact) => {
                const status = listStatusDisplay(contact);
                return (
                <li
                  key={contact.id}
                  className={[
                    contact.status !== "pending" ? "calls-cockpit-list__row--done" : "",
                    selectedIds.has(contact.id) ? "calls-cockpit-list__row--selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  <label className="calls-checkbox calls-checkbox--tight">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(contact.id)}
                      disabled={contact.status !== "pending"}
                      onChange={() => toggleSelected(contact.id)}
                      aria-label={`Sélectionner ${contact.contact_name}`}
                    />
                  </label>
                  <button type="button" className="calls-cockpit-list__name" onClick={() => openDetail(contact.id)}>
                    <strong>{contact.contact_name}</strong>
                  </button>
                  <span className="calls-cockpit-list__cell" title={contact.title ?? undefined}>
                    {contact.title ?? "—"}
                  </span>
                  <span className="calls-cockpit-list__cell" title={contact.account_name ?? undefined}>
                    {contact.account_name ?? "—"}
                  </span>
                  <span className="calls-cockpit-list__cell">
                    {contact.phone ? (
                      <a
                        href={`tel:${contact.phone}`}
                        className="calls-cockpit-list__phone xos-numeric"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {contact.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span className="calls-cockpit-list__status">
                    <Tag variant={status.variant}>{status.label}</Tag>
                  </span>
                  <span className="calls-cockpit-list__cell xos-numeric">{contact.recall_at ? formatIsoDateFr(contact.recall_at) : "—"}</span>
                </li>
                );
              })}
              {filteredContacts.length === 0 && (
                <li className="calls-cockpit-list__empty">Aucun contact pour ce filtre.</li>
              )}
            </ul>
          </GlassCard>
        </div>
      ) : focusedContact ? (
        <div className="calls-cockpit-detail">
          <GlassCard className="calls-contact-card">
            <div className="calls-contact-card__top">
              <div>
                <h3>{focusedContact.contact_name}</h3>
                {(focusedContact.attempt_count ?? 0) > 0 && (
                  <Tag variant="muted">Tentative {focusedContact.attempt_count}</Tag>
                )}
                {focusedContact.title && (
                  <p className="calls-contact-card__title">{focusedContact.title}</p>
                )}
                <p className="calls-contact-card__account">
                  {focusedContact.account_name ?? "Compte inconnu"}
                </p>
              </div>
              <div className="calls-contact-card__links">
                {sfContactUrl && (
                  <a
                    href={sfContactUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="calls-sf-link"
                  >
                    Fiche Salesforce
                  </a>
                )}
                {focusedContact.linkedin_url && (
                  <a href={focusedContact.linkedin_url} target="_blank" rel="noopener noreferrer">
                    LinkedIn
                  </a>
                )}
              </div>
            </div>

            {focusedContact.phone ? (
              <div className="calls-contact-card__phone">
                <a href={`tel:${focusedContact.phone}`} className="calls-phone-link xos-numeric">
                  {focusedContact.phone}
                </a>
                <Button onClick={() => window.open(`tel:${focusedContact.phone}`, "_self")}>
                  Appeler
                </Button>
              </div>
            ) : (
              <p className="calls-contact-card__no-phone">Aucun numéro mobile</p>
            )}

            {focusedContact.status !== "pending" && (
              <div className="calls-contact-card__meta">
                <Tag variant={listStatusDisplay(focusedContact).variant}>
                  {listStatusDisplay(focusedContact).label}
                </Tag>
                {focusedContact.recall_at && <span>Rappel {focusedContact.recall_at}</span>}
              </div>
            )}
            {!contextLoading && contactContext?.npa && (
              <Tag variant="alert" className="calls-contact-card__npa">
                Ne pas rappeler (NPA)
              </Tag>
            )}
          </GlassCard>

          <div className={`calls-cockpit-side${contextLoading ? " calls-cockpit-side--loading" : ""}`}>
            {contextLoading ? (
              <GlassCard className="calls-context-panel calls-context-panel--skeleton" aria-busy="true">
                <p className="calls-muted">Chargement historique & opportunités…</p>
              </GlassCard>
            ) : (
              <>
            <GlassCard className="calls-context-panel">
              <h3>Historique d&apos;appels</h3>
              {contactContext && contactContext.tasks.length === 0 && (
                <p className="calls-muted">Aucun appel Salesforce récent.</p>
              )}
              {contactContext && contactContext.tasks.length > 0 && (
                <ul className="calls-context-list">
                  {contactContext.tasks.map((task) => (
                    <li key={task.id}>
                      <strong>{task.result ?? task.subject ?? "Appel"}</strong>
                      <span className="xos-numeric">{task.activity_date ?? "—"}</span>
                      {task.record_url && (
                        <a href={task.record_url} target="_blank" rel="noopener noreferrer">
                          SF
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>

            <GlassCard className="calls-context-panel">
              <h3>Opportunités</h3>
              {contactContext && contactContext.opportunities.length === 0 && (
                <p className="calls-muted">Aucune opportunité sur le compte.</p>
              )}
              {contactContext && contactContext.opportunities.length > 0 && (
                <ul className="calls-context-list">
                  {contactContext.opportunities.map((opp) => (
                    <li key={opp.id}>
                      <strong>{opp.name}</strong>
                      <span>{opp.stage_name ?? "—"}</span>
                      {opp.record_url && (
                        <a href={opp.record_url} target="_blank" rel="noopener noreferrer">
                          SF
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
              </>
            )}
          </div>

          {awaitingEvent ? (
            <EventPanel
              contactName={awaitingEvent.contact_name}
              loading={loading}
              onSubmit={onLogEvent}
              heading={`Finaliser le RDV — ${awaitingEvent.contact_name}`}
            />
          ) : focusedContact.status === "pending" ? (
            <GlassCard className="calls-log-form">
              <h3>Journaliser l&apos;appel</h3>
              <div className="calls-fb-control">
                <div className="calls-fb-control__label">
                  <span>Résultat</span>
                </div>
                <ResultButtons value={resultat} onChange={setResultat} />
              </div>

              {needsRecall && (
                <div className="calls-fb-row">
                  <DatePicker label="Date de rappel" value={recallAt} onChange={setRecallAt} />
                  <label className="calls-field">
                    <span>Défaut rappel (jours)</span>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      className="calls-input"
                      value={defaultRecallDays}
                      onChange={(e) => handleDefaultRecallDays(Number(e.target.value) || 0)}
                    />
                  </label>
                </div>
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
                  contactName={focusedContact.contact_name}
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
                  <Button
                    variant="secondary"
                    onClick={() => openDefer([focusedContact.id])}
                    disabled={loading}
                    title="Reporter vers une séance de follow-up (sans incrémenter le compteur)"
                  >
                    Non contacté
                  </Button>
                </div>
              )}

              {resultat === "RDV planifié" && (
                <div className="calls-runner-actions">
                  <Button
                    variant="secondary"
                    onClick={() => openDefer([focusedContact.id])}
                    disabled={loading}
                    title="Reporter vers une séance de follow-up (sans incrémenter le compteur)"
                  >
                    Non contacté
                  </Button>
                </div>
              )}

              {deferIds && mode === "detail" && (
                <div className="calls-defer-panel" role="region" aria-label="Reporter en follow-up">
                  <strong>Non contacté — follow-up</strong>
                  <DatePicker label="Date de follow-up" value={deferDate} onChange={(d) => { setDeferDate(d); setDeferTargetId(null); }} />
                  {deferCandidates.length > 0 ? (
                    <ul className="calls-defer-panel__candidates">
                      {deferCandidates.map((candidate) => (
                        <li key={candidate.id}>
                          <button
                            type="button"
                            className={`calls-defer-panel__candidate${deferTargetId === candidate.id ? " calls-defer-panel__candidate--active" : ""}`}
                            onClick={() => setDeferTargetId(candidate.id)}
                          >
                            <span>
                              <strong>{candidate.name}</strong>
                              <small> · {sessionTypeLabel(candidate.session_type)}</small>
                            </span>
                            <span className="xos-numeric">{candidate.pending} restants</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="calls-defer-panel__empty">Aucune séance active à cette date.</p>
                  )}
                  <div className="calls-runner-actions">
                    <Button onClick={confirmDefer} disabled={loading}>
                      {deferTargetId ? "Associer à la séance" : "Créer une séance de relance"}
                    </Button>
                    <Button variant="secondary" onClick={() => setDeferIds(null)} disabled={loading}>
                      Annuler
                    </Button>
                  </div>
                </div>
              )}
            </GlassCard>
          ) : (
            <GlassCard className="calls-empty">
              <p>Contact déjà traité — choisissez le suivant dans la liste.</p>
              <Button variant="secondary" onClick={() => setMode("list")}>
                Voir la liste
              </Button>
            </GlassCard>
          )}
        </div>
      ) : (
        <GlassCard className="calls-empty">
          <p>Tous les contacts ont été traités.</p>
        </GlassCard>
      )}
    </div>
  );
}

export type { LogPayload, DeferPayload };
