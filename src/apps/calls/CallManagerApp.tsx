import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../auth/useSession";
import {
  completeSession,
  createSession,
  fetchContactList,
  fetchSession,
  fetchSessions,
  fetchStats,
  logCall,
  skipContact,
  CallsApiError,
} from "./api";
import { NewSessionView } from "./NewSessionView";
import { RecapView } from "./RecapView";
import { RunnerView } from "./RunnerView";
import { SessionsView } from "./SessionsView";
import type {
  CallOutcome,
  CallStats,
  ContactPreview,
  SessionContact,
  SessionDetail,
  SessionSummary,
} from "./types";
import "./calls.css";

type View = "sessions" | "new" | "runner" | "recap";

type CallManagerAppProps = {
  params?: Record<string, string>;
};

function errorMessage(err: unknown): string {
  if (err instanceof CallsApiError) {
    if (err.status === 401) return "Session expirée — reconnectez-vous.";
    if (err.status === 404) return "Séance introuvable.";
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

  const [preview, setPreview] = useState<ContactPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const [activeSession, setActiveSession] = useState<SessionDetail | null>(null);
  const [contacts, setContacts] = useState<SessionContact[]>([]);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [runnerError, setRunnerError] = useState<string | null>(null);

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

  const openSession = useCallback(
    async (sessionId: number) => {
      if (!token) return;
      setRunnerError(null);
      setRunnerLoading(true);
      try {
        const data = await fetchSession(token, sessionId);
        setActiveSession(data.session);
        setContacts(data.contacts);
        if (data.session.status === "completed") {
          setView("recap");
        } else {
          setView("runner");
        }
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

  const handlePreview = async (filters: {
    ownerOnly: boolean;
    hasPhone: boolean;
    accountId: string;
  }) => {
    if (!token) return;
    setPreviewLoading(true);
    setNewError(null);
    try {
      const list = await fetchContactList(token, {
        ownerOnly: filters.ownerOnly,
        hasPhone: filters.hasPhone,
        accountId: filters.accountId || undefined,
        limit: 50,
      });
      setPreview(list);
      if (list.length === 0) {
        setNewError("Aucun contact ne correspond aux filtres.");
      }
    } catch (err) {
      setNewError(errorMessage(err));
      setPreview([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCreate = async (name: string, contactList: ContactPreview[]) => {
    if (!token) return;
    setCreateLoading(true);
    setNewError(null);
    try {
      const data = await createSession(token, name, contactList);
      setActiveSession(data.session);
      setContacts(data.contacts);
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

  const handleLogAndNext = async (outcome: CallOutcome, comments: string) => {
    if (!token || !activeSession) return;
    const current = findNextPending(contacts);
    if (!current) return;

    setRunnerLoading(true);
    setRunnerError(null);
    try {
      await logCall(token, activeSession.id, current.id, outcome, comments);
      const data = await refreshRunner(activeSession.id);
      const next = findNextPending(data.contacts);
      if (!next) {
        await completeSession(token, activeSession.id);
        const finalData = await refreshRunner(activeSession.id);
        setActiveSession(finalData.session);
        setContacts(finalData.contacts);
        setView("recap");
      }
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
      const data = await refreshRunner(activeSession.id);
      const next = findNextPending(data.contacts);
      if (!next) {
        await completeSession(token, activeSession.id);
        const finalData = await refreshRunner(activeSession.id);
        setActiveSession(finalData.session);
        setContacts(finalData.contacts);
        setView("recap");
      }
    } catch (err) {
      setRunnerError(errorMessage(err));
    } finally {
      setRunnerLoading(false);
    }
  };

  const goToSessions = () => {
    setView("sessions");
    setActiveSession(null);
    setContacts([]);
    setPreview([]);
    setNewError(null);
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
            setPreview([]);
            setNewError(null);
          }}
          onOpenSession={(id) => void openSession(id)}
        />
      )}

      {view === "new" && (
        <NewSessionView
          loading={createLoading}
          previewLoading={previewLoading}
          error={newError}
          preview={preview}
          onBack={goToSessions}
          onPreview={(filters) => void handlePreview(filters)}
          onCreate={(name, list) => void handleCreate(name, list)}
        />
      )}

      {view === "runner" && activeSession && (
        <RunnerView
          session={activeSession}
          contacts={contacts}
          currentContact={findNextPending(contacts)}
          loading={runnerLoading}
          error={runnerError}
          onBack={goToSessions}
          onLogAndNext={(outcome, comments) => void handleLogAndNext(outcome, comments)}
          onSkip={() => void handleSkip()}
        />
      )}

      {view === "recap" && activeSession && (
        <RecapView session={activeSession} contacts={contacts} onBack={goToSessions} />
      )}
    </div>
  );
}
