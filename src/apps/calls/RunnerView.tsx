import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  DEFAULT_RECALL_DAYS,
  PIPE_DECROCHE,
  RECALL_ELIGIBLE_RESULTATS,
  RELANCE_DEFAULT_RESULTATS,
  type ResultatCall,
} from "../../crm";
import { EventPanel, type EventPanelHandle } from "./EventPanel";
import { ShareSessionPanel } from "./ShareSessionPanel";
import { EmptyState } from "./EmptyState";
import { CommandBar, ShortcutHelp } from "./CommandBar";
import { ComboOnboardingDemo } from "./ComboOnboardingDemo";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  digitFromKeyboardCode,
  hasSeenComboDemo,
  isModKey,
  isTypingTarget,
  readSoundsEnabled,
  RECALL_SHORTCUT_PRESETS,
  resultatFromDigit,
  type ComboActionId,
  writeSoundsEnabled,
} from "./comboKeyboard";
import { readSoundPrefs } from "./comboSoundPrefs";
import { playComboSound, playRdvCelebrateSound } from "./comboSounds";
import { RdvConfetti } from "./RdvConfetti";
import {
  countSessionRdvs,
  readRdvGoal,
  rdvHeatLevel,
  writeRdvGoal,
  type RdvHeat,
} from "./rdvCelebrate";
import { DatePicker, formatActivityDateFr, formatIsoDateFr, RdvGoalPicker, todayParisIso } from "./formControls";
import { LinkedInRecordLink, SalesforceRecordLink } from "./BrandLinks";
import { ProgressBar } from "./ProgressBar";
import {
  countRecallDateFilters,
  listRecallOriginSessions,
  matchesRecallDateFilter,
  matchesRecallSessionFilter,
  type RecallDateFilter,
  type RecallSessionFilter,
} from "./recallQueue";
import { nextContinuationName } from "./sessionNaming";
import type {
  ContactContext,
  ContactEventItem,
  ContactOpportunityItem,
  SessionContact,
  SessionDetail,
  SessionSummary,
  TeamMember,
} from "./types";
import { RESULTAT_OPTIONS, sessionTypeLabel } from "./types";

const RECALL_DAYS_KEY = "xos-calls-default-recall-days";

type RunnerMode = "list" | "detail";

type RunnerToast =
  | { kind: "plain"; message: string }
  | {
      kind: "rdv";
      count: number;
      goal: number | null;
      goalJustHit: boolean;
      heat: RdvHeat;
    };

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
  contextTargetContactId?: number | null;
  onBack: () => void;
  onPin?: () => Promise<void>;
  onShareSession?: (memberUserIds: string[]) => Promise<void>;
  onFocusContact: (contactId: number) => void;
  onLogAndNext: (contactId: number, payload: LogPayload) => void;
  onLogRdvAndNext: (
    contactId: number,
    payload: LogPayload,
    event: {
      start: string;
      durationMin: number;
      subject: string;
      ownerSfUserId: string | null;
    },
  ) => void;
  onLogMany: (contactIds: number[], payload: LogPayload) => void;
  onLogEvent: (
    start: string,
    durationMin: number,
    meta: { subject: string; ownerSfUserId: string | null },
  ) => void;
  onDeferContacts: (contactIds: number[], payload: DeferPayload) => void;
  onRemoveContacts: (contactIds: number[]) => void;
  onUpdateRecall: (contactIds: number[], recallAt: string | null) => void;
  /** Social cheer when the session RDV goal is hit (shared sessions). */
  onCelebrateGoal?: (payload: { goal: number; count: number }) => void;
  team?: TeamMember[];
  currentSfUserId?: string | null;
  currentUserId?: string | null;
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

/** `completedAttempts` = appels déjà journalisés ; on affiche le n° de la prochaine tentative. */
function formatAttemptLabel(completedAttempts: number): string {
  const next = Math.max(1, completedAttempts + 1);
  if (next === 1) return "1re tentative";
  return `${next}e tentative`;
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
  return [...opportunities].sort((a, b) => {
    const link = Number(Boolean(b.linked_to_contact)) - Number(Boolean(a.linked_to_contact));
    if (link !== 0) return link;
    return Number(a.is_closed) - Number(b.is_closed);
  });
}

function sortEvents(events: ContactEventItem[]): ContactEventItem[] {
  return [...events].sort((a, b) => {
    const link = Number(Boolean(b.linked_to_contact)) - Number(Boolean(a.linked_to_contact));
    if (link !== 0) return link;
    return String(b.start_date_time || "").localeCompare(String(a.start_date_time || ""));
  });
}

function listStatusDisplay(contact: SessionContact): {
  label: string;
  variant: "success" | "warning" | "accent" | "muted" | "default";
} {
  if (contact.status === "pending" && contact.claim_active && contact.claimed_by_label) {
    return { label: `Pris · ${contact.claimed_by_label}`, variant: "warning" };
  }
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
  const calledRows = contacts.filter((c) => c.status === "called");
  const called = calledRows.length;
  const decroches = calledRows.filter((c) => c.outcome && PIPE_DECROCHE.includes(c.outcome)).length;
  const argumentes = calledRows.filter((c) => c.outcome === "Appel argumenté").length;
  const rdv = calledRows.filter((c) => c.outcome === "RDV planifié").length;
  return { total, remaining, called, decroches, argumentes, rdv };
}

function ResultButtons({
  value,
  onChange,
  disabledValues = [],
  onPick,
}: {
  value: ResultatCall;
  onChange: (value: ResultatCall) => void;
  disabledValues?: ResultatCall[];
  onPick?: () => void;
}) {
  return (
    <div className="calls-result-seg" role="group" aria-label="Résultat de l'appel">
      {RESULTAT_OPTIONS.map((opt, index) => {
        const disabled = disabledValues.includes(opt.value);
        const digit = String(index + 1);
        return (
          <button
            key={opt.value}
            type="button"
            className={`calls-result-seg__btn${value === opt.value ? " calls-result-seg__btn--active" : ""}`}
            aria-pressed={value === opt.value}
            disabled={disabled}
            title={disabled ? "Sélectionnez un seul contact pour planifier un RDV" : digit}
            onClick={() => {
              if (opt.value !== value) onPick?.();
              onChange(opt.value);
            }}
          >
            <span>{opt.label}</span>
            <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">{digit}</kbd>
          </button>
        );
      })}
    </div>
  );
}

const RECALL_PRESETS: { days: number; label: string; shiftDigit: string }[] = [
  { days: 0, label: "Aujourd'hui", shiftDigit: "1" },
  { days: 1, label: "+1 j", shiftDigit: "2" },
  { days: 3, label: "+3 j", shiftDigit: "3" },
  { days: 7, label: "+7 j", shiftDigit: "4" },
  { days: 14, label: "+14 j", shiftDigit: "5" },
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
      <label className="calls-checkbox calls-checkbox--tight">
        <input
          type="checkbox"
          checked={scheduleRecall}
          onChange={(e) => onScheduleRecallChange(e.target.checked)}
          aria-label="Planifier un rappel"
        />
        <span aria-hidden="true">Planifier un rappel</span>
        <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">R</kbd>
      </label>
      {scheduleRecall ? (
        <div className="calls-recall__track" role="group" aria-label="Choisir la date de rappel">
          <div className="calls-recall__presets" role="group" aria-label="Délai rapide">
            {RECALL_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                className={`calls-recall__chip${activePreset === preset.days ? " calls-recall__chip--active" : ""}`}
                aria-pressed={activePreset === preset.days}
                aria-label={preset.label}
                title={`⇧${preset.shiftDigit}`}
                onClick={() => pickPreset(preset.days)}
              >
                <span aria-hidden="true">{preset.label}</span>
                <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                  ⇧{preset.shiftDigit}
                </kbd>
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
      ) : (
        <p className="calls-muted calls-recall__skip-hint">
          Pas de rappel cette fois — le contact reste appelable (contrairement au NPA).
        </p>
      )}
    </div>
  );
}

function ContextSideSkeleton({ quiet = false }: { quiet?: boolean }) {
  return (
    <>
      <GlassCard className="calls-context-panel calls-context-panel--skeleton" aria-busy="true">
        <h3>Historique d&apos;appels</h3>
        <p className="calls-muted">{quiet ? "\u00a0" : "Chargement…"}</p>
      </GlassCard>
      <GlassCard className="calls-context-panel calls-context-panel--skeleton" aria-busy="true">
        <h3>Opportunités du compte</h3>
        <p className="calls-muted">{quiet ? "\u00a0" : "Chargement…"}</p>
      </GlassCard>
      <GlassCard className="calls-context-panel calls-context-panel--skeleton" aria-busy="true">
        <h3>RDV du compte</h3>
        <p className="calls-muted">{quiet ? "\u00a0" : "Chargement…"}</p>
      </GlassCard>
    </>
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
  contextTargetContactId = null,
  onBack,
  onPin,
  onShareSession,
  onFocusContact,
  onLogAndNext,
  onLogRdvAndNext,
  onLogMany,
  onLogEvent,
  onDeferContacts,
  onRemoveContacts,
  onUpdateRecall,
  onCelebrateGoal,
  team = [],
  currentSfUserId = null,
  currentUserId = null,
}: RunnerViewProps) {
  const isRecallQueue = variant === "recalls";
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const today = todayParisIso();
  const [mode, setMode] = useState<RunnerMode>("list");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [listStatusFilter, setListStatusFilter] = useState<ListStatusFilter>("all");
  const [recallDateFilter, setRecallDateFilter] = useState<RecallDateFilter>("today");
  const [recallSessionFilter, setRecallSessionFilter] = useState<RecallSessionFilter>("all");
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
  const [bulkRecallPicker, setBulkRecallPicker] = useState<{ ids: number[]; seed: string } | null>(null);
  const [pinned, setPinned] = useState(false);
  const [toast, setToast] = useState<RunnerToast | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(() => !hasSeenComboDemo());
  const [soundsEnabled, setSoundsEnabled] = useState(readSoundsEnabled);
  const [soundPrefs, setSoundPrefs] = useState(readSoundPrefs);
  const [pendingRemove, setPendingRemove] = useState<{
    ids: number[];
    title: string;
    description: ReactNode;
    confirmLabel: string;
  } | null>(null);
  const [sessionRdvCount, setSessionRdvCount] = useState(() => countSessionRdvs(contacts));
  const [rdvGoal, setRdvGoal] = useState<number | null>(() =>
    isRecallQueue ? null : readRdvGoal(session.id),
  );
  const [confettiBurst, setConfettiBurst] = useState(0);
  const [confettiHeat, setConfettiHeat] = useState<RdvHeat>(1);
  const [goalBurst, setGoalBurst] = useState(false);
  const [kpiGoalPulse, setKpiGoalPulse] = useState(false);
  const sessionRdvRef = useRef(sessionRdvCount);
  const bootstrappedDetail = useRef(false);
  const eventPanelRef = useRef<EventPanelHandle>(null);

  useEffect(() => {
    setPinned(false);
    const n = countSessionRdvs(contacts);
    sessionRdvRef.current = n;
    setSessionRdvCount(n);
    setRdvGoal(isRecallQueue ? null : readRdvGoal(session.id));
  }, [session.id, isRecallQueue]);

  useEffect(() => {
    const n = countSessionRdvs(contacts);
    if (n >= sessionRdvRef.current) {
      sessionRdvRef.current = n;
      setSessionRdvCount(n);
    }
  }, [contacts]);

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
    const ms =
      toast.kind === "rdv"
        ? toast.goalJustHit
          ? 5200
          : toast.heat >= 4
            ? 3800
            : toast.heat >= 3
              ? 3200
              : 2600
        : 1500;
    const timeout = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!kpiGoalPulse) return;
    const timeout = window.setTimeout(() => setKpiGoalPulse(false), 7200);
    return () => window.clearTimeout(timeout);
  }, [kpiGoalPulse]);

  const kpis = useMemo(() => computeKpis(contacts), [contacts]);
  const canRecall = RECALL_ELIGIBLE_RESULTATS.includes(resultat) && !doNotCall;
  const bulkCanRecall = RECALL_ELIGIBLE_RESULTATS.includes(bulkResultat) && !bulkDoNotCall;
  const willSendRecall = canRecall && scheduleRecall;
  const bulkWillSendRecall = bulkCanRecall && bulkScheduleRecall;
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
  const recallOriginSessions = useMemo(
    () => listRecallOriginSessions(contacts),
    [contacts],
  );
  const recallDateCounts = useMemo(
    () =>
      countRecallDateFilters(
        contacts
          .filter((c) => matchesRecallSessionFilter(c.origin_session_id, recallSessionFilter))
          .map((c) => ({
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
    [contacts, today, recallSessionFilter],
  );
  const filteredContacts = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (isRecallQueue) {
        if (!matchesRecallDateFilter(contact.recall_at, recallDateFilter, today)) return false;
        if (!matchesRecallSessionFilter(contact.origin_session_id, recallSessionFilter)) return false;
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
  }, [contacts, listStatusFilter, listQuery, isRecallQueue, recallDateFilter, recallSessionFilter, today]);
  const pendingSelected = useMemo(
    () => [...selectedIds].filter((id) => pendingContacts.some((c) => c.id === id)),
    [selectedIds, pendingContacts],
  );
  const recallManageSelected = useMemo(
    () =>
      contacts
        .filter((contact) => {
          if (!selectedIds.has(contact.id) || !contact.recall_at) return false;
          return isRecallQueue || contact.status === "called";
        })
        .map((contact) => contact.id),
    [contacts, selectedIds, isRecallQueue],
  );
  const selectableContacts = useMemo(
    () =>
      filteredContacts.filter(
        (contact) =>
          contact.status === "pending"
          || (Boolean(contact.recall_at) && (isRecallQueue || contact.status === "called")),
      ),
    [filteredContacts, isRecallQueue],
  );
  const allSelectableSelected =
    selectableContacts.length > 0 && selectableContacts.every((c) => selectedIds.has(c.id));
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
  const contextReady = Boolean(
    contactContext && contextContactId != null && contextContactId === focusedContact?.id,
  );
  const contextBusy = Boolean(
    focusedContact
    && contextTargetContactId === focusedContact.id
    && contextContactId !== focusedContact.id,
  );
  const contextApplies = contextReady;
  const [showContextSkeleton, setShowContextSkeleton] = useState(false);

  useEffect(() => {
    if (!contextBusy) {
      setShowContextSkeleton(false);
      return;
    }
    const timer = window.setTimeout(() => setShowContextSkeleton(true), 160);
    return () => window.clearTimeout(timer);
  }, [contextBusy, focusedContact?.id]);
  const sortedOpportunities = useMemo(
    () => sortOpportunities(contactContext?.opportunities ?? []),
    [contactContext?.opportunities],
  );
  const sortedEvents = useMemo(
    () => sortEvents(contactContext?.events ?? []),
    [contactContext?.events],
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
    if (!isRecallQueue) return;
    if (recallSessionFilter === "all") return;
    if (!recallOriginSessions.some((session) => session.id === recallSessionFilter)) {
      setRecallSessionFilter("all");
    }
  }, [isRecallQueue, recallSessionFilter, recallOriginSessions]);

  useEffect(() => {
    if (awaitingEvent) setMode("detail");
    // Only react to a new awaiting event by identity, not on every awaitingEvent reference change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // currentContact is read via currentContact.id only; re-running on the full object
    // would re-sync focus on every parent render instead of on the actual contact change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedContactId, currentContact?.id, mode, contacts]);

  useEffect(() => {
    setResultat(RESULTAT_OPTIONS[0].value);
    setComments("");
    setDoNotCall(false);
    setScheduleRecall(true);
  }, [focusedContact?.id]);

  useEffect(() => {
    setRecallAt(addDaysIso(defaultRecallDays));
    // Reset only when the focused contact changes; defaultRecallDays is read as a
    // one-time seed, not tracked so an in-progress edit isn't clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedContact?.id]);

  useEffect(() => {
    setScheduleRecall(RELANCE_DEFAULT_RESULTATS.includes(resultat));
  }, [resultat]);

  useEffect(() => {
    setBulkScheduleRecall(RELANCE_DEFAULT_RESULTATS.includes(bulkResultat));
  }, [bulkResultat]);

  useEffect(() => {
    // Drop selections that are no longer actionable after a bulk action.
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((id) => {
          const contact = contacts.find((row) => row.id === id);
          if (!contact) return false;
          if (contact.status === "pending") return true;
          return Boolean(contact.recall_at) && (isRecallQueue || contact.status === "called");
        }),
      );
      return next.size === current.size ? current : next;
    });
  }, [contacts, isRecallQueue]);

  const openDetail = useCallback((contactId: number) => {
    setFocusedId(contactId);
    onFocusContact(contactId);
    setMode("detail");
  }, [onFocusContact]);

  const toggleSelected = (contactId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const toggleSelectAllSelectable = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(selectableContacts.map((c) => c.id)));
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

  const celebrateRdv = useCallback(() => {
    const next = sessionRdvRef.current + 1;
    sessionRdvRef.current = next;
    setSessionRdvCount(next);
    const goalJustHit = rdvGoal != null && next === rdvGoal;
    const heat = rdvHeatLevel(next, goalJustHit);
    setConfettiHeat(heat);
    setGoalBurst(goalJustHit);
    setConfettiBurst((key) => key + 1);
    if (goalJustHit) setKpiGoalPulse(true);
    playRdvCelebrateSound(heat, soundsEnabled);
    setToast({
      kind: "rdv",
      count: next,
      goal: rdvGoal,
      goalJustHit,
      heat,
    });
    if (goalJustHit && rdvGoal != null && onCelebrateGoal) {
      onCelebrateGoal({ goal: rdvGoal, count: next });
    }
  }, [onCelebrateGoal, rdvGoal, soundsEnabled]);

  const handleRdvGoalChange = (goal: number | null) => {
    if (isRecallQueue) return;
    setRdvGoal(goal);
    writeRdvGoal(session.id, goal);
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
    playComboSound(willSendRecall ? "recall" : "success", { master: soundsEnabled });
    setToast({
      kind: "plain",
      message: willSendRecall
        ? `Loggué · rappel ${formatIsoDateFr(recallAt)}`
        : canRecall && !scheduleRecall
          ? "Loggué · sans rappel"
          : "Loggué",
    });
  }, [canRecall, comments, doNotCall, focusedContact, onLogAndNext, recallAt, resultat, scheduleRecall, soundsEnabled, willSendRecall]);

  const handleRdvSubmit = (
    start: string,
    durationMin: number,
    meta: { subject: string; ownerSfUserId: string | null },
  ) => {
    if (!focusedContact || focusedContact.status !== "pending") return;
    onLogRdvAndNext(
      focusedContact.id,
      {
        resultat: "RDV planifié",
        comments,
        recallAt: null,
        doNotCall,
      },
      { start, durationMin, subject: meta.subject, ownerSfUserId: meta.ownerSfUserId },
    );
    celebrateRdv();
  };

  const handleFinalizeEvent = useCallback(
    (
      start: string,
      durationMin: number,
      meta: { subject: string; ownerSfUserId: string | null },
    ) => {
      onLogEvent(start, durationMin, meta);
      celebrateRdv();
    },
    [celebrateRdv, onLogEvent],
  );

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
    setToast({
      kind: "plain",
      message: bulkWillSendRecall ? `Loggué · rappel ${formatIsoDateFr(bulkRecallAt)}` : "Loggué",
    });
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

  const openBulkRecallPicker = (ids: number[]) => {
    if (ids.length === 0) return;
    const seed =
      contacts.find((contact) => contact.id === ids[0])?.recall_at
      || addDaysIso(defaultRecallDays);
    setBulkRecallPicker({ ids, seed });
    setDeferIds(null);
  };

  const applyRecallDate = (ids: number[], next: string) => {
    if (ids.length === 0) return;
    onUpdateRecall(ids, next);
    setSelectedIds(new Set());
    setBulkRecallPicker(null);
  };

  const confirmRemove = (ids: number[], label: string) => {
    if (ids.length === 0) return;
    const clearingRecall = isRecallQueue
      || ids.every((id) => {
        const contact = contacts.find((row) => row.id === id);
        return contact?.status === "called" && Boolean(contact.recall_at);
      });
    setPendingRemove({
      ids,
      title: clearingRecall
        ? ids.length === 1
          ? "Retirer des rappels"
          : `Retirer ${ids.length} contacts des rappels`
        : ids.length === 1
          ? "Retirer de la séance"
          : `Retirer ${ids.length} contacts de la séance`,
      description: clearingRecall
        ? ids.length === 1
          ? (
              <>
                Retirer <strong>{label}</strong> des rappels ? L&apos;historique d&apos;appel est conservé.
              </>
            )
          : (
              <>
                Retirer {ids.length} contacts des rappels ? L&apos;historique d&apos;appel est conservé.
              </>
            )
        : ids.length === 1
          ? (
              <>
                Retirer <strong>{label}</strong> de la séance ?
              </>
            )
          : <>Retirer {ids.length} contacts de la séance ?</>,
      confirmLabel: clearingRecall ? "Retirer des rappels" : "Retirer",
    });
  };

  const executeRemove = () => {
    if (!pendingRemove) return;
    const ids = pendingRemove.ids;
    setPendingRemove(null);

    if (isRecallQueue) {
      onRemoveContacts(ids);
    } else {
      const toDelete: number[] = [];
      const toClearRecall: number[] = [];
      for (const id of ids) {
        const contact = contacts.find((row) => row.id === id);
        if (!contact) continue;
        if (contact.status === "called" && contact.recall_at) toClearRecall.push(id);
        else if (contact.status === "pending" || contact.status === "skipped") toDelete.push(id);
      }
      if (toDelete.length) onRemoveContacts(toDelete);
      if (toClearRecall.length) onUpdateRecall(toClearRecall, null);
    }
    setSelectedIds(new Set());
    setBulkRecallPicker(null);
  };

  const navigateContact = useCallback(
    (direction: 1 | -1) => {
      const pool = filteredContacts.length > 0 ? filteredContacts : contacts;
      if (pool.length === 0) return;
      const currentId = focusedContact?.id ?? focusedId ?? pool[0]?.id;
      const index = pool.findIndex((c) => c.id === currentId);
      const nextIndex = index < 0 ? 0 : (index + direction + pool.length) % pool.length;
      const next = pool[nextIndex];
      if (!next) return;
      openDetail(next.id);
      playComboSound("nav", { master: soundsEnabled });
    },
    [contacts, filteredContacts, focusedContact?.id, focusedId, openDetail, soundsEnabled],
  );

  const runComboAction = useCallback(
    (id: ComboActionId) => {
      switch (id) {
        case "result-1":
        case "result-2":
        case "result-3":
        case "result-4":
        case "result-5": {
          if (mode !== "detail" || focusedContact?.status !== "pending") return;
          const digit = id.slice(-1);
          const next = resultatFromDigit(digit);
          if (!next) return;
          setResultat(next);
          playComboSound("result-pick", { master: soundsEnabled });
          return;
        }
        case "toggle-recall": {
          if (mode !== "detail" || focusedContact?.status !== "pending") return;
          setScheduleRecall((v) => !v);
          playComboSound("nav", { master: soundsEnabled });
          return;
        }
        case "recall-0":
        case "recall-1":
        case "recall-3":
        case "recall-7":
        case "recall-14": {
          if (mode !== "detail" || focusedContact?.status !== "pending") return;
          const preset = RECALL_SHORTCUT_PRESETS.find((item) => item.id === id);
          if (!preset) return;
          setScheduleRecall(true);
          handleDefaultRecallDays(preset.days);
          playComboSound("recall", { master: soundsEnabled, group: "navigation" });
          return;
        }
        case "toggle-npa": {
          if (mode !== "detail" || focusedContact?.status !== "pending") return;
          setDoNotCall((v) => !v);
          playComboSound("warn", { master: soundsEnabled });
          return;
        }
        case "log-next":
          handleSubmit();
          return;
        case "nav-next":
          navigateContact(1);
          return;
        case "nav-prev":
          navigateContact(-1);
          return;
        case "mode-list":
          setMode("list");
          playComboSound("nav", { master: soundsEnabled });
          return;
        case "mode-fiche":
          if (focusedContact) openDetail(focusedContact.id);
          else if (currentContact) openDetail(currentContact.id);
          else setMode("detail");
          playComboSound("nav", { master: soundsEnabled });
          return;
        case "call": {
          const phone = focusedContact?.phone;
          if (!phone) return;
          window.open(`tel:${phone}`, "_self");
          playComboSound("nav", { master: soundsEnabled });
          return;
        }
        case "defer": {
          if (isRecallQueue || !focusedContact || focusedContact.status !== "pending") return;
          openDefer([focusedContact.id]);
          playComboSound("nav", { master: soundsEnabled });
          return;
        }
        case "remove": {
          if (!focusedContact) return;
          confirmRemove([focusedContact.id], focusedContact.contact_name);
          return;
        }
        case "help":
          setHelpOpen(true);
          playComboSound("whoosh", { master: soundsEnabled });
          return;
        case "command-bar":
          setCommandBarOpen(true);
          playComboSound("whoosh", { master: soundsEnabled });
          return;
        case "replay-demo":
          setDemoOpen(true);
          return;
        case "toggle-sounds": {
          setSoundsEnabled((prev) => {
            const next = !prev;
            writeSoundsEnabled(next);
            return next;
          });
          return;
        }
        default:
          return;
      }
    },
    [
      currentContact,
      focusedContact,
      handleDefaultRecallDays,
      handleSubmit,
      isRecallQueue,
      mode,
      navigateContact,
      openDetail,
      soundsEnabled,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Capture + stopPropagation : ⌘K ne doit pas ouvrir le launcher OS.
      if (isModKey(event) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        if (demoOpen || helpOpen) return;
        setCommandBarOpen(true);
        playComboSound("whoosh", { master: soundsEnabled });
        return;
      }

      // Démo / overlays gèrent Esc + focus trap eux-mêmes.
      if (demoOpen || commandBarOpen || helpOpen) return;

      // ⌘↵ doit marcher même dans un champ (commentaires / date RDV).
      if (
        event.key === "Enter"
        && isModKey(event)
        && mode === "detail"
        && !loading
        && focusedContact?.status === "pending"
      ) {
        event.preventDefault();
        if (resultat === "RDV planifié") {
          eventPanelRef.current?.submit();
        } else {
          handleSubmit();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setHelpOpen(true);
        playComboSound("whoosh", { master: soundsEnabled });
        return;
      }

      if (event.key === "Escape") {
        setBulkRecallPicker(null);
        setDeferIds(null);
        return;
      }

      if (event.shiftKey && event.code.startsWith("Digit")) {
        const digit = event.code.replace("Digit", "");
        const preset = RECALL_SHORTCUT_PRESETS.find((item) => item.shiftDigit === digit);
        if (preset) {
          event.preventDefault();
          runComboAction(preset.id);
        }
        return;
      }

      // AZERTY : sans Shift, Digit1–5 émettent &é"'( — on lit event.code.
      if (!event.shiftKey && !isModKey(event) && !event.altKey) {
        const digit = digitFromKeyboardCode(event.code);
        if (digit) {
          event.preventDefault();
          runComboAction(`result-${digit}` as ComboActionId);
          return;
        }
      }

      if (isModKey(event) || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "r") {
        event.preventDefault();
        runComboAction("toggle-recall");
        return;
      }
      if (key === "n") {
        event.preventDefault();
        runComboAction("toggle-npa");
        return;
      }
      if (key === "d") {
        event.preventDefault();
        runComboAction("defer");
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        runComboAction("remove");
        return;
      }
      if (key === "j") {
        event.preventDefault();
        runComboAction("nav-prev");
        return;
      }
      if (key === "k") {
        event.preventDefault();
        runComboAction("nav-next");
        return;
      }
      if (key === "l") {
        event.preventDefault();
        runComboAction("mode-list");
        return;
      }
      if (key === "f") {
        event.preventDefault();
        runComboAction("mode-fiche");
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [
    commandBarOpen,
    demoOpen,
    focusedContact?.status,
    handleSubmit,
    helpOpen,
    loading,
    mode,
    resultat,
    runComboAction,
    soundsEnabled,
  ]);

  const continuationLabel = nextContinuationName(session.name);

  const handleBulkRdvSubmit = (
    start: string,
    durationMin: number,
    meta: { subject: string; ownerSfUserId: string | null },
  ) => {
    if (!singleSelectedId) return;
    onLogRdvAndNext(
      singleSelectedId,
      {
        resultat: "RDV planifié",
        comments: bulkComments,
        recallAt: null,
        doNotCall: bulkDoNotCall,
      },
      { start, durationMin, subject: meta.subject, ownerSfUserId: meta.ownerSfUserId },
    );
    setSelectedIds(new Set());
    setBulkComments("");
    setBulkDoNotCall(false);
    celebrateRdv();
  };

  const called = contacts.filter((c) => c.status === "called").length;

  return (
    <div className={`calls-view calls-view--runner${isRecallQueue ? " calls-view--recalls" : ""}${mode === "detail" ? " calls-view--detail" : ""}`}>
      {toast?.kind === "plain" && (
        <div className="calls-runner-toast" role="status">
          {toast.message}
        </div>
      )}
      {toast?.kind === "rdv" && (
        <div
          className={`calls-runner-toast calls-runner-toast--rdv calls-runner-toast--heat-${toast.heat}${toast.goalJustHit ? " calls-runner-toast--goal" : ""}`}
          role="status"
        >
          <p className="calls-runner-toast__eyebrow">
            {toast.goalJustHit ? "Objectif atteint" : "RDV planifié"}
          </p>
          <p className="calls-runner-toast__title">
            {toast.goalJustHit
              ? `${toast.count} RDV — bravo`
              : toast.count === 1
                ? "Premier RDV de la séance"
                : `${toast.count} RDV dans la séance`}
          </p>
          <p className="calls-runner-toast__meta">
            {toast.goal
              ? `Objectif ${toast.count}/${toast.goal}`
              : toast.heat >= 3
                ? "La séance chauffe"
                : "Continue comme ça"}
          </p>
        </div>
      )}
      <RdvConfetti burstKey={confettiBurst} heat={confettiHeat} goalHit={goalBurst} />
      <header className="calls-view__header calls-view__header--runner">
        <div className="calls-view__nav">
          <Button variant="secondary" className="calls-view__back" onClick={onBack}>
            Quitter
          </Button>
          <div className="calls-view__titleblock">
            <Tag variant="accent">{isRecallQueue ? "File de rappels" : "Cockpit"}</Tag>
            <h2>{isRecallQueue ? "Rappels" : session.name}</h2>
            {!isRecallQueue && (session.members?.length ?? 0) > 0 && (
              <p className="calls-muted calls-share-hint">
                Partagée avec {session.members!.map((m) => m.label).join(", ")}
              </p>
            )}
          </div>
        </div>
        <div className="calls-view__actions">
          <div className="calls-mode-toggle" role="group" aria-label="Mode d'affichage">
            <button
              type="button"
              className={`calls-mode-toggle__btn${mode === "list" ? " calls-mode-toggle__btn--active" : ""}`}
              aria-pressed={mode === "list"}
              onClick={() => setMode("list")}
              title="L"
            >
              Liste <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">L</kbd>
            </button>
            <button
              type="button"
              className={`calls-mode-toggle__btn${mode === "detail" ? " calls-mode-toggle__btn--active" : ""}`}
              aria-pressed={mode === "detail"}
              onClick={() => setMode("detail")}
              title="F"
            >
              Fiche <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">F</kbd>
            </button>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setCommandBarOpen(true);
              playComboSound("whoosh", { master: soundsEnabled });
            }}
            title="Command bar (⌘K)"
            aria-label="Command bar"
          >
            ⌘K
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setHelpOpen(true);
              playComboSound("whoosh", { master: soundsEnabled });
            }}
            title="Aide raccourcis (?)"
            aria-label="Aide raccourcis"
          >
            ?
          </Button>
          {!isRecallQueue && onShareSession && (
            <Button variant="secondary" onClick={() => setShareOpen(true)}>
              Partager
            </Button>
          )}
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

      {shareOpen && onShareSession && currentUserId && (
        <ShareSessionPanel
          members={session.members ?? []}
          team={team}
          currentUserId={currentUserId}
          saving={shareSaving}
          onClose={() => setShareOpen(false)}
          onSave={async (ids) => {
            setShareSaving(true);
            try {
              await onShareSession(ids);
              setShareOpen(false);
            } finally {
              setShareSaving(false);
            }
          }}
        />
      )}

      {!isRecallQueue && (
        <>
          <ProgressBar called={called} total={contacts.length} label="Progression de la séance" />
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
              <strong className="xos-numeric calls-stat__value">
                {kpis.decroches}
                {kpis.called > 0 && (
                  <span className="calls-stat__rate">
                    {Math.round((kpis.decroches / kpis.called) * 1000) / 10}&nbsp;%
                  </span>
                )}
              </strong>
            </GlassCard>
            <GlassCard className="calls-stat">
              <span>Argumentés</span>
              <strong className="xos-numeric">{kpis.argumentes}</strong>
            </GlassCard>
            <GlassCard
              className={[
                "calls-stat",
                "calls-stat--rdv",
                rdvGoal != null && sessionRdvCount >= rdvGoal ? "calls-stat--rdv-goal" : "",
                kpiGoalPulse ? "calls-stat--rdv-goal-hit" : "",
                sessionRdvCount >= 2 ? `calls-stat--rdv-heat-${rdvHeatLevel(sessionRdvCount, false)}` : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span>RDV</span>
              <strong className="xos-numeric">
                {sessionRdvCount}
                {rdvGoal != null ? (
                  <span className="calls-stat__goal">/{rdvGoal}</span>
                ) : null}
              </strong>
              {!isRecallQueue && (
                <RdvGoalPicker
                  label="Objectif"
                  value={rdvGoal}
                  onChange={handleRdvGoalChange}
                  compact
                />
              )}
            </GlassCard>
          </div>
        </>
      )}

      {isRecallQueue && (
        <div className="calls-recall-queue__filters-wrap">
          <div className="calls-recall-queue__filters" role="group" aria-label="Filtrer les rappels par date">
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
          {recallOriginSessions.length > 1 && (
            <div className="calls-recall-queue__filters" role="group" aria-label="Filtrer les rappels par séance">
              <button
                type="button"
                className={`calls-list-filter-chip${recallSessionFilter === "all" ? " calls-list-filter-chip--active" : ""}`}
                aria-pressed={recallSessionFilter === "all"}
                onClick={() => setRecallSessionFilter("all")}
              >
                Toutes les séances
                <span className="xos-numeric">{contacts.length}</span>
              </button>
              {recallOriginSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`calls-list-filter-chip${recallSessionFilter === session.id ? " calls-list-filter-chip--active" : ""}`}
                  aria-pressed={recallSessionFilter === session.id}
                  onClick={() => setRecallSessionFilter(session.id)}
                  title={session.name}
                >
                  {session.name}
                  <span className="xos-numeric">{session.count}</span>
                </button>
              ))}
            </div>
          )}
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
            description="Aucun rappel en attente — dès qu'un appel planifie un rappel, il atterrit ici."
            action={
              <Button variant="secondary" onClick={onBack}>
                Retour au hub
              </Button>
            }
          />
        </GlassCard>
      ) : mode === "list" ? (
        <div className="calls-cockpit-list-wrap">
          {(pendingSelected.length > 0 || recallManageSelected.length > 0) && (
            <GlassCard className="calls-bulk-bar">
              <div className="calls-bulk-bar__head">
                <strong>
                  {(pendingSelected.length || recallManageSelected.length)} contact
                  {(pendingSelected.length || recallManageSelected.length) > 1 ? "s" : ""} sélectionné
                  {(pendingSelected.length || recallManageSelected.length) > 1 ? "s" : ""}
                </strong>
                <span className="calls-muted">
                  {pendingSelected.length > 0
                    ? singleSelectedId
                      ? "Consigner, planifier un RDV, ou reporter"
                      : "Même action pour toute la sélection"
                    : "Reporter ou retirer les rappels sélectionnés"}
                </span>
              </div>
              {pendingSelected.length > 0 && (
                <>
              <div className="calls-fb-control">
                <div className="calls-fb-control__label">
                  <span>Résultat</span>
                </div>
                <ResultButtons
                  value={bulkResultat}
                  onChange={setBulkResultat}
                  disabledValues={singleSelectedId ? [] : ["RDV planifié"]}
                  onPick={() => playComboSound("result-pick", { master: soundsEnabled })}
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
                  Ne pas rappeler (NPA) — définitif
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
                  key={singleSelectedContact.id}
                  contactName={singleSelectedContact.contact_name}
                  loading={loading}
                  onSubmit={handleBulkRdvSubmit}
                  submitLabel="Consigner appel + RDV & suivant"
                  heading={`Détails du RDV — ${singleSelectedContact.contact_name}`}
                  className="calls-event-panel--inline"
                  team={team}
                  sessionType={session.session_type}
                  currentSfUserId={currentSfUserId}
                  accountCustomerType={
                    contextApplies && contextContactId === singleSelectedContact.id
                      ? contactContext?.account_customer_type ?? null
                      : null
                  }
                  defaultOwnerSfUserId={
                    contextApplies && contextContactId === singleSelectedContact.id
                      ? contactContext?.account_owner_sf_user_id ?? null
                      : null
                  }
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
                      title={`Reporter vers « ${continuationLabel} » · D`}
                    >
                      Reporter
                      <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                        D
                      </kbd>
                    </Button>
                  )}
                  {recallManageSelected.length > 0 && (
                    bulkRecallPicker
                      && bulkRecallPicker.ids.length === recallManageSelected.length
                      && bulkRecallPicker.ids.every((id) => recallManageSelected.includes(id)) ? (
                      <DatePicker
                        compact
                        defaultOpen
                        label="Reporter les rappels"
                        triggerLabel={
                          recallManageSelected.length > 1
                            ? `Reporter (${recallManageSelected.length})`
                            : "Reporter"
                        }
                        value={bulkRecallPicker.seed}
                        onChange={(next) => applyRecallDate(bulkRecallPicker.ids, next)}
                        triggerClassName="xos-btn xos-btn--secondary"
                      />
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => openBulkRecallPicker(recallManageSelected)}
                        disabled={loading}
                      >
                        Reporter{recallManageSelected.length > 1 ? ` (${recallManageSelected.length})` : ""}
                      </Button>
                    )
                  )}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      confirmRemove(
                        isRecallQueue ? recallManageSelected : pendingSelected,
                        singleSelectedContact?.contact_name ?? "ces contacts",
                      )
                    }
                    disabled={loading}
                  >
                    {isRecallQueue ? "Retirer des rappels" : "Retirer"}
                  </Button>
                </div>
              )}
                </>
              )}
              {pendingSelected.length === 0 && recallManageSelected.length > 0 && (
                <div className="calls-runner-actions">
                  {bulkRecallPicker
                    && bulkRecallPicker.ids.length === recallManageSelected.length
                    && bulkRecallPicker.ids.every((id) => recallManageSelected.includes(id)) ? (
                    <DatePicker
                      compact
                      defaultOpen
                      label="Reporter les rappels"
                      triggerLabel={
                        recallManageSelected.length > 1
                          ? `Reporter (${recallManageSelected.length})`
                          : "Reporter"
                      }
                      value={bulkRecallPicker.seed}
                      onChange={(next) => applyRecallDate(bulkRecallPicker.ids, next)}
                      triggerClassName="xos-btn xos-btn--secondary"
                    />
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => openBulkRecallPicker(recallManageSelected)}
                      disabled={loading}
                    >
                      Reporter{recallManageSelected.length > 1 ? ` (${recallManageSelected.length})` : ""}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      confirmRemove(
                        recallManageSelected,
                        contacts.find((c) => c.id === recallManageSelected[0])?.contact_name ?? "ces contacts",
                      )
                    }
                    disabled={loading}
                  >
                    Retirer des rappels
                  </Button>
                </div>
              )}
            </GlassCard>
          )}

          {deferIds && !isRecallQueue && (
            <div className="calls-defer-panel" role="region" aria-label="Créer la séance suivante">
              <strong>
                Reporter → {continuationLabel}
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
                  disabled={loading || selectableContacts.length === 0}
                  onClick={toggleSelectAllSelectable}
                >
                  {allSelectableSelected
                    ? "Tout désélectionner"
                    : `Sélectionner (${selectableContacts.length})`}
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
                      disabled={
                        contact.status !== "pending"
                        && !(contact.recall_at && (isRecallQueue || contact.status === "called"))
                      }
                      onChange={() => toggleSelected(contact.id)}
                      aria-label={`Sélectionner ${contact.contact_name}`}
                    />
                  </label>
                  <button type="button" className="calls-cockpit-list__name" onClick={() => openDetail(contact.id)}>
                    <strong title={contact.contact_name}>{contact.contact_name}</strong>
                    {(contact.attempt_count ?? 0) > 0 && (
                      <small className="calls-cockpit-list__attempt">
                        {formatAttemptLabel(contact.attempt_count ?? 0)}
                      </small>
                    )}
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
                  {focusedContact.claim_active && focusedContact.claimed_by_label && (
                    <Tag variant="alert">Pris par {focusedContact.claimed_by_label}</Tag>
                  )}
                  {isRecallQueue && focusedContact.origin_session_name && (
                    <Tag variant="accent">{focusedContact.origin_session_name}</Tag>
                  )}
                  {(focusedContact.attempt_count ?? 0) > 0 && (
                    <Tag variant={isRecallQueue ? "accent" : "muted"}>
                      {formatAttemptLabel(focusedContact.attempt_count ?? 0)}
                    </Tag>
                  )}
                  {focusedContact.status !== "pending" && (
                    <Tag variant={listStatusDisplay(focusedContact).variant}>
                      {listStatusDisplay(focusedContact).label}
                    </Tag>
                  )}
                  {!contextBusy && contextApplies && contactContext?.npa && (
                    <Tag variant="alert">Ne pas rappeler (NPA)</Tag>
                  )}
                </div>
                <h3>{focusedContact.contact_name}</h3>
                <p className="calls-contact-card__role">
                  {[displayTitle, focusedContact.account_name || "Compte inconnu"].filter(Boolean).join(" · ")}
                </p>
                <div
                  className={`calls-contact-card__context-meta${contextBusy ? " calls-contact-card__context-meta--loading" : ""}`}
                >
                {contextApplies && contactContext?.industry && (
                  <p className="calls-contact-card__industry">
                    Secteur · {contactContext.industry}
                  </p>
                )}
                {contextApplies && contactContext?.peer_clients && contactContext.peer_clients.length > 0 && (
                  <div className="calls-contact-card__peers" aria-label="Références clients">
                    <span className="calls-contact-card__peers-label">Refs</span>
                    <ul className="calls-contact-card__peers-list">
                      {contactContext.peer_clients.map((peer) => (
                        <li key={peer.id}>
                          {peer.record_url ? (
                            <a
                              className="calls-contact-card__peer"
                              href={peer.record_url}
                              target="_blank"
                              rel="noreferrer"
                              title={peer.name}
                            >
                              {peer.name}
                            </a>
                          ) : (
                            <span className="calls-contact-card__peer calls-contact-card__peer--static" title={peer.name}>
                              {peer.name}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                </div>
                {(isRecallQueue || focusedContact.status !== "pending") && focusedContact.recall_at && (
                  <div className="calls-contact-card__recall-meta">
                    <span>Rappel</span>
                    <DatePicker
                      compact
                      label="Modifier la date de rappel"
                      value={focusedContact.recall_at}
                      onChange={(next) => {
                        if (next !== focusedContact.recall_at) {
                          onUpdateRecall([focusedContact.id], next);
                        }
                      }}
                      triggerClassName="calls-inline-link"
                    />
                  </div>
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

          <div className="calls-cockpit-side">
            {contextBusy ? (
              <ContextSideSkeleton quiet={!showContextSkeleton} />
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
              <h3>Opportunités du compte</h3>
              {contextApplies && contactContext && contactContext.opportunities.length === 0 && (
                <p className="calls-muted">Aucune opportunité sur ce compte.</p>
              )}
              {contextApplies && contactContext && contactContext.opportunities.length > 0 && (
                <ul className="calls-context-list">
                  {sortedOpportunities.map((opp) => (
                    <li
                      key={opp.id}
                      className={[
                        opp.is_closed ? "calls-context-list__row--closed" : "",
                        opp.linked_to_contact ? "calls-context-list__row--linked" : "",
                      ].filter(Boolean).join(" ") || undefined}
                    >
                      <strong>
                        {opp.name}
                        {opp.linked_to_contact && (
                          <span className="calls-context-list__chip" title="Contact associé à cette opportunité dans Salesforce">
                            Associé
                          </span>
                        )}
                      </strong>
                      <span>{opp.stage_name ?? "—"}</span>
                      {opp.record_url ? <SalesforceRecordLink href={opp.record_url} /> : <span />}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>

            <GlassCard className="calls-context-panel">
              <h3>RDV du compte</h3>
              {contextApplies && contactContext && (contactContext.events?.length ?? 0) === 0 && (
                <p className="calls-muted">Aucun RDV sur ce compte.</p>
              )}
              {contextApplies && contactContext && (contactContext.events?.length ?? 0) > 0 && (
                <ul className="calls-context-list">
                  {sortedEvents.map((event) => (
                    <li
                      key={event.id}
                      className={event.linked_to_contact ? "calls-context-list__row--linked" : undefined}
                    >
                      <strong>
                        {event.subject || "RDV"}
                        {event.linked_to_contact && (
                          <span className="calls-context-list__chip" title="RDV associé à ce contact (WhoId)">
                            Associé
                          </span>
                        )}
                      </strong>
                      <span className="calls-context-list__date xos-numeric">
                        {formatActivityDateFr(event.start_date_time)}
                      </span>
                      {event.record_url ? <SalesforceRecordLink href={event.record_url} /> : <span />}
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
              key={awaitingEvent.id}
              contactName={awaitingEvent.contact_name}
              loading={loading}
              onSubmit={handleFinalizeEvent}
              heading={`Finaliser le RDV — ${awaitingEvent.contact_name}`}
              team={team}
              sessionType={session.session_type}
              currentSfUserId={currentSfUserId}
              accountCustomerType={
                contextApplies && contextContactId === awaitingEvent.id
                  ? contactContext?.account_customer_type ?? null
                  : null
              }
              defaultOwnerSfUserId={
                contextApplies && contextContactId === awaitingEvent.id
                  ? contactContext?.account_owner_sf_user_id ?? null
                  : null
              }
            />
          ) : focusedContact.status === "pending" ? (
            <GlassCard className="calls-log-form">
              <h3>Consigner l&apos;appel</h3>
              <div className="calls-fb-control">
                <div className="calls-fb-control__label">
                  <span>Résultat</span>
                </div>
                <ResultButtons
                  value={resultat}
                  onChange={setResultat}
                  onPick={() => playComboSound("result-pick", { master: soundsEnabled })}
                />
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
                  aria-label="Ne pas rappeler (NPA) — définitif"
                />
                <span aria-hidden="true">Ne pas rappeler (NPA) — définitif</span>
                <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">N</kbd>
              </label>
              {doNotCall && (
                <p className="calls-muted calls-npa-hint">
                  Marque le contact NPA dans Salesforce. Pour seulement ne pas replanifier, décoche le rappel ci-dessus.
                </p>
              )}

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
                  key={focusedContact.id}
                  ref={eventPanelRef}
                  contactName={focusedContact.contact_name}
                  loading={loading}
                  onSubmit={handleRdvSubmit}
                  submitLabel="Consigner appel + RDV & suivant"
                  heading="Détails du RDV"
                  className="calls-event-panel--inline"
                  team={team}
                  sessionType={session.session_type}
                  currentSfUserId={currentSfUserId}
                  showSubmitShortcut
                  accountCustomerType={
                    contextApplies ? contactContext?.account_customer_type ?? null : null
                  }
                  defaultOwnerSfUserId={
                    contextApplies ? contactContext?.account_owner_sf_user_id ?? null : null
                  }
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
                      {loading ? (
                        "Enregistrement…"
                      ) : (
                        <>
                          Consigner & suivant
                          <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                            ⌘↵
                          </kbd>
                        </>
                      )}
                    </Button>
                    {!isRecallQueue && (
                      <Button
                        variant="secondary"
                        onClick={() => openDefer([focusedContact.id])}
                        disabled={loading}
                        title={`Reporter vers « ${continuationLabel} » · D`}
                      >
                        Reporter
                        <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                          D
                        </kbd>
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => confirmRemove([focusedContact.id], focusedContact.contact_name)}
                      disabled={loading}
                      title="⌫"
                    >
                      {isRecallQueue ? "Retirer des rappels" : "Retirer"}
                      <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                        ⌫
                      </kbd>
                    </Button>
                  </div>
                </div>
              )}

              {resultat === "RDV planifié" && !isRecallQueue && (
                <div className="calls-runner-actions">
                  <Button
                    variant="secondary"
                    onClick={() => openDefer([focusedContact.id])}
                    disabled={loading}
                    title={`Reporter vers « ${continuationLabel} » · D`}
                  >
                    Reporter
                    <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                      D
                    </kbd>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => confirmRemove([focusedContact.id], focusedContact.contact_name)}
                    disabled={loading}
                    title="⌫"
                  >
                    Retirer
                    <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                      ⌫
                    </kbd>
                  </Button>
                </div>
              )}

              {deferIds && mode === "detail" && !isRecallQueue && (
                <div className="calls-defer-panel" role="region" aria-label="Créer la séance suivante">
                  <strong>Reporter → {continuationLabel}</strong>
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
              {focusedContact.recall_at && (
                <div className="calls-runner-actions">
                  <Button
                    variant="secondary"
                    onClick={() => confirmRemove([focusedContact.id], focusedContact.contact_name)}
                    disabled={loading}
                  >
                    Retirer le rappel
                  </Button>
                </div>
              )}
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

      <CommandBar
        open={commandBarOpen}
        onClose={() => setCommandBarOpen(false)}
        onRun={runComboAction}
        soundsEnabled={soundsEnabled}
        soundPrefs={soundPrefs}
        onSoundPrefsChange={setSoundPrefs}
      />
      <ShortcutHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onOpenCommandBar={() => setCommandBarOpen(true)}
      />
      <ComboOnboardingDemo open={demoOpen} onClose={() => setDemoOpen(false)} />
      <ConfirmDialog
        open={pendingRemove != null}
        title={pendingRemove?.title ?? ""}
        description={pendingRemove?.description ?? ""}
        confirmLabel={pendingRemove?.confirmLabel ?? "Confirmer"}
        onConfirm={executeRemove}
        onCancel={() => setPendingRemove(null)}
        loading={loading}
        titleId="calls-remove-contact-title"
      />
    </div>
  );
}

export type { LogPayload, DeferPayload };
