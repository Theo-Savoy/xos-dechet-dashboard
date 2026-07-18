import { useId } from "react";
import { RDV_GOAL_PRESETS } from "./rdvCelebrate";
import type { SessionType } from "./types";
import { SESSION_TYPE_OPTIONS } from "./types";

/** @deprecated moved to src/components/ui/DatePicker — import from there in new code. */
export { DatePicker } from "../../components/ui/DatePicker";

/** Sélecteur de type de séance (chips mono-sélection). */
export function SessionTypePicker({
  label = "Type de séance",
  value,
  onChange,
  id,
}: {
  label?: string;
  value: SessionType;
  onChange: (next: SessionType) => void;
  id?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="calls-fb-control" id={fieldId}>
      <div className="calls-fb-control__label">
        <span>{label}</span>
      </div>
      <div className="calls-chip-row" role="radiogroup" aria-label={label}>
        {SESSION_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            className={`calls-chip${value === opt.value ? " calls-chip--active" : ""}`}
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const RDV_GOAL_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "—" },
  ...RDV_GOAL_PRESETS.map((n) => ({ value: n, label: String(n) })),
];

/** Objectif de RDV pour la séance (chips / segment, pas de select natif). */
export function RdvGoalPicker({
  label = "Objectif de RDV",
  value,
  onChange,
  compact = false,
  id,
}: {
  label?: string;
  value: number | null;
  onChange: (next: number | null) => void;
  compact?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  if (compact) {
    return (
      <div className="calls-rdv-goal" id={fieldId}>
        <span className="calls-rdv-goal__label">{label}</span>
        <div className="calls-seg calls-rdv-goal__seg" role="radiogroup" aria-label={label}>
          {RDV_GOAL_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={value === opt.value}
              className={`calls-seg__btn calls-rdv-goal__btn${value === opt.value ? " calls-seg__btn--active" : ""}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="calls-fb-control" id={fieldId}>
      <div className="calls-fb-control__label">
        <span>{label}</span>
      </div>
      <div className="calls-chip-row" role="radiogroup" aria-label={label}>
        {RDV_GOAL_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            role="radio"
            className={`calls-chip${value === opt.value ? " calls-chip--active" : ""}`}
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
/** Chips MEDDIC lite — spec §2.2. Un clic ajoute le tag au commentaire avec une virgule. */
export const NOTE_TEMPLATE_CHIPS: readonly string[] = [
  "Intérêt produit A",
  "Intérêt produit B",
  "Intérêt produit C",
  "Décision ce trimestre",
  "Décision Q+1",
  "Pas de projet",
  "Curieux",
  "Évalue",
  "Compare",
  "Métrique identifiée",
  "Champion identifié",
  "Décideur connu",
];

export function appendNoteChip(value: string, chip: string): string {
  return value ? `${value}, ${chip}` : chip;
}

/** N'apparaît que si le commentaire est vide — pas de wizard, pas de popover. */
export function NoteTemplateChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  if (value.trim().length > 0) return null;
  return (
    <div className="calls-chip-row calls-note-chips" role="group" aria-label="Modèles de note">
      {NOTE_TEMPLATE_CHIPS.map((chip) => (
        <button key={chip} type="button" className="calls-chip" onClick={() => onChange(appendNoteChip(value, chip))}>
          {chip}
        </button>
      ))}
    </div>
  );
}

