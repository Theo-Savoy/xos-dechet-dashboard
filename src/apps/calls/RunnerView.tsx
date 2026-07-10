import { useEffect, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import type { ResultatCall } from "../../crm";
import { EventPanel } from "./EventPanel";
import { ProgressBar } from "./ProgressBar";
import type { SessionContact, SessionDetail } from "./types";
import { RESULTAT_OPTIONS } from "./types";

type RunnerViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  currentContact: SessionContact | null;
  loading: boolean;
  error: string | null;
  awaitingEvent: SessionContact | null;
  onBack: () => void;
  onLogAndNext: (resultat: ResultatCall, comments: string, durationSec: number | null) => void;
  onLogEvent: (start: string, durationMin: number, invitees: string[]) => void;
  onSkip: () => void;
};

export function RunnerView({
  session,
  contacts,
  currentContact,
  loading,
  error,
  awaitingEvent,
  onBack,
  onLogAndNext,
  onLogEvent,
  onSkip,
}: RunnerViewProps) {
  const [resultat, setResultat] = useState<ResultatCall>(RESULTAT_OPTIONS[0].value);
  const [comments, setComments] = useState("");
  const [duration, setDuration] = useState("");

  useEffect(() => {
    setResultat(RESULTAT_OPTIONS[0].value);
    setComments("");
    setDuration("");
  }, [currentContact?.id]);

  const called = contacts.filter((c) => c.status === "called").length;
  const total = contacts.length;
  const displayedContact = awaitingEvent ?? currentContact;

  return (
    <div className="calls-view calls-view--runner">
      <header className="calls-view__header">
        <div>
          <Tag variant="accent">En cours</Tag>
          <h2>{session.name}</h2>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Quitter
        </Button>
      </header>

      <ProgressBar called={called} total={total} label="Progression de la séance" />

      {error && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">{error}</p>
        </GlassCard>
      )}

      {displayedContact ? (
        <>
          <GlassCard className="calls-contact-card">
            <h3>{displayedContact.contact_name}</h3>
            {displayedContact.title && (
              <p className="calls-contact-card__title">{displayedContact.title}</p>
            )}
            <p className="calls-contact-card__account">
              {displayedContact.account_name ?? "Compte inconnu"}
            </p>
            {displayedContact.linkedin_url && (
              <p>
                <a
                  href={displayedContact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Profil LinkedIn
                </a>
              </p>
            )}
            {displayedContact.phone ? (
              <div className="calls-contact-card__phone">
                <a href={`tel:${displayedContact.phone}`} className="calls-phone-link xos-numeric">
                  {displayedContact.phone}
                </a>
                <Button
                  variant="secondary"
                  onClick={() => window.open(`tel:${displayedContact.phone}`, "_self")}
                >
                  Appeler
                </Button>
              </div>
            ) : (
              <p className="calls-contact-card__no-phone">Aucun numéro</p>
            )}
          </GlassCard>

          {awaitingEvent ? (
            <EventPanel
              contactName={awaitingEvent.contact_name}
              loading={loading}
              onSubmit={onLogEvent}
            />
          ) : (
            <GlassCard className="calls-log-form">
              <h3>Journaliser l&apos;appel</h3>
              <label className="calls-field">
                <span>Résultat</span>
                <select
                  className="calls-select"
                  value={resultat}
                  onChange={(e) => setResultat(e.target.value as ResultatCall)}
                >
                  {RESULTAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="calls-fb-row">
                <label className="calls-field">
                  <span>Durée (secondes)</span>
                  <input
                    type="number"
                    min={0}
                    className="calls-input"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="120"
                  />
                </label>
              </div>
              <label className="calls-field">
                <span>Commentaires</span>
                <textarea
                  className="calls-textarea"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={3}
                  placeholder="Notes sur l'appel…"
                />
              </label>
              <div className="calls-runner-actions">
                <Button
                  onClick={() =>
                    onLogAndNext(resultat, comments, duration ? Number(duration) : null)
                  }
                  disabled={loading}
                >
                  {loading ? "Enregistrement…" : "Logguer & suivant"}
                </Button>
                <Button variant="secondary" onClick={onSkip} disabled={loading}>
                  Passer
                </Button>
              </div>
            </GlassCard>
          )}
        </>
      ) : (
        <GlassCard className="calls-empty">
          <p>Tous les contacts ont été traités.</p>
        </GlassCard>
      )}
    </div>
  );
}
