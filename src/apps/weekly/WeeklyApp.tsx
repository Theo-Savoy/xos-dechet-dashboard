import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, GlassCard, Tag } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import "./weekly.css";

type Tracking = "commercial" | "sdr" | "dg";
type Owner = { sf_user_id: string; name: string; email: string | null; role: "commercial" | "manager" | "admin" | null; tracking?: Tracking };
type Pulse = { sf_user_id: string; week: string; week_start: string; calls: number; meetings: number; proposals: number };
type WonByType = { catalogue: number; sur_mesure: number; conseil: number };
type Pipeline = { sf_user_id: string; week: string; week_start: string; generated_count: number; generated_amount: number; won_count: number; won_amount: number; won_by_type: WonByType; won_arr_amount: number; closing_rate_count: number | null; closing_rate_amount: number | null };
type Effort = { sf_user_id: string; week: string; week_start: string; progressions: number; open_opps_at_start: number; effort_rate: number | null };
type Quarter = { sf_user_id: string; quarter: string; signed_to_date: number; weighted_open: number; forecast: number; custom_pipe: number; target: number | null; signed_n1?: number };
type ForecastPoint = { sf_user_id: string; week_start: string; week: string; forecast: number | null; signed_to_date: number };
type RitualOpp = {
  id: string | null;
  name: string;
  sf_user_id: string;
  stage: string;
  amount: number;
  probability: number;
  expected: number;
  close_date: string | null;
  days_in_stage?: number | null;
  days_since_activity?: number | null;
  reasons?: Array<"stage" | "silence">;
};
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
};
type CustomPipeOpp = { id: string | null; name: string; sf_user_id: string; amount: number; expected: number; probability: number; close_date: string; month: string };
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
  warning?: "sf_user_unmapped";
};
type Week = { start: string; label: string };
type PeriodMode = "week" | "quarter";
type Health = { label: string; tone: "ok" | "warn" | "crit"; reco: string };

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const weekLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const emptyWonByType = (): WonByType => ({ catalogue: 0, sur_mesure: 0, conseil: 0 });
const TYPE_LABELS: Record<keyof WonByType, string> = { catalogue: "Catalogue", sur_mesure: "Sur-mesure", conseil: "Conseil" };
const emptyCustomPipe = (): CustomPipe => ({ horizon_days: 180, total_amount: 0, total_expected: 0, count: 0, months: [], by_owner: [], opps: [] });
const chartTooltipStyle = { background: "var(--xos-window-content-bg)", border: "1px solid var(--xos-border)", borderRadius: 8, color: "var(--xos-text)" };

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
  if (tracking === "dg") return "DG";
  if (role === "manager") return "Manager";
  if (role === "admin") return "Admin";
  return null;
}

function wowDelta(current: number, previous: number | undefined) {
  if (previous === undefined) return null;
  return current - previous;
}

function formatDelta(value: number | null, format: "count" | "money" = "count") {
  if (value === null) return null;
  const absolute = format === "money" ? money.format(Math.abs(value)) : countFmt.format(Math.abs(value));
  if (value === 0) return "= S−1";
  return `${value > 0 ? "+" : "−"}${absolute} vs S−1`;
}

function cadenceHealth(tracking: Tracking, currentPulse: Pulse, previousPulse: Pulse | undefined, currentPipe: Pipeline, previousPipe: Pipeline | undefined): Health {
  if (tracking === "sdr") {
    if (currentPulse.calls === 0 && currentPulse.meetings === 0 && currentPipe.generated_count === 0) {
      return { label: "Critique", tone: "crit", reco: "Semaine sans activité SDR." };
    }
    if (previousPulse && (currentPulse.calls < previousPulse.calls * 0.6 || currentPulse.meetings < previousPulse.meetings * 0.6)) {
      return { label: "À surveiller", tone: "warn", reco: `${currentPulse.calls} appels · ${currentPulse.meetings} RDV vs S−1.` };
    }
    return { label: "OK", tone: "ok", reco: `${currentPipe.generated_count} opp${currentPipe.generated_count > 1 ? "s" : ""} détectée${currentPipe.generated_count > 1 ? "s" : ""}.` };
  }
  if (tracking === "dg") {
    if (currentPipe.won_amount <= 0) return { label: "Calme", tone: "warn", reco: "Pas de signature cette semaine." };
    return { label: "OK", tone: "ok", reco: `${money.format(currentPipe.won_amount)} signés.` };
  }
  if (currentPulse.meetings === 0 && currentPipe.generated_count === 0 && currentPipe.won_amount === 0) {
    return { label: "Critique", tone: "crit", reco: "Aucun RDV, opp ni signé." };
  }
  if (previousPulse && previousPipe && (currentPulse.meetings < previousPulse.meetings * 0.6 || currentPipe.generated_count < previousPipe.generated_count * 0.6)) {
    return { label: "À surveiller", tone: "warn", reco: `${currentPulse.meetings} RDV · ${currentPipe.generated_count} opps vs S−1.` };
  }
  return { label: "OK", tone: "ok", reco: `${currentPulse.meetings} RDV · ${currentPipe.generated_count} opps · ${money.format(currentPipe.won_amount)}.` };
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
        <thead><tr><th scope="col">Métrique</th>{weeks.map((week) => <th scope="col" key={week.start}>{week.label}</th>)}<th scope="col">Total</th><th scope="col">Moyenne</th></tr></thead>
        <tbody>{rows.map((metric) => {
          const elapsed = metric.values.slice(0, currentIndex + 1).filter((value): value is number => value !== null);
          const total = elapsed.length ? elapsed.reduce((sum, value) => sum + value, 0) : null;
          const averageValue = total === null ? null : total / elapsed.length;
          return <tr key={metric.label}><th scope="row">{metric.label}</th>{metric.values.map((value, index) => <td key={weeks[index].start} className={index === currentIndex ? "weekly-table-current" : undefined}>{index > currentIndex ? "—" : formatValue(value, metric.format)}</td>)}<td className="weekly-table-total">{formatValue(total, metric.format)}</td><td>{formatValue(averageValue, metric.format)}</td></tr>;
        })}</tbody>
      </table>
    </div>
    {tracking !== "sdr" && <QuarterGauge data={quarter} />}
  </GlassCard>;
}

function MetricCell({ label, value, previous, moneyValue = false }: { label: string; value: number; previous?: number; moneyValue?: boolean }) {
  const delta = wowDelta(value, previous);
  const deltaText = formatDelta(delta, moneyValue ? "money" : "count");
  return <div>
    <span>{label}</span>
    <strong className="xos-numeric">{moneyValue ? money.format(value) : value}</strong>
    {deltaText && <small className={`weekly-delta ${delta && delta < 0 ? "weekly-delta--down" : delta && delta > 0 ? "weekly-delta--up" : ""}`}>{deltaText}</small>}
  </div>;
}

function PersonCard({ owner, pulseSeries, pipelineSeries, quarter, delay, currentIndex }: { owner: Owner; pulseSeries: Pulse[]; pipelineSeries: Pipeline[]; quarter: Quarter | undefined; delay: number; currentIndex: number }) {
  const tracking = trackingOf(owner);
  const current = pulseSeries[currentIndex] || pulseSeries.at(-1)!;
  const previous = currentIndex > 0 ? pulseSeries[currentIndex - 1] : undefined;
  const currentPipeline = pipelineSeries[currentIndex] || pipelineSeries.at(-1)!;
  const previousPipeline = currentIndex > 0 ? pipelineSeries[currentIndex - 1] : undefined;
  const badge = trackingBadge(tracking, owner.role);
  const health = cadenceHealth(tracking, current, previous, currentPipeline, previousPipeline);

  return <GlassCard className="weekly-pulse-card weekly-pulse-card--current" style={{ "--weekly-delay": `${delay}ms` } as React.CSSProperties}>
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
        <thead><tr><th scope="col">Métrique</th>{weeks.map((week) => <th scope="col" key={week.start}>{week.label}</th>)}<th scope="col">Total</th><th scope="col">Moyenne</th></tr></thead>
        <tbody>{rows.map((metric) => {
          const elapsed = metric.values.slice(0, currentIndex + 1).filter((value): value is number => value !== null);
          const total = elapsed.length ? elapsed.reduce((sum, value) => sum + value, 0) : null;
          const averageValue = total === null ? null : total / elapsed.length;
          return <tr key={metric.label}><th scope="row">{metric.label}</th>{metric.values.map((value, index) => <td key={weeks[index].start} className={index === currentIndex ? "weekly-table-current" : undefined}>{index > currentIndex ? "—" : formatValue(value, metric.format)}</td>)}<td className="weekly-table-total">{formatValue(total, metric.format)}</td><td>{formatValue(averageValue, metric.format)}</td></tr>;
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
            <Tooltip formatter={(value) => money.format(Number(value))} contentStyle={chartTooltipStyle} />
            <Legend wrapperStyle={{ color: "var(--xos-text-muted)", fontSize: 12 }} />
            <Bar dataKey="expected" name="CA attendu" fill="var(--xos-accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {ownerRows.length > 1 && <div className="weekly-custom-owners">{ownerRows.map((row) => <span key={row.sf_user_id}>{nameOf(row.sf_user_id).split(" ")[0]} · {money.format(row.expected)}</span>)}</div>}
      {opps.length > 0 && <div className="weekly-custom-opps" aria-label="Principales opportunités sur-mesure">
        <table>
          <thead><tr><th>Opportunité</th><th>Owner</th><th>Close</th><th>Attendu</th></tr></thead>
          <tbody>{opps.slice(0, 5).map((opp) => <tr key={`${opp.id || opp.name}-${opp.close_date}`}><td>{opp.name}</td><td>{nameOf(opp.sf_user_id).split(" ")[0]}</td><td>{opp.close_date.slice(5)}</td><td className="xos-numeric">{money.format(opp.expected)}</td></tr>)}</tbody>
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
  const expectedToDate = target === null ? null : target * (weekOfQuarter / Math.max(weekOfQuarter, weeksInQuarter));
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
    };
}

function PaceStrip({ pace }: { pace: Pace }) {
  const deltaN1 = pace.signed_to_date - pace.signed_n1;
  const n1Text = pace.signed_n1 > 0 || pace.signed_to_date > 0
    ? `${deltaN1 === 0 ? "=" : deltaN1 > 0 ? "+" : "−"}${money.format(Math.abs(deltaN1))} vs N−1`
    : "N−1 indisponible";
  const paceText = pace.pace_ratio === null ? "Sans target" : pace.pace_ratio >= 1 ? "Au-dessus du rythme" : pace.pace_ratio >= 0.85 ? "Dans le rythme" : "Sous le rythme";
  const paceTone = pace.pace_ratio === null ? "" : pace.pace_ratio >= 1 ? "weekly-pace--up" : pace.pace_ratio >= 0.85 ? "weekly-pace--ok" : "weekly-pace--down";
  return <GlassCard className={`weekly-pace ${paceTone}`}>
    <div className="weekly-pace-grid">
      <div><small>Signé TQ</small><strong className="xos-numeric">{money.format(pace.signed_to_date)}</strong><span>{n1Text}</span></div>
      <div><small>Allure fin TQ</small><strong className="xos-numeric">{money.format(pace.run_rate)}</strong><span>{paceText}{pace.expected_to_date !== null ? ` · attendu ${money.format(pace.expected_to_date)}` : ""}</span></div>
      <div><small>Target</small><strong className="xos-numeric">{pace.target === null ? "—" : money.format(pace.target)}</strong><span>S{pace.week_of_quarter}/{pace.weeks_in_quarter}</span></div>
      <div><small>Gagnées TQ</small><strong className="xos-numeric">{pace.won_count ?? 0}</strong><span>{money.format(pace.signed_to_date)} signés</span></div>
    </div>
  </GlassCard>;
}

function DecisionBoard({ followUps, stagnant, owners }: { followUps: RitualOpp[]; stagnant: RitualOpp[]; owners: Owner[] }) {
  if (!followUps.length && !stagnant.length) return null;
  const nameOf = (id: string) => owners.find((owner) => owner.sf_user_id === id)?.name.split(" ")[0] || id;
  const reasonLabel = (reasons: RitualOpp["reasons"] = []) => {
    if (reasons.includes("stage") && reasons.includes("silence")) return "Étape + silence";
    if (reasons.includes("stage")) return "Étape longue";
    return "Sans activité";
  };
  return <section className="weekly-section">
    <div className="weekly-section-heading"><p>Décisions</p><h3>Ce qu’il faut bouger lundi</h3></div>
    <div className="weekly-decision-grid">
      {followUps.length > 0 && <GlassCard className="weekly-decision-card">
        <div className="weekly-decision-heading"><h4>À pousser</h4><span>Montant × proba</span></div>
        <ul className="weekly-decision-list">
          {followUps.map((opp) => (
            <li key={opp.id || `${opp.name}-${opp.close_date}`}>
              <div>
                <strong>{opp.name}</strong>
                <small>{nameOf(opp.sf_user_id)} · {opp.stage}{opp.close_date ? ` · close ${opp.close_date.slice(5)}` : ""}</small>
              </div>
              <div className="weekly-decision-value">
                <strong className="xos-numeric">{money.format(opp.expected)}</strong>
                <small>{money.format(opp.amount)} × {countFmt.format(opp.probability)}%</small>
              </div>
            </li>
          ))}
        </ul>
      </GlassCard>}
      {stagnant.length > 0 && <GlassCard className="weekly-decision-card weekly-decision-card--alert">
        <div className="weekly-decision-heading"><h4>Stagnantes</h4><span>Durée d’étape · silence</span></div>
        <ul className="weekly-decision-list">
          {stagnant.map((opp) => (
            <li key={opp.id || `${opp.name}-stale`}>
              <div>
                <strong>{opp.name}</strong>
                <small>{nameOf(opp.sf_user_id)} · {opp.stage}</small>
                <div className="weekly-decision-tags">
                  <span className="weekly-decision-tag">{reasonLabel(opp.reasons)}</span>
                  {opp.days_in_stage !== null && opp.days_in_stage !== undefined && <span className="weekly-decision-tag">{opp.days_in_stage}j étape</span>}
                  <span className="weekly-decision-tag">{opp.days_since_activity === null || opp.days_since_activity === undefined ? "Aucune activité" : `${opp.days_since_activity}j silence`}</span>
                </div>
              </div>
              <div className="weekly-decision-value">
                <strong className="xos-numeric">{money.format(opp.expected || opp.amount)}</strong>
                <small>attendu</small>
              </div>
            </li>
          ))}
        </ul>
      </GlassCard>}
    </div>
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
      target: target === null ? null : target,
    };
  });
  const hasForecast = data.some((point) => point.forecast !== null);
  return <GlassCard className="weekly-chart-card weekly-forecast-card">
    <div className="weekly-chart weekly-chart--forecast">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="color-mix(in srgb, var(--xos-border) 80%, transparent)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} />
          <YAxis hide />
          <Tooltip formatter={(value) => (value === null || value === undefined ? "—" : money.format(Number(value)))} contentStyle={chartTooltipStyle} />
          <Legend wrapperStyle={{ color: "var(--xos-text-muted)", fontSize: 12 }} />
          {target !== null && <ReferenceLine y={target} stroke="var(--xos-text-muted)" strokeDasharray="5 5" label={{ value: "Target", fill: "var(--xos-text-muted)", fontSize: 11 }} />}
          {hasForecast && <Line type="monotone" dataKey="forecast" name="Forecast" stroke="var(--xos-accent)" strokeWidth={2.4} dot={{ r: 3 }} connectNulls={false} />}
          <Line type="monotone" dataKey="signed" name="Signé cumulé" stroke="var(--xos-alert)" strokeWidth={2.4} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <p className="weekly-closing">Forecast vs signé vs target trimestre{!hasForecast ? " · historique forecast en cours" : ""}</p>
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
  const [commercialsOnly, setCommercialsOnly] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const prefetchDone = useRef(false);

  const loadPeriod = useCallback(async (nextPeriod: PeriodMode, { background = false } = {}) => {
    if (!background) setLoading(true);
    setError(false);
    try {
      const next = await perfRequest(nextPeriod);
      setCache((current) => ({ ...current, [nextPeriod]: next }));
      if (!background) setSelectedWeek(null);
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
    if (cache[next]) setSelectedWeek(null);
  };

  const result = cache[period] || null;

  const model = useMemo(() => {
    if (!result) return null;
    const { payload, email } = result;
    const weeks = makeWeeks(payload);
    const currentWeekStart = addDays(payload.range.to, -6);
    const currentIndex = Math.max(0, weeks.findIndex((week) => week.start === currentWeekStart));
    const latestWeek = weeks[currentIndex]?.start || currentWeekStart || payload.range.from;
    const selfOwner = payload.owners.find((owner) => owner.email?.toLowerCase() === email?.toLowerCase()) || payload.owners[0];
    const visibleOwners = mode === "self"
      ? (selfOwner ? [selfOwner] : [])
      : payload.owners.filter((owner) => {
        if (!commercialsOnly) return true;
        if (trackingOf(owner) === "dg") return false;
        return owner.role !== "manager" && owner.role !== "admin";
      });
    const pulseFor = (owner: Owner) => weeks.map(({ start }) => payload.pulse.find((point) => point.sf_user_id === owner.sf_user_id && point.week_start === start) || { sf_user_id: owner.sf_user_id, week: "", week_start: start, calls: 0, meetings: 0, proposals: 0 });
    const pipelineFor = (owner: Owner) => weeks.map(({ start }) => payload.pipeline.find((point) => point.sf_user_id === owner.sf_user_id && point.week_start === start) || { sf_user_id: owner.sf_user_id, week: "", week_start: start, generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: emptyWonByType(), won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null });
    const sellers = visibleOwners.filter((owner) => trackingOf(owner) !== "sdr");
    const sellerIds = new Set(sellers.map((owner) => owner.sf_user_id));
    const pipeline = weeks.map(({ start, label }) => {
      const points = payload.pipeline.filter((point) => point.week_start === start && sellerIds.has(point.sf_user_id));
      return { week_start: start, label, generated_amount: points.reduce((sum, point) => sum + point.generated_amount, 0), won_amount: points.reduce((sum, point) => sum + point.won_amount, 0), generated_count: points.reduce((sum, point) => sum + point.generated_count, 0), won_count: points.reduce((sum, point) => sum + point.won_count, 0) };
    });
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
    const followUps = (payload.follow_up_opps || []).filter((opp) => visibleIds.has(opp.sf_user_id)).slice(0, 8);
    const stagnant = (payload.stagnant_opps || []).filter((opp) => visibleIds.has(opp.sf_user_id)).slice(0, 8);
    return {
      payload, weeks, latestWeek, currentIndex, visibleOwners, pulseFor, pipelineFor, quarterFor, pipeline, sellerIds,
      forecastHistory: payload.forecast_history || [], customPipe: scopedPipe, pace, target, followUps, stagnant,
    };
  }, [commercialsOnly, mode, result]);

  if (error && !model) return <main className="weekly-app weekly-app__state"><GlassCard className="weekly-error"><h2>Performance indisponible</h2><p>La récupération des données n’a pas abouti.</p><Button onClick={() => void loadPeriod(period)}>Réessayer</Button></GlassCard></main>;
  if (!model) return <Skeleton />;
  const { payload, latestWeek, currentIndex, visibleOwners, pulseFor, pipelineFor, quarterFor, pipeline, sellerIds, forecastHistory, customPipe, pace, target, followUps, stagnant } = model;
  const weekMode = period === "week";
  const activeWeek = selectedWeek || latestWeek;
  const selectedPipeline = pipeline.find((point) => point.week_start === activeWeek) || pipeline.find((point) => point.week_start === latestWeek) || pipeline[currentIndex];
  const hasActivity = payload.pulse.some((point) => point.calls || point.meetings || point.proposals) || payload.pipeline.some((point) => point.generated_amount || point.won_amount) || payload.effort.some((point) => point.progressions) || customPipe.count > 0 || followUps.length > 0 || stagnant.length > 0 || (pace?.signed_to_date || 0) > 0;
  const showPipelineBars = !weekMode && visibleOwners.some((owner) => trackingOf(owner) === "commercial");
  const showForecast = !weekMode && visibleOwners.some((owner) => trackingOf(owner) !== "sdr");
  const showCustomPipe = visibleOwners.some((owner) => trackingOf(owner) !== "sdr");
  const showTeamRollup = mode === "team" && visibleOwners.length > 1;
  const showPace = Boolean(pace) && visibleOwners.some((owner) => trackingOf(owner) !== "sdr");

  return <main className={`weekly-app ${loading ? "weekly-app--loading" : ""}`}>
    <header className="weekly-header">
      <div><Tag variant="accent">Performance</Tag><h2>Weekly Perf</h2></div>
      <div className="weekly-period" aria-label="Période">
        <Button variant={period === "week" ? "primary" : "secondary"} onClick={() => switchPeriod("week")}>Semaine</Button>
        <Button variant={period === "quarter" ? "primary" : "secondary"} onClick={() => switchPeriod("quarter")}>Trimestre</Button>
      </div>
    </header>
    <p className="weekly-period-hint">{weekMode ? "Semaine en cours comparée à S−1" : "Trimestre fiscal en cours, semaine par semaine"}</p>
    {payload.warning === "sf_user_unmapped" && <div className="weekly-warning" role="status">Compte Salesforce non lié — passez par le Hub ou le login Salesforce.</div>}
    <div className="weekly-controls">
      {payload.view === "team" && <div className="weekly-toggle" aria-label="Vue"><Button variant={mode === "self" ? "primary" : "secondary"} onClick={() => setMode("self")}>Moi</Button><Button variant={mode === "team" ? "primary" : "secondary"} onClick={() => setMode("team")}>Équipe</Button></div>}
      {payload.view === "team" && mode === "team" && <label className="weekly-checkbox"><input type="checkbox" checked={commercialsOnly} onChange={(event) => setCommercialsOnly(event.target.checked)} /> Commerciaux seulement</label>}
      <div className="weekly-toggle weekly-display-toggle" aria-label="Affichage"><Button variant={displayMode === "cards" ? "primary" : "secondary"} onClick={() => setDisplayMode("cards")}>Cards</Button><Button variant={displayMode === "table" ? "primary" : "secondary"} onClick={() => setDisplayMode("table")}>Tableau</Button></div>
    </div>
    {!hasActivity ? <GlassCard className="weekly-empty"><h3>Une semaine encore calme</h3><p>Les activités Salesforce apparaîtront ici au fil des saisies.</p><span>Consultez Call Manager pour enregistrer vos appels.</span></GlassCard> : <>
      {showPace && pace && <section className="weekly-section"><div className="weekly-section-heading"><p>Cap</p><h3>{weekMode ? "Objectif trimestre en vue" : "Rythme du trimestre"}</h3></div><PaceStrip pace={pace} /></section>}
      <DecisionBoard followUps={followUps} stagnant={stagnant} owners={visibleOwners} />
      {showTeamRollup && displayMode === "cards" && <TeamRollup owners={visibleOwners} pulseFor={pulseFor} pipelineFor={pipelineFor} quarterFor={quarterFor} weekMode={weekMode} currentIndex={currentIndex} />}
      {displayMode === "table" ? <>
        <section className="weekly-section"><div className="weekly-section-heading"><p>Rituel</p><h3>{weekMode ? "Cette semaine vs S−1" : "Trimestre en cours"}</h3></div><div className="weekly-tables weekly-view-transition">
          {showTeamRollup && <TeamMetricTable owners={visibleOwners} weeks={model.weeks} pulseFor={pulseFor} pipelineFor={pipelineFor} quarterFor={quarterFor} currentIndex={currentIndex} />}
          {visibleOwners.map((owner) => <MetricTable key={owner.sf_user_id} owner={owner} weeks={model.weeks} pulse={pulseFor(owner)} pipeline={pipelineFor(owner)} quarter={quarterFor(owner)} currentIndex={currentIndex} />)}
        </div></section>
        {showCustomPipe && <CustomPipeSection pipe={customPipe} owners={visibleOwners} sellerIds={sellerIds} />}
      </> : <>
        <section className="weekly-section"><div className="weekly-section-heading"><p>Pulse</p><h3>{weekMode ? "Cette semaine vs S−1" : "Qui a bougé ?"}</h3></div><div className="weekly-pulse-grid weekly-view-transition">{visibleOwners.map((owner, ownerIndex) => (
          <PersonCard key={owner.sf_user_id} owner={owner} pulseSeries={pulseFor(owner)} pipelineSeries={pipelineFor(owner)} quarter={quarterFor(owner)} delay={ownerIndex * 70} currentIndex={currentIndex} />
        ))}</div></section>
        {showPipelineBars && <section className="weekly-section"><div className="weekly-section-heading"><p>Pipeline</p><h3>Généré, puis gagné</h3></div><GlassCard className="weekly-chart-card"><div className="weekly-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={pipeline} onMouseMove={(state) => { const point = pipeline.find((item) => item.label === state.activeLabel); if (point) setSelectedWeek(point.week_start); }}><XAxis dataKey="label" stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} /><YAxis hide /><Tooltip formatter={(value) => money.format(Number(value))} contentStyle={chartTooltipStyle} /><Legend wrapperStyle={{ color: "var(--xos-text-muted)", fontSize: 12 }} /><Bar dataKey="generated_amount" name="Généré" fill="var(--xos-accent)" radius={[4, 4, 0, 0]} /><Bar dataKey="won_amount" name="Gagné" fill="var(--xos-alert)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div><p className="weekly-closing">{selectedPipeline?.label} · closing <strong className="xos-numeric">{selectedPipeline?.generated_count ? percent.format(selectedPipeline.won_count / selectedPipeline.generated_count) : "—"}</strong> nb · <strong className="xos-numeric">{selectedPipeline?.generated_amount ? percent.format(selectedPipeline.won_amount / selectedPipeline.generated_amount) : "—"}</strong> €</p></GlassCard></section>}
        {showForecast && <section className="weekly-section"><div className="weekly-section-heading"><p>Effort</p><h3>Forecast vs réalisé</h3></div><ForecastChart weeks={model.weeks} history={forecastHistory} ownerIds={sellerIds} target={target} currentIndex={currentIndex} /></section>}
        {showCustomPipe && <CustomPipeSection pipe={customPipe} owners={visibleOwners} sellerIds={sellerIds} />}
      </>}
    </>}
  </main>;
}
