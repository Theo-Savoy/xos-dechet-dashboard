import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RDV_GOAL_PRESETS } from "./rdvCelebrate";
import type { SessionType } from "./types";
import { SESSION_TYPE_OPTIONS } from "./types";
import { formatIsoDateFr, todayParisIso } from "./formControls.helpers";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function buildMonthCells(year: number, monthIndex: number): (Date | null)[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, monthIndex, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

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

/** Date picker custom (calendrier mois). */
export function DatePicker({
  label = "Date",
  value,
  onChange,
  id,
  compact = false,
  triggerClassName,
  triggerLabel,
  defaultOpen = false,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  id?: string;
  /** Trigger seul, sans label — pour s’aligner dans une rangée de chips. */
  compact?: boolean;
  /** Classes CSS du bouton trigger (ex. même style que les chips rappel). */
  triggerClassName?: string;
  /** Remplace l’affichage de la date sur le trigger (ex. « Reporter »). */
  triggerLabel?: string;
  /** Ouvre le popover au montage (ex. action « Reporter »). */
  defaultOpen?: boolean;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const initial = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
  const [cursor, setCursor] = useState({ year: initial.getFullYear(), month: initial.getMonth() });

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const d = new Date(`${value}T12:00:00`);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }, [value]);

  const cells = useMemo(() => buildMonthCells(cursor.year, cursor.month), [cursor]);
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const today = todayParisIso();
  const triggerClasses = [
    compact ? null : "calls-input",
    "calls-datepicker__trigger",
    compact ? "calls-datepicker__trigger--compact" : null,
    triggerClassName,
  ].filter(Boolean).join(" ");
  const displayed = triggerLabel ?? (value ? formatIsoDateFr(value) : "Choisir une date");

  return (
    <div className={`calls-field calls-datepicker${compact ? " calls-datepicker--compact" : ""}`} ref={rootRef}>
      {!compact && <span id={`${fieldId}-label`}>{label}</span>}
      <button
        type="button"
        id={fieldId}
        className={triggerClasses}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        aria-labelledby={compact ? undefined : `${fieldId}-label`}
        onClick={() => setOpen((v) => !v)}
      >
        {displayed}
      </button>
      {open && (
        <div className="calls-datepicker__popover" role="dialog" aria-label={label}>
          <div className="calls-datepicker__nav">
            <button
              type="button"
              className="calls-datepicker__nav-btn"
              aria-label="Mois précédent"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.year, c.month - 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              ←
            </button>
            <strong className="calls-datepicker__month">{monthLabel}</strong>
            <button
              type="button"
              className="calls-datepicker__nav-btn"
              aria-label="Mois suivant"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.year, c.month + 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              →
            </button>
          </div>
          <div className="calls-datepicker__weekdays" aria-hidden="true">
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
              <span key={`${d}-${i}`}>{d}</span>
            ))}
          </div>
          <div className="calls-datepicker__grid">
            {cells.map((date, index) => {
              if (!date) return <span key={`e-${index}`} className="calls-datepicker__day calls-datepicker__day--empty" />;
              const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
              const selected = iso === value;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    "calls-datepicker__day",
                    selected ? "calls-datepicker__day--selected" : "",
                    isToday ? "calls-datepicker__day--today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="calls-datepicker__footer">
            <button
              type="button"
              className="calls-datepicker__today"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
            >
              Aujourd&apos;hui
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
