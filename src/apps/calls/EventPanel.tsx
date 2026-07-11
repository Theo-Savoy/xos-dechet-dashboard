import { useState } from "react";
import { Button, GlassCard } from "../../components/ui";
import { TagInput } from "./filterControls";

export type EventDraft = {
  start: string;
  durationMin: number;
  invitees: string[];
};

type EventPanelProps = {
  contactName: string;
  loading: boolean;
  onSubmit: (start: string, durationMin: number, invitees: string[]) => void;
  /** When set, used as primary CTA label (e.g. combined call+RDV log). */
  submitLabel?: string;
  heading?: string;
  className?: string;
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
}: EventPanelProps) {
  const [start, setStart] = useState(defaultStart());
  const [durationMin, setDurationMin] = useState(30);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const eventStart = new Date(start);
    if (!start || Number.isNaN(eventStart.getTime()) || eventStart.getTime() <= Date.now()) {
      setError("La date du RDV doit être valide et à venir.");
      return;
    }
    if (!Number.isInteger(durationMin) || durationMin <= 0) {
      setError("La durée doit être un entier supérieur à zéro.");
      return;
    }
    if (invitees.some((invitee) => !/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(invitee))) {
      setError("Chaque ID CRM doit contenir 15 ou 18 caractères alphanumériques.");
      return;
    }
    setError(null);
    onSubmit(eventStart.toISOString(), durationMin, invitees);
  };

  const inline = Boolean(className?.includes("calls-event-panel--inline"));
  const Wrapper = inline ? "div" : GlassCard;
  const wrapperClass = ["calls-event-panel", className].filter(Boolean).join(" ");

  return (
    <Wrapper className={wrapperClass}>
      <h3>{heading ?? `RDV planifié — ${contactName}`}</h3>
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
        <label className="calls-field">
          <span>Durée (min)</span>
          <input
            type="number"
            min={5}
            step={5}
            className="calls-input"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value) || 0)}
          />
        </label>
      </div>
      <TagInput
        label="IDs CRM"
        hint="15 ou 18 caractères"
        value={invitees}
        onChange={setInvitees}
        placeholder="003… (15 ou 18 caractères)"
      />
      {error && <p role="alert" aria-live="assertive" className="calls-error">{error}</p>}
      <Button onClick={handleSubmit} disabled={loading || !start}>
        {loading ? "Enregistrement…" : (submitLabel ?? "Enregistrer le RDV & suivant")}
      </Button>
    </Wrapper>
  );
}
