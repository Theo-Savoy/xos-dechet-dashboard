import { Button, GlassCard, Tag } from "../../components/ui";
import type { CallStats, SessionSummary } from "./types";
import { ProgressBar } from "./ProgressBar";

type SessionsViewProps = {
  sessions: SessionSummary[];
  stats: CallStats | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNewSession: () => void;
  onOpenSession: (sessionId: number) => void;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionsView({
  sessions,
  stats,
  loading,
  error,
  onRefresh,
  onNewSession,
  onOpenSession,
}: SessionsViewProps) {
  return (
    <div className="calls-view">
      <header className="calls-view__header">
        <div>
          <Tag variant="accent">Prospection</Tag>
          <h2>Séances d&apos;appels</h2>
        </div>
        <div className="calls-view__actions">
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            Actualiser
          </Button>
          <Button onClick={onNewSession}>Nouvelle séance</Button>
        </div>
      </header>

      {stats && (
        <div className="calls-stats">
          <GlassCard className="calls-stat">
            <span>Aujourd&apos;hui</span>
            <strong className="xos-numeric">{stats.calls_today}</strong>
          </GlassCard>
          <GlassCard className="calls-stat">
            <span>Cette semaine</span>
            <strong className="xos-numeric">{stats.calls_week}</strong>
          </GlassCard>
          <GlassCard className="calls-stat">
            <span>Actives</span>
            <strong className="xos-numeric">{stats.sessions_active}</strong>
          </GlassCard>
          <GlassCard className="calls-stat">
            <span>Terminées</span>
            <strong className="xos-numeric">{stats.sessions_completed}</strong>
          </GlassCard>
        </div>
      )}

      {loading && <p className="calls-state">Chargement des séances…</p>}
      {error && (
        <GlassCard className="calls-error">
          <p>{error}</p>
          <Button variant="secondary" onClick={onRefresh}>
            Réessayer
          </Button>
        </GlassCard>
      )}

      {!loading && !error && sessions.length === 0 && (
        <GlassCard className="calls-empty">
          <p>Aucune séance pour le moment.</p>
          <Button onClick={onNewSession}>Créer une première séance</Button>
        </GlassCard>
      )}

      {!loading && !error && sessions.length > 0 && (
        <ul className="calls-session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <GlassCard
                className="calls-session-card"
                role="button"
                tabIndex={0}
                onClick={() => onOpenSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenSession(session.id);
                  }
                }}
              >
                <div className="calls-session-card__top">
                  <strong>{session.name}</strong>
                  <Tag variant={session.status === "active" ? "accent" : "default"}>
                    {session.status === "active" ? "En cours" : "Terminée"}
                  </Tag>
                </div>
                <span className="calls-session-card__date">{formatDate(session.created_at)}</span>
                <ProgressBar called={session.called} total={session.total} />
                {session.skipped > 0 && (
                  <small className="calls-session-card__skipped">
                    {session.skipped} passé{session.skipped > 1 ? "s" : ""}
                  </small>
                )}
              </GlassCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
