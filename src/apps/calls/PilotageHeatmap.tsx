import { useMemo, useState } from "react";
import type { CockpitHeatmapDay } from "./pilotageApi";
import {
  buildWeekdayHeatmapGrid,
  WEEKDAY_LABELS,
} from "./pilotageHeatmapLayout";

export type HeatmapMetric = "calls" | "rdv";

type PilotageHeatmapProps = {
  days: CockpitHeatmapDay[];
  selectedDate?: string | null;
  onSelectDay: (date: string) => void;
  onPrefetchDay?: (date: string) => void;
};

/** Soften low values so the gradient stays readable. */
function intensity(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  const linear = Math.min(1, value / max);
  return Math.sqrt(linear);
}

export function PilotageHeatmap({
  days,
  selectedDate,
  onSelectDay,
  onPrefetchDay,
}: PilotageHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>("calls");
  const grid = useMemo(() => buildWeekdayHeatmapGrid(days), [days]);
  const maxValue = useMemo(
    () => days.reduce((m, d) => Math.max(m, metric === "calls" ? d.calls : d.rdv), 0),
    [days, metric],
  );

  if (grid.columns === 0) return null;

  return (
    <section
      className="pilotage-heatmap"
      aria-label="Activité récente"
      style={{ ["--week-cols" as string]: String(grid.columns) }}
    >
      <div className="pilotage-heatmap__head">
        <div>
          <h3>Calendrier</h3>
          <p className="pilotage-heatmap__hint">Jours ouvrés · cliquez pour filtrer.</p>
        </div>
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

      <div className="pilotage-heatmap__matrix-wrap">
        <div className="pilotage-heatmap__months" aria-hidden="true">
          <span className="pilotage-heatmap__corner" />
          {grid.monthMarkers.map((marker) => (
            <span
              key={`${marker.col}-${marker.row}-${marker.label}`}
              className="pilotage-heatmap__month"
              style={{
                gridColumnStart: marker.col + 2,
                ["--month-row" as string]: String(marker.row),
              }}
            >
              {marker.label}
            </span>
          ))}
        </div>

        <div className="pilotage-heatmap__matrix" role="grid" aria-label="Jours ouvrés">
          {grid.rows.map((weekRow, rowIdx) => (
            <div key={WEEKDAY_LABELS[rowIdx]} className="pilotage-heatmap__matrix-row" role="row">
              <span className="pilotage-heatmap__row-label" aria-hidden="true">
                {WEEKDAY_LABELS[rowIdx]}
              </span>
              {weekRow.map((cell, colIdx) => {
                if (!cell) {
                  return (
                    <span
                      key={`empty-${rowIdx}-${colIdx}`}
                      className="pilotage-heatmap__cell pilotage-heatmap__cell--empty"
                      role="gridcell"
                      aria-hidden="true"
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
                      value > 0 ? "pilotage-heatmap__cell--active" : "",
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
                    {value > 0 ? (
                      <span className="pilotage-heatmap__value xos-numeric">{value}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
