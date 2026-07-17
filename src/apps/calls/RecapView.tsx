import { useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import { DatePicker } from "./formControls";
import { tomorrowParisIso } from "./formControls.helpers";
import { suggestFollowUpSessionName } from "./sessionNaming";
import type { SessionContact, SessionDetail } from "./types";

type RecapViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  followUpLoading: boolean;
  error: string | null;
  onBack: () => void;
  onCreateFollowUp: (name: string, scheduledFor: string) => void;
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

  const [followUpDate, setFollowUpDate] = useState(tomorrowParisIso);
  const [followUpName, setFollowUpName] = useState(() => suggestFollowUpSessionName(session.name, tomorrowParisIso()));

  return (
    <div className="calls-view">
      <header className="calls-view__header calls-view__header--runner">
        <div className="calls-view__nav">
          <Button variant="secondary" className="calls-view__back" onClick={onBack}>
            Retour au hub
          </Button>
          <div className="calls-view__titleblock">
            <Tag variant="alert">Terminée</Tag>
            <h2>{session.name}</h2>
          </div>
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

      {followUpCount > 0 && (
        <GlassCard className="calls-recap-list calls-recap-followup">
          <h3>Préparer la relance</h3>
          <p className="calls-recap-followup__hint">
            {followUpCount} contact{followUpCount > 1 ? "s" : ""} non contacté{followUpCount > 1 ? "s" : ""} basculeront dans la séance 2.
          </p>
          <div className="calls-fb-row">
            <label className="calls-field">
              <span>Nom de la séance 2</span>
              <input
                type="text"
                className="calls-input"
                value={followUpName}
                onChange={(event) => setFollowUpName(event.target.value)}
              />
            </label>
            <DatePicker label="Date de la séance 2" value={followUpDate} onChange={setFollowUpDate} />
          </div>
          <Button
            onClick={() =>
              onCreateFollowUp(
                followUpName.trim() || suggestFollowUpSessionName(session.name, followUpDate),
                followUpDate,
              )
            }
            disabled={followUpLoading}
          >
            {followUpLoading ? "Création…" : "Préparer la relance"}
          </Button>
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
