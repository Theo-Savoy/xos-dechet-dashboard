import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SessionType } from "./types";
import { SESSION_TYPE_OPTIONS } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatIsoDateFr(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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

/** Date picker custom (calendrier mois). */
export function DatePicker({
  label = "Date",
  value,
  onChange,
  id,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  id?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
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
  const today = todayIso();

  return (
    <div className="calls-field calls-datepicker" ref={rootRef}>
      <span id={`${fieldId}-label`}>{label}</span>
      <button
        type="button"
        id={fieldId}
        className="calls-input calls-datepicker__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${fieldId}-label`}
        onClick={() => setOpen((v) => !v)}
      >
        {value ? formatIsoDateFr(value) : "Choisir une date"}
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
