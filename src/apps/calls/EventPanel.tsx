import { useEffect, useMemo, useState } from "react";
import { Button, GlassCard } from "../../components/ui";
import { isRdvAssigneeCandidate, isSdrCaller } from "./callerTracking";
import {
  defaultRdvSubjectId,
  RDV_DURATION_DEFAULT,
  RDV_DURATION_PRESETS,
  rdvSubjectById,
  rdvSubjectsForSession,
  type RdvSubjectId,
} from "./rdvSubjects";
import type { SessionType, TeamMember } from "./types";

export type EventDraft = {
  start: string;
  durationMin: number;
  subject: string;
  ownerSfUserId: string | null;
};

type EventPanelProps = {
  contactName: string;
  loading: boolean;
  onSubmit: (
    start: string,
    durationMin: number,
    meta: { subject: string; ownerSfUserId: string | null },
  ) => void;
  /** When set, used as primary CTA label (e.g. combined call+RDV log). */
  submitLabel?: string;
  heading?: string;
  className?: string;
  team?: TeamMember[];
  sessionType?: SessionType | string | null;
  /** SF user id of the current caller (for “moi” vs attribution SDR). */
  currentSfUserId?: string | null;
};

function defaultStart(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventPanel({
  contactName,
  loading,
  onSubmit,
  submitLabel,
  heading,
  className,
  team = [],
  sessionType = "prospection",
  currentSfUserId = null,
}: EventPanelProps) {
  const subjects = useMemo(() => rdvSubjectsForSession(sessionType), [sessionType]);
  const sdr = isSdrCaller(currentSfUserId);
  const assignees = useMemo(() => {
    const others = team.filter((member) => member.sf_user_id && member.sf_user_id !== currentSfUserId);
    if (!sdr) return others;
    return others.filter((member) => isRdvAssigneeCandidate(member.sf_user_id));
  }, [team, currentSfUserId, sdr]);

  const [subjectId, setSubjectId] = useState<RdvSubjectId>(() => defaultRdvSubjectId(sessionType));
  const [start, setStart] = useState(defaultStart());
  const [durationMin, setDurationMin] = useState(RDV_DURATION_DEFAULT);
  const [ownerSfUserId, setOwnerSfUserId] = useState<string>(() => (
    sdr ? (assignees[0]?.sf_user_id ?? "") : ""
  ));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubjectId(defaultRdvSubjectId(sessionType));
  }, [sessionType]);

  useEffect(() => {
    if (!sdr) {
      setOwnerSfUserId("");
      return;
    }
    setOwnerSfUserId((current) => {
      if (current && assignees.some((member) => member.sf_user_id === current)) return current;
      return assignees[0]?.sf_user_id ?? "";
    });
  }, [sdr, assignees]);

  const handleSubmit = () => {
    const eventStart = new Date(start);
    if (!start || Number.isNaN(eventStart.getTime()) || eventStart.getTime() <= Date.now()) {
      setError("La date du RDV doit être valide et à venir.");
      return;
    }
    if (!RDV_DURATION_PRESETS.includes(durationMin as (typeof RDV_DURATION_PRESETS)[number])) {
      setError("Choisissez une durée parmi les presets.");
      return;
    }
    const subject = rdvSubjectById(subjectId);
    if (!subjects.some((s) => s.id === subjectId)) {
      setError("Choisissez un type de RDV valide pour cette séance.");
      return;
    }
    if (sdr) {
      if (!ownerSfUserId || !assignees.some((member) => member.sf_user_id === ownerSfUserId)) {
        setError("Choisissez le commercial à qui attribuer le RDV.");
        return;
      }
    } else if (ownerSfUserId && !assignees.some((member) => member.sf_user_id === ownerSfUserId)) {
      setError("Le commercial attribué doit faire partie de l’équipe.");
      return;
    }
    setError(null);
    onSubmit(eventStart.toISOString(), durationMin, {
      subject: subject.apiName,
      ownerSfUserId: ownerSfUserId || null,
    });
  };

  const inline = Boolean(className?.includes("calls-event-panel--inline"));
  const Wrapper = inline ? "div" : GlassCard;
  const wrapperClass = ["calls-event-panel", className].filter(Boolean).join(" ");
  const submitText = submitLabel ?? "Enregistrer le RDV & suivant";
  const startTime = start ? new Date(start).getTime() : Number.NaN;
  const hasValidStart = Number.isFinite(startTime) && startTime > Date.now();
  const ownerReady = !sdr || Boolean(ownerSfUserId);
  const canSubmit = hasValidStart && ownerReady;
  const disabledTitle = !start
    ? "Renseignez la date et l’heure du RDV"
    : !hasValidStart
      ? "Choisissez une date et une heure à venir"
      : sdr && !ownerSfUserId
        ? "Attribuez le RDV à un commercial"
        : undefined;
  const selectedSubject = rdvSubjectById(subjectId);

  return (
    <Wrapper className={wrapperClass}>
      <h3>{heading ?? `RDV planifié — ${contactName}`}</h3>

      <div className="calls-fb-control" role="group" aria-label="Type de RDV">
        <div className="calls-fb-control__label">Type de RDV</div>
        <div className="calls-rdv-subjects">
          {subjects.map((subject) => (
            <button
              key={subject.id}
              type="button"
              className={`calls-rdv-subjects__btn${subjectId === subject.id ? " calls-rdv-subjects__btn--active" : ""}`}
              aria-pressed={subjectId === subject.id}
              onClick={() => setSubjectId(subject.id)}
            >
              <span>{subject.label}</span>
              {subject.countsForLundi && (
                <span className="calls-rdv-subjects__badge" title="Compte pour le KPI Lundi">
                  Lundi
                </span>
              )}
            </button>
          ))}
        </div>
        {selectedSubject.countsForLundi ? (
          <p className="calls-muted calls-rdv-subjects__hint">Compte dans le bilan Lundi.</p>
        ) : (
          <p className="calls-muted calls-rdv-subjects__hint">Hors KPI Lundi (suivi / soutenance).</p>
        )}
      </div>

      <div className="calls-fb-row">
        <label className="calls-field">
          <span>Date &amp; heure</span>
          <input
            type="datetime-local"
            className="calls-input"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
      </div>

      <div className="calls-fb-control" role="group" aria-label="Durée du RDV">
        <div className="calls-fb-control__label">Durée</div>
        <div className="calls-rdv-durations">
          {RDV_DURATION_PRESETS.map((mins) => (
            <button
              key={mins}
              type="button"
              className={`calls-rdv-durations__btn${durationMin === mins ? " calls-rdv-durations__btn--active" : ""}`}
              aria-pressed={durationMin === mins}
              onClick={() => setDurationMin(mins)}
            >
              {mins}&nbsp;min
            </button>
          ))}
        </div>
      </div>

      <div className="calls-fb-control">
        <div className="calls-fb-control__label">
          {sdr ? "Attribuer le RDV à" : "Propriétaire du RDV"}
        </div>
        <select
          className="calls-input"
          aria-label="Commercial propriétaire du RDV"
          value={ownerSfUserId}
          onChange={(e) => setOwnerSfUserId(e.target.value)}
        >
          {!sdr && <option value="">Moi</option>}
          {sdr && assignees.length === 0 && (
            <option value="" disabled>
              Aucun commercial disponible
            </option>
          )}
          {assignees.map((member) => (
            <option key={member.user_id} value={member.sf_user_id}>
              {member.label}
            </option>
          ))}
        </select>
        {sdr && (
          <p className="calls-muted calls-rdv-subjects__hint">
            Profil SDR : le RDV est créé par toi, attribué à un commercial.
          </p>
        )}
        {sdr && assignees.length === 0 && (
          <p className="calls-muted calls-rdv-subjects__hint">
            Aucun commercial assignable (Paul / Christophe) dans le mapping.
          </p>
        )}
      </div>

      {error && <p role="alert" aria-live="assertive" className="calls-error">{error}</p>}
      <Button
        onClick={handleSubmit}
        disabled={loading || !canSubmit}
        aria-disabled={loading || !canSubmit}
        title={disabledTitle}
      >
        {loading ? "Enregistrement…" : submitText}
      </Button>
    </Wrapper>
  );
}
