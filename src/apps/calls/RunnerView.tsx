import { useEffect, useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  DEFAULT_RECALL_DAYS,
  PIPE_DECROCHE,
  RELANCE_DEFAULT_RESULTATS,
  type ResultatCall,
} from "../../crm";
import { EventPanel } from "./EventPanel";
import { ProgressBar } from "./ProgressBar";
import type { ContactContext, SessionContact, SessionDetail } from "./types";
import { RESULTAT_OPTIONS } from "./types";

const RECALL_DAYS_KEY = "xos-calls-default-recall-days";

type RunnerMode = "list" | "detail";

type LogPayload = {
  resultat: ResultatCall;
  comments: string;
  recallAt: string | null;
  doNotCall: boolean;
};

type ListStatusFilter = "all" | "pending" | "called" | "skipped";

type RunnerViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
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
  onSkip: (contactId: number) => void;
  onSkipMany: (contactIds: number[]) => void;
};

function addDaysIso(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function statusLabel(status: SessionContact["status"]): string {
  if (status === "called") return "Appelé";
  if (status === "skipped") return "Non joint";
  return "À faire";
}

function statusVariant(status: SessionContact["status"]): "accent" | "default" | "warning" {
  if (status === "called") return "default";
  if (status === "skipped") return "warning";
  return "accent";
}

function outcomeVariant(
  outcome: ResultatCall | null | undefined,
): "success" | "warning" | "accent" | "muted" {
  if (!outcome) return "muted";
  if (outcome === "RDV planifié") return "success";
  if (outcome === "Appel non décroché" || outcome === "Message répondeur") return "warning";
  return "accent";
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
            title={disabled ? "Disponible uniquement en fiche individuelle" : undefined}
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
  onSkip,
  onSkipMany,
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

  const kpis = useMemo(() => computeKpis(contacts), [contacts]);
  const needsRecall = RELANCE_DEFAULT_RESULTATS.includes(resultat) && !doNotCall;
  const bulkNeedsRecall = RELANCE_DEFAULT_RESULTATS.includes(bulkResultat) && !bulkDoNotCall;
  const pendingContacts = useMemo(() => contacts.filter((c) => c.status === "pending"), [contacts]);
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

  const handleBulkSkip = () => {
    if (pendingSelected.length === 0) return;
    onSkipMany(pendingSelected);
    setSelectedIds(new Set());
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
                <span className="calls-muted">Même résultat pour toute la sélection</span>
              </div>
              <div className="calls-fb-control">
                <div className="calls-fb-control__label">
                  <span>Résultat</span>
                </div>
                <ResultButtons
                  value={bulkResultat}
                  onChange={setBulkResultat}
                  disabledValues={["RDV planifié"]}
                />
              </div>
              {bulkNeedsRecall && (
                <div className="calls-fb-row">
                  <label className="calls-field">
                    <span>Date de rappel</span>
                    <input
                      type="date"
                      className="calls-input"
                      value={bulkRecallAt}
                      onChange={(e) => setBulkRecallAt(e.target.value)}
                    />
                  </label>
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
              <div className="calls-runner-actions">
                <Button onClick={handleBulkLog} disabled={loading || bulkResultat === "RDV planifié"}>
                  {loading
                    ? "Enregistrement…"
                    : `Consigner pour ${pendingSelected.length}`}
                </Button>
                <Button variant="secondary" onClick={handleBulkSkip} disabled={loading}>
                  Non joints (essayés)
                </Button>
              </div>
            </GlassCard>
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
                    ["all", "Tous"],
                    ["pending", "À faire"],
                    ["called", "Appelés"],
                    ["skipped", "Non joints"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`calls-list-filter-chip${listStatusFilter === value ? " calls-list-filter-chip--active" : ""}`}
                    aria-pressed={listStatusFilter === value}
                    onClick={() => setListStatusFilter(value)}
                  >
                    {label}
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
                <span>Résultat</span>
                <span>Rappel</span>
              </li>
              {filteredContacts.map((contact) => (
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
                  {contact.phone ? (
                    <a
                      href={`tel:${contact.phone}`}
                      className="calls-cockpit-list__phone xos-numeric"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {contact.phone}
                    </a>
                  ) : (
                    <span className="calls-cockpit-list__cell">—</span>
                  )}
                  <Tag variant={statusVariant(contact.status)}>{statusLabel(contact.status)}</Tag>
                  {contact.outcome ? (
                    <Tag variant={outcomeVariant(contact.outcome)}>{contact.outcome}</Tag>
                  ) : (
                    <span className="calls-cockpit-list__cell">—</span>
                  )}
                  <span className="xos-numeric">{contact.recall_at ?? "—"}</span>
                </li>
              ))}
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
                <Tag variant={statusVariant(focusedContact.status)}>{statusLabel(focusedContact.status)}</Tag>
                {focusedContact.outcome && (
                  <Tag variant={outcomeVariant(focusedContact.outcome)}>{focusedContact.outcome}</Tag>
                )}
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
                  <label className="calls-field">
                    <span>Date de rappel</span>
                    <input
                      type="date"
                      className="calls-input"
                      value={recallAt}
                      onChange={(e) => setRecallAt(e.target.value)}
                    />
                  </label>
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
                    onClick={() => onSkip(focusedContact.id)}
                    disabled={loading}
                    title="Essayé sans succès — inclus en relance, compteur +1"
                  >
                    Non joint
                  </Button>
                </div>
              )}

              {resultat === "RDV planifié" && (
                <div className="calls-runner-actions">
                  <Button
                    variant="secondary"
                    onClick={() => onSkip(focusedContact.id)}
                    disabled={loading}
                    title="Essayé sans succès — inclus en relance, compteur +1"
                  >
                    Non joint
                  </Button>
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

export type { LogPayload };
