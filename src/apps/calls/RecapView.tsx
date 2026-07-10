import { Button, GlassCard, Tag } from "../../components/ui";
import type { SessionContact, SessionDetail } from "./types";
import { OUTCOME_OPTIONS } from "./types";

type RecapViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  onBack: () => void;
};

function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "—";
  return OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? outcome;
}

export function RecapView({ session, contacts, onBack }: RecapViewProps) {
  const called = contacts.filter((c) => c.status === "called");
  const skipped = contacts.filter((c) => c.status === "skipped");

  return (
    <div className="calls-view">
      <header className="calls-view__header">
        <div>
          <Tag variant="alert">Terminée</Tag>
          <h2>{session.name}</h2>
        </div>
        <Button onClick={onBack}>Retour aux séances</Button>
      </header>

      <div className="calls-recap-stats">
        <GlassCard className="calls-stat">
          <span>Appels loggés</span>
          <strong className="xos-numeric">{called.length}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>Passés</span>
          <strong className="xos-numeric">{skipped.length}</strong>
        </GlassCard>
        <GlassCard className="calls-stat">
          <span>Total</span>
          <strong className="xos-numeric">{contacts.length}</strong>
        </GlassCard>
      </div>

      {called.length > 0 && (
        <GlassCard className="calls-recap-list">
          <h3>Appels enregistrés</h3>
          <ul>
            {called.map((contact) => (
              <li key={contact.id}>
                <strong>{contact.contact_name}</strong>
                <Tag variant="accent">{outcomeLabel(contact.outcome)}</Tag>
                {contact.comments && <span>{contact.comments}</span>}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </div>
  );
}
