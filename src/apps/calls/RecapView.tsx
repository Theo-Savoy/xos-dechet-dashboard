import { Button, GlassCard, Tag } from "../../components/ui";
import type { SessionContact, SessionDetail } from "./types";

type RecapViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  followUpLoading: boolean;
  error: string | null;
  onBack: () => void;
  onCreateFollowUp: () => void;
};

export function RecapView({
  session,
  contacts,
  followUpLoading,
  error,
  onBack,
  onCreateFollowUp,
}: RecapViewProps) {
  const called = contacts.filter((c) => c.status === "called");
  const skipped = contacts.filter((c) => c.status === "skipped");
  const pending = contacts.filter((c) => c.status === "pending");
  const rdv = called.filter((c) => c.outcome === "RDV planifié");
  const followUpCount =
    called.filter((c) => c.outcome === "Appel non décroché" || c.outcome === "Message répondeur").length +
    skipped.length +
    pending.length;

  return (
    <div className="calls-view">
      <header className="calls-view__header">
        <div>
          <Tag variant="alert">Terminée</Tag>
          <h2>{session.name}</h2>
        </div>
        <div className="calls-view__actions">
          <Button variant="secondary" onClick={onCreateFollowUp} disabled={followUpLoading || followUpCount === 0}>
            {followUpLoading
              ? "Création…"
              : followUpCount
                ? `Créer séance #2 (${followUpCount})`
                : "Aucune relance nécessaire"}
          </Button>
          <Button onClick={onBack}>Retour au hub</Button>
        </div>
      </header>

      <div className="calls-recap-stats">
        <GlassCard className="calls-stat">
          <span>Appels loggés</span>
          <strong className="xos-numeric">{called.length}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>RDV planifiés</span>
          <strong className="xos-numeric">{rdv.length}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>Non contactés</span>
          <strong className="xos-numeric">{skipped.length}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>Restants à faire</span>
          <strong className="xos-numeric">{pending.length}</strong>
        </GlassCard>
      </div>

      {error && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">
            {error}
          </p>
        </GlassCard>
      )}

      {called.length > 0 ? (
        <GlassCard className="calls-recap-list">
          <h3>Appels enregistrés</h3>
          <ul>
            {called.map((contact) => (
              <li key={contact.id}>
                <strong>{contact.contact_name}</strong>
                <Tag
                  variant={
                    contact.outcome === "RDV planifié"
                      ? "success"
                      : contact.outcome === "Appel non décroché" || contact.outcome === "Message répondeur"
                        ? "warning"
                        : "accent"
                  }
                >
                  {contact.outcome ?? "—"}
                </Tag>
                {contact.comments && <span className="calls-recap-list__comment">{contact.comments}</span>}
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : (
        <GlassCard className="calls-empty">
          <p>Aucun appel journalisé sur cette séance.</p>
        </GlassCard>
      )}

      {skipped.length > 0 && (
        <GlassCard className="calls-recap-list">
          <h3>Non contactés — reportés en follow-up</h3>
          <ul>
            {skipped.map((contact) => (
              <li key={contact.id}>
                <strong>{contact.contact_name}</strong>
                <Tag variant="warning">Non contacté</Tag>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      {pending.length > 0 && (
        <GlassCard className="calls-recap-list">
          <h3>Encore à faire dans cette séance</h3>
          <ul>
            {pending.map((contact) => (
              <li key={contact.id}>
                <strong>{contact.contact_name}</strong>
                <Tag variant="muted">À faire</Tag>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </div>
  );
}
