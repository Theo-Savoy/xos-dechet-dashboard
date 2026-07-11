import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../auth/useSession";
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
  fetchRecalls,
  fetchSession,
  fetchSessions,
  fetchStats,
  logCall,
  logEvent,
  updateSession,
  CallsApiError,
} from "./api";
import { resolveContextContactId } from "./runnerContext";
import { NewSessionView } from "./NewSessionView";
import { RecapView } from "./RecapView";
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
} from "./types";
import "./calls.css";

type View = "sessions" | "new" | "runner" | "recap";

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
    if (err.code === "no_follow_up_contacts") return "Aucun contact ne nécessite de relance.";
    if (err.code === "session_contacts_insert_failed") {
      return "Échec d'enregistrement de la liste d'appels (base de données)";
    }
    if (err.code === "sf_write_error" || err.code === "sf_auth_error" || err.code === "sf_query_error") {
      const hint = err.details?.trim();
      return hint
        ? `Salesforce a refusé l'opération : ${hint.slice(0, 220)}`
        : "Salesforce a refusé l'enregistrement.";
    }
    return `Erreur API (${err.code})`;
  }
  return "Une erreur est survenue.";
}

export default function CallManagerApp({ params }: CallManagerAppProps) {
  const { session } = useSession();
  const token = session?.access_token ?? "";

  const [view, setView] = useState<View>("sessions");
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
  const previewRequest = useRef(0);
  const matchCountRequest = useRef(0);
  const [newError, setNewError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const [presets, setPresets] = useState<CallTargetPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);

  const [activeSession, setActiveSession] = useState<SessionDetail | null>(null);
  const [contacts, setContacts] = useState<SessionContact[]>([]);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [awaitingEvent, setAwaitingEvent] = useState<SessionContact | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [contactContext, setContactContext] = useState<ContactContext | null>(null);
  const [contextContactId, setContextContactId] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const contextRequest = useRef(0);
  const [focusedContactId, setFocusedContactId] = useState<number | null>(null);

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
        } catch {
          if (matchCountRequest.current !== requestId) return;
          setMatchCount(null);
          setMatchCountCapped(false);
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
    async (sessionId: number, contactId: number) => {
      if (!token) return;
      const requestId = contextRequest.current + 1;
      contextRequest.current = requestId;
      setContactContext(null);
      setContextContactId(null);
      setContextLoading(true);
      try {
        const context = await fetchContactContext(token, sessionId, contactId);
        if (contextRequest.current !== requestId) return;
        setContactContext(context);
        setContextContactId(contactId);
      } catch {
        if (contextRequest.current !== requestId) return;
        setContactContext(null);
        setContextContactId(null);
      } finally {
        if (contextRequest.current === requestId) setContextLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (view !== "runner" || !activeSession) return;
    const targetId = resolveContextContactId(contacts, awaitingEvent?.id, focusedContactId);
    if (!targetId) {
      setContactContext(null);
      setContextContactId(null);
      return;
    }
    void loadContactContext(activeSession.id, targetId);
  }, [view, activeSession?.id, awaitingEvent?.id, focusedContactId, contacts, loadContactContext]);

  const handleLogAndNext = async (contactId: number, payload: LogPayload) => {
    if (!token || !activeSession) return;

    setRunnerLoading(true);
    setRunnerError(null);
    try {
      const result = await logCall(token, activeSession.id, contactId, payload.resultat, {
        comments: payload.comments,
        recallAt: payload.recallAt,
        doNotCall: payload.doNotCall,
      });
      if (result.needs_event) {
        const refreshed = await fetchSession(token, activeSession.id);
        const updatedCurrent = refreshed.contacts.find((c) => c.id === contactId);
        setContacts(refreshed.contacts);
        setAwaitingEvent(updatedCurrent ?? null);
      } else {
        setFocusedContactId(null);
        await advanceOrComplete(activeSession.id);
      }
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setRunnerLoading(false);
    }
  };

  const handleLogRdvAndNext = async (
    contactId: number,
    payload: LogPayload,
    event: { start: string; durationMin: number; invitees: string[] },
  ) => {
    if (!token || !activeSession) return;

    setRunnerLoading(true);
    setRunnerError(null);
    try {
      const result = await logCall(token, activeSession.id, contactId, "RDV planifié", {
        comments: payload.comments,
        doNotCall: payload.doNotCall,
      });
      if (result.needs_event) {
        await logEvent(
          token,
          activeSession.id,
          contactId,
          event.start,
          event.durationMin,
          event.invitees,
        );
      }
      setAwaitingEvent(null);
      setFocusedContactId(null);
      await advanceOrComplete(activeSession.id);
    } catch (err) {
      setRunnerError(errorMessage(err));
      try {
        const refreshed = await fetchSession(token, activeSession.id);
        setContacts(refreshed.contacts);
        const updated = refreshed.contacts.find((c) => c.id === contactId);
        if (updated?.outcome === "RDV planifié" && !updated.sf_event_id) {
          setAwaitingEvent(updated);
        }
      } catch {
        /* keep current */
      }
    } finally {
      setRunnerLoading(false);
    }
  };

  const handleLogEvent = async (start: string, durationMin: number, invitees: string[]) => {
    if (!token || !activeSession || !awaitingEvent) return;
    setRunnerLoading(true);
    setRunnerError(null);
    try {
      await logEvent(token, activeSession.id, awaitingEvent.id, start, durationMin, invitees);
      setAwaitingEvent(null);
      setFocusedContactId(null);
      await advanceOrComplete(activeSession.id);
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setRunnerLoading(false);
    }
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
      if (result.target_session && payload.name && !payload.targetSessionId) {
        setFocusedContactId(null);
        setAwaitingEvent(null);
        setActiveSession(result.target_session);
        setContacts(result.contacts ?? []);
        setView("runner");
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

  const handleLogMany = async (contactIds: number[], payload: LogPayload) => {
    if (!token || !activeSession || contactIds.length === 0) return;
    if (payload.resultat === "RDV planifié") {
      setRunnerError("Sélectionnez un seul contact pour planifier un RDV.");
      return;
    }

    setRunnerLoading(true);
    setRunnerError(null);
    try {
      for (const contactId of contactIds) {
        await logCall(token, activeSession.id, contactId, payload.resultat, {
          comments: payload.comments,
          recallAt: payload.recallAt,
          doNotCall: payload.doNotCall,
        });
      }
      await advanceOrComplete(activeSession.id);
      setFocusedContactId(null);
    } catch (err) {
      setRunnerError(errorMessage(err));
      try {
        const refreshed = await fetchSession(token, activeSession.id);
        setContacts(refreshed.contacts);
      } catch {
        /* keep current list */
      }
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

  const goToSessions = () => {
    setView("sessions");
    setActiveSession(null);
    setContacts([]);
    setPreview([]);
    setDedup([]);
    setNewError(null);
    setAwaitingEvent(null);
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
            setNewError(null);
            void loadPresets();
          }}
          onOpenSession={(id, contactId) => void openSession(id, contactId)}
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

      {view === "runner" && activeSession && (
        <RunnerView
          session={activeSession}
          contacts={contacts}
          hubSessions={sessions}
          currentContact={findNextPending(contacts)}
          loading={runnerLoading}
          error={runnerError}
          awaitingEvent={awaitingEvent}
          contactContext={contactContext}
          contextContactId={contextContactId}
          contextLoading={contextLoading}
          onBack={goToSessions}
          onFocusContact={setFocusedContactId}
          onLogAndNext={(contactId, payload) => void handleLogAndNext(contactId, payload)}
          onLogRdvAndNext={(contactId, payload, event) =>
            void handleLogRdvAndNext(contactId, payload, event)
          }
          onLogEvent={(start, durationMin, invitees) =>
            void handleLogEvent(start, durationMin, invitees)
          }
          onDeferContacts={(ids, payload) => void handleDeferContacts(ids, payload)}
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
