import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../auth/useSession";
import { emptyFilterTree, type CallTargetPreset, type ContactLimit, type DedupEntry, type FilterTree } from "../../crm";
import {
  completeSession,
  createFollowUpSession,
  createPreset,
  createSession,
  deletePreset,
  fetchContactList,
  fetchPresets,
  fetchSession,
  fetchSessions,
  fetchStats,
  logCall,
  logEvent,
  skipContact,
  CallsApiError,
} from "./api";
import { NewSessionView } from "./NewSessionView";
import { RecapView } from "./RecapView";
import { RunnerView } from "./RunnerView";
import { SessionsView } from "./SessionsView";
import type {
  CallStats,
  ContactPreview,
  SessionContact,
  SessionDetail,
  SessionSummary,
} from "./types";
import type { ResultatCall } from "../../crm";
import "./calls.css";

type View = "sessions" | "new" | "runner" | "recap";

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
    return `Erreur API (${err.code})`;
  }
  return "Une erreur est survenue.";
}

function findNextPending(contacts: SessionContact[]): SessionContact | null {
  return contacts.find((c) => c.status === "pending") ?? null;
}

export default function CallManagerApp({ params }: CallManagerAppProps) {
  const { session } = useSession();
  const token = session?.access_token ?? "";

  const [view, setView] = useState<View>("sessions");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterTree>(emptyFilterTree());
  const [contactLimit, setContactLimit] = useState<ContactLimit>(200);
  const [preview, setPreview] = useState<ContactPreview[]>([]);
  const [dedup, setDedup] = useState<DedupEntry[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequest = useRef(0);
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

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const [sessionList, statsData] = await Promise.all([
        fetchSessions(token),
        fetchStats(token).catch(() => null),
      ]);
      setSessions(sessionList);
      setStats(statsData);
    } catch (err) {
      setSessionsError(errorMessage(err));
    } finally {
      setSessionsLoading(false);
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
    async (sessionId: number) => {
      if (!token) return;
      setRunnerError(null);
      setAwaitingEvent(null);
      setRunnerLoading(true);
      try {
        const data = await fetchSession(token, sessionId);
        setActiveSession(data.session);
        setContacts(data.contacts);
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

  const handleFiltersChange = (next: FilterTree) => {
    setFilters(next);
    invalidatePreview();
  };

  const handleLoadPreset = (preset: CallTargetPreset) => {
    setFilters(preset.filters);
    invalidatePreview();
  };

  const handlePreview = async () => {
    if (!token) return;
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    setPreviewLoading(true);
    setNewError(null);
    try {
      const data = await fetchContactList(token, filters, { limit: contactLimit });
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

  const handleCreate = async (name: string, contactList: ContactPreview[], scheduledFor: string) => {
    if (!token) return;
    setCreateLoading(true);
    setNewError(null);
    try {
      const data = await createSession(token, name, contactList, scheduledFor);
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

  const handleLogAndNext = async (
    resultat: ResultatCall,
    comments: string,
    durationSec: number | null,
  ) => {
    if (!token || !activeSession) return;
    const current = findNextPending(contacts);
    if (!current) return;

    setRunnerLoading(true);
    setRunnerError(null);
    try {
      const result = await logCall(token, activeSession.id, current.id, resultat, comments, durationSec);
      if (result.needs_event) {
        const refreshed = await fetchSession(token, activeSession.id);
        const updatedCurrent = refreshed.contacts.find((c) => c.id === current.id) ?? current;
        setContacts(refreshed.contacts);
        setAwaitingEvent(updatedCurrent);
      } else {
        await advanceOrComplete(activeSession.id);
      }
    } catch (err) {
      setRunnerError(errorMessage(err));
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
      await advanceOrComplete(activeSession.id);
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setRunnerLoading(false);
    }
  };

  const handleSkip = async () => {
    if (!token || !activeSession) return;
    const current = findNextPending(contacts);
    if (!current) return;

    setRunnerLoading(true);
    setRunnerError(null);
    try {
      await skipContact(token, activeSession.id, current.id);
      await advanceOrComplete(activeSession.id);
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
          loading={sessionsLoading}
          error={sessionsError}
          onRefresh={() => void loadSessions()}
          onNewSession={() => {
            setView("new");
            setFilters(emptyFilterTree());
            setContactLimit(200);
            setPreview([]);
            setDedup([]);
            setNewError(null);
            void loadPresets();
          }}
          onOpenSession={(id) => void openSession(id)}
        />
      )}

      {view === "new" && (
        <NewSessionView
          filters={filters}
          onFiltersChange={handleFiltersChange}
          contactLimit={contactLimit}
          onContactLimitChange={setContactLimit}
          loading={createLoading}
          previewLoading={previewLoading}
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
          onCreate={(name, list, scheduledFor) => void handleCreate(name, list, scheduledFor)}
        />
      )}

      {view === "runner" && activeSession && (
        <RunnerView
          session={activeSession}
          contacts={contacts}
          currentContact={findNextPending(contacts)}
          loading={runnerLoading}
          error={runnerError}
          awaitingEvent={awaitingEvent}
          onBack={goToSessions}
          onLogAndNext={(resultat, comments, durationSec) =>
            void handleLogAndNext(resultat, comments, durationSec)
          }
          onLogEvent={(start, durationMin, invitees) =>
            void handleLogEvent(start, durationMin, invitees)
          }
          onSkip={() => void handleSkip()}
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
