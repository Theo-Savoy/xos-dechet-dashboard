import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../auth/useSession";
import { WindowBootScreen } from "../../components/WindowBootScreen";
import { emptyFilterTree, normalizeFilterTree, type CallTargetPreset, type ContactLimit, type DedupEntry, type FilterTree, type MaxPerCompany } from "../../crm";
import { AccountSearchView } from "./AccountSearchView";
import {
  completeSession,
  createFollowUpSession,
  createPreset,
  createSession,
  celebrateGoal,
  claimContact,
  deferContacts,
  deletePreset,
  deleteSession,
  fetchContactContext,
  fetchContactCount,
  fetchContactList,
  fetchCreateAudienceSessions,
  fetchPresets,
  fetchTeam,
  fetchRecalls,
  fetchSession,
  fetchComboHub,
  invalidateComboHubCache,
  logCall,
  logEvent,
  removeContact,
  setSessionMembers,
  updateRecall,
  updateSession,
  CallsApiError,
} from "./api";
import { addShortcut } from "../../os/shortcuts";
import { resolveContextContactId, pendingContactsAhead } from "./runnerContext";
import { PilotageView } from "./PilotageView";
import { supabase } from "../../lib/supabase";
import type { AppRole } from "../../os/registry";
import { createDialerLogQueue } from "./dialerLogQueue";
import { NewSessionView } from "./NewSessionView";
import { RecapView } from "./RecapView";
import { RECALL_QUEUE_SESSION, recallsToSessionContacts } from "./recallQueue";
import { RunnerView } from "./RunnerView";
import type { LogPayload } from "./RunnerView.types";
import { SessionsView } from "./SessionsView";
import { PreSessionFlow } from "./PreSessionFlow";
import { ShareSessionPanel } from "./ShareSessionPanel";
import { shouldShowPreSession, isStaleSession, sessionDayKey } from "./sessionLifecycle";
import { RolloverDecisionView, type RolloverDecision } from "./RolloverDecisionView";
import type { AudienceSessionGroup } from "./api";
import { nextContinuationName } from "./sessionNaming";
import type {
  CallStats,
  ContactContext,
  ContactPreview,
  SessionContact,
  SessionDetail,
  SessionSummary,
  SessionType,
  TeamMember,
} from "./types";
import { todayParisIso } from "./formControls.helpers";
import "./calls.css";

const CONTEXT_PREFETCH_AHEAD = 3;
const CONTEXT_CACHE_MAX = 32;

type View = "sessions" | "new" | "account-search" | "pre-session" | "runner" | "recap" | "recalls" | "pilotage" | "loading-params";

function viewFromParams(view?: string, sessionId?: string): View {
  if (sessionId) return "loading-params";
  switch (view) {
    case "pilotage":
      return "pilotage";
    case "new":
      return "new";
    case "abm":
      return "account-search";
    case "recalls":
      return "recalls";
    case "runner":
    case "recap":
      return sessionId ? "loading-params" : "sessions";
    default:
      return "sessions";
  }
}

function navigationParamsForView(view: View, sessionId?: number | null): Record<string, string> | undefined {
  switch (view) {
    case "pilotage":
      return { view: "pilotage" };
    case "new":
      return { view: "new" };
    case "account-search":
      return { view: "abm" };
    case "recalls":
      return { view: "recalls" };
    case "runner":
    case "pre-session":
      return sessionId ? { view: "runner", session_id: String(sessionId) } : undefined;
    case "recap":
      return sessionId ? { view: "recap", session_id: String(sessionId) } : undefined;
    case "sessions":
    case "loading-params":
    default:
      return undefined;
  }
}

function findNextPending(contacts: SessionContact[], userId?: string): SessionContact | null {
  return contacts.find((c) => {
    if (c.status !== "pending") return false;
    if (c.claim_active && c.claimed_by && userId && c.claimed_by !== userId) return false;
    return true;
  }) ?? null;
}

type CallManagerAppProps = {
  params?: Record<string, string>;
  onParamsChange?: (params?: Record<string, string>) => void;
};

function errorMessage(err: unknown): string {
  if (err instanceof CallsApiError) {
    if (err.status === 401) return "Session expirée — reconnectez-vous.";
    if (err.status === 404) return "Séance introuvable.";
    if (err.status === 409 && err.code === "contact_already_processed") {
      return "Contact déjà traité — liste actualisée.";
    }
    if (err.code === "no_follow_up_contacts") return "Aucun contact ne nécessite de relance.";
    if (err.code === "session_contacts_insert_failed") {
      return "Échec d'enregistrement de la liste d'appels (base de données)";
    }
    if (err.code === "sf_write_error" || err.code === "sf_auth_error" || err.code === "sf_query_error") {
      const hint = err.details?.trim();
      return hint
        ? `Salesforce a refusé l'opération : ${hint.slice(0, 220)}`
        : err.code === "sf_query_error"
          ? "Salesforce a refusé la requête (filtres trop complexes ou champ invalide)."
          : err.code === "sf_auth_error"
            ? "Salesforce a refusé l'authentification — reconnectez-vous via le bandeau en haut à droite."
            : "Salesforce a refusé l'enregistrement.";
    }
    return `Erreur API (${err.code})`;
  }
  return "Une erreur est survenue.";
}

export default function CallManagerApp({ params, onParamsChange }: CallManagerAppProps) {
  const { session, loading, bridgeError } = useSession();
  const token = session?.access_token ?? "";

  // Si on arrive avec un session_id dans les params (ex. raccourci bureau), on
  // saute la page d'accueil "sessions" et on affiche un loader le temps du
  // fetch. La view bascule ensuite vers runner/recap via openSession().
  // params.view=pilotage ouvre le cockpit manager.
  const [view, setView] = useState<View>(() => viewFromParams(params?.view, params?.session_id));
  const [appRole, setAppRole] = useState<AppRole>("commercial");
  const canPilotage = appRole === "manager" || appRole === "admin";
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const sessionsRef = useRef<SessionSummary[]>([]);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [recallCount, setRecallCount] = useState(0);
  const [recallsLoading, setRecallsLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterTree>(emptyFilterTree());
  const [contactLimit, setContactLimit] = useState<ContactLimit>(200);
  const [maxPerCompany, setMaxPerCompany] = useState<MaxPerCompany | null>(null);
  const [preview, setPreview] = useState<ContactPreview[]>([]);
  const [dedup, setDedup] = useState<DedupEntry[]>([]);
  const [excludedCount, setExcludedCount] = useState(0);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [matchCountCapped, setMatchCountCapped] = useState(false);
  const [matchCountLoading, setMatchCountLoading] = useState(false);
  const [matchCountError, setMatchCountError] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const matchCountRequest = useRef(0);
  const [newError, setNewError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [audienceCreating, setAudienceCreating] = useState(false);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [audienceBanner, setAudienceBanner] = useState<{
    sessionId: number;
    createdCount: number;
    excludedCount: number;
  } | null>(null);
  const [shareSessionId, setShareSessionId] = useState<number | null>(null);
  const [shareSaving, setShareSaving] = useState(false);

  const [presets, setPresets] = useState<CallTargetPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const teamRequested = useRef(false);

  const [activeSession, setActiveSession] = useState<SessionDetail | null>(null);
  const [contacts, setContacts] = useState<SessionContact[]>([]);
  const [rollover, setRollover] = useState<{ session: SessionDetail; contacts: SessionContact[] } | null>(null);
  const [rolloverLoading, setRolloverLoading] = useState(false);
  const [rolloverError, setRolloverError] = useState<string | null>(null);
  const rolloverSeen = useRef(new Set<number>());
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [awaitingEvent, setAwaitingEvent] = useState<SessionContact | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [contactContext, setContactContext] = useState<ContactContext | null>(null);
  const [contextContactId, setContextContactId] = useState<number | null>(null);
  const [contextTargetContactId, setContextTargetContactId] = useState<number | null>(null);
  const [, setContextLoading] = useState(false);
  const contextRequest = useRef(0);
  const contextTargetRef = useRef<number | null>(null);
  const lastContextKey = useRef<string | null>(null);
  const [focusedContactId, setFocusedContactId] = useState<number | null>(null);
  const contextCacheRef = useRef<Map<string, ContactContext>>(new Map());
  const contextInflightRef = useRef<Map<string, Promise<ContactContext>>>(new Map());
  const contactsRef = useRef<SessionContact[]>([]);
  const pendingLogsRef = useRef(0);
  const logQueueRef = useRef(
    createDialerLogQueue((pending) => {
      pendingLogsRef.current = pending;
    }),
  );

  const currentSfUserId = team.find((member) => member.user_id === session?.user?.id)?.sf_user_id ?? null;

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingLogsRef.current <= 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    lastContextKey.current = null;
  }, [activeSession?.id]);

  const loadSessions = useCallback(async (opts?: { force?: boolean }) => {
    if (!token) return;
    const hasSessions = sessionsRef.current.length > 0;
    if (!hasSessions) setSessionsLoading(true);
    setSessionsError(null);

    try {
      const hub = await fetchComboHub(token, { force: opts?.force === true });
      sessionsRef.current = hub.sessions;
      setSessions(hub.sessions);
      setStats(hub.stats);
      setRecallCount(hub.recall_count);
      setRecallsLoading(false);
      setSessionsLoading(false);
    } catch (err) {
      setSessionsError(errorMessage(err));
      setSessionsLoading(false);
      setRecallsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const loadPresets = useCallback(async () => {
    if (!token) return;
    setPresetsLoading(true);
    try {
      setPresets(await fetchPresets(token));
    } catch {
      setPresets([]);
    } finally {
      setPresetsLoading(false);
    }
  }, [token]);

  const loadTeam = useCallback(async () => {
    if (!token || teamRequested.current) return;
    teamRequested.current = true;
    try {
      setTeam(await fetchTeam(token));
    } catch {
      setTeam([]);
    }
  }, [token]);

  useEffect(() => {
    if (view === "runner" || view === "recalls" || view === "new" || view === "account-search" || shareSessionId != null) {
      void loadTeam();
    }
  }, [view, loadTeam, shareSessionId]);

  const openSession = useCallback(
    async (sessionId: number, focusContactId?: number) => {
      if (!token) return;
      setRunnerError(null);
      setAwaitingEvent(null);
      setFocusedContactId(focusContactId ?? null);
      setContactContext(null);
      setContextContactId(null);
      setRunnerLoading(true);
      try {
        const data = await fetchSession(token, sessionId);
        setActiveSession(data.session);
        setContacts(data.contacts);
        if (focusContactId != null && data.contacts.some((c) => c.id === focusContactId)) {
          setFocusedContactId(focusContactId);
        }
        const isToday = sessionDayKey(data.session) === todayParisIso();
        if (data.session.status === "completed") {
          setView("recap");
        } else if (shouldShowPreSession(data.session) && isToday) {
          setView("pre-session");
        } else if (data.session.engaged_at === null && !isToday) {
          invalidateComboHubCache();
          await loadSessions({ force: true });
          setView("sessions");
        } else {
          setView("runner");
        }
      } catch (err) {
        setSessionsError(errorMessage(err));
        // Si on était sur le loader de transition params, retombe sur la
        // liste des séances pour que l'utilisateur voie l'erreur.
        setView((current) => (current === "loading-params" ? "sessions" : current));
      } finally {
        setRunnerLoading(false);
      }
    },
    [loadSessions, token],
  );

  useEffect(() => {
    if (token) {
      void loadSessions();
    }
  }, [token, loadSessions]);

  useEffect(() => {
    if (!token || view !== "sessions" || rollover || rolloverLoading) return;
    const stale = sessions.find(
      (candidate) =>
        !rolloverSeen.current.has(candidate.id)
        && isStaleSession(candidate, todayParisIso()),
    );
    if (!stale) return;

    rolloverSeen.current.add(stale.id);
    setRolloverLoading(true);
    setRolloverError(null);
    void (async () => {
      try {
        const data = await fetchSession(token, stale.id);
        let session = data.session;
        if (session.status === "active") {
          await completeSession(token, session.id);
          session = { ...session, status: "completed" };
        }
        const pending = data.contacts.filter((contact) => contact.status === "pending");
        if (pending.length > 0) {
          setRollover({ session, contacts: data.contacts });
        } else {
          invalidateComboHubCache();
          await loadSessions({ force: true });
        }
      } catch (err) {
        setRolloverError(errorMessage(err));
      } finally {
        setRolloverLoading(false);
      }
    })();
  }, [loadSessions, rollover, rolloverLoading, sessions, token, view]);

  useEffect(() => {
    const email = session?.user?.email;
    if (!email) return;
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("role")
      .eq("email", email)
      .maybeSingle()
      .then(({ data }) => {
        const value = data?.role;
        if (!cancelled && (value === "admin" || value === "manager" || value === "commercial")) {
          setAppRole(value);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.email]);

  // Miroir du couple vue/séance affichée, pour que l'effet ci-dessous puisse
  // ignorer le retour de ses propres params sans élargir ses dépendances.
  const displayedSessionRef = useRef<{ view: View; sessionId: number | null }>({
    view: "sessions",
    sessionId: null,
  });
  displayedSessionRef.current = { view, sessionId: activeSession?.id ?? null };

  useEffect(() => {
    const sessionId = params?.session_id;
    if (sessionId && token) {
      const id = Number(sessionId);
      if (Number.isNaN(id)) return;
      const displayed = displayedSessionRef.current;
      if (
        displayed.sessionId === id
        && (displayed.view === "pre-session" || displayed.view === "runner" || displayed.view === "recap")
      ) {
        return;
      }
      void openSession(id);
    }
  }, [params?.session_id, token, openSession]);

  useEffect(() => {
    if (params?.session_id) return;
    const next = viewFromParams(params?.view, params?.session_id);
    if (next !== "loading-params") {
      setView(next);
    }
  }, [params?.view, params?.session_id]);

  const onParamsChangeRef = useRef(onParamsChange);
  onParamsChangeRef.current = onParamsChange;

  useEffect(() => {
    if (view === "loading-params") return;
    onParamsChangeRef.current?.(navigationParamsForView(view, activeSession?.id));
  }, [view, activeSession?.id]);

  const invalidatePreview = () => {
    previewRequest.current += 1;
    setPreview([]);
    setDedup([]);
    setPreviewTruncated(false);
    setPreviewLoading(false);
  };

  useEffect(() => {
    if (!token || view !== "new") return;
    const requestId = matchCountRequest.current + 1;
    matchCountRequest.current = requestId;
    setMatchCountLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await fetchContactCount(token, filters);
          if (matchCountRequest.current !== requestId) return;
          setMatchCount(data.count);
          setMatchCountCapped(data.capped);
          setMatchCountError(null);
        } catch (err) {
          if (matchCountRequest.current !== requestId) return;
          setMatchCount(null);
          setMatchCountCapped(false);
          setMatchCountError(errorMessage(err));
        } finally {
          if (matchCountRequest.current === requestId) setMatchCountLoading(false);
        }
      })();
    }, 450);
    return () => {
      window.clearTimeout(timer);
    };
  }, [token, view, filters]);

  const handleFiltersChange = (next: FilterTree) => {
    setFilters(next);
    invalidatePreview();
  };

  const handleLoadPreset = (preset: CallTargetPreset) => {
    setFilters(normalizeFilterTree(preset.filters));
    invalidatePreview();
  };

  const handleCreateAudience = async (payload: {
    groups: AudienceSessionGroup[];
    targetSize: number;
    maxSessions: number;
    namePrefix?: string;
    excludedCount: number;
    scheduledFor?: string;
    sessionType?: SessionType;
  }) => {
    if (!token) return;
    setAudienceCreating(true);
    setAudienceError(null);
    try {
      const data = await fetchCreateAudienceSessions(token, {
        groups: payload.groups,
        target_size: payload.targetSize,
        max_sessions: payload.maxSessions,
        name_prefix: payload.namePrefix,
        scheduled_for: payload.scheduledFor,
        session_type: payload.sessionType,
      });
      setAudienceBanner({
        sessionId: data.sessions[0].id,
        createdCount: data.sessions.length,
        excludedCount: payload.excludedCount,
      });
      await openSession(data.sessions[0].id);
    } catch (err) {
      setAudienceError(errorMessage(err));
    } finally {
      setAudienceCreating(false);
    }
  };

  const handleContactLimitChange = (limit: ContactLimit) => {
    setContactLimit(limit);
    invalidatePreview();
  };

  const handleMaxPerCompanyChange = (value: MaxPerCompany | null) => {
    setMaxPerCompany(value);
    invalidatePreview();
  };

  const handlePreview = async () => {
    if (!token) return;
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    setPreviewLoading(true);
    setNewError(null);
    try {
      const data = await fetchContactList(token, filters, { limit: contactLimit, maxPerCompany });
      if (previewRequest.current !== requestId) return;
      setPreview(data.contacts);
      setDedup(data.dedup);
      setExcludedCount(data.excluded_count ?? 0);
      setPreviewTruncated(data.truncated);
      if (data.contacts.length === 0) {
        setNewError("Aucun contact ne correspond aux filtres.");
      }
    } catch (err) {
      if (previewRequest.current !== requestId) return;
      setNewError(errorMessage(err));
      setPreview([]);
      setDedup([]);
      setExcludedCount(0);
      setPreviewTruncated(false);
    } finally {
      if (previewRequest.current === requestId) setPreviewLoading(false);
    }
  };

  const handleSavePreset = async (name: string, shared: boolean) => {
    if (!token) return;
    setSavingPreset(true);
    try {
      await createPreset(token, name, filters, shared);
      await loadPresets();
    } catch (err) {
      setNewError(errorMessage(err));
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (id: number) => {
    if (!token) return;
    try {
      await deletePreset(token, id);
      await loadPresets();
    } catch (err) {
      setNewError(errorMessage(err));
    }
  };

  const handleCreate = async (
    name: string,
    contactList: ContactPreview[],
    scheduledFor: string,
    sessionType: SessionType,
    memberUserIds: string[] = [],
  ) => {
    if (!token) return;
    setCreateLoading(true);
    setNewError(null);
    try {
      const data = await createSession(
        token,
        name,
        contactList,
        scheduledFor,
        sessionType,
        memberUserIds,
      );
      setActiveSession(data.session);
      setContacts(data.contacts);
      setAwaitingEvent(null);
      invalidateComboHubCache();
      if (shouldShowPreSession(data.session) && sessionDayKey(data.session) === todayParisIso()) {
        setView("pre-session");
      } else {
        await loadSessions({ force: true });
        setView("sessions");
      }
    } catch (err) {
      setNewError(errorMessage(err));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleLaunchPreSession = async (goal: number) => {
    if (!token || !activeSession) return;
    const updated = await updateSession(token, activeSession.id, {
      rdv_goal: goal,
      engaged_at: activeSession.engaged_at ?? new Date().toISOString(),
    });
    setActiveSession({ ...activeSession, ...updated });
    invalidateComboHubCache();
    setView("runner");
  };

  const handleUpdateSession = async (
    sessionId: number,
    patch: { name?: string; scheduled_for?: string | null; session_type?: SessionType },
  ) => {
    if (!token) return;
    try {
      await updateSession(token, sessionId, patch);
      invalidateComboHubCache();
      await loadSessions({ force: true });
    } catch (err) {
      setSessionsError(errorMessage(err));
      throw err;
    }
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!token) return;
    try {
      await deleteSession(token, sessionId);
      invalidateComboHubCache();
      await loadSessions({ force: true });
    } catch (err) {
      setSessionsError(errorMessage(err));
      throw err;
    }
  };

  const refreshRunner = async (sessionId: number) => {
    const data = await fetchSession(token, sessionId);
    setActiveSession(data.session);
    setContacts(data.contacts);
    return data;
  };

  const advanceOrComplete = async (sessionId: number) => {
    const data = await refreshRunner(sessionId);
    if (!findNextPending(data.contacts)) {
      await completeSession(token, sessionId);
      const finalData = await refreshRunner(sessionId);
      setActiveSession(finalData.session);
      setContacts(finalData.contacts);
      setView("recap");
    }
  };

  const loadContactContext = useCallback(
    async (sessionId: number, contactId: number, options?: { silent?: boolean }) => {
      if (!token) return;
      const cacheKey = `${sessionId}:${contactId}`;
      const cached = contextCacheRef.current.get(cacheKey);

      // Cache hit : affichage immédiat, pas de re-fetch (le prefetch a déjà peuplé).
      if (cached) {
        if (!options?.silent) {
          contextTargetRef.current = contactId;
          setContextTargetContactId(contactId);
          setContactContext(cached);
          setContextContactId(contactId);
          setContextLoading(false);
        }
        return;
      }

      let requestId = contextRequest.current;
      if (!options?.silent) {
        requestId = contextRequest.current + 1;
        contextRequest.current = requestId;
        contextTargetRef.current = contactId;
        setContextTargetContactId(contactId);
        // Only show loading if we don't already have an in-flight prefetch for this contact.
        if (!contextInflightRef.current.has(cacheKey)) {
          setContextLoading(true);
        }
      }

      let pending = contextInflightRef.current.get(cacheKey);
      if (!pending) {
        pending = fetchContactContext(token, sessionId, contactId, {
          lite: Boolean(options?.silent),
        })
          .then((context) => {
            contextCacheRef.current.set(cacheKey, context);
            while (contextCacheRef.current.size > CONTEXT_CACHE_MAX) {
              const first = contextCacheRef.current.keys().next().value;
              if (!first) break;
              contextCacheRef.current.delete(first);
            }
            return context;
          })
          .finally(() => {
            contextInflightRef.current.delete(cacheKey);
          });
        contextInflightRef.current.set(cacheKey, pending);
      }

      try {
        const context = await pending;
        if (options?.silent) {
          if (contextTargetRef.current === contactId) {
            setContactContext(context);
            setContextContactId(contactId);
            setContextLoading(false);
          }
          return;
        }
        if (contextRequest.current !== requestId) return;
        setContactContext(context);
        setContextContactId(contactId);
      } catch {
        if (options?.silent) return;
        if (contextRequest.current !== requestId) return;
        setContactContext(null);
        setContextContactId(null);
      } finally {
        if (!options?.silent && contextRequest.current === requestId) setContextLoading(false);
      }
    },
    [token],
  );

  const prefetchContactContexts = useCallback(
    (sessionId: number, contactIds: number[]) => {
      for (const contactId of contactIds) {
        const key = `${sessionId}:${contactId}`;
        if (contextCacheRef.current.has(key) || contextInflightRef.current.has(key)) continue;
        void loadContactContext(sessionId, contactId, { silent: true });
      }
    },
    [loadContactContext],
  );

  const contextSessionId = activeSession?.id ?? null;

  useEffect(() => {
    if (view !== "runner" && view !== "recalls") {
      lastContextKey.current = null;
      return;
    }
    if (view === "runner" && contextSessionId === null) return;

    if (view === "recalls") {
      const focused = focusedContactId != null
        ? contacts.find((c) => c.id === focusedContactId)
        : contacts.find((c) => c.status === "pending") ?? null;
      if (!focused?.origin_session_id) {
        lastContextKey.current = null;
        setContactContext(null);
        setContextContactId(null);
        setContextTargetContactId(null);
        contextTargetRef.current = null;
        return;
      }
      const contextKey = `${focused.origin_session_id}:${focused.id}`;
      if (lastContextKey.current !== contextKey) {
        lastContextKey.current = contextKey;
        void loadContactContext(focused.origin_session_id, focused.id);
      }
      const focusedIndex = contacts.findIndex((c) => c.id === focused.id);
      const ahead = (focusedIndex >= 0 ? contacts.slice(focusedIndex + 1) : contacts)
        .slice(0, CONTEXT_PREFETCH_AHEAD)
        .filter((c) => c.origin_session_id)
        .map((c) => ({ sessionId: c.origin_session_id as number, contactId: c.id }));
      for (const row of ahead) {
        const key = `${row.sessionId}:${row.contactId}`;
        if (contextCacheRef.current.has(key) || contextInflightRef.current.has(key)) continue;
        void loadContactContext(row.sessionId, row.contactId, { silent: true });
      }
      return;
    }

    if (contextSessionId === null) return;
    const targetId = resolveContextContactId(contacts, awaitingEvent?.id, focusedContactId);

    // Warm the cache as soon as the runner opens: current + next N pending.
    const warmIds = [
      ...(targetId != null ? [targetId] : []),
      ...pendingContactsAhead(contacts, targetId, CONTEXT_PREFETCH_AHEAD).map((c) => c.id),
    ];
    prefetchContactContexts(contextSessionId, [...new Set(warmIds)]);

    if (!targetId) {
      lastContextKey.current = null;
      setContactContext(null);
      setContextContactId(null);
      setContextTargetContactId(null);
      contextTargetRef.current = null;
      return;
    }
    const contextKey = `${contextSessionId}:${targetId}`;
    if (lastContextKey.current !== contextKey) {
      lastContextKey.current = contextKey;
      void loadContactContext(contextSessionId, targetId);
    }
  }, [
    view,
    contextSessionId,
    awaitingEvent?.id,
    focusedContactId,
    contacts,
    loadContactContext,
    prefetchContactContexts,
  ]);

  const openRecalls = useCallback(async () => {
    if (!token) return;
    setRunnerError(null);
    setFocusedContactId(null);
    setAwaitingEvent(null);
    setContactContext(null);
    setContextContactId(null);
    setRecallsLoading(true);
    setActiveSession(RECALL_QUEUE_SESSION);
    setView("recalls");
    try {
      const list = await fetchRecalls(token);
      setRecallCount(list.length);
      setContacts(recallsToSessionContacts(list));
    } catch (err) {
      setRunnerError(errorMessage(err));
      setContacts([]);
    } finally {
      setRecallsLoading(false);
    }
  }, [token]);

  const refreshRecallsQueue = async () => {
    if (!token) return [];
    const list = await fetchRecalls(token);
    setRecallCount(list.length);
    setContacts(recallsToSessionContacts(list));
    return list;
  };

  const removeRefetchTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (removeRefetchTimer.current != null) window.clearTimeout(removeRefetchTimer.current);
    };
  }, []);

  // Un seul refetch de sync même si l'utilisateur retire plusieurs contacts
  // d'affilée, au lieu d'un refetch complet de la séance par remove.
  const scheduleRemoveSync = (viewAtCall: View, sessionId: number | null) => {
    if (removeRefetchTimer.current != null) window.clearTimeout(removeRefetchTimer.current);
    removeRefetchTimer.current = window.setTimeout(() => {
      removeRefetchTimer.current = null;
      void (async () => {
        try {
          if (viewAtCall === "recalls") {
            await refreshRecallsQueue();
          } else if (sessionId != null) {
            const refreshed = await fetchSession(token, sessionId);
            setContacts(refreshed.contacts);
            setActiveSession(refreshed.session);
          }
        } catch (err) {
          setRunnerError(errorMessage(err));
        }
      })();
    }, 500);
  };

  const resolveLogTarget = (contactId: number): { sessionId: number; contactId: number } | null => {
    if (view === "recalls") {
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact?.origin_session_id) return null;
      return { sessionId: contact.origin_session_id, contactId };
    }
    if (!activeSession) return null;
    return { sessionId: activeSession.id, contactId };
  };

  const finishSessionIfDone = async (sessionId: number) => {
    if (!token) return;
    if (contactsRef.current.some((c) => c.status === "pending")) return;
    // Pendant l'exécution d'une tâche, pending >= 1 (la tâche courante).
    if (pendingLogsRef.current > 1) return;
    setRunnerLoading(true);
    try {
      await completeSession(token, sessionId);
      const finalData = await refreshRunner(sessionId);
      setActiveSession(finalData.session);
      setContacts(finalData.contacts);
      setView("recap");
    } finally {
      setRunnerLoading(false);
    }
  };

  const rollbackContact = (contactId: number, snapshot: SessionContact) => {
    setContacts((current) => current.map((c) => (c.id === contactId ? snapshot : c)));
    setFocusedContactId(contactId);
  };

  const handleLogAndNext = (contactId: number, payload: LogPayload) => {
    if (!token) return;
    const target = resolveLogTarget(contactId);
    if (!target) return;

    let snapshot: SessionContact | undefined;
    let remainingPending = false;

    setContacts((current) => {
      snapshot = current.find((c) => c.id === contactId);
      if (!snapshot || snapshot.status !== "pending") return current;
      const optimistic: SessionContact = {
        ...snapshot,
        status: "called",
        outcome: payload.resultat,
        comments: payload.comments || null,
        recall_at: payload.recallAt,
        marked_npa: payload.doNotCall ? true : snapshot.marked_npa,
        called_at: new Date().toISOString(),
      };
      const nextContacts = current.map((c) => (c.id === contactId ? optimistic : c));
      remainingPending = nextContacts.some((c) => c.status === "pending");
      return nextContacts;
    });

    if (!snapshot) return;

    setFocusedContactId(null);
    setRunnerError(null);
    const rollback = snapshot;
    const wasLast = !remainingPending;
    const viewAtEnqueue = view;

    logQueueRef.current.enqueue(async () => {
      try {
        const result = await logCall(token, target.sessionId, target.contactId, payload.resultat, {
          comments: payload.comments,
          recallAt: payload.recallAt,
          doNotCall: payload.doNotCall,
        });
        const syncWarnings = [
          ...(result.recall_failed
            ? ["Appel consigné, mais la création du rappel a échoué dans Salesforce — vérifie la fiche."]
            : []),
          ...(result.npa_failed
            ? ["Appel consigné, mais le marquage NPA a échoué dans Salesforce — vérifie la fiche."]
            : []),
        ];
        if (syncWarnings.length) {
          setRunnerError(syncWarnings.join(" "));
        }

        if (viewAtEnqueue === "recalls") {
          await refreshRecallsQueue();
          return;
        }

        if (result.needs_event) {
          const refreshed = await fetchSession(token, target.sessionId);
          setContacts(refreshed.contacts);
          setAwaitingEvent(refreshed.contacts.find((c) => c.id === contactId) ?? null);
          setFocusedContactId(contactId);
          return;
        }

        if (wasLast) {
          await finishSessionIfDone(target.sessionId);
        }
      } catch (err) {
        if (
          err instanceof CallsApiError
          && err.status === 409
          && err.code === "contact_already_processed"
        ) {
          if (wasLast) await finishSessionIfDone(target.sessionId);
          else if (viewAtEnqueue === "recalls") await refreshRecallsQueue();
          return;
        }
        rollbackContact(contactId, rollback);
        setRunnerError(errorMessage(err));
        if (viewAtEnqueue === "recalls") {
          await refreshRecallsQueue();
        }
      }
    });
  };

  const handleLogRdvAndNext = (
    contactId: number,
    payload: LogPayload,
    event: {
      start: string;
      durationMin: number;
      subject: string;
      ownerSfUserId: string | null;
    },
  ) => {
    if (!token) return;
    const target = resolveLogTarget(contactId);
    if (!target) return;

    let snapshot: SessionContact | undefined;
    let remainingPending = false;

    setContacts((current) => {
      snapshot = current.find((c) => c.id === contactId);
      if (!snapshot || snapshot.status !== "pending") return current;
      const optimistic: SessionContact = {
        ...snapshot,
        status: "called",
        outcome: "RDV planifié",
        comments: payload.comments || null,
        recall_at: null,
        marked_npa: payload.doNotCall ? true : snapshot.marked_npa,
        called_at: new Date().toISOString(),
      };
      const nextContacts = current.map((c) => (c.id === contactId ? optimistic : c));
      remainingPending = nextContacts.some((c) => c.status === "pending");
      return nextContacts;
    });

    if (!snapshot) return;

    setAwaitingEvent(null);
    setFocusedContactId(null);
    setRunnerError(null);
    const rollback = snapshot;
    const wasLast = !remainingPending;
    const viewAtEnqueue = view;

    logQueueRef.current.enqueue(async () => {
      try {
        const result = await logCall(token, target.sessionId, target.contactId, "RDV planifié", {
          comments: payload.comments,
          doNotCall: payload.doNotCall,
        });
        if (result.needs_event) {
          await logEvent(
            token,
            target.sessionId,
            target.contactId,
            event.start,
            event.durationMin,
            [],
            { subject: event.subject, ownerSfUserId: event.ownerSfUserId },
          );
        }
        if (viewAtEnqueue === "recalls") {
          await refreshRecallsQueue();
          return;
        }
        if (wasLast) {
          await finishSessionIfDone(target.sessionId);
        }
      } catch (err) {
        rollbackContact(contactId, rollback);
        setRunnerError(errorMessage(err));
        if (viewAtEnqueue === "recalls") return;
        try {
          const refreshed = await fetchSession(token, target.sessionId);
          setContacts(refreshed.contacts);
          const updated = refreshed.contacts.find((c) => c.id === contactId);
          if (updated?.outcome === "RDV planifié" && !updated.sf_event_id) {
            setAwaitingEvent(updated);
            setFocusedContactId(contactId);
          }
        } catch {
          /* keep rollback UI */
        }
      }
    });
  };

  const handleLogEvent = (
    start: string,
    durationMin: number,
    meta: { subject: string; ownerSfUserId: string | null },
  ) => {
    if (!token || !activeSession || !awaitingEvent) return;
    const sessionId = activeSession.id;
    const contactId = awaitingEvent.id;
    const snapshot = awaitingEvent;

    setAwaitingEvent(null);
    setFocusedContactId(null);
    setRunnerError(null);

    const remainingPending = contactsRef.current.some(
      (c) => c.id !== contactId && c.status === "pending",
    );

    logQueueRef.current.enqueue(async () => {
      try {
        await logEvent(token, sessionId, contactId, start, durationMin, [], {
          subject: meta.subject,
          ownerSfUserId: meta.ownerSfUserId,
        });
        if (!remainingPending) {
          await finishSessionIfDone(sessionId);
        }
      } catch (err) {
        setAwaitingEvent(snapshot);
        setFocusedContactId(contactId);
        setRunnerError(errorMessage(err));
      }
    });
  };

  const handleDeferContacts = async (
    contactIds: number[],
    payload: { scheduledFor: string; targetSessionId: number | null; name?: string | null },
  ) => {
    if (!token || !activeSession || contactIds.length === 0) return;
    setRunnerLoading(true);
    setRunnerError(null);
    try {
      const result = await deferContacts(
        token,
        activeSession.id,
        contactIds,
        payload.scheduledFor,
        payload.targetSessionId,
        payload.name,
      );
      invalidateComboHubCache();
      await loadSessions({ force: true });
      if (result.target_session) {
        setFocusedContactId(null);
        setAwaitingEvent(null);
        if (result.contacts && result.contacts.length > 0) {
          setActiveSession(result.target_session);
          setContacts(result.contacts);
          setView("runner");
        } else {
          await openSession(result.target_session.id);
        }
        return;
      }
      setFocusedContactId(null);
      await advanceOrComplete(activeSession.id);
    } catch (err) {
      setRunnerError(errorMessage(err));
      try {
        const refreshed = await fetchSession(token, activeSession.id);
        setContacts(refreshed.contacts);
      } catch {
        /* keep */
      }
    } finally {
      setRunnerLoading(false);
    }
  };

  const handleRemoveContacts = async (contactIds: number[]) => {
    if (!token || contactIds.length === 0) return;
    // Pas de spinner global ici : l'UI reste réactive pendant les removes,
    // la mise à jour locale (filter ci-dessous) rend l'action instantanée
    // à l'œil. Le spinner était trompeur (l'utilisateur voyait 3 minutes de
    // chargement alors que le state local était déjà synchronisé).
    setRunnerError(null);
    const targets = contactIds
      .map((contactId) => resolveLogTarget(contactId))
      .filter((target): target is { sessionId: number; contactId: number } => target !== null);
    const results = await Promise.allSettled(
      targets.map((target) =>
        view === "recalls"
          ? updateRecall(token, target.sessionId, target.contactId, null)
          : removeContact(token, target.sessionId, target.contactId),
      ),
    );
    const removedIds = targets
      .filter((_, index) => results[index]!.status === "fulfilled")
      .map((target) => target.contactId);
    const failures = results.filter((result) => result.status === "rejected");

    if (focusedContactId && contactIds.includes(focusedContactId)) {
      setFocusedContactId(null);
    }
    if (removedIds.length > 0) {
      setContacts((prev) => prev.filter((c) => !removedIds.includes(c.id)));
    }
    if (failures.length) {
      setRunnerError(
        `${results.length - failures.length} retirés, ${failures.length} en échec — liste actualisée`,
      );
    }
    scheduleRemoveSync(view, activeSession?.id ?? null);
  };

  const handleUpdateRecall = async (contactIds: number[], recallAt: string | null) => {
    if (!token || contactIds.length === 0) return;
    // Pas de spinner global : update local immédiat (filter ci-dessous) puis
    // refetch debounced via refreshRecallsQueue. Le spinner rendait l'UI
    // gelée inutilement.
    setRunnerError(null);
    const targets = contactIds
      .map((contactId) => resolveLogTarget(contactId))
      .filter((target): target is { sessionId: number; contactId: number } => target !== null);
    const results = await Promise.allSettled(
      targets.map((target) => updateRecall(token, target.sessionId, target.contactId, recallAt)),
    );
    const updatedIds = targets
      .filter((_, index) => results[index]!.status === "fulfilled")
      .map((target) => target.contactId);
    const failures = results.filter((result) => result.status === "rejected");
    try {
      if (recallAt === null && focusedContactId && contactIds.includes(focusedContactId)) {
        setFocusedContactId(null);
      }
      // Mise à jour locale immédiate pour ne pas attendre le refetch réseau
      if (updatedIds.length > 0 && recallAt === null) {
        setContacts((prev) => prev.filter((c) => !updatedIds.includes(c.id)));
      }
      if (failures.length) {
        setRunnerError(
          `${results.length - failures.length} mis à jour, ${failures.length} en échec — liste actualisée`,
        );
      }
      // Sync debounced : on laisse le state local optimiste vivre, le refetch
      // corrige les éventuelles divergences après le délai.
      scheduleRemoveSync(view, activeSession?.id ?? null);
    } catch (err) {
      setRunnerError(errorMessage(err));
    }
  };

  const handleLogMany = async (contactIds: number[], payload: LogPayload) => {
    if (!token || contactIds.length === 0) return;
    if (payload.resultat === "RDV planifié") {
      setRunnerError("Sélectionnez un seul contact pour planifier un RDV.");
      return;
    }

    setRunnerLoading(true);
    setRunnerError(null);
    const targets = contactIds
      .map((contactId) => resolveLogTarget(contactId))
      .filter((target): target is { sessionId: number; contactId: number } => target !== null);
    const results: PromiseSettledResult<unknown>[] = [];
    for (let start = 0; start < targets.length; start += 4) {
      results.push(...await Promise.allSettled(targets.slice(start, start + 4).map((target) =>
        logCall(token, target.sessionId, target.contactId, payload.resultat, {
          comments: payload.comments,
          recallAt: payload.recallAt,
          doNotCall: payload.doNotCall,
        }),
      )));
    }
    const failures = results.filter((result) => (
      result.status === "rejected"
      && !(result.reason instanceof CallsApiError
        && result.reason.status === 409
        && result.reason.code === "contact_already_processed")
    ));
    const succeeded = results.length - failures.length;
    try {
      setFocusedContactId(null);
      if (view === "recalls") {
        await refreshRecallsQueue();
      } else if (activeSession) {
        await advanceOrComplete(activeSession.id);
      }
      if (failures.length) {
        setRunnerError(`${succeeded} consignés, ${failures.length} en échec — liste actualisée`);
      }
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setRunnerLoading(false);
    }
  };

  const handleCreateFollowUp = async (name: string, scheduledFor: string) => {
    if (!token || !activeSession) return;
    setFollowUpLoading(true);
    try {
      const data = await createFollowUpSession(token, activeSession.id, { name, scheduledFor });
      setActiveSession(data.session);
      setContacts(data.contacts);
      setAwaitingEvent(null);
      // Every newly created session passes through the same intentional
      // objective/warmup gate, including the #2 follow-up action.
      setView("pre-session");
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setFollowUpLoading(false);
    }
  };

  const handleRolloverApply = async (decisions: RolloverDecision[]) => {
    if (!token || !rollover) return;
    setRolloverLoading(true);
    setRolloverError(null);
    const failures: unknown[] = [];
    try {
      for (const decision of decisions.filter((item) => item.action === "remove")) {
        try {
          await removeContact(token, rollover.session.id, decision.contactId);
        } catch (err) {
          failures.push(err);
        }
      }

      const byDate = new Map<string, number[]>();
      for (const decision of decisions) {
        if (decision.action !== "contact" || !decision.scheduledFor) continue;
        const ids = byDate.get(decision.scheduledFor) ?? [];
        ids.push(decision.contactId);
        byDate.set(decision.scheduledFor, ids);
      }
      for (const [scheduledFor, contactIds] of byDate) {
        const target = sessions.find(
          (candidate) =>
            candidate.id !== rollover.session.id
            && candidate.status === "active"
            && candidate.scheduled_for === scheduledFor,
        );
        try {
          await deferContacts(
            token,
            rollover.session.id,
            contactIds,
            scheduledFor,
            target?.id ?? null,
            target ? null : nextContinuationName(rollover.session.name),
          );
        } catch (err) {
          failures.push(err);
        }
      }

      if (failures.length > 0) {
        const applied = Math.max(0, decisions.length - failures.length);
        setRolloverError(
          applied + " décision" + (applied > 1 ? "s" : "")
          + " appliquée" + (applied > 1 ? "s" : "")
          + ", " + failures.length + " en échec — vérifiez la séance.",
        );
        return;
      }
      setRollover(null);
      invalidateComboHubCache();
      await loadSessions({ force: true });
    } catch (err) {
      setRolloverError(errorMessage(err));
    } finally {
      setRolloverLoading(false);
    }
  };

  useEffect(() => {
    const userId = session?.user?.id;
    if (view !== "runner" || !token || !activeSession || !focusedContactId || !userId) return;
    if (activeSession.id === RECALL_QUEUE_SESSION.id) return;
    const contact = contacts.find((c) => c.id === focusedContactId);
    if (!contact || contact.status !== "pending") return;
    if (contact.claim_active && contact.claimed_by && contact.claimed_by !== userId) return;
    if (contact.claimed_by === userId && contact.claim_active) return;

    let cancelled = false;
    void claimContact(token, activeSession.id, focusedContactId)
      .then((result) => {
        if (cancelled) return;
        setContacts((prev) =>
          prev.map((row) =>
            row.id === focusedContactId
              ? {
                  ...row,
                  claimed_by: result.claimed_by,
                  claimed_at: result.claimed_at,
                  claim_active: true,
                  claimed_by_label: null,
                }
              : row,
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof CallsApiError && err.code === "contact_claimed") {
          void openSession(activeSession.id, focusedContactId);
        }
      });
    return () => {
      cancelled = true;
    };
    // Intentionally omit `contacts` — only claim when focus/session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, token, activeSession?.id, focusedContactId, session?.user?.id]);

  const handleShareSession = async (memberUserIds: string[]) => {
    if (!token || !activeSession || activeSession.id === RECALL_QUEUE_SESSION.id) return;
    const members = await setSessionMembers(token, activeSession.id, memberUserIds);
    setActiveSession((prev) =>
      prev
        ? {
            ...prev,
            members,
            is_owner: prev.is_owner ?? true,
          }
        : prev,
    );
  };

  const handleHubShareSession = async (memberUserIds: string[]) => {
    if (!token || shareSessionId == null) return;
    const members = await setSessionMembers(token, shareSessionId, memberUserIds);
    setSessions((prev) =>
      prev.map((session) =>
        session.id === shareSessionId
          ? {
              ...session,
              members,
              shared: members.length > 0,
              member_count: members.length,
            }
          : session,
      ),
    );
    setShareSessionId(null);
  };

  const shareTargetSession =
    shareSessionId != null ? sessions.find((session) => session.id === shareSessionId) ?? null : null;

  const handleCelebrateGoal = (payload: { goal: number; count: number }) => {
    if (!token || !activeSession || activeSession.id === RECALL_QUEUE_SESSION.id) return;
    void celebrateGoal(token, activeSession.id, payload.goal, payload.count).catch(() => {
      /* fire-and-forget */
    });
  };

  const handlePin = async () => {
    if (!activeSession || activeSession.id === RECALL_QUEUE_SESSION.id) return;
    const dateLabel = activeSession.scheduled_for
      ? new Date(`${activeSession.scheduled_for}T12:00:00`).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
        })
      : "";
    const label = dateLabel ? `${activeSession.name} · ${dateLabel}` : activeSession.name;
    await addShortcut("calls", { session_id: String(activeSession.id) }, label);
  };

  const handlePinPilotage = async () => {
    await addShortcut("calls", { view: "pilotage" }, "Pilotage");
  };

  const goToSessions = () => {
    setView("sessions");
    setRollover(null);
    setActiveSession(null);
    setContacts([]);
    setPreview([]);
    setDedup([]);
    setNewError(null);
    setAwaitingEvent(null);
    setFocusedContactId(null);
    void loadSessions();
  };

  const refreshSessions = () => {
    rolloverSeen.current.clear();
    setRolloverError(null);
    void loadSessions({ force: true });
  };

  if (bridgeError && !session) {
    return (
      <div className="calls-app">
        <p className="calls-state" role="alert">
          Reconnexion requise — vérifiez votre liaison Salesforce.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="calls-app">
        <WindowBootScreen label="Ouverture de Combo…" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="calls-app">
        <p className="calls-state">Connexion requise…</p>
      </div>
    );
  }

  return (
    <div className="calls-app">
      {view === "loading-params" && (
        <WindowBootScreen label="Ouverture de la séance…" />
      )}
      {rollover && view === "sessions" && (
        <RolloverDecisionView
          session={rollover.session}
          contacts={rollover.contacts}
          loading={rolloverLoading}
          error={rolloverError}
          onApply={handleRolloverApply}
          onCancel={goToSessions}
        />
      )}
      {view === "sessions" && !rollover && rolloverError && (
        <p className="calls-state" role="alert">{rolloverError}</p>
      )}
      {view === "sessions" && !rollover && (
        <SessionsView
          sessions={sessions}
          stats={stats}
          recallCount={recallCount}
          recallsLoading={recallsLoading}
          loading={sessionsLoading}
          error={sessionsError}
          canPilotage={canPilotage}
          onRefresh={refreshSessions}
          onNewSession={() => {
            setView("new");
            setFilters(emptyFilterTree());
            setContactLimit(200);
            setMaxPerCompany(null);
            setPreview([]);
            setDedup([]);
            setMatchCount(null);
            setMatchCountCapped(false);
            setMatchCountError(null);
            setNewError(null);
            void loadPresets();
          }}
          onOpenSession={(id, contactId) => void openSession(id, contactId)}
          onOpenRecalls={() => void openRecalls()}
          onOpenPilotage={() => setView("pilotage")}
          onUpdateSession={handleUpdateSession}
          onDeleteSession={handleDeleteSession}
          onShareSession={(id) => setShareSessionId(id)}
        />
      )}

      {view === "pilotage" && (
        <PilotageView onBack={goToSessions} onPin={handlePinPilotage} />
      )}

      {view === "new" && (
        <NewSessionView
          filters={filters}
          onFiltersChange={handleFiltersChange}
          contactLimit={contactLimit}
          onContactLimitChange={handleContactLimitChange}
          maxPerCompany={maxPerCompany}
          onMaxPerCompanyChange={handleMaxPerCompanyChange}
          loading={createLoading}
          previewLoading={previewLoading}
          matchCount={matchCount}
          matchCountCapped={matchCountCapped}
          matchCountLoading={matchCountLoading}
          matchCountError={matchCountError}
          error={newError}
          preview={preview}
          dedup={dedup}
          excludedCount={excludedCount}
          previewTruncated={previewTruncated}
          presets={presets}
          presetsLoading={presetsLoading}
          savingPreset={savingPreset}
          currentUserId={session.user.id}
          team={team}
          onBack={goToSessions}
          onOpenAccountSearch={() => setView("account-search")}
          onPreview={() => void handlePreview()}
          onLoadPreset={handleLoadPreset}
          onSavePreset={(name, shared) => void handleSavePreset(name, shared)}
          onDeletePreset={(id) => void handleDeletePreset(id)}
          onCreate={(name, list, scheduledFor, sessionType, memberUserIds) =>
            void handleCreate(name, list, scheduledFor, sessionType, memberUserIds)
          }
          onCreateAudience={(payload) => void handleCreateAudience(payload)}
        />
      )}

      {view === "account-search" && (
        <AccountSearchView
          token={token}
          team={team}
          onBack={() => setView("new")}
          onCreateAudience={(payload) => void handleCreateAudience(payload)}
          creating={audienceCreating}
          createError={audienceError}
        />
      )}

      {view === "pre-session" && activeSession && (
        <PreSessionFlow
          session={activeSession}
          contacts={contacts}
          loading={runnerLoading}
          onLaunch={handleLaunchPreSession}
          onCancel={goToSessions}
        />
      )}

      {view === "runner" && activeSession && audienceBanner && audienceBanner.sessionId === activeSession.id && (
        <div className="calls-builder-excluded-banner" role="status">
          {audienceBanner.createdCount} séance{audienceBanner.createdCount > 1 ? "s" : ""} créée
          {audienceBanner.createdCount > 1 ? "s" : ""}.
          {audienceBanner.excludedCount > 0
            ? ` ${audienceBanner.excludedCount} contact${audienceBanner.excludedCount > 1 ? "s" : ""} exclu${audienceBanner.excludedCount > 1 ? "s" : ""} car déjà en séance active.`
            : ""}
          <button type="button" className="calls-builder-excluded-banner__dismiss" onClick={() => setAudienceBanner(null)}>
            ✕
          </button>
        </div>
      )}

      {(view === "runner" || view === "recalls" || view === "pre-session") && activeSession && (
        <div className={view === "pre-session" ? "calls-pre-session__underlay" : undefined} aria-hidden={view === "pre-session"}>
          <RunnerView
          session={activeSession}
          contacts={contacts}
          hubSessions={sessions}
          currentContact={findNextPending(contacts, session.user.id)}
          focusedContactId={focusedContactId}
          variant={view === "recalls" ? "recalls" : "session"}
          loading={runnerLoading || (view === "recalls" && recallsLoading)}
          error={runnerError}
          awaitingEvent={awaitingEvent}
          contactContext={contactContext}
          contextContactId={contextContactId}
          contextTargetContactId={contextTargetContactId}
          team={team}
          currentSfUserId={currentSfUserId}
          currentUserId={session.user.id}
          onBack={goToSessions}
          onPin={handlePin}
          onShareSession={
            activeSession.is_owner !== false && view === "runner"
              ? handleShareSession
              : undefined
          }
          onFocusContact={setFocusedContactId}
          onLogAndNext={(contactId, payload) => void handleLogAndNext(contactId, payload)}
          onLogRdvAndNext={(contactId, payload, event) =>
            void handleLogRdvAndNext(contactId, payload, event)
          }
          onLogEvent={(start, durationMin, meta) =>
            void handleLogEvent(start, durationMin, meta)
          }
          onDeferContacts={(ids, payload) => void handleDeferContacts(ids, payload)}
          onRemoveContacts={(ids) => void handleRemoveContacts(ids)}
          onUpdateRecall={(contactIds, recallAt) => void handleUpdateRecall(contactIds, recallAt)}
          onLogMany={(ids, payload) => void handleLogMany(ids, payload)}
          onCelebrateGoal={handleCelebrateGoal}
          />
        </div>
      )}

      {view === "recap" && activeSession && (
        <RecapView
          session={activeSession}
          contacts={contacts}
          followUpLoading={followUpLoading}
          error={runnerError}
          onBack={goToSessions}
          onCreateFollowUp={(name, scheduledFor) => void handleCreateFollowUp(name, scheduledFor)}
        />
      )}

      {shareTargetSession && (
        <ShareSessionPanel
          members={shareTargetSession.members ?? []}
          team={team}
          currentUserId={session.user.id}
          saving={shareSaving}
          onClose={() => setShareSessionId(null)}
          onSave={async (ids) => {
            setShareSaving(true);
            try {
              await handleHubShareSession(ids);
            } finally {
              setShareSaving(false);
            }
          }}
        />
      )}
    </div>
  );
}
