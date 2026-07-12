import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../auth/useSession";
import { WindowBootScreen } from "../../components/WindowBootScreen";
import { emptyFilterTree, normalizeFilterTree, type CallTargetPreset, type ContactLimit, type DedupEntry, type FilterTree, type MaxPerCompany } from "../../crm";
import {
  completeSession,
  createFollowUpSession,
  createPreset,
  createSession,
  deferContacts,
  deletePreset,
  deleteSession,
  fetchContactContext,
  fetchContactCount,
  fetchContactList,
  fetchPresets,
  fetchTeam,
  fetchRecalls,
  fetchSession,
  fetchSessions,
  fetchStats,
  logCall,
  logEvent,
  removeContact,
  updateRecall,
  updateSession,
  CallsApiError,
} from "./api";
import { addShortcut } from "../../os/shortcuts";
import { pendingContactsAhead, resolveContextContactId } from "./runnerContext";

const CONTEXT_PREFETCH_AHEAD = 5;
const CONTEXT_CACHE_MAX = 24;
import { createDialerLogQueue } from "./dialerLogQueue";
import { NewSessionView } from "./NewSessionView";
import { RecapView } from "./RecapView";
import { RECALL_QUEUE_SESSION, recallsToSessionContacts } from "./recallQueue";
import { RunnerView, type LogPayload } from "./RunnerView";
import { SessionsView } from "./SessionsView";
import type {
  CallStats,
  ContactContext,
  ContactPreview,
  RecallInboxItem,
  SessionContact,
  SessionDetail,
  SessionSummary,
  SessionType,
  TeamMember,
} from "./types";
import "./calls.css";

type View = "sessions" | "new" | "runner" | "recap" | "recalls" | "loading-params";

function findNextPending(contacts: SessionContact[]): SessionContact | null {
  return contacts.find((c) => c.status === "pending") ?? null;
}

type CallManagerAppProps = {
  params?: Record<string, string>;
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
          : "Salesforce a refusé l'enregistrement.";
    }
    return `Erreur API (${err.code})`;
  }
  return "Une erreur est survenue.";
}

export default function CallManagerApp({ params }: CallManagerAppProps) {
  const { session } = useSession();
  const token = session?.access_token ?? "";

  // Si on arrive avec un session_id dans les params (ex. raccourci bureau), on
  // saute la page d'accueil "sessions" et on affiche un loader le temps du
  // fetch. La view bascule ensuite vers runner/recap via openSession().
  const [view, setView] = useState<View>(() =>
    params?.session_id ? "loading-params" : "sessions",
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [recalls, setRecalls] = useState<RecallInboxItem[]>([]);
  const [recallsLoading, setRecallsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterTree>(emptyFilterTree());
  const [contactLimit, setContactLimit] = useState<ContactLimit>(200);
  const [maxPerCompany, setMaxPerCompany] = useState<MaxPerCompany | null>(null);
  const [preview, setPreview] = useState<ContactPreview[]>([]);
  const [dedup, setDedup] = useState<DedupEntry[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [matchCountCapped, setMatchCountCapped] = useState(false);
  const [matchCountLoading, setMatchCountLoading] = useState(false);
  const [matchCountError, setMatchCountError] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const matchCountRequest = useRef(0);
  const [newError, setNewError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const [presets, setPresets] = useState<CallTargetPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const teamRequested = useRef(false);

  const [activeSession, setActiveSession] = useState<SessionDetail | null>(null);
  const [contacts, setContacts] = useState<SessionContact[]>([]);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [awaitingEvent, setAwaitingEvent] = useState<SessionContact | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [contactContext, setContactContext] = useState<ContactContext | null>(null);
  const [contextContactId, setContextContactId] = useState<number | null>(null);
  const [contextTargetContactId, setContextTargetContactId] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
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

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setSessionsLoading(true);
    setRecallsLoading(true);
    setSessionsError(null);
    try {
      const [sessionList, statsData, recallList] = await Promise.all([
        fetchSessions(token),
        fetchStats(token).catch(() => null),
        fetchRecalls(token).catch(() => []),
      ]);
      setSessions(sessionList);
      setStats(statsData);
      setRecalls(recallList);
    } catch (err) {
      setSessionsError(errorMessage(err));
    } finally {
      setSessionsLoading(false);
      setRecallsLoading(false);
    }
  }, [token]);

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
    if (view === "runner" || view === "recalls") {
      void loadTeam();
    }
  }, [view, loadTeam]);

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
        setView(data.session.status === "completed" ? "recap" : "runner");
      } catch (err) {
        setSessionsError(errorMessage(err));
        // Si on était sur le loader de transition params, retombe sur la
        // liste des séances pour que l'utilisateur voie l'erreur.
        setView((current) => (current === "loading-params" ? "sessions" : current));
      } finally {
        setRunnerLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (token) {
      void loadSessions();
    }
  }, [token, loadSessions]);

  useEffect(() => {
    const sessionId = params?.session_id;
    if (sessionId && token) {
      const id = Number(sessionId);
      if (!Number.isNaN(id)) {
        void openSession(id);
      }
    }
  }, [params?.session_id, token, openSession]);

  const invalidatePreview = () => {
    previewRequest.current += 1;
    setPreview([]);
    setDedup([]);
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
      if (data.contacts.length === 0) {
        setNewError("Aucun contact ne correspond aux filtres.");
      }
    } catch (err) {
      if (previewRequest.current !== requestId) return;
      setNewError(errorMessage(err));
      setPreview([]);
      setDedup([]);
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
  ) => {
    if (!token) return;
    setCreateLoading(true);
    setNewError(null);
    try {
      const data = await createSession(token, name, contactList, scheduledFor, sessionType);
      setActiveSession(data.session);
      setContacts(data.contacts);
      setAwaitingEvent(null);
      setView("runner");
    } catch (err) {
      setNewError(errorMessage(err));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleUpdateSession = async (
    sessionId: number,
    patch: { name?: string; scheduled_for?: string | null; session_type?: SessionType },
  ) => {
    if (!token) return;
    try {
      await updateSession(token, sessionId, patch);
      await loadSessions();
    } catch (err) {
      setSessionsError(errorMessage(err));
      throw err;
    }
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!token) return;
    try {
      await deleteSession(token, sessionId);
      await loadSessions();
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
        setContextLoading(true);
      }

      let pending = contextInflightRef.current.get(cacheKey);
      if (!pending) {
        pending = fetchContactContext(token, sessionId, contactId)
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

  useEffect(() => {
    if (view !== "runner" && view !== "recalls") {
      lastContextKey.current = null;
      return;
    }
    if (view === "runner" && !activeSession) return;

    if (view === "recalls") {
      const focused = focusedContactId != null
        ? contacts.find((c) => c.id === focusedContactId)
        : contacts.find((c) => c.status === "pending") ?? null;
      if (!focused?.origin_session_id) {
        lastContextKey.current = null;
        setContactContext(null);
        setContextContactId(null);
        return;
      }
      const contextKey = `${focused.origin_session_id}:${focused.id}`;
      if (lastContextKey.current !== contextKey) {
        lastContextKey.current = contextKey;
        void loadContactContext(focused.origin_session_id, focused.id);
      }
      // Prefetch des rappels suivants dans la file affichée.
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

    if (!activeSession) return;
    const targetId = resolveContextContactId(contacts, awaitingEvent?.id, focusedContactId);
    if (!targetId) {
      lastContextKey.current = null;
      setContactContext(null);
      setContextContactId(null);
      return;
    }
    const contextKey = `${activeSession.id}:${targetId}`;
    if (lastContextKey.current !== contextKey) {
      lastContextKey.current = contextKey;
      void loadContactContext(activeSession.id, targetId);
    }

    // Précharge les N prochains pending dans l’ordre de file (même logique que « Ensuite »).
    const aheadIds = pendingContactsAhead(contacts, targetId, CONTEXT_PREFETCH_AHEAD).map((c) => c.id);
    prefetchContactContexts(activeSession.id, aheadIds);
  }, [
    view,
    activeSession?.id,
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
      setRecalls(list);
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
    setRecalls(list);
    setContacts(recallsToSessionContacts(list));
    return list;
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
      await loadSessions();
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
    setRunnerLoading(true);
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
    const failures = results.filter((result) => result.status === "rejected");
    try {
      if (focusedContactId && contactIds.includes(focusedContactId)) {
        setFocusedContactId(null);
      }
      if (view === "recalls") {
        await refreshRecallsQueue();
      } else if (activeSession) {
        const refreshed = await fetchSession(token, activeSession.id);
        setContacts(refreshed.contacts);
        setActiveSession(refreshed.session);
      }
      if (failures.length) {
        setRunnerError(
          `${results.length - failures.length} retirés, ${failures.length} en échec — liste actualisée`,
        );
      }
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setRunnerLoading(false);
    }
  };

  const handleUpdateRecall = async (contactIds: number[], recallAt: string | null) => {
    if (!token || contactIds.length === 0) return;
    setRunnerLoading(true);
    setRunnerError(null);
    const targets = contactIds
      .map((contactId) => resolveLogTarget(contactId))
      .filter((target): target is { sessionId: number; contactId: number } => target !== null);
    const results = await Promise.allSettled(
      targets.map((target) => updateRecall(token, target.sessionId, target.contactId, recallAt)),
    );
    const failures = results.filter((result) => result.status === "rejected");
    try {
      if (recallAt === null && focusedContactId && contactIds.includes(focusedContactId)) {
        setFocusedContactId(null);
      }
      if (view === "recalls") {
        await refreshRecallsQueue();
      } else if (activeSession) {
        const refreshed = await fetchSession(token, activeSession.id);
        setContacts(refreshed.contacts);
      }
      if (failures.length) {
        setRunnerError(
          `${results.length - failures.length} mis à jour, ${failures.length} en échec — liste actualisée`,
        );
      }
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setRunnerLoading(false);
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

  const handleCreateFollowUp = async () => {
    if (!token || !activeSession) return;
    setFollowUpLoading(true);
    try {
      const data = await createFollowUpSession(token, activeSession.id);
      setActiveSession(data.session);
      setContacts(data.contacts);
      setAwaitingEvent(null);
      setView("runner");
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setFollowUpLoading(false);
    }
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

  const goToSessions = () => {
    setView("sessions");
    setActiveSession(null);
    setContacts([]);
    setPreview([]);
    setDedup([]);
    setNewError(null);
    setAwaitingEvent(null);
    setFocusedContactId(null);
    void loadSessions();
  };

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
      {view === "sessions" && (
        <SessionsView
          sessions={sessions}
          stats={stats}
          recalls={recalls}
          recallsLoading={recallsLoading}
          loading={sessionsLoading}
          error={sessionsError}
          onRefresh={() => void loadSessions()}
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
          onUpdateSession={handleUpdateSession}
          onDeleteSession={handleDeleteSession}
        />
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
          presets={presets}
          presetsLoading={presetsLoading}
          savingPreset={savingPreset}
          currentUserId={session.user.id}
          onBack={goToSessions}
          onPreview={() => void handlePreview()}
          onLoadPreset={handleLoadPreset}
          onSavePreset={(name, shared) => void handleSavePreset(name, shared)}
          onDeletePreset={(id) => void handleDeletePreset(id)}
          onCreate={(name, list, scheduledFor, sessionType) =>
            void handleCreate(name, list, scheduledFor, sessionType)
          }
        />
      )}

      {(view === "runner" || view === "recalls") && activeSession && (
        <RunnerView
          session={activeSession}
          contacts={contacts}
          hubSessions={sessions}
          currentContact={findNextPending(contacts)}
          focusedContactId={focusedContactId}
          variant={view === "recalls" ? "recalls" : "session"}
          loading={runnerLoading || (view === "recalls" && recallsLoading)}
          error={runnerError}
          awaitingEvent={awaitingEvent}
          contactContext={contactContext}
          contextContactId={contextContactId}
          contextTargetContactId={contextTargetContactId}
          contextLoading={contextLoading}
          team={team}
          currentSfUserId={currentSfUserId}
          onBack={goToSessions}
          onPin={handlePin}
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
        />
      )}

      {view === "recap" && activeSession && (
        <RecapView
          session={activeSession}
          contacts={contacts}
          followUpLoading={followUpLoading}
          error={runnerError}
          onBack={goToSessions}
          onCreateFollowUp={() => void handleCreateFollowUp()}
        />
      )}
    </div>
  );
}
