import { useMemo, useState } from "react";
import type { CockpitHeatmapDay } from "./pilotageApi";

export type HeatmapMetric = "calls" | "rdv";

type PilotageHeatmapProps = {
  days: CockpitHeatmapDay[];
  selectedDate?: string | null;
  onSelectDay: (date: string) => void;
  onPrefetchDay?: (date: string) => void;
};

type WeekRow = {
  key: string;
  cells: Array<CockpitHeatmapDay | null>;
};

/** Group heatmap days into Mon–Sun weeks (pad empty leading/trailing cells). */
function weeksFromDays(days: CockpitHeatmapDay[]): WeekRow[] {
  if (days.length === 0) return [];

  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days[0].date;
  const last = days[days.length - 1].date;

  const [fy, fm, fd] = first.split("-").map(Number);
  const firstUtc = new Date(Date.UTC(fy, fm - 1, fd, 12));
  const firstDow = firstUtc.getUTCDay();
  const mondayOffset = firstDow === 0 ? 6 : firstDow - 1;

  const gridStart = new Date(firstUtc);
  gridStart.setUTCDate(gridStart.getUTCDate() - mondayOffset);

  const [ly, lm, ld] = last.split("-").map(Number);
  const lastUtc = new Date(Date.UTC(ly, lm - 1, ld, 12));
  const lastDow = lastUtc.getUTCDay();
  const sundayPad = lastDow === 0 ? 0 : 7 - lastDow;
  const gridEnd = new Date(lastUtc);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + sundayPad);

  const weeks: WeekRow[] = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    const cells: Array<CockpitHeatmapDay | null> = [];
    const weekKey = cursor.toISOString().slice(0, 10);
    for (let i = 0; i < 7; i++) {
      const key = cursor.toISOString().slice(0, 10);
      cells.push(byDate.get(key) ?? null);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push({ key: weekKey, cells });
  }
  return weeks;
}

function intensity(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(1, value / max);
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

export function PilotageHeatmap({
  days,
  selectedDate,
  onSelectDay,
  onPrefetchDay,
}: PilotageHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>("calls");
  const weeks = useMemo(() => weeksFromDays(days), [days]);
  const maxValue = useMemo(
    () => days.reduce((m, d) => Math.max(m, metric === "calls" ? d.calls : d.rdv), 0),
    [days, metric],
  );

  if (weeks.length === 0) return null;

  return (
    <section className="pilotage-heatmap" aria-label="Activité récente">
      <div className="pilotage-heatmap__head">
        <h3>Calendrier</h3>
        <div className="calls-seg pilotage-heatmap__metric" role="group" aria-label="Métrique affichée">
          <button
            type="button"
            className={`calls-seg__btn${metric === "calls" ? " calls-seg__btn--active" : ""}`}
            aria-pressed={metric === "calls"}
            onClick={() => setMetric("calls")}
          >
            Appels
          </button>
          <button
            type="button"
            className={`calls-seg__btn${metric === "rdv" ? " calls-seg__btn--active" : ""}`}
            aria-pressed={metric === "rdv"}
            onClick={() => setMetric("rdv")}
          >
            RDV
          </button>
        </div>
      </div>

      <div className="pilotage-heatmap__scale" aria-hidden="true">
        <span className="pilotage-heatmap__scale-bound xos-numeric">0</span>
        <div className={`pilotage-heatmap__gradient pilotage-heatmap__gradient--${metric}`} />
        <span className="pilotage-heatmap__scale-bound xos-numeric">{maxValue}</span>
      </div>

      <div className="pilotage-heatmap__weekdays" aria-hidden="true">
        {WEEKDAYS.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>

      <div className="pilotage-heatmap__grid" role="grid" aria-label="Jours">
        {weeks.map((week) => (
          <div key={week.key} className="pilotage-heatmap__week" role="row">
            {week.cells.map((cell, idx) => {
              if (!cell) {
                return (
                  <span
                    key={`${week.key}-empty-${idx}`}
                    className="pilotage-heatmap__cell pilotage-heatmap__cell--empty"
                    role="gridcell"
                  />
                );
              }

              const value = metric === "calls" ? cell.calls : cell.rdv;
              const heatT = intensity(value, maxValue);
              const selected = selectedDate === cell.date;
              const dayNum = Number(cell.date.slice(8, 10));

              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  className={[
                    "pilotage-heatmap__cell",
                    `pilotage-heatmap__cell--${metric}`,
                    selected ? "pilotage-heatmap__cell--selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ ["--heat-t" as string]: String(heatT) }}
                  title={`${cell.label} · ${cell.calls} appels · ${cell.rdv} RDV`}
                  aria-label={`${cell.label}, ${cell.calls} appels, ${cell.rdv} RDV`}
                  aria-pressed={selected}
                  onClick={() => onSelectDay(cell.date)}
                  onMouseEnter={() => onPrefetchDay?.(cell.date)}
                  onFocus={() => onPrefetchDay?.(cell.date)}
                >
                  <span className="pilotage-heatmap__day">{dayNum}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
