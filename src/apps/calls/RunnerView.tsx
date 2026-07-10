import { useEffect, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import type { CallOutcome, SessionContact, SessionDetail } from "./types";
import { OUTCOME_OPTIONS } from "./types";
import { ProgressBar } from "./ProgressBar";

type RunnerViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  currentContact: SessionContact | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onLogAndNext: (outcome: CallOutcome, comments: string) => void;
  onSkip: () => void;
};

export function RunnerView({
  session,
  contacts,
  currentContact,
  loading,
  error,
  onBack,
  onLogAndNext,
  onSkip,
}: RunnerViewProps) {
  const [outcome, setOutcome] = useState<CallOutcome>("answered");
  const [comments, setComments] = useState("");

  useEffect(() => {
    setOutcome("answered");
    setComments("");
  }, [currentContact?.id]);

  const called = contacts.filter((c) => c.status === "called").length;
  const total = contacts.length;

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
          <p>{error}</p>
        </GlassCard>
      )}

      {currentContact ? (
        <>
          <GlassCard className="calls-contact-card">
            <h3>{currentContact.contact_name}</h3>
            <p className="calls-contact-card__account">
              {currentContact.account_name ?? "Compte inconnu"}
            </p>
            {currentContact.phone ? (
              <div className="calls-contact-card__phone">
                <a href={`tel:${currentContact.phone}`} className="calls-phone-link xos-numeric">
                  {currentContact.phone}
                </a>
                <Button
                  variant="secondary"
                  onClick={() => window.open(`tel:${currentContact.phone}`, "_self")}
                >
                  Appeler
                </Button>
              </div>
            ) : (
              <p className="calls-contact-card__no-phone">Aucun numéro</p>
            )}
          </GlassCard>

          <GlassCard className="calls-log-form">
            <h3>Journaliser l&apos;appel</h3>
            <label className="calls-field">
              <span>Résultat</span>
              <select
                className="calls-select"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as CallOutcome)}
              >
                {OUTCOME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
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
                onClick={() => onLogAndNext(outcome, comments)}
                disabled={loading}
              >
                {loading ? "Enregistrement…" : "Logguer & suivant"}
              </Button>
              <Button variant="secondary" onClick={onSkip} disabled={loading}>
                Passer
              </Button>
            </div>
          </GlassCard>
        </>
      ) : (
        <GlassCard className="calls-empty">
          <p>Tous les contacts ont été traités.</p>
        </GlassCard>
      )}
    </div>
  );
}
