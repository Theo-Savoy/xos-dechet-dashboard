import { useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import { DatePicker } from "./formControls";
import { formatIsoDateFr, tomorrowParisIso } from "./formControls.helpers";
import { suggestFollowUpSessionName } from "./sessionNaming";
import type { SessionContact, SessionDetail } from "./types";

export type WeeklyCallStats = { callsThisWeek: number; isNewRecord: boolean };

type RecapViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  followUpLoading: boolean;
  error: string | null;
  /** Comparaison hebdo (record vs médiane 4 dernières) — absente si non calculée, alors le nudge reste silencieux. */
  weeklyCallStats?: WeeklyCallStats;
  onBack: () => void;
  onCreateFollowUp: (name: string, scheduledFor: string) => void;
};

function computePaceNudge(session: SessionDetail, called: SessionContact[]): { text: string; rateLabel: string } | null {
  const start = session.engaged_at ?? session.created_at;
  const endTimestamps = called.map((c) => c.called_at).filter((v): v is string => Boolean(v));
  if (!start || endTimestamps.length === 0) return null;
  const startMs = new Date(start).getTime();
  const endMs = Math.max(...endTimestamps.map((t) => new Date(t).getTime()));
  const durationMin = Math.max((endMs - startMs) / 60000, 1);
  const rate = called.length / durationMin;
  const avgMin = Math.max(1, Math.round(durationMin / called.length));
  const rateLabel = rate.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return { text: `${rateLabel} appels/min · ${avgMin} min/appel en moyenne`, rateLabel };
}

function computeRecordNudge(weeklyCallStats: WeeklyCallStats | undefined, rateLabel: string | null): string | null {
  if (!weeklyCallStats) return null;
  if (weeklyCallStats.isNewRecord) {
    return `Nouveau record hebdo : ${weeklyCallStats.callsThisWeek} appels cette semaine`;
  }
  if (!rateLabel) return null;
  return `Tu es dans ta moyenne, ${rateLabel} appels/min`;
}

function computeFollowUpNudge(followUpCount: number, followUpDate: string): string | null {
  if (followUpCount <= 0) return null;
  return `${followUpCount} contact${followUpCount > 1 ? "s" : ""} non contacté${followUpCount > 1 ? "s" : ""} — créer la séance de relance du ${formatIsoDateFr(followUpDate)} ?`;
}

function computeAbandonedNudge(session: SessionDetail, pendingCount: number): string | null {
  if (session.status !== "completed" || pendingCount <= 0) return null;
  return `Séance clôturée sans être terminée — ${pendingCount} contact${pendingCount > 1 ? "s" : ""} à trancher`;
}

export function RecapView({
  session,
  contacts,
  followUpLoading,
  error,
  weeklyCallStats,
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

  const pace = computePaceNudge(session, called);
  const nudges = [
    pace?.text ?? null,
    computeRecordNudge(weeklyCallStats, pace?.rateLabel ?? null),
    computeFollowUpNudge(followUpCount, followUpDate),
    computeAbandonedNudge(session, pending.length),
  ].filter((text): text is string => Boolean(text));

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

      {nudges.length > 0 && (
        <GlassCard className="calls-recap-nudges">
          <ul>
            {nudges.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </GlassCard>
      )}

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
