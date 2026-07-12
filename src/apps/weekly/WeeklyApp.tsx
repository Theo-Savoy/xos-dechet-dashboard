import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Button, GlassCard, Select, Tag } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import "./weekly.css";

type Tracking = "commercial" | "sdr" | "dg";
type Owner = { sf_user_id: string; name: string; email: string | null; role: "commercial" | "manager" | "admin" | null; tracking?: Tracking };
type Pulse = { sf_user_id: string; week: string; week_start: string; calls: number; meetings: number; proposals: number; call_results?: Record<string, number> };
type WonByType = { catalogue: number; sur_mesure: number; conseil: number };
type Pipeline = { sf_user_id: string; week: string; week_start: string; generated_count: number; generated_amount: number; won_count: number; won_amount: number; won_by_type: WonByType; won_arr_amount: number; closing_rate_count: number | null; closing_rate_amount: number | null };
type Effort = { sf_user_id: string; week: string; week_start: string; progressions: number; open_opps_at_start: number; effort_rate: number | null };
type Quarter = { sf_user_id: string; quarter: string; signed_to_date: number; weighted_open: number; forecast: number; custom_pipe: number; target: number | null; signed_n1?: number; pace_ratio?: number | null; expected_to_date?: number | null };
type ForecastPoint = { sf_user_id: string; week_start: string; week: string; forecast: number | null; signed_to_date: number };
type RitualOpp = {
  id: string | null;
  name: string;
  account?: string | null;
  sf_user_id: string;
  stage: string;
  amount: number;
  probability: number;
  expected: number;
  close_date: string | null;
  days_in_stage?: number | null;
  days_since_activity?: number | null;
  reasons?: Array<"stage" | "silence">;
  url?: string | null;
};
type CustomPipeOpp = { id: string | null; name: string; sf_user_id: string; amount: number; expected: number; probability: number; close_date: string; month: string; url?: string | null };
type Pace = {
  week_of_quarter: number;
  weeks_in_quarter: number;
  signed_to_date: number;
  forecast: number;
  target: number | null;
  signed_n1: number;
  expected_to_date: number | null;
  run_rate: number;
  pace_ratio: number | null;
  won_count?: number;
  expected_mode?: "seasonal" | "linear";
};

const CALL_FUNNEL_STAGES = [
  { key: "no_answer", label: "Non décroché", hint: "dont répondeur", sources: ["Appel non décroché", "Message répondeur"], color: "#7d8aa3" },
  { key: "answered", label: "Décroché", hint: null, sources: ["Appel décroché"], color: "#5b8def" },
  { key: "pitched", label: "Argumenté", hint: null, sources: ["Appel argumenté"], color: "var(--xos-accent)" },
  { key: "meeting", label: "RDV planifié", hint: null, sources: ["RDV planifié"], color: "var(--xos-alert)" },
] as const;

const chartBarCursor = { fill: "color-mix(in srgb, var(--xos-accent) 12%, transparent)" };
type CustomPipe = {
  horizon_days: number;
  total_amount: number;
  total_expected: number;
  count: number;
  months: Array<{ month: string; label: string; amount: number; expected: number; count: number; by_owner?: Record<string, { amount: number; expected: number; count: number }> }>;
  by_owner: Array<{ sf_user_id: string; amount: number; expected: number; count: number }>;
  opps: CustomPipeOpp[];
};
type PerfResponse = {
  weeks: number;
  period?: "week" | "quarter" | "weeks";
  range: { from: string; to: string };
  view: "self" | "team";
  owners: Owner[];
  pulse: Pulse[];
  pipeline: Pipeline[];
  effort: Effort[];
  quarter: Quarter[];
  forecast_history?: ForecastPoint[];
  custom_pipe?: CustomPipe;
  follow_up_opps?: RitualOpp[];
  stagnant_opps?: RitualOpp[];
  pace?: Pace | null;
  quarter_bounds?: { from: string; to: string; label: string };
  warning?: "sf_user_unmapped";
};
type Week = { start: string; label: string };
type PeriodMode = "week" | "quarter";
type Health = { label: string; tone: "ok" | "warn" | "crit" | "super"; reco: string };

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const weekLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const emptyWonByType = (): WonByType => ({ catalogue: 0, sur_mesure: 0, conseil: 0 });
const TYPE_LABELS: Record<keyof WonByType, string> = { catalogue: "Catalogue", sur_mesure: "Sur-mesure", conseil: "Conseil" };
const emptyCustomPipe = (): CustomPipe => ({ horizon_days: 180, total_amount: 0, total_expected: 0, count: 0, months: [], by_owner: [], opps: [] });
const chartTooltipStyle = { background: "var(--xos-window-content-bg)", border: "1px solid var(--xos-border)", borderRadius: 8, color: "var(--xos-text)" };

/** Cibles cadence — volume RDV = levier semaine ; détection lisible dès qu’il y a assez de RDV ; closing = mois/TQ. */
const CADENCE = {
  rdvPerWeek: 5,
  detectRate: 0.5,
  detectFloor: 0.2, // sous ce seuil avec un échantillon mini → signal fort
  detectSample: 2, // RDV mini pour juger la détection
  closeRate: 0.35,
  sdrCallsHint: 20, // repère d’appel SDR (pas un hard KPI Hub)
} as const;

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function makeWeeks(response: PerfResponse): Week[] {
  return Array.from({ length: response.weeks }, (_, index) => {
    const start = addDays(response.range.from, index * 7);
    return { start, label: weekLabel.format(new Date(`${start}T12:00:00.000Z`)) };
  });
}

function trackingOf(owner: Owner): Tracking {
  return owner.tracking || "commercial";
}

function trackingBadge(tracking: Tracking, role: Owner["role"]) {
  if (tracking === "sdr") return "SDR";
  if (tracking === "dg") return null;
  if (role === "manager") return "Manager";
  if (role === "admin") return "Admin";
  return null;
}

function wowDelta(current: number, previous: number | undefined) {
  if (previous === undefined) return null;
  return current - previous;
}

function formatDelta(value: number | null, format: "count" | "money" = "count", compact = false) {
  if (value === null) return null;
  const absolute = format === "money" ? money.format(Math.abs(value)) : countFmt.format(Math.abs(value));
  if (value === 0) return compact ? "=" : "= S−1";
  const signed = `${value > 0 ? "+" : "−"}${absolute}`;
  return compact ? signed : `${signed} vs S−1`;
}

/**
 * Forme (pas jugement de perf) — signaux croisés :
 * RDV, détection (si échantillon), ventes de la semaine, trajectoire vs target TQ.
 */
function cadenceHealth(
  tracking: Tracking,
  currentPulse: Pulse,
  _previousPulse: Pulse | undefined,
  currentPipe: Pipeline,
  _previousPipe: Pipeline | undefined,
  paceRatio: number | null = null,
): Health {
  const ahead = paceRatio !== null && paceRatio >= 1;
  const onTrack = paceRatio !== null && paceRatio >= 0.85;
  const trajectoryLabel = ahead ? "trajectoire en avance" : onTrack ? "trajectoire dans le rythme" : paceRatio !== null ? "trajectoire en retard" : null;

  if (tracking === "sdr") {
    const calls = currentPulse.calls;
    const rdv = currentPulse.meetings;
    const opps = currentPipe.generated_count;
    const detect = rdv >= CADENCE.detectSample ? opps / rdv : null;
    const recoParts = [`${calls} appels`, `${rdv}/${CADENCE.rdvPerWeek} RDV`, detect === null ? `${opps} opp` : `détect. ${percent.format(detect)}`];
    const reco = recoParts.join(" · ");

    if (calls === 0 && rdv === 0 && opps === 0) {
      return { label: "Critique", tone: "crit", reco: "Semaine sans appels ni RDV." };
    }
    if (rdv >= CADENCE.rdvPerWeek && (detect === null || detect >= CADENCE.detectRate) && calls >= CADENCE.sdrCallsHint * 0.6) {
      return { label: "Super", tone: "super", reco };
    }
    if (rdv === 0 && opps === 0) {
      return { label: "Critique", tone: "crit", reco };
    }
    if (rdv < CADENCE.rdvPerWeek || (detect !== null && detect < CADENCE.detectRate) || calls < CADENCE.sdrCallsHint * 0.4) {
      return { label: "À surveiller", tone: "warn", reco };
    }
    return { label: "OK", tone: "ok", reco };
  }

  if (tracking === "dg") {
    if (currentPipe.won_amount <= 0 && !ahead) {
      return { label: "Calme", tone: "warn", reco: trajectoryLabel ? `Pas de signature · ${trajectoryLabel}.` : "Pas de signature cette semaine." };
    }
    if (currentPipe.won_amount > 0) {
      return { label: "OK", tone: "ok", reco: `${money.format(currentPipe.won_amount)} signés${trajectoryLabel ? ` · ${trajectoryLabel}` : ""}.` };
    }
    return { label: "OK", tone: "ok", reco: trajectoryLabel || "Trajectoire tenue sans signature cette semaine." };
  }

  const rdv = currentPulse.meetings;
  const opps = currentPipe.generated_count;
  const wonAmount = currentPipe.won_amount;
  const hasSales = wonAmount > 0;
  const detect = rdv >= CADENCE.detectSample ? opps / rdv : null;
  const rdvOk = rdv >= CADENCE.rdvPerWeek;
  const detectOk = detect !== null && detect >= CADENCE.detectRate;
  const detectBad = detect !== null && detect < CADENCE.detectFloor;

  const bits = [
    `${rdv}/${CADENCE.rdvPerWeek} RDV`,
    detect === null ? `${opps} opp` : `détect. ${percent.format(detect)}`,
    hasSales ? `signés ${money.format(wonAmount)}` : null,
    trajectoryLabel,
  ].filter(Boolean);
  const reco = bits.join(" · ");

  // Semaine morte : pas d’activité ni de vente — sauf si trajectoire déjà largement en avance.
  if (rdv === 0 && opps === 0 && !hasSales) {
    if (ahead) return { label: "OK", tone: "ok", reco: `Semaine calme · ${trajectoryLabel}.` };
    return { label: "Critique", tone: "crit", reco: "Aucun RDV, opp ni signé." };
  }

  // Super : volume + résultats (ventes ou détection saine).
  if (rdvOk && hasSales) {
    return { label: "Super", tone: "super", reco };
  }
  if (rdvOk && detectOk) {
    return { label: "Super", tone: "super", reco };
  }

  // Peu de RDV mais ventes + trajectoire OK → forme correcte, pas critique.
  if (!rdvOk && hasSales && (ahead || onTrack)) {
    return { label: "OK", tone: "ok", reco };
  }
  if (!rdvOk && hasSales) {
    return { label: "À surveiller", tone: "warn", reco: `${reco} · volume RDV bas.` };
  }

  // Détection très basse sur un vrai échantillon.
  if (detectBad) {
    return { label: "À surveiller", tone: "warn", reco };
  }

  if (rdvOk && !detectBad) {
    return { label: "OK", tone: "ok", reco };
  }

  // Volume bas, pas de ventes qui sauvent.
  if (!rdvOk) {
    if (ahead) return { label: "OK", tone: "ok", reco };
    return { label: "À surveiller", tone: "warn", reco };
  }

  if (detect !== null && detect < CADENCE.detectRate) {
    return { label: "À surveiller", tone: "warn", reco };
  }

  return { label: "OK", tone: "ok", reco };
}

function CadenceLegend() {
  return (
    <p className="weekly-cadence-legend" role="note">
      <span>Forme</span>
      <span>{CADENCE.rdvPerWeek} RDV / sem</span>
      <span>détection {percent.format(CADENCE.detectRate)}</span>
    </p>
  );
}

function ConversionRates({
  owners, pulseFor, pipelineFor, currentIndex,
}: {
  owners: Owner[];
  pulseFor: (owner: Owner) => Pulse[];
  pipelineFor: (owner: Owner) => Pipeline[];
  currentIndex: number;
}) {
  const sellers = owners.filter((owner) => trackingOf(owner) !== "sdr");
  const pool = sellers.length ? sellers : owners;
  let rdv = 0;
  let opps = 0;
  let won = 0;
  for (const owner of pool) {
    const pulse = pulseFor(owner);
    const pipe = pipelineFor(owner);
    for (let index = 0; index <= currentIndex; index += 1) {
      rdv += pulse[index]?.meetings || 0;
      opps += pipe[index]?.generated_count || 0;
      won += pipe[index]?.won_count || 0;
    }
  }
  const detect = rdv > 0 ? opps / rdv : null;
  const close = opps > 0 ? won / opps : null;
  const detectTone = detect === null ? "" : detect >= CADENCE.detectRate ? "weekly-rate--ok" : detect >= CADENCE.detectFloor ? "weekly-rate--warn" : "weekly-rate--crit";
  const closeTone = close === null ? "" : close >= CADENCE.closeRate ? "weekly-rate--ok" : "weekly-rate--warn";
  return (
    <GlassCard className="weekly-conversion">
      <div className="weekly-conversion__item">
        <small>Taux détection (TQ)</small>
        <strong className={`xos-numeric ${detectTone}`}>{detect === null ? "—" : percent.format(detect)}</strong>
        <span>{opps} opp / {rdv} RDV</span>
      </div>
      <div className="weekly-conversion__item">
        <small>Taux closing (TQ)</small>
        <strong className={`xos-numeric ${closeTone}`}>{close === null ? "—" : percent.format(close)}</strong>
        <span>{won} gagnées / {opps} détectées</span>
      </div>
    </GlassCard>
  );
}

async function perfRequest(period: PeriodMode) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("missing_session");
  const response = await fetch(`/api/perf?period=${period}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) throw new Error("perf_unavailable");
  return { payload: await response.json() as PerfResponse, email: session.user.email || null };
}

function QuarterGauge({ data }: { data: Quarter | undefined }) {
  const signed = data?.signed_to_date || 0;
  const forecast = data?.forecast || 0;
  const target = data?.target ?? null;
  const ceiling = Math.max(target || 0, forecast, signed, 1);
  const targetText = target === null ? "—" : money.format(target);
  return <div className="weekly-quarter">
    <div className="weekly-quarter-heading"><span>{data?.quarter || "Trimestre"}</span><small>Target trimestre</small></div>
    <div className="weekly-quarter-track" aria-hidden="true">
      <span className="weekly-quarter-forecast" style={{ width: `${Math.min(100, forecast / ceiling * 100)}%` }} />
      <span className="weekly-quarter-signed" style={{ width: `${Math.min(100, signed / ceiling * 100)}%` }} />
    </div>
    <div className="weekly-quarter-stats">
      <span aria-label={`Signé ${money.format(signed)}`}><small>Signé</small><strong>{money.format(signed)}</strong></span>
      <span aria-label={`Forecast ${money.format(forecast)}`}><small>Forecast</small><strong>{money.format(forecast)}</strong></span>
      <span aria-label={`Target ${targetText}`}><small>Target</small><strong>{targetText}</strong></span>
    </div>
  </div>;
}

function Breakdown({ wonByType, wonAmount }: { wonByType: WonByType; wonAmount: number }) {
  return <>
    <div className="weekly-breakdown" aria-label="Répartition du CA signé">
      {(Object.entries(wonByType) as Array<[keyof WonByType, number]>).map(([type, value]) => (
        <span className={`weekly-breakdown-${type}`} key={type} style={{ width: wonAmount ? `${value / wonAmount * 100}%` : "0%" }} title={`${TYPE_LABELS[type]}: ${money.format(value)}`} />
      ))}
    </div>
    <div className="weekly-breakdown-labels">
      {(Object.keys(TYPE_LABELS) as Array<keyof WonByType>).map((type) => (
        <span className={`weekly-legend-${type}`} key={type}>{TYPE_LABELS[type]} · {money.format(wonByType[type])}</span>
      ))}
    </div>
  </>;
}

type TableMetric = { label: string; format: "count" | "money"; values: Array<number | null> };

function MetricTable({ owner, weeks, pulse, pipeline, quarter, currentIndex }: { owner: Owner; weeks: Week[]; pulse: Pulse[]; pipeline: Pipeline[]; quarter: Quarter | undefined; currentIndex: number }) {
  const tracking = trackingOf(owner);
  const rows: TableMetric[] = tracking === "sdr"
    ? [
      { label: "Appels", format: "count", values: pulse.map((point) => point.calls) },
      { label: "RDV pris", format: "count", values: pulse.map((point) => point.meetings) },
      { label: "Opps détectées", format: "count", values: pipeline.map((point) => point.generated_count) },
    ]
    : tracking === "dg"
      ? [
        { label: "CA signé", format: "money", values: pipeline.map((point) => point.won_amount) },
        { label: "Sur-mesure", format: "money", values: pipeline.map((point) => point.won_by_type.sur_mesure) },
        { label: "Catalogue", format: "money", values: pipeline.map((point) => point.won_by_type.catalogue) },
        { label: "Conseil", format: "money", values: pipeline.map((point) => point.won_by_type.conseil) },
        { label: "Dont ARR", format: "money", values: pipeline.map((point) => point.won_arr_amount) },
      ]
      : [
        { label: "RDV effectués", format: "count", values: pulse.map((point) => point.meetings) },
        { label: "Opps détectées", format: "count", values: pipeline.map((point) => point.generated_count) },
        { label: "CA signé", format: "money", values: pipeline.map((point) => point.won_amount) },
        { label: "Sur-mesure", format: "money", values: pipeline.map((point) => point.won_by_type.sur_mesure) },
        { label: "Catalogue", format: "money", values: pipeline.map((point) => point.won_by_type.catalogue) },
        { label: "Conseil", format: "money", values: pipeline.map((point) => point.won_by_type.conseil) },
        { label: "Dont ARR", format: "money", values: pipeline.map((point) => point.won_arr_amount) },
      ];
  const formatValue = (value: number | null, format: TableMetric["format"]) => value === null ? "—" : format === "money" ? money.format(value) : countFmt.format(value);
  const badge = trackingBadge(tracking, owner.role);
  return <GlassCard className="weekly-table-card">
    <div className="weekly-person"><h4>{owner.name}</h4>{badge && <Tag variant="muted">{badge}</Tag>}</div>
    <div className="weekly-table-scroll">
      <table className="weekly-table" aria-label={`Suivi hebdomadaire de ${owner.name}`}>
        <thead><tr><th scope="col">Métrique</th>{weeks.map((week) => <th scope="col" key={week.start}>{week.label}</th>)}<th scope="col">Total</th><th scope="col">Δ S−1</th></tr></thead>
        <tbody>{rows.map((metric) => {
          const elapsed = metric.values.slice(0, currentIndex + 1).filter((value): value is number => value !== null);
          const total = elapsed.length ? elapsed.reduce((sum, value) => sum + value, 0) : null;
          const delta = currentIndex > 0 ? wowDelta(metric.values[currentIndex] ?? 0, metric.values[currentIndex - 1] ?? undefined) : null;
          return <tr key={metric.label}><th scope="row">{metric.label}</th>{metric.values.map((value, index) => <td key={weeks[index].start} className={index === currentIndex ? "weekly-table-current" : undefined}>{index > currentIndex ? "—" : formatValue(value, metric.format)}</td>)}<td className="weekly-table-total">{formatValue(total, metric.format)}</td><td className={delta && delta < 0 ? "weekly-delta--down" : delta && delta > 0 ? "weekly-delta--up" : undefined}>{formatDelta(delta, metric.format) || "—"}</td></tr>;
        })}</tbody>
      </table>
    </div>
    {tracking !== "sdr" && <QuarterGauge data={quarter} />}
  </GlassCard>;
}

function MetricCell({ label, value, previous, moneyValue = false }: { label: string; value: number; previous?: number; moneyValue?: boolean }) {
  const delta = wowDelta(value, previous);
  const deltaText = formatDelta(delta, moneyValue ? "money" : "count", true);
  return <div>
    <span>{label}</span>
    <strong className="xos-numeric">{moneyValue ? money.format(value) : value}</strong>
    {deltaText && <small className={`weekly-delta ${delta && delta < 0 ? "weekly-delta--down" : delta && delta > 0 ? "weekly-delta--up" : ""}`}>{deltaText}</small>}
  </div>;
}

function PersonCard({
  owner, pulseSeries, pipelineSeries, quarter, delay, currentIndex, interactive = false, focused = false, onOpen,
}: {
  owner: Owner;
  pulseSeries: Pulse[];
  pipelineSeries: Pipeline[];
  quarter: Quarter | undefined;
  delay: number;
  currentIndex: number;
  interactive?: boolean;
  focused?: boolean;
  onOpen?: () => void;
}) {
  const tracking = trackingOf(owner);
  const current = pulseSeries[currentIndex] || pulseSeries.at(-1)!;
  const previous = currentIndex > 0 ? pulseSeries[currentIndex - 1] : undefined;
  const currentPipeline = pipelineSeries[currentIndex] || pipelineSeries.at(-1)!;
  const previousPipeline = currentIndex > 0 ? pipelineSeries[currentIndex - 1] : undefined;
  const badge = trackingBadge(tracking, owner.role);
  const paceRatio = quarter?.pace_ratio ?? null;
  const health = cadenceHealth(tracking, current, previous, currentPipeline, previousPipeline, paceRatio);
  const className = [
    "weekly-pulse-card",
    focused ? "weekly-pulse-card--focus" : "",
    interactive ? "weekly-pulse-card--interactive" : "",
  ].filter(Boolean).join(" ");

  return <GlassCard
    className={className}
    style={{ "--weekly-delay": `${delay}ms` } as React.CSSProperties}
    role={interactive ? "button" : undefined}
    tabIndex={interactive ? 0 : undefined}
    onClick={interactive ? onOpen : undefined}
    onKeyDown={interactive ? (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen?.();
      }
    } : undefined}
  >
    <div className="weekly-person">
      <div>
        <h4>{owner.name}</h4>
        <p className="weekly-reco">{health.reco}</p>
      </div>
      <div className="weekly-person-tags">
        {badge && <Tag variant="muted">{badge}</Tag>}
        <span className={`weekly-health weekly-health--${health.tone}`}>{health.label}</span>
      </div>
    </div>
    <div className={`weekly-metrics weekly-metrics--${tracking === "sdr" ? 3 : tracking === "dg" ? 2 : 3}`}>
      {tracking === "sdr" ? <>
        <MetricCell label="Appels" value={current.calls} previous={previous?.calls} />
        <MetricCell label="RDV pris" value={current.meetings} previous={previous?.meetings} />
        <MetricCell label="Opps détectées" value={currentPipeline.generated_count} previous={previousPipeline?.generated_count} />
      </> : tracking === "dg" ? <>
        <MetricCell label="CA signé" value={currentPipeline.won_amount} previous={previousPipeline?.won_amount} moneyValue />
        <MetricCell label="Dont ARR" value={currentPipeline.won_arr_amount} previous={previousPipeline?.won_arr_amount} moneyValue />
      </> : <>
        <MetricCell label="RDV" value={current.meetings} previous={previous?.meetings} />
        <MetricCell label="Opps détectées" value={currentPipeline.generated_count} previous={previousPipeline?.generated_count} />
        <MetricCell label="CA signé" value={currentPipeline.won_amount} previous={previousPipeline?.won_amount} moneyValue />
      </>}
    </div>
    {tracking !== "sdr" && currentPipeline.won_amount > 0 && (
      <div className="weekly-revenue"><Breakdown wonByType={currentPipeline.won_by_type} wonAmount={currentPipeline.won_amount} /></div>
    )}
    {tracking !== "sdr" && <QuarterGauge data={quarter} />}
  </GlassCard>;
}

function sumAt<T>(owners: Owner[], seriesFor: (owner: Owner) => T[], index: number, pick: (row: T) => number) {
  return owners.reduce((sum, owner) => sum + (pick(seriesFor(owner)[index]) || 0), 0);
}

function teamWonByType(owners: Owner[], pipelineFor: (owner: Owner) => Pipeline[], index: number): WonByType {
  return owners.reduce((acc, owner) => {
    const won = pipelineFor(owner)[index]?.won_by_type || emptyWonByType();
    return { catalogue: acc.catalogue + won.catalogue, sur_mesure: acc.sur_mesure + won.sur_mesure, conseil: acc.conseil + won.conseil };
  }, emptyWonByType());
}

function teamQuarter(owners: Owner[], quarterFor: (owner: Owner) => Quarter | undefined): Quarter | undefined {
  const rows = owners.map(quarterFor).filter((row): row is Quarter => Boolean(row));
  if (!rows.length) return undefined;
  const targets = rows.map((row) => row.target).filter((value): value is number => value !== null);
  return {
    sf_user_id: "team",
    quarter: rows[0].quarter,
    signed_to_date: rows.reduce((sum, row) => sum + row.signed_to_date, 0),
    weighted_open: rows.reduce((sum, row) => sum + row.weighted_open, 0),
    forecast: rows.reduce((sum, row) => sum + row.forecast, 0),
    custom_pipe: rows.reduce((sum, row) => sum + row.custom_pipe, 0),
    target: targets.length ? targets.reduce((sum, value) => sum + value, 0) : null,
  };
}

function TeamRollup({
  owners, pulseFor, pipelineFor, quarterFor, weekMode, currentIndex,
}: {
  owners: Owner[];
  pulseFor: (owner: Owner) => Pulse[];
  pipelineFor: (owner: Owner) => Pipeline[];
  quarterFor: (owner: Owner) => Quarter | undefined;
  weekMode: boolean;
  currentIndex: number;
}) {
  const sellers = owners.filter((owner) => trackingOf(owner) !== "sdr");
  const hasSdr = owners.some((owner) => trackingOf(owner) === "sdr");
  const previous = currentIndex > 0 ? currentIndex - 1 : -1;
  const metric = <T,>(pool: Owner[], seriesFor: (owner: Owner) => T[], pick: (row: T) => number) => {
    if (weekMode) {
      const value = sumAt(pool, seriesFor, currentIndex, pick);
      const prev = previous >= 0 ? sumAt(pool, seriesFor, previous, pick) : undefined;
      return { value, previous: prev };
    }
    const values = Array.from({ length: currentIndex + 1 }, (_, index) => sumAt(pool, seriesFor, index, pick));
    return { value: values.reduce((sum, n) => sum + n, 0), previous: undefined as number | undefined };
  };
  const calls = metric(owners, pulseFor, (row) => row.calls);
  const meetings = metric(owners, pulseFor, (row) => row.meetings);
  const opps = metric(owners, pipelineFor, (row) => row.generated_count);
  const won = metric(sellers, pipelineFor, (row) => row.won_amount);
  const arr = metric(sellers, pipelineFor, (row) => row.won_arr_amount);
  const wonTypes = weekMode
    ? teamWonByType(sellers, pipelineFor, currentIndex)
    : Array.from({ length: currentIndex + 1 }, (_, index) => teamWonByType(sellers, pipelineFor, index))
      .reduce((acc, row) => ({ catalogue: acc.catalogue + row.catalogue, sur_mesure: acc.sur_mesure + row.sur_mesure, conseil: acc.conseil + row.conseil }), emptyWonByType());
  const quarter = teamQuarter(sellers, quarterFor);
  const ownerTotal = (pick: (owner: Owner) => number) => owners
    .map((owner) => ({ name: owner.name.split(" ")[0], value: pick(owner) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
  const meetingLeaders = ownerTotal((owner) => weekMode
    ? (pulseFor(owner)[currentIndex]?.meetings || 0)
    : pulseFor(owner).slice(0, currentIndex + 1).reduce((sum, row) => sum + row.meetings, 0));
  const wonLeaders = ownerTotal((owner) => weekMode
    ? (pipelineFor(owner)[currentIndex]?.won_amount || 0)
    : pipelineFor(owner).slice(0, currentIndex + 1).reduce((sum, row) => sum + row.won_amount, 0));

  return <section className="weekly-section">
    <div className="weekly-section-heading"><p>Équipe</p><h3>{weekMode ? "Consolidé vs S−1" : "Consolidé trimestre"}</h3></div>
    <GlassCard className="weekly-team-rollup">
      <div className={`weekly-metrics weekly-metrics--${hasSdr ? 5 : 4}`}>
        {hasSdr && <MetricCell label="Appels" value={calls.value} previous={calls.previous} />}
        <MetricCell label="RDV" value={meetings.value} previous={meetings.previous} />
        <MetricCell label="Opps détectées" value={opps.value} previous={opps.previous} />
        <MetricCell label="CA signé" value={won.value} previous={won.previous} moneyValue />
        <MetricCell label="Dont ARR" value={arr.value} previous={arr.previous} moneyValue />
      </div>
      {won.value > 0 && <div className="weekly-revenue"><Breakdown wonByType={wonTypes} wonAmount={won.value} /></div>}
      {sellers.length > 0 && <QuarterGauge data={quarter} />}
      {(meetingLeaders.length > 0 || wonLeaders.length > 0) && <div className="weekly-team-contributors" aria-label="Contributeurs">
        {meetingLeaders.length > 0 && <span>RDV · {meetingLeaders.map((row) => `${row.name} ${row.value}`).join(" · ")}</span>}
        {wonLeaders.length > 0 && <span>CA · {wonLeaders.map((row) => `${row.name} ${money.format(row.value)}`).join(" · ")}</span>}
      </div>}
    </GlassCard>
  </section>;
}

function TeamMetricTable({
  owners, weeks, pulseFor, pipelineFor, quarterFor, currentIndex,
}: {
  owners: Owner[];
  weeks: Week[];
  pulseFor: (owner: Owner) => Pulse[];
  pipelineFor: (owner: Owner) => Pipeline[];
  quarterFor: (owner: Owner) => Quarter | undefined;
  currentIndex: number;
}) {
  const sellers = owners.filter((owner) => trackingOf(owner) !== "sdr");
  const hasSdr = owners.some((owner) => trackingOf(owner) === "sdr");
  const series = <T,>(seriesFor: (owner: Owner) => T[], pool: Owner[], pick: (row: T) => number) => weeks.map((_, index) => sumAt(pool, seriesFor, index, pick));
  const quarter = teamQuarter(sellers, quarterFor);
  const rows: TableMetric[] = [
    ...(hasSdr ? [{ label: "Appels", format: "count" as const, values: series(pulseFor, owners, (row) => row.calls) }] : []),
    { label: "RDV effectués", format: "count", values: series(pulseFor, owners, (row) => row.meetings) },
    { label: "Opps détectées", format: "count", values: series(pipelineFor, owners, (row) => row.generated_count) },
    { label: "CA signé", format: "money", values: series(pipelineFor, sellers, (row) => row.won_amount) },
    { label: "Sur-mesure", format: "money", values: series(pipelineFor, sellers, (row) => row.won_by_type.sur_mesure) },
    { label: "Catalogue", format: "money", values: series(pipelineFor, sellers, (row) => row.won_by_type.catalogue) },
    { label: "Conseil", format: "money", values: series(pipelineFor, sellers, (row) => row.won_by_type.conseil) },
    { label: "Dont ARR", format: "money", values: series(pipelineFor, sellers, (row) => row.won_arr_amount) },
  ];
  const formatValue = (value: number | null, format: TableMetric["format"]) => value === null ? "—" : format === "money" ? money.format(value) : countFmt.format(value);
  return <GlassCard className="weekly-table-card weekly-table-card--team">
    <div className="weekly-person"><h4>Équipe</h4><Tag variant="accent">Consolidé</Tag></div>
    <div className="weekly-table-scroll">
      <table className="weekly-table" aria-label="Suivi hebdomadaire consolidé de l’équipe">
        <thead><tr><th scope="col">Métrique</th>{weeks.map((week) => <th scope="col" key={week.start}>{week.label}</th>)}<th scope="col">Total</th><th scope="col">Δ S−1</th></tr></thead>
        <tbody>{rows.map((metric) => {
          const elapsed = metric.values.slice(0, currentIndex + 1).filter((value): value is number => value !== null);
          const total = elapsed.length ? elapsed.reduce((sum, value) => sum + value, 0) : null;
          const delta = currentIndex > 0 ? wowDelta(metric.values[currentIndex] ?? 0, metric.values[currentIndex - 1] ?? undefined) : null;
          return <tr key={metric.label}><th scope="row">{metric.label}</th>{metric.values.map((value, index) => <td key={weeks[index].start} className={index === currentIndex ? "weekly-table-current" : undefined}>{index > currentIndex ? "—" : formatValue(value, metric.format)}</td>)}<td className="weekly-table-total">{formatValue(total, metric.format)}</td><td className={delta && delta < 0 ? "weekly-delta--down" : delta && delta > 0 ? "weekly-delta--up" : undefined}>{formatDelta(delta, metric.format) || "—"}</td></tr>;
        })}</tbody>
      </table>
    </div>
    {sellers.length > 0 && <QuarterGauge data={quarter} />}
  </GlassCard>;
}

function CustomPipeSection({ pipe, owners, sellerIds }: { pipe: CustomPipe; owners: Owner[]; sellerIds: Set<string> }) {
  const nameOf = (id: string) => owners.find((owner) => owner.sf_user_id === id)?.name || id;
  const ownerRows = pipe.by_owner.filter((row) => sellerIds.has(row.sf_user_id));
  const months = pipe.months.map((entry) => ({ ...entry, label: entry.label.replace(".", "") }));
  const opps = pipe.opps.filter((opp) => sellerIds.has(opp.sf_user_id));
  return <section className="weekly-section">
    <div className="weekly-section-heading"><p>Pipe sur-mesure</p><h3>6 prochains mois</h3></div>
    <GlassCard className="weekly-custom-pipe">
      <div className="weekly-custom-kpis">
        <div><small>Montant brut</small><strong className="xos-numeric">{money.format(pipe.total_amount)}</strong></div>
        <div><small>CA attendu</small><strong className="xos-numeric">{money.format(pipe.total_expected)}</strong></div>
        <div><small>Opps</small><strong className="xos-numeric">{pipe.count}</strong></div>
      </div>
      <div className="weekly-chart weekly-chart--custom">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={months}>
            <XAxis dataKey="label" stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip cursor={chartBarCursor} formatter={(value) => money.format(Number(value))} contentStyle={chartTooltipStyle} />
            <Legend wrapperStyle={{ color: "var(--xos-text-muted)", fontSize: 12 }} />
            <Bar dataKey="expected" name="CA attendu" fill="var(--xos-accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {ownerRows.length > 1 && <div className="weekly-custom-owners">{ownerRows.map((row) => <span key={row.sf_user_id}>{nameOf(row.sf_user_id).split(" ")[0]} · {money.format(row.expected)}</span>)}</div>}
      {opps.length > 0 && <div className="weekly-custom-opps" aria-label="Principales opportunités sur-mesure">
        <table>
          <thead><tr><th>Opportunité</th><th>Owner</th><th>Close</th><th>Attendu</th></tr></thead>
          <tbody>{opps.slice(0, 5).map((opp) => <tr key={`${opp.id || opp.name}-${opp.close_date}`}><td>{opp.url ? <a className="weekly-opp-link" href={opp.url} target="_blank" rel="noreferrer">{opp.name}</a> : opp.name}</td><td>{nameOf(opp.sf_user_id).split(" ")[0]}</td><td>{opp.close_date.slice(5)}</td><td className="xos-numeric">{money.format(opp.expected)}</td></tr>)}</tbody>
        </table>
      </div>}
    </GlassCard>
  </section>;
}

function scopePace(rows: Quarter[], meta: Pace | null | undefined): Pace | null {
  if (!rows.length) return null;
  const targets = rows.map((row) => row.target).filter((value): value is number => value !== null);
  const signed = rows.reduce((sum, row) => sum + row.signed_to_date, 0);
  const forecast = rows.reduce((sum, row) => sum + row.forecast, 0);
  const signedN1 = rows.reduce((sum, row) => sum + (row.signed_n1 || 0), 0);
  const target = targets.length ? targets.reduce((sum, value) => sum + value, 0) : null;
  const weekOfQuarter = meta?.week_of_quarter || 1;
  const weeksInQuarter = meta?.weeks_in_quarter || weekOfQuarter;
  const expectedFromRows = rows.every((row) => row.expected_to_date != null)
    ? rows.reduce((sum, row) => sum + (row.expected_to_date || 0), 0)
    : null;
  const expectedToDate = meta?.expected_to_date ?? expectedFromRows ?? (target === null ? null : target * (weekOfQuarter / Math.max(weekOfQuarter, weeksInQuarter)));
  return {
      week_of_quarter: weekOfQuarter,
      weeks_in_quarter: Math.max(weekOfQuarter, weeksInQuarter),
      signed_to_date: signed,
      forecast,
      target,
      signed_n1: signedN1,
      expected_to_date: expectedToDate,
      run_rate: signed * (Math.max(weekOfQuarter, weeksInQuarter) / weekOfQuarter),
      pace_ratio: expectedToDate && expectedToDate > 0 ? signed / expectedToDate : null,
      won_count: meta?.won_count || 0,
      expected_mode: meta?.expected_mode || (expectedFromRows !== null ? "seasonal" : "linear"),
    };
}

function CallFunnelChart({
  weeks, owners, pulseFor, currentIndex, weekMode,
}: {
  weeks: Week[];
  owners: Owner[];
  pulseFor: (owner: Owner) => Pulse[];
  currentIndex: number;
  weekMode: boolean;
}) {
  const totals = CALL_FUNNEL_STAGES.map((stage) => {
    let count = 0;
    for (const owner of owners) {
      const pulse = pulseFor(owner);
      const indexes = weekMode ? [currentIndex] : weeks.map((_, index) => index).filter((index) => index <= currentIndex);
      for (const index of indexes) {
        const results = pulse[index]?.call_results || {};
        for (const source of stage.sources) count += results[source] || 0;
      }
    }
    return { ...stage, count };
  });
  const max = Math.max(...totals.map((stage) => stage.count), 0);
  const totalCalls = totals.reduce((sum, stage) => sum + stage.count, 0);
  if (!max) return null;
  return <section className="weekly-section">
    <div className="weekly-section-heading"><p>Funnel appels</p><h3>{weekMode ? "Cette semaine" : "Cumul trimestre"}</h3></div>
    <GlassCard className="weekly-call-funnel-card">
      <div className="weekly-call-funnel" role="img" aria-label="Entonnoir des résultats d’appel">
        {totals.map((stage, index) => {
          const width = max <= 0 ? 42 : Math.max(42, Math.round(42 + (stage.count / max) * 58));
          const share = totalCalls > 0 ? stage.count / totalCalls : 0;
          return (
            <div
              key={stage.key}
              className="weekly-call-funnel__stage"
              style={{
                ["--funnel-width" as string]: `${width}%`,
                ["--stage-color" as string]: stage.color,
                zIndex: totals.length - index,
              }}
            >
              <div className="weekly-call-funnel__meta">
                <span className="weekly-call-funnel__label">
                  {stage.label}
                  {stage.hint ? <em> · {stage.hint}</em> : null}
                </span>
                <span className="weekly-call-funnel__pct">{percent.format(share)}</span>
              </div>
              <strong className="xos-numeric">{countFmt.format(stage.count)}</strong>
            </div>
          );
        })}
      </div>
    </GlassCard>
  </section>;
}

function LeadingFunnel({
  owners, pulseFor, pipelineFor, weekMode, currentIndex,
}: {
  owners: Owner[];
  pulseFor: (owner: Owner) => Pulse[];
  pipelineFor: (owner: Owner) => Pipeline[];
  weekMode: boolean;
  currentIndex: number;
}) {
  let rdv = 0;
  let opps = 0;
  let created = 0;
  for (const owner of owners) {
    const pulse = pulseFor(owner);
    const pipe = pipelineFor(owner);
    if (weekMode) {
      rdv += pulse[currentIndex]?.meetings || 0;
      opps += pipe[currentIndex]?.generated_count || 0;
      created += pipe[currentIndex]?.generated_amount || 0;
    } else {
      for (let index = 0; index <= currentIndex; index += 1) {
        rdv += pulse[index]?.meetings || 0;
        opps += pipe[index]?.generated_count || 0;
        created += pipe[index]?.generated_amount || 0;
      }
    }
  }
  if (!rdv && !opps && !created) return null;
  const detectRate = rdv > 0 ? opps / rdv : null;
  const avgCreated = opps > 0 ? created / opps : null;
  return <section className="weekly-section">
    <div className="weekly-section-heading"><p>Flux menant</p><h3>{weekMode ? "Cette semaine" : "Cumul trimestre"}</h3></div>
    <GlassCard className="weekly-leading-funnel">
      <div className="weekly-leading-step">
        <small>RDV</small>
        <strong className="xos-numeric">{countFmt.format(rdv)}</strong>
      </div>
      <div className="weekly-leading-rate" aria-hidden="true">
        <span>{detectRate === null ? "—" : percent.format(detectRate)}</span>
      </div>
      <div className="weekly-leading-step">
        <small>Opps détectées</small>
        <strong className="xos-numeric">{countFmt.format(opps)}</strong>
      </div>
      <div className="weekly-leading-rate" aria-hidden="true">
        <span>{avgCreated === null ? "—" : money.format(avgCreated)}</span>
      </div>
      <div className="weekly-leading-step">
        <small>CA créé</small>
        <strong className="xos-numeric">{money.format(created)}</strong>
      </div>
    </GlassCard>
  </section>;
}

function PaceStrip({ pace }: { pace: Pace }) {
  const ceiling = Math.max(pace.target || 0, pace.signed_to_date, pace.signed_n1, pace.expected_to_date || 0, 1);
  const signedPct = Math.min(100, (pace.signed_to_date / ceiling) * 100);
  const expectedPct = pace.expected_to_date === null ? null : Math.min(100, (pace.expected_to_date / ceiling) * 100);
  const n1Pct = Math.min(100, (pace.signed_n1 / ceiling) * 100);
  const deltaN1 = pace.signed_to_date - pace.signed_n1;
  const n1Text = `${deltaN1 === 0 ? "=" : deltaN1 > 0 ? "+" : "−"}${money.format(Math.abs(deltaN1))} vs même période N−1`;
  const paceText = pace.pace_ratio === null ? "Sans target" : pace.pace_ratio >= 1 ? "Au-dessus du rythme" : pace.pace_ratio >= 0.85 ? "Dans le rythme" : "Sous le rythme";
  const paceTone = pace.pace_ratio === null ? "" : pace.pace_ratio >= 1 ? "weekly-pace--up" : pace.pace_ratio >= 0.85 ? "weekly-pace--ok" : "weekly-pace--down";
  return <GlassCard className={`weekly-pace ${paceTone}`}>
    <div className="weekly-pace-visual">
      <div className="weekly-pace-hero">
        <div>
          <small>Signé trimestre</small>
          <strong className="xos-numeric">{money.format(pace.signed_to_date)}</strong>
          <span>{n1Text}</span>
        </div>
        <div>
          <small>Target · semaine {pace.week_of_quarter}/{pace.weeks_in_quarter}</small>
          <strong className="xos-numeric">{pace.target === null ? "—" : money.format(pace.target)}</strong>
          <span>{pace.won_count ?? 0} opportunité{(pace.won_count || 0) > 1 ? "s" : ""} gagnée{(pace.won_count || 0) > 1 ? "s" : ""}</span>
        </div>
      </div>
      <div className="weekly-pace-track" aria-label="Progression vers le target trimestre">
        <span className="weekly-pace-fill" style={{ width: `${signedPct}%` }} />
        {expectedPct !== null && <span className="weekly-pace-marker weekly-pace-marker--expected" style={{ left: `${expectedPct}%` }} title={`Attendu à date ${money.format(pace.expected_to_date || 0)}`} />}
        <span className="weekly-pace-marker weekly-pace-marker--n1" style={{ left: `${n1Pct}%` }} title={`N−1 ${money.format(pace.signed_n1)}`} />
      </div>
      <div className="weekly-pace-legend">
        <span className="weekly-pace-legend--signed">Signé</span>
        <span className="weekly-pace-legend--expected">Attendu{pace.expected_to_date !== null ? ` · ${money.format(pace.expected_to_date)}` : ""}</span>
        <span className="weekly-pace-legend--n1">N−1 · {money.format(pace.signed_n1)}</span>
      </div>
      {pace.expected_mode === "seasonal" && <p className="weekly-pace-note">Attendu saisonnier</p>}
    </div>
    <div className="weekly-pace-aside">
      <small>Projection fin de trimestre</small>
      <strong className="xos-numeric">{money.format(pace.run_rate)}</strong>
      <span>{paceText}</span>
    </div>
  </GlassCard>;
}

function OppTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: RitualOpp & { kind: string } }> }) {
  if (!active || !payload?.[0]?.payload) return null;
  const opp = payload[0].payload;
  return <div className="weekly-opp-tooltip">
    <strong>{opp.account || opp.name}</strong>
    {opp.account ? <span>{opp.name}</span> : null}
    <span>Clôture · {opp.close_date ? weekLabel.format(new Date(`${opp.close_date}T12:00:00.000Z`)) : "—"}</span>
    <span>Probabilité · {countFmt.format(opp.probability)} %</span>
    <span>Montant · {money.format(opp.amount)}</span>
  </div>;
}

function DecisionBoard({
  followUps, stagnant, owners, quarterBounds,
}: {
  followUps: RitualOpp[];
  stagnant: RitualOpp[];
  owners: Owner[];
  quarterBounds: { from: string; to: string } | null;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const nameOf = (id: string) => owners.find((owner) => owner.sf_user_id === id)?.name.split(" ")[0] || id;
  const reasonLabel = (reasons: RitualOpp["reasons"] = []) => {
    if (reasons.includes("stage") && reasons.includes("silence")) return "Étape + silence";
    if (reasons.includes("stage")) return "Étape longue";
    return "Sans activité";
  };
  const inQuarter = (close: string | null) => {
    if (!close || !quarterBounds) return Boolean(close);
    return close >= quarterBounds.from && close <= quarterBounds.to;
  };
  const stagnantIds = new Set(stagnant.map((opp) => opp.id).filter(Boolean));
  const merged = new Map<string, RitualOpp & { kind: "push" | "stagnant" | "both"; close_ts: number; key: string }>();
  for (const opp of [...followUps, ...stagnant]) {
    if (!opp.close_date || !inQuarter(opp.close_date)) continue;
    const key = opp.id || `${opp.name}-${opp.close_date}`;
    const existing = merged.get(key);
    const isStagnant = stagnantIds.has(opp.id) || stagnant.some((row) => row.id === opp.id || (!row.id && row.name === opp.name));
    const isPush = followUps.some((row) => row.id === opp.id || (!row.id && row.name === opp.name));
    const kind = isStagnant && isPush ? "both" : isStagnant ? "stagnant" : "push";
    if (existing) {
      existing.kind = kind;
      continue;
    }
    merged.set(key, { ...opp, kind, close_ts: Date.parse(`${opp.close_date}T12:00:00.000Z`), key });
  }
  const points = [...merged.values()].sort((a, b) => b.expected - a.expected);
  const maxAmount = Math.max(...points.map((opp) => opp.amount), 1);
  const cluster = new Map<string, number>();
  const scatterData = points.map((opp) => {
    const bucket = `${opp.close_date}:${Math.round(opp.probability / 5) * 5}`;
    const n = cluster.get(bucket) || 0;
    cluster.set(bucket, n + 1);
    const angle = n * 2.15;
    const radius = Math.min(5.5, n * 1.55);
    return {
      ...opp,
      x: opp.close_ts + Math.cos(angle) * radius * 86400000 * 0.45,
      y: Math.min(100, Math.max(0, opp.probability + Math.sin(angle) * radius * 0.55)),
      z: Math.max(opp.amount, maxAmount * 0.07),
    };
  });
  const domainFrom = quarterBounds ? Date.parse(`${quarterBounds.from}T12:00:00.000Z`) : "dataMin";
  const domainTo = quarterBounds ? Date.parse(`${quarterBounds.to}T12:00:00.000Z`) : "dataMax";
  const ranked = points.map((opp) => ({ ...opp, listKind: opp.kind === "stagnant" ? "stagnant" as const : "push" as const }));
  const list = showAll ? ranked : ranked.slice(0, 10);
  const tickFormatter = (value: number) => weekLabel.format(new Date(value));

  useEffect(() => {
    if (!selectedKey) return;
    const node = document.getElementById(`weekly-opp-${selectedKey}`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedKey, showAll]);

  if (!followUps.length && !stagnant.length) return null;
  if (!ranked.length) return null;

  const selectOpp = (key: string | null) => {
    if (!key) return;
    const index = ranked.findIndex((opp) => opp.key === key);
    if (index >= 10) setShowAll(true);
    setSelectedKey(key);
  };

  return <section className="weekly-section">
    <div className="weekly-section-heading"><p>Décisions</p><h3>Opportunités essentielles du trimestre</h3></div>
    <GlassCard className="weekly-decision-board">
      {scatterData.length > 0 && <div className="weekly-chart weekly-chart--scatter" aria-label="Carte des opportunités : date de clôture × probabilité">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 14, right: 18, bottom: 10, left: 8 }}>
            <CartesianGrid stroke="color-mix(in srgb, var(--xos-border) 45%, transparent)" strokeDasharray="3 6" />
            <XAxis type="number" dataKey="x" name="Clôture" domain={[domainFrom, domainTo]} tickFormatter={tickFormatter} stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} />
            <YAxis type="number" dataKey="y" name="Proba" domain={[0, 100]} stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} width={36} tickFormatter={(value) => `${value}%`} />
            <ZAxis type="number" dataKey="z" range={[40, 260]} />
            <Tooltip cursor={{ stroke: "color-mix(in srgb, var(--xos-text) 35%, transparent)", strokeDasharray: "4 4" }} content={<OppTooltip />} wrapperStyle={{ outline: "none", zIndex: 20 }} />
            <Scatter
              name="Opps"
              data={scatterData}
              cursor="pointer"
              onClick={(entry) => {
                const payload = (entry as { payload?: { key?: string }; key?: string })?.payload || entry;
                selectOpp((payload as { key?: string })?.key || null);
              }}
            >
              {scatterData.map((point) => (
                <Cell
                  key={point.key}
                  fill={point.kind === "stagnant" || point.kind === "both" ? "var(--xos-alert)" : "var(--xos-accent)"}
                  fillOpacity={selectedKey === point.key ? 1 : point.kind === "both" ? 0.88 : 0.68}
                  stroke={selectedKey === point.key ? "var(--xos-text)" : "color-mix(in srgb, var(--xos-window-content-bg) 70%, transparent)"}
                  strokeWidth={selectedKey === point.key ? 2 : 1}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>}
      <div className="weekly-decision-legend">
        <span className="weekly-decision-legend--push">À pousser</span>
        <span className="weekly-decision-legend--stale">Stagnante</span>
        <span>Taille = montant</span>
      </div>
      <ul className="weekly-decision-list">
        {list.map((opp) => (
          <li
            id={`weekly-opp-${opp.key}`}
            key={opp.key}
            className={selectedKey === opp.key ? "weekly-decision-list__item--active" : undefined}
            role="button"
            tabIndex={0}
            onClick={() => selectOpp(opp.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectOpp(opp.key);
              }
            }}
          >
            <div>
              {opp.url ? <a className="weekly-opp-link" href={opp.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{opp.account || opp.name}</a> : <strong>{opp.account || opp.name}</strong>}
              <small>{nameOf(opp.sf_user_id)} · {opp.stage}{opp.close_date ? ` · ${opp.close_date.slice(5)}` : ""}{opp.listKind === "stagnant" ? ` · ${reasonLabel(opp.reasons)}` : ""}{opp.account ? ` · ${opp.name}` : ""}</small>
            </div>
            <div className="weekly-decision-value">
              <strong className="xos-numeric">{money.format(opp.expected || opp.amount)}</strong>
              <small>{opp.listKind === "push" ? `${money.format(opp.amount)} × ${countFmt.format(opp.probability)}%` : "attendu"}</small>
            </div>
          </li>
        ))}
      </ul>
      {ranked.length > 10 && (
        <div className="weekly-decision-more">
          <Button variant="secondary" onClick={() => setShowAll((current) => !current)}>
            {showAll ? "Réduire la liste" : `Tout afficher (${ranked.length})`}
          </Button>
        </div>
      )}
    </GlassCard>
  </section>;
}

function ForecastChart({ weeks, history, ownerIds, target, currentIndex }: { weeks: Week[]; history: ForecastPoint[]; ownerIds: Set<string>; target: number | null; currentIndex: number }) {
  const data = weeks.map((week, index) => {
    const points = history.filter((point) => point.week_start === week.start && ownerIds.has(point.sf_user_id));
    const forecastValues = points.map((point) => point.forecast).filter((value): value is number => value !== null);
    const future = index > currentIndex;
    return {
      label: week.label,
      forecast: future ? null : (forecastValues.length ? forecastValues.reduce((sum, value) => sum + value, 0) : null),
      signed: future ? null : points.reduce((sum, point) => sum + (point.signed_to_date || 0), 0),
    };
  });
  const hasForecast = data.some((point) => point.forecast !== null);
  const yMax = Math.max(
    target || 0,
    ...data.map((point) => Math.max(point.forecast || 0, point.signed || 0)),
    1,
  );
  return <GlassCard className="weekly-chart-card weekly-forecast-card">
    <div className="weekly-chart weekly-chart--forecast">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="color-mix(in srgb, var(--xos-border) 55%, transparent)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} />
          <YAxis hide domain={[0, yMax * 1.08]} />
          <Tooltip formatter={(value) => (value === null || value === undefined ? "—" : money.format(Number(value)))} contentStyle={chartTooltipStyle} />
          <Legend wrapperStyle={{ color: "var(--xos-text-muted)", fontSize: 12 }} />
          {target !== null && target > 0 && (
            <ReferenceLine
              y={target}
              stroke="color-mix(in srgb, var(--xos-text) 55%, transparent)"
              strokeDasharray="5 5"
              strokeWidth={1.6}
              ifOverflow="extendDomain"
              label={{ value: "Objectif", position: "insideTopRight", fill: "var(--xos-text-muted)", fontSize: 11 }}
            />
          )}
          {hasForecast && <Line type="monotone" dataKey="forecast" name="Forecast" stroke="var(--xos-accent)" strokeWidth={2.4} dot={{ r: 3 }} connectNulls={false} />}
          <Line type="monotone" dataKey="signed" name="Signé cumulé" stroke="var(--xos-alert)" strokeWidth={2.4} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </GlassCard>;
}

function Skeleton() {
  return <main className="weekly-app"><header className="weekly-header"><div className="weekly-skeleton weekly-skeleton--tag" /><div className="weekly-skeleton weekly-skeleton--title" /></header><section className="weekly-pulse-grid">{Array.from({ length: 3 }, (_, index) => <GlassCard className="weekly-pulse-card weekly-skeleton-card" key={index}><div className="weekly-skeleton weekly-skeleton--line" /><div className="weekly-skeleton weekly-skeleton--metrics" /></GlassCard>)}</section></main>;
}

export default function WeeklyApp() {
  const [period, setPeriod] = useState<PeriodMode>("week");
  const [cache, setCache] = useState<Partial<Record<PeriodMode, { payload: PerfResponse; email: string | null }>>>({});
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"self" | "team">("self");
  const [displayMode, setDisplayMode] = useState<"cards" | "table">("cards");
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>("all");
  const prefetchDone = useRef(false);

  const loadPeriod = useCallback(async (nextPeriod: PeriodMode, { background = false } = {}) => {
    if (!background) setLoading(true);
    setError(false);
    try {
      const next = await perfRequest(nextPeriod);
      setCache((current) => ({ ...current, [nextPeriod]: next }));
    } catch {
      if (!background) setError(true);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPeriod(period); }, [loadPeriod, period]);

  useEffect(() => {
    if (prefetchDone.current || !cache.week) return;
    prefetchDone.current = true;
    void loadPeriod("quarter", { background: true });
  }, [cache.week, loadPeriod]);

  const switchPeriod = (next: PeriodMode) => {
    setPeriod(next);
  };

  const result = cache[period] || null;

  const model = useMemo(() => {
    if (!result) return null;
    const { payload, email } = result;
    const weeks = makeWeeks(payload);
    const currentWeekStart = addDays(payload.range.to, -6);
    const currentIndex = Math.max(0, weeks.findIndex((week) => week.start === currentWeekStart));
    const selfOwner = payload.owners.find((owner) => owner.email?.toLowerCase() === email?.toLowerCase()) || payload.owners[0];
    const roster = mode === "self"
      ? (selfOwner ? [selfOwner] : [])
      : [...payload.owners].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const visibleOwners = mode === "team" && selectedOwnerId !== "all"
      ? roster.filter((owner) => owner.sf_user_id === selectedOwnerId)
      : roster;
    const pulseFor = (owner: Owner) => weeks.map(({ start }) => payload.pulse.find((point) => point.sf_user_id === owner.sf_user_id && point.week_start === start) || { sf_user_id: owner.sf_user_id, week: "", week_start: start, calls: 0, meetings: 0, proposals: 0 });
    const pipelineFor = (owner: Owner) => weeks.map(({ start }) => payload.pipeline.find((point) => point.sf_user_id === owner.sf_user_id && point.week_start === start) || { sf_user_id: owner.sf_user_id, week: "", week_start: start, generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: emptyWonByType(), won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null });
    const sellers = visibleOwners.filter((owner) => trackingOf(owner) !== "sdr");
    const sellerIds = new Set(sellers.map((owner) => owner.sf_user_id));
    const quarterFor = (owner: Owner) => payload.quarter.find((point) => point.sf_user_id === owner.sf_user_id);
    const customPipe = payload.custom_pipe || emptyCustomPipe();
    const ownerRows = customPipe.by_owner.filter((row) => sellerIds.has(row.sf_user_id));
    const scopedPipe: CustomPipe = {
      ...customPipe,
      by_owner: ownerRows,
      opps: customPipe.opps.filter((opp) => sellerIds.has(opp.sf_user_id)),
      total_amount: ownerRows.reduce((sum, row) => sum + row.amount, 0),
      total_expected: ownerRows.reduce((sum, row) => sum + row.expected, 0),
      count: ownerRows.reduce((sum, row) => sum + row.count, 0),
      months: customPipe.months.map((month) => {
        const parts = Object.entries(month.by_owner || {}).filter(([id]) => sellerIds.has(id));
        return {
          month: month.month,
          label: month.label,
          amount: parts.reduce((sum, [, row]) => sum + row.amount, 0),
          expected: parts.reduce((sum, [, row]) => sum + row.expected, 0),
          count: parts.reduce((sum, [, row]) => sum + row.count, 0),
        };
      }),
    };
    const visibleIds = new Set(visibleOwners.map((owner) => owner.sf_user_id));
    const quarterRows = payload.quarter.filter((row) => sellerIds.has(row.sf_user_id));
    const pace = scopePace(quarterRows, payload.pace);
    const target = pace?.target ?? null;
    const followUps = (payload.follow_up_opps || []).filter((opp) => visibleIds.has(opp.sf_user_id));
    const stagnant = (payload.stagnant_opps || []).filter((opp) => visibleIds.has(opp.sf_user_id));
    return {
      payload, weeks, currentIndex, visibleOwners, roster, pulseFor, pipelineFor, quarterFor, sellerIds,
      forecastHistory: payload.forecast_history || [], customPipe: scopedPipe, pace, target, followUps, stagnant,
      quarterBounds: payload.quarter_bounds || null,
    };
  }, [mode, result, selectedOwnerId]);

  if (error && !model) return <main className="weekly-app weekly-app__state"><GlassCard className="weekly-error"><h2>Performance indisponible</h2><p>La récupération des données n’a pas abouti.</p><Button onClick={() => void loadPeriod(period)}>Réessayer</Button></GlassCard></main>;
  if (!model) return <Skeleton />;
  const { payload, currentIndex, visibleOwners, roster, pulseFor, pipelineFor, quarterFor, sellerIds, forecastHistory, customPipe, pace, target, followUps, stagnant, quarterBounds } = model;
  const weekMode = period === "week";
  const hasActivity = payload.pulse.some((point) => point.calls || point.meetings || point.proposals) || payload.pipeline.some((point) => point.generated_amount || point.won_amount) || payload.effort.some((point) => point.progressions) || customPipe.count > 0 || followUps.length > 0 || stagnant.length > 0 || (pace?.signed_to_date || 0) > 0;
  const showForecast = !weekMode && visibleOwners.some((owner) => trackingOf(owner) !== "sdr");
  const showCustomPipe = visibleOwners.some((owner) => trackingOf(owner) !== "sdr");
  const showTeamRollup = mode === "team" && selectedOwnerId === "all" && visibleOwners.length > 1;
  const showPace = Boolean(pace) && visibleOwners.some((owner) => trackingOf(owner) !== "sdr");
  const ownerOptions = [{ value: "all", label: "Toute l’équipe" }, ...roster.map((owner) => ({ value: owner.sf_user_id, label: owner.name }))];

  return <main className={`weekly-app ${loading ? "weekly-app--loading" : ""}`}>
    <header className="weekly-header">
      <div className="weekly-header__brand">
        <Tag variant="accent">Performance</Tag>
        <h2>Weekly Perf</h2>
        <p className="weekly-period-hint">{weekMode ? "Semaine vs S−1" : "Trimestre en cours"}</p>
      </div>
      <div className="weekly-period weekly-seg" aria-label="Période">
        <Button variant={period === "week" ? "primary" : "secondary"} onClick={() => switchPeriod("week")}>Semaine</Button>
        <Button variant={period === "quarter" ? "primary" : "secondary"} onClick={() => switchPeriod("quarter")}>Trimestre</Button>
      </div>
    </header>
    {payload.warning === "sf_user_unmapped" && <div className="weekly-warning" role="status">Compte Salesforce non lié — passez par le Hub ou le login Salesforce.</div>}
    <div className="weekly-controls">
      {payload.view === "team" && <div className="weekly-toggle weekly-seg" aria-label="Vue">
        <Button variant={mode === "self" ? "primary" : "secondary"} onClick={() => { setMode("self"); setSelectedOwnerId("all"); }}>Moi</Button>
        <Button variant={mode === "team" ? "primary" : "secondary"} onClick={() => setMode("team")}>Équipe</Button>
      </div>}
      {payload.view === "team" && mode === "team" && (
        <Select label="Commercial" aria-label="Filtrer un commercial" value={selectedOwnerId} options={ownerOptions} onChange={setSelectedOwnerId} />
      )}
      <div className="weekly-toggle weekly-seg weekly-display-toggle" aria-label="Affichage">
        <Button variant={displayMode === "cards" ? "primary" : "secondary"} onClick={() => setDisplayMode("cards")}>Cards</Button>
        <Button variant={displayMode === "table" ? "primary" : "secondary"} onClick={() => setDisplayMode("table")}>Tableau</Button>
      </div>
    </div>
    {!hasActivity ? <GlassCard className="weekly-empty"><h3>Une semaine encore calme</h3><p>Les activités Salesforce apparaîtront ici au fil des saisies.</p><span>Consultez Call Manager pour enregistrer vos appels.</span></GlassCard> : <>
      {showTeamRollup && displayMode === "cards" && <TeamRollup owners={visibleOwners} pulseFor={pulseFor} pipelineFor={pipelineFor} quarterFor={quarterFor} weekMode={weekMode} currentIndex={currentIndex} />}
      {displayMode === "cards" && <section className="weekly-section">
        <div className="weekly-section-heading weekly-section-heading--row">
          <div>
            <p>Pulse</p>
            <h3>{selectedOwnerId !== "all" ? visibleOwners[0]?.name || "Fiche" : weekMode ? "Cette semaine vs S−1" : "Qui a bougé ?"}</h3>
          </div>
          {mode === "team" && selectedOwnerId !== "all" && (
            <Button variant="secondary" onClick={() => setSelectedOwnerId("all")}>Toute l’équipe</Button>
          )}
        </div>
        <CadenceLegend />
        <div className="weekly-pulse-grid weekly-view-transition" key={`cards-${period}-${mode}-${selectedOwnerId}`}>
          {visibleOwners.map((owner, ownerIndex) => (
            <PersonCard
              key={owner.sf_user_id}
              owner={owner}
              pulseSeries={pulseFor(owner)}
              pipelineSeries={pipelineFor(owner)}
              quarter={quarterFor(owner)}
              delay={ownerIndex * 55}
              currentIndex={currentIndex}
              interactive={mode === "team" && selectedOwnerId === "all" && payload.view === "team"}
              focused={selectedOwnerId === owner.sf_user_id}
              onOpen={() => setSelectedOwnerId(owner.sf_user_id)}
            />
          ))}
        </div>
      </section>}
      {displayMode === "table" && <section className="weekly-section">
        <div className="weekly-section-heading weekly-section-heading--row">
          <div>
            <p>Rituel</p>
            <h3>{selectedOwnerId !== "all" ? visibleOwners[0]?.name || "Fiche" : weekMode ? "Cette semaine vs S−1" : "Trimestre en cours"}</h3>
          </div>
          {mode === "team" && selectedOwnerId !== "all" && (
            <Button variant="secondary" onClick={() => setSelectedOwnerId("all")}>Toute l’équipe</Button>
          )}
        </div>
        <CadenceLegend />
        <div className="weekly-tables weekly-view-transition" key={`table-${period}-${mode}-${selectedOwnerId}`}>
          {showTeamRollup && <TeamMetricTable owners={visibleOwners} weeks={model.weeks} pulseFor={pulseFor} pipelineFor={pipelineFor} quarterFor={quarterFor} currentIndex={currentIndex} />}
          {visibleOwners.map((owner) => (
            <MetricTable key={owner.sf_user_id} owner={owner} weeks={model.weeks} pulse={pulseFor(owner)} pipeline={pipelineFor(owner)} quarter={quarterFor(owner)} currentIndex={currentIndex} />
          ))}
        </div>
      </section>}
      <LeadingFunnel owners={visibleOwners} pulseFor={pulseFor} pipelineFor={pipelineFor} weekMode={weekMode} currentIndex={currentIndex} />
      {showPace && pace && <section className="weekly-section">
        <div className="weekly-section-heading"><p>Cap</p><h3>{weekMode ? "Objectif du trimestre" : "Rythme du trimestre"}</h3></div>
        <PaceStrip pace={pace} />
        {!weekMode && <ConversionRates owners={visibleOwners} pulseFor={pulseFor} pipelineFor={pipelineFor} currentIndex={currentIndex} />}
      </section>}
      <DecisionBoard followUps={followUps} stagnant={stagnant} owners={visibleOwners} quarterBounds={quarterBounds} />
      {displayMode === "cards" && showForecast && <section className="weekly-section"><div className="weekly-section-heading"><p>Effort</p><h3>Forecast vs réalisé</h3></div><ForecastChart weeks={model.weeks} history={forecastHistory} ownerIds={sellerIds} target={target} currentIndex={currentIndex} /></section>}
      <CallFunnelChart weeks={model.weeks} owners={visibleOwners} pulseFor={pulseFor} currentIndex={currentIndex} weekMode={weekMode} />
      {showCustomPipe && <CustomPipeSection pipe={customPipe} owners={visibleOwners} sellerIds={sellerIds} />}
    </>}
  </main>;
}
