import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  DEFAULT_RECALL_DAYS,
  PIPE_DECROCHE,
  RECALL_ELIGIBLE_RESULTATS,
  RELANCE_DEFAULT_RESULTATS,
  type ResultatCall,
} from "../../crm";
import { EventPanel } from "./EventPanel";
import { EmptyState } from "./EmptyState";
import { DatePicker, formatActivityDateFr, formatIsoDateFr, todayParisIso } from "./formControls";
import { LinkedInRecordLink, SalesforceRecordLink } from "./BrandLinks";
import { ProgressBar } from "./ProgressBar";
import {
  countRecallDateFilters,
  matchesRecallDateFilter,
  type RecallDateFilter,
} from "./recallQueue";
import { nextContinuationName } from "./sessionNaming";
import type {
  ContactContext,
  ContactOpportunityItem,
  SessionContact,
  SessionDetail,
  SessionSummary,
  TeamMember,
} from "./types";
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
  name?: string | null;
};

type ListStatusFilter = "all" | "pending" | "called" | "skipped";

type RunnerViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  hubSessions: SessionSummary[];
  currentContact: SessionContact | null;
  focusedContactId?: number | null;
  /** Infinite recall queue reuses the same cockpit with date filters. */
  variant?: "session" | "recalls";
  loading: boolean;
  error: string | null;
  awaitingEvent: SessionContact | null;
  contactContext: ContactContext | null;
  contextContactId: number | null;
  contextLoading: boolean;
  onBack: () => void;
  onPin?: () => Promise<void>;
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
  team?: TeamMember[];
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

function formatRelativeDaysFr(iso: string | null | undefined, today = todayParisIso()): string {
  const value = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return "";
  const from = new Date(`${value}T12:00:00Z`).getTime();
  const to = new Date(`${today}T12:00:00Z`).getTime();
  const days = Math.max(0, Math.round((to - from) / 86_400_000));
  if (days === 0) return "aujourd’hui";
  if (days === 1) return "hier";
  return `il y a ${days} j`;
}

function sortOpportunities(opportunities: ContactOpportunityItem[]): ContactOpportunityItem[] {
  return [...opportunities].sort((a, b) => Number(a.is_closed) - Number(b.is_closed));
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
    <div className="calls-result-seg" role="group" aria-label="Résultat de l'appel">
      {RESULTAT_OPTIONS.map((opt) => {
        const disabled = disabledValues.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            className={`calls-result-seg__btn${value === opt.value ? " calls-result-seg__btn--active" : ""}`}
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

const RECALL_PRESETS: { days: number; label: string }[] = [
  { days: 0, label: "Aujourd'hui" },
  { days: 1, label: "+1 j" },
  { days: 3, label: "+3 j" },
  { days: 7, label: "+7 j" },
  { days: 14, label: "+14 j" },
];

function RecallFields({
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
  const autoRecall = RELANCE_DEFAULT_RESULTATS.includes(resultat);
  if (!RECALL_ELIGIBLE_RESULTATS.includes(resultat)) return null;

  const activePreset = RECALL_PRESETS.find((preset) => addDaysIso(preset.days) === recallAt)?.days;
  const customActive = activePreset == null;

  const pickPreset = (days: number) => {
    onDefaultRecallDaysChange(days);
    onRecallAtChange(addDaysIso(days));
  };

  return (
    <div className="calls-recall" role="group" aria-label="Rappel">
      <div className="calls-recall__head">
        <p className="calls-recall__title">Rappel</p>
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
        <div className="calls-recall__track" role="group" aria-label="Choisir la date de rappel">
          <div className="calls-recall__presets" role="group" aria-label="Délai rapide">
            {RECALL_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                className={`calls-recall__chip${activePreset === preset.days ? " calls-recall__chip--active" : ""}`}
                aria-pressed={activePreset === preset.days}
                onClick={() => pickPreset(preset.days)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <span className="calls-recall__or" aria-hidden="true">ou</span>
          <DatePicker
            compact
            label="Choisir une date"
            value={recallAt}
            onChange={onRecallAtChange}
            triggerClassName={`calls-recall__chip calls-recall__chip--date${customActive ? " calls-recall__chip--active" : ""}`}
          />
        </div>
      )}
    </div>
  );
}

export function RunnerView({
  session,
  contacts,
  hubSessions,
  currentContact,
  focusedContactId = null,
  variant = "session",
  loading,
  error,
  awaitingEvent,
  contactContext,
  contextContactId,
  contextLoading,
  onBack,
  onPin,
  onFocusContact,
  onLogAndNext,
  onLogRdvAndNext,
  onLogMany,
  onLogEvent,
  onDeferContacts,
  team = [],
}: RunnerViewProps) {
  const isRecallQueue = variant === "recalls";
  const today = todayParisIso();
  const [mode, setMode] = useState<RunnerMode>("list");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [listStatusFilter, setListStatusFilter] = useState<ListStatusFilter>("all");
  const [recallDateFilter, setRecallDateFilter] = useState<RecallDateFilter>("today");
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
  const [scheduleRecall, setScheduleRecall] = useState(true);
  const [bulkScheduleRecall, setBulkScheduleRecall] = useState(true);
  const [deferIds, setDeferIds] = useState<number[] | null>(null);
  const [deferDate, setDeferDate] = useState(() => addDaysIso(readDefaultRecallDays()));
  const [deferTargetId, setDeferTargetId] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const bootstrappedDetail = useRef(false);

  useEffect(() => {
    setPinned(false);
  }, [session.id]);

  useEffect(() => {
    if (bootstrappedDetail.current || !currentContact) return;
    bootstrappedDetail.current = true;
    if (currentContact.status !== "pending") return;
    setFocusedId(currentContact.id);
    onFocusContact(currentContact.id);
    setMode("detail");
  }, [currentContact, onFocusContact]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const kpis = useMemo(() => computeKpis(contacts), [contacts]);
  const canRecall = RECALL_ELIGIBLE_RESULTATS.includes(resultat) && !doNotCall;
  const bulkCanRecall = RECALL_ELIGIBLE_RESULTATS.includes(bulkResultat) && !bulkDoNotCall;
  const willSendRecall = canRecall && (RELANCE_DEFAULT_RESULTATS.includes(resultat) || scheduleRecall);
  const bulkWillSendRecall =
    bulkCanRecall && (RELANCE_DEFAULT_RESULTATS.includes(bulkResultat) || bulkScheduleRecall);
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
  const recallDateCounts = useMemo(
    () =>
      countRecallDateFilters(
        contacts.map((c) => ({
          id: c.id,
          session_id: c.origin_session_id ?? 0,
          session_name: c.origin_session_name ?? "",
          session_status: "active" as const,
          contact_name: c.contact_name,
          account_name: c.account_name,
          phone: c.phone,
          recall_at: c.recall_at ?? "",
          outcome: c.outcome,
        })),
        today,
      ),
    [contacts, today],
  );
  const filteredContacts = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (isRecallQueue) {
        if (!matchesRecallDateFilter(contact.recall_at, recallDateFilter, today)) return false;
      } else if (listStatusFilter !== "all" && contact.status !== listStatusFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        contact.contact_name,
        contact.title,
        contact.account_name,
        contact.phone,
        contact.email,
        contact.origin_session_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [contacts, listStatusFilter, listQuery, isRecallQueue, recallDateFilter, today]);
  const pendingSelected = useMemo(
    () => [...selectedIds].filter((id) => pendingContacts.some((c) => c.id === id)),
    [selectedIds, pendingContacts],
  );
  const visiblePending = useMemo(
    () => filteredContacts.filter((c) => c.status === "pending"),
    [filteredContacts],
  );
  const allPendingSelected =
    visiblePending.length > 0 && visiblePending.every((c) => selectedIds.has(c.id));
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
    contextContactId === focusedContact?.id
      ? (contactContext?.contact_record_url ?? focusedContact?.sf_contact_url ?? null)
      : (focusedContact?.sf_contact_url ?? null);
  const displayEmail =
    focusedContact?.email
    ?? (contextContactId === focusedContact?.id ? contactContext?.email : null)
    ?? null;
  const displayTitle =
    focusedContact?.title
    ?? (contextContactId === focusedContact?.id ? contactContext?.title : null)
    ?? null;
  const contextApplies = contextContactId != null && contextContactId === focusedContact?.id;
  const sortedOpportunities = useMemo(
    () => sortOpportunities(contactContext?.opportunities ?? []),
    [contactContext?.opportunities],
  );
  const nextContact = useMemo(() => {
    if (!focusedContact) return pendingContacts[0] ?? null;
    const focusedIndex = contacts.findIndex((contact) => contact.id === focusedContact.id);
    if (focusedIndex < 0) return pendingContacts.find((contact) => contact.id !== focusedContact.id) ?? null;
    return contacts.slice(focusedIndex + 1).find((contact) => contact.status === "pending") ?? null;
  }, [contacts, focusedContact, pendingContacts]);

  useEffect(() => {
    if (!isRecallQueue) return;
    if (recallDateFilter === "today" && recallDateCounts.today === 0 && recallDateCounts.overdue > 0) {
      setRecallDateFilter("overdue");
    }
  }, [isRecallQueue, recallDateFilter, recallDateCounts.today, recallDateCounts.overdue]);

  useEffect(() => {
    if (awaitingEvent) setMode("detail");
  }, [awaitingEvent?.id]);

  // Keep local focus in sync with parent. After "Logguer & suivant" in fiche mode,
  // parent clears focusedContactId and currentContact becomes the next pending row.
  useEffect(() => {
    if (focusedContactId != null) {
      setFocusedId(focusedContactId);
      return;
    }
    if (mode === "detail") {
      if (currentContact) setFocusedId(currentContact.id);
      else setFocusedId(null);
      return;
    }
    // List mode: refresh row state only — do not follow the next pending contact.
    setFocusedId((id) => {
      if (id == null) return null;
      const focused = contacts.find((c) => c.id === id);
      return focused?.status === "pending" ? id : null;
    });
  }, [focusedContactId, currentContact?.id, mode, contacts]);

  useEffect(() => {
    setResultat(RESULTAT_OPTIONS[0].value);
    setComments("");
    setDoNotCall(false);
    setScheduleRecall(true);
  }, [focusedContact?.id]);

  useEffect(() => {
    setRecallAt(addDaysIso(defaultRecallDays));
  }, [focusedContact?.id]);

  useEffect(() => {
    setScheduleRecall(RELANCE_DEFAULT_RESULTATS.includes(resultat));
  }, [resultat]);

  useEffect(() => {
    setBulkScheduleRecall(RELANCE_DEFAULT_RESULTATS.includes(bulkResultat));
  }, [bulkResultat]);

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
    setSelectedIds(new Set(visiblePending.map((c) => c.id)));
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

  const handleSubmit = useCallback(() => {
    if (!focusedContact || focusedContact.status !== "pending") return;
    if (resultat === "RDV planifié") return;
    onLogAndNext(focusedContact.id, {
      resultat,
      comments,
      recallAt: willSendRecall ? recallAt : null,
      doNotCall,
    });
    setToast(willSendRecall ? `Loggué · rappel ${formatIsoDateFr(recallAt)}` : "Loggué");
  }, [comments, doNotCall, focusedContact, onLogAndNext, recallAt, resultat, willSendRecall]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter"
        || (!event.metaKey && !event.ctrlKey)
        || mode !== "detail"
        || loading
        || focusedContact?.status !== "pending"
        || resultat === "RDV planifié"
      ) {
        return;
      }
      event.preventDefault();
      handleSubmit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusedContact?.status, handleSubmit, loading, mode, resultat]);

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
    setToast("Loggué · RDV planifié");
  };

  const handleBulkLog = () => {
    if (pendingSelected.length === 0) return;
    onLogMany(pendingSelected, {
      resultat: bulkResultat,
      comments: bulkComments,
      recallAt: bulkWillSendRecall ? bulkRecallAt : null,
      doNotCall: bulkDoNotCall,
    });
    setSelectedIds(new Set());
    setBulkComments("");
    setBulkDoNotCall(false);
    setBulkRecallAt(addDaysIso(defaultRecallDays));
    setToast(bulkWillSendRecall ? `Loggué · rappel ${formatIsoDateFr(bulkRecallAt)}` : "Loggué");
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
      name: deferTargetId ? null : nextContinuationName(session.name),
    });
    setDeferIds(null);
    setSelectedIds(new Set());
  };

  const continuationLabel = nextContinuationName(session.name);

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
    setToast("Loggué · RDV planifié");
  };

  const called = contacts.filter((c) => c.status === "called").length;

  return (
    <div className={`calls-view calls-view--runner${isRecallQueue ? " calls-view--recalls" : ""}${mode === "detail" ? " calls-view--detail" : ""}`}>
      {toast && <div className="calls-runner-toast" role="status">{toast}</div>}
      <header className="calls-view__header calls-view__header--runner">
        <div className="calls-view__nav">
          <Button variant="secondary" className="calls-view__back" onClick={onBack}>
            Quitter
          </Button>
          <div className="calls-view__titleblock">
            <Tag variant="accent">{isRecallQueue ? "File de rappels" : "Cockpit"}</Tag>
            <h2>{isRecallQueue ? "Rappels" : session.name}</h2>
          </div>
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
          {!isRecallQueue && onPin && (
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
        </div>
      </header>

      {!isRecallQueue && (
        <>
          <div className={mode === "detail" ? "calls-progress-sticky" : undefined}>
            <ProgressBar called={called} total={contacts.length} label="Progression de la séance" />
          </div>
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
        </>
      )}

      {isRecallQueue && (
        <div className="calls-recall-queue__filters" role="group" aria-label="Filtrer les rappels">
          {(
            [
              ["today", "Aujourd'hui", recallDateCounts.today],
              ["overdue", "En retard", recallDateCounts.overdue],
              ["upcoming", "À venir", recallDateCounts.upcoming],
              ["all", "Tous", recallDateCounts.all],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={`calls-list-filter-chip${recallDateFilter === value ? " calls-list-filter-chip--active" : ""}`}
              aria-pressed={recallDateFilter === value}
              onClick={() => setRecallDateFilter(value)}
            >
              {label}
              <span className="xos-numeric">{count}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">{error}</p>
        </GlassCard>
      )}

      {isRecallQueue && contacts.length === 0 && !loading ? (
        <GlassCard className="calls-empty calls-empty--hero">
          <EmptyState
            title="Rien à rappeler"
            description="Inbox zero — dès qu'un appel planifie un rappel, il atterrit ici, prêt à être traité comme une séance."
            action={
              <Button variant="secondary" onClick={onBack}>
                Retour au hub
              </Button>
            }
          />
        </GlassCard>
      ) : mode === "list" ? (
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
                {bulkCanRecall && (
                  <RecallFields
                    resultat={bulkResultat}
                    scheduleRecall={bulkScheduleRecall}
                    onScheduleRecallChange={setBulkScheduleRecall}
                    recallAt={bulkRecallAt}
                    onRecallAtChange={setBulkRecallAt}
                    onDefaultRecallDaysChange={handleDefaultRecallDays}
                  />
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
                  team={team}
                />
              ) : (
                <div className="calls-runner-actions">
                  <Button onClick={handleBulkLog} disabled={loading || bulkResultat === "RDV planifié"}>
                    {loading
                      ? "Enregistrement…"
                      : `Consigner pour ${pendingSelected.length}`}
                  </Button>
                  {!isRecallQueue && (
                    <Button
                      variant="secondary"
                      onClick={() => openDefer(pendingSelected)}
                      disabled={loading}
                      title={`Reporter vers « ${continuationLabel} »`}
                    >
                      Non contacté
                    </Button>
                  )}
                </div>
              )}
            </GlassCard>
          )}

          {deferIds && !isRecallQueue && (
            <div className="calls-defer-panel" role="region" aria-label="Créer la séance suivante">
              <strong>
                Non contacté → {continuationLabel}
              </strong>
              <p className="calls-defer-panel__empty">
                Choisissez la date de la séance suivante
                {deferIds.length > 1 ? ` (${deferIds.length} contacts)` : ""}.
              </p>
              <DatePicker label="Date de la séance" value={deferDate} onChange={(d) => { setDeferDate(d); setDeferTargetId(null); }} />
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
                <p className="calls-defer-panel__empty">
                  Nouvelle séance « {continuationLabel} » le {formatIsoDateFr(deferDate)}.
                </p>
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
                      : `Créer ${continuationLabel}`}
                </Button>
                {deferTargetId != null && (
                  <Button variant="secondary" onClick={() => setDeferTargetId(null)} disabled={loading}>
                    Créer plutôt {continuationLabel}
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
              <h3>{isRecallQueue ? "Contacts à rappeler" : "Liste de la séance"}</h3>
              <div className="calls-preview__actions">
                <Button
                  variant="secondary"
                  disabled={loading || visiblePending.length === 0}
                  onClick={toggleSelectAllPending}
                >
                  {allPendingSelected
                    ? "Tout désélectionner"
                    : `Sélectionner les à faire (${visiblePending.length})`}
                </Button>
              </div>
            </div>
            <div className="calls-cockpit-list__filters">
              {!isRecallQueue && (
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
              )}
              <input
                type="search"
                className="calls-input calls-cockpit-list__search"
                placeholder={
                  isRecallQueue
                    ? "Filtrer nom, entreprise, séance…"
                    : "Filtrer nom, poste, entreprise, tél…"
                }
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                aria-label="Filtrer la liste"
              />
            </div>
            <div className="calls-cockpit-list__scroll">
            <ul className={`calls-cockpit-list__rows${isRecallQueue ? " calls-cockpit-list__rows--recalls" : ""}`}>
              <li className="calls-cockpit-list__header" aria-hidden="true">
                <span />
                <span>Contact</span>
                <span>Poste</span>
                <span>Entreprise</span>
                <span>Email</span>
                <span>Tél.</span>
                <span>{isRecallQueue ? "Séance" : "Statut"}</span>
                <span>Rappel</span>
              </li>
              {filteredContacts.map((contact) => {
                const status = listStatusDisplay(contact);
                return (
                <li
                  key={isRecallQueue ? `${contact.origin_session_id}-${contact.id}` : contact.id}
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
                    <strong title={contact.contact_name}>{contact.contact_name}</strong>
                  </button>
                  <span className="calls-cockpit-list__cell calls-cockpit-list__cell--wrap" title={contact.title ?? undefined}>
                    {contact.title ?? "—"}
                  </span>
                  <span className="calls-cockpit-list__cell calls-cockpit-list__cell--wrap" title={contact.account_name ?? undefined}>
                    {contact.account_name ?? "—"}
                  </span>
                  <span className="calls-cockpit-list__cell calls-cockpit-list__cell--wrap" title={contact.email ?? undefined}>
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        className="calls-cockpit-list__email"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {contact.email}
                      </a>
                    ) : (
                      "—"
                    )}
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
                  {isRecallQueue ? (
                    <span
                      className="calls-cockpit-list__cell calls-cockpit-list__cell--wrap"
                      title={contact.origin_session_name}
                    >
                      {contact.origin_session_name ?? "—"}
                    </span>
                  ) : (
                    <span className="calls-cockpit-list__status" title={status.label}>
                      <Tag variant={status.variant}>{status.label}</Tag>
                    </span>
                  )}
                  <span className="calls-cockpit-list__cell xos-numeric">
                    {contact.recall_at ? formatIsoDateFr(contact.recall_at) : "—"}
                  </span>
                </li>
                );
              })}
              {filteredContacts.length === 0 && (
                <li className="calls-cockpit-list__empty">
                  {isRecallQueue ? (
                    <EmptyState
                      title="Calme plat sur ce filtre"
                      description="Aucun rappel ici — essayez « En retard », « À venir » ou « Tous »."
                    />
                  ) : (
                    "Aucun contact pour ce filtre."
                  )}
                </li>
              )}
            </ul>
            </div>
          </GlassCard>
        </div>
      ) : focusedContact ? (
        <div className="calls-cockpit-detail">
          <GlassCard className="calls-contact-card">
            <div className="calls-contact-card__main">
              <div className="calls-contact-card__who">
                <div className="calls-contact-card__chips">
                  {isRecallQueue && focusedContact.origin_session_name && (
                    <Tag variant="accent">{focusedContact.origin_session_name}</Tag>
                  )}
                  {(focusedContact.attempt_count ?? 0) > 0 && (
                    <Tag variant="muted">Tentative {focusedContact.attempt_count}</Tag>
                  )}
                  {focusedContact.status !== "pending" && (
                    <Tag variant={listStatusDisplay(focusedContact).variant}>
                      {listStatusDisplay(focusedContact).label}
                    </Tag>
                  )}
                  {!contextLoading && contextApplies && contactContext?.npa && (
                    <Tag variant="alert">Ne pas rappeler (NPA)</Tag>
                  )}
                </div>
                <h3>{focusedContact.contact_name}</h3>
                <p className="calls-contact-card__role">
                  {[displayTitle, focusedContact.account_name || "Compte inconnu"].filter(Boolean).join(" · ")}
                </p>
                {focusedContact.status !== "pending" && focusedContact.recall_at && (
                  <p className="calls-contact-card__recall-meta">
                    Rappel {formatIsoDateFr(focusedContact.recall_at)}
                  </p>
                )}
              </div>
              <div className="calls-contact-card__links">
                {sfContactUrl && <SalesforceRecordLink href={sfContactUrl} />}
                {focusedContact.linkedin_url && <LinkedInRecordLink href={focusedContact.linkedin_url} />}
              </div>
            </div>

            <div className="calls-contact-card__cta">
              <div className="calls-contact-card__cta-copy">
                {focusedContact.phone ? (
                  <a href={`tel:${focusedContact.phone}`} className="calls-phone-link xos-numeric">
                    {focusedContact.phone}
                  </a>
                ) : (
                  <p className="calls-contact-card__no-phone">Aucun numéro</p>
                )}
                {displayEmail ? (
                  <a href={`mailto:${displayEmail}`} className="calls-email-link">
                    {displayEmail}
                  </a>
                ) : (
                  <p className="calls-contact-card__no-email">Aucun email</p>
                )}
              </div>
              {focusedContact.phone && (
                <Button onClick={() => window.open(`tel:${focusedContact.phone}`, "_self")}>
                  Appeler
                </Button>
              )}
            </div>
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
              {contextApplies && contactContext && contactContext.tasks.length === 0 && (
                <p className="calls-muted">Aucun appel récent.</p>
              )}
              {contextApplies && contactContext && contactContext.tasks.length > 0 && (
                <ul className="calls-context-list">
                  {contactContext.tasks.map((task, index) => (
                    <li key={task.id} className={index === 0 ? "calls-context-list__row--latest" : undefined}>
                      <strong>{task.result ?? task.subject ?? "Appel"}</strong>
                      <span className="calls-context-list__date xos-numeric">
                        {formatActivityDateFr(task.activity_date)}
                        <small>{formatRelativeDaysFr(task.activity_date)}</small>
                      </span>
                      {task.record_url ? <SalesforceRecordLink href={task.record_url} /> : <span />}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>

            <GlassCard className="calls-context-panel">
              <h3>Opportunités</h3>
              {contextApplies && contactContext && contactContext.opportunities.length === 0 && (
                <p className="calls-muted">Aucune opportunité.</p>
              )}
              {contextApplies && contactContext && contactContext.opportunities.length > 0 && (
                <ul className="calls-context-list">
                  {sortedOpportunities.map((opp) => (
                    <li key={opp.id} className={opp.is_closed ? "calls-context-list__row--closed" : undefined}>
                      <strong>{opp.name}</strong>
                      <span>{opp.stage_name ?? "—"}</span>
                      {opp.record_url ? <SalesforceRecordLink href={opp.record_url} /> : <span />}
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
              team={team}
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

              {canRecall && (
                <RecallFields
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
                  placeholder={willSendRecall ? "Motif du rappel…" : "Notes sur l'appel…"}
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
                  team={team}
                />
              ) : (
                <div className="calls-runner-actions calls-runner-actions--sticky">
                  {nextContact && (
                    <p className="calls-next-hint">
                      Ensuite : <strong>{nextContact.contact_name}</strong>
                    </p>
                  )}
                  <div className="calls-runner-actions__row">
                    <Button onClick={handleSubmit} disabled={loading} title="⌘↵">
                      {loading ? "Enregistrement…" : "Logguer & suivant"}
                    </Button>
                    {!isRecallQueue && (
                      <Button
                        variant="secondary"
                        onClick={() => openDefer([focusedContact.id])}
                        disabled={loading}
                        title={`Reporter vers « ${continuationLabel} »`}
                      >
                        Non contacté
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {resultat === "RDV planifié" && !isRecallQueue && (
                <div className="calls-runner-actions">
                  <Button
                    variant="secondary"
                    onClick={() => openDefer([focusedContact.id])}
                    disabled={loading}
                    title={`Reporter vers « ${continuationLabel} »`}
                  >
                    Non contacté
                  </Button>
                </div>
              )}

              {deferIds && mode === "detail" && !isRecallQueue && (
                <div className="calls-defer-panel" role="region" aria-label="Créer la séance suivante">
                  <strong>Non contacté → {continuationLabel}</strong>
                  <p className="calls-defer-panel__empty">
                    Choisissez la date de la séance suivante.
                  </p>
                  <DatePicker label="Date de la séance" value={deferDate} onChange={(d) => { setDeferDate(d); setDeferTargetId(null); }} />
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
                    <p className="calls-defer-panel__empty">
                      Nouvelle séance « {continuationLabel} » le {formatIsoDateFr(deferDate)}.
                    </p>
                  )}
                  <div className="calls-runner-actions">
                    <Button onClick={confirmDefer} disabled={loading}>
                      {deferTargetId ? "Associer à la séance" : `Créer ${continuationLabel}`}
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
