import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, GlassCard, Tag } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import "./weekly.css";

type Owner = { sf_user_id: string; name: string; email: string | null; role: "commercial" | "manager" | "admin" | null };
type Pulse = { sf_user_id: string; week: string; week_start: string; calls: number; meetings: number; proposals: number };
type WonByType = { catalogue: number; sur_mesure: number; conseil: number };
type Pipeline = { sf_user_id: string; week: string; week_start: string; generated_count: number; generated_amount: number; won_count: number; won_amount: number; won_by_type: WonByType; won_arr_amount: number; closing_rate_count: number | null; closing_rate_amount: number | null };
type Effort = { sf_user_id: string; week: string; week_start: string; progressions: number; open_opps_at_start: number; effort_rate: number | null };
type Quarter = { sf_user_id: string; quarter: string; signed_to_date: number; weighted_open: number; forecast: number; custom_pipe: number; target: number | null };
type PerfResponse = { weeks: number; range: { from: string; to: string }; view: "self" | "team"; owners: Owner[]; pulse: Pulse[]; pipeline: Pipeline[]; effort: Effort[]; quarter: Quarter[]; warning?: "sf_user_unmapped" };
type Week = { start: string; label: string };

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const weekLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const emptyWonByType = (): WonByType => ({ catalogue: 0, sur_mesure: 0, conseil: 0 });

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

async function perfRequest(weeks: number) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("missing_session");
  const response = await fetch(`/api/perf?weeks=${weeks}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) throw new Error("perf_unavailable");
  return { payload: await response.json() as PerfResponse, email: session.user.email || null };
}

function roleLabel(role: Owner["role"]) {
  return role === "manager" ? "Manager" : role === "admin" ? "Admin" : null;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${28 - (value / max) * 24}`).join(" ");
  return <svg className="weekly-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function QuarterGauge({ data }: { data: Quarter | undefined }) {
  const signed = data?.signed_to_date || 0;
  const forecast = data?.forecast || 0;
  const target = data?.target ?? null;
  const ceiling = Math.max(target || 0, forecast, signed, 1);
  const signedWidth = `${Math.min(100, signed / ceiling * 100)}%`;
  const forecastWidth = `${Math.min(100, forecast / ceiling * 100)}%`;
  const targetText = target === null ? "—" : money.format(target);
  return <div className="weekly-quarter">
    <div className="weekly-quarter-heading"><span>{data?.quarter || "Trimestre"}</span><small>Objectif trimestriel</small></div>
    <div className="weekly-quarter-track" aria-hidden="true"><span className="weekly-quarter-forecast" style={{ width: forecastWidth }} /><span className="weekly-quarter-signed" style={{ width: signedWidth }} /></div>
    <div className="weekly-quarter-stats">
      <span aria-label={`Signé ${money.format(signed)}`}><small>Signé</small><strong>{money.format(signed)}</strong></span>
      <span aria-label={`Forecast ${money.format(forecast)}`}><small>Forecast</small><strong>{money.format(forecast)}</strong></span>
      <span aria-label={`Target ${targetText}`}><small>Target</small><strong>{targetText}</strong></span>
    </div>
  </div>;
}

type TableMetric = { label: string; format: "count" | "money"; values: Array<number | null> };

function MetricTable({ owner, weeks, pulse, pipeline, quarter }: { owner: Owner; weeks: Week[]; pulse: Pulse[]; pipeline: Pipeline[]; quarter: Quarter | undefined }) {
  const snapshot = (value: number | null | undefined) => weeks.map((_, index) => index === weeks.length - 1 && value !== null && value !== undefined ? value : null);
  const rows: TableMetric[] = [
    { label: "RDV effectués", format: "count", values: pulse.map((point) => point.meetings) },
    { label: "Opps détectées", format: "count", values: pipeline.map((point) => point.generated_count) },
    { label: "CA signé", format: "money", values: pipeline.map((point) => point.won_amount) },
    { label: "Sur-mesure", format: "money", values: pipeline.map((point) => point.won_by_type.sur_mesure) },
    { label: "Catalogue", format: "money", values: pipeline.map((point) => point.won_by_type.catalogue) },
    { label: "Conseil", format: "money", values: pipeline.map((point) => point.won_by_type.conseil) },
    { label: "Dont ARR", format: "money", values: pipeline.map((point) => point.won_arr_amount) },
    { label: "Forecast trimestre", format: "money", values: snapshot(quarter?.forecast) },
    { label: "Pipe sur-mesure", format: "money", values: snapshot(quarter?.custom_pipe) },
    { label: "Target", format: "money", values: snapshot(quarter?.target) },
  ];
  const formatValue = (value: number | null, format: TableMetric["format"]) => value === null ? "—" : format === "money" ? money.format(value) : count.format(value);
  const badge = roleLabel(owner.role);
  return <GlassCard className="weekly-table-card">
    <div className="weekly-person"><h4>{owner.name}</h4>{badge && <Tag variant="muted">{badge}</Tag>}</div>
    <div className="weekly-table-scroll">
      <table className="weekly-table" aria-label={`Suivi hebdomadaire de ${owner.name}`}>
        <thead><tr><th scope="col">Métrique</th>{weeks.map((week) => <th scope="col" key={week.start}>{week.label}</th>)}<th scope="col">Total</th><th scope="col">Moyenne</th></tr></thead>
        <tbody>{rows.map((metric) => {
          const populated = metric.values.filter((value): value is number => value !== null);
          const total = populated.length ? populated.reduce((sum, value) => sum + value, 0) : null;
          const average = total === null ? null : total / populated.length;
          return <tr key={metric.label}><th scope="row">{metric.label}</th>{metric.values.map((value, index) => <td key={weeks[index].start}>{formatValue(value, metric.format)}</td>)}<td className="weekly-table-total">{formatValue(total, metric.format)}</td><td>{formatValue(average, metric.format)}</td></tr>;
        })}</tbody>
      </table>
    </div>
  </GlassCard>;
}

function Skeleton() {
  return <main className="weekly-app"><header className="weekly-header"><div className="weekly-skeleton weekly-skeleton--tag" /><div className="weekly-skeleton weekly-skeleton--title" /></header><section className="weekly-pulse-grid">{Array.from({ length: 3 }, (_, index) => <GlassCard className="weekly-pulse-card weekly-skeleton-card" key={index}><div className="weekly-skeleton weekly-skeleton--line" /><div className="weekly-skeleton weekly-skeleton--metrics" /></GlassCard>)}</section></main>;
}

export default function WeeklyApp() {
  const [period, setPeriod] = useState(8);
  const [result, setResult] = useState<{ payload: PerfResponse; email: string | null } | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"self" | "team">("self");
  const [displayMode, setDisplayMode] = useState<"cards" | "table">("cards");
  const [commercialsOnly, setCommercialsOnly] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(false);
    try {
      const next = await perfRequest(period);
      setResult(next);
      setMode("self");
      setDisplayMode("cards");
      setSelectedWeek(null);
    } catch { setError(true); }
  }, [period]);

  useEffect(() => { void refresh(); }, [refresh]);

  const model = useMemo(() => {
    if (!result) return null;
    const { payload, email } = result;
    const weeks = makeWeeks(payload);
    const latestWeek = weeks.at(-1)?.start || payload.range.from;
    const selfOwner = payload.owners.find((owner) => owner.email?.toLowerCase() === email?.toLowerCase()) || payload.owners[0];
    const visibleOwners = mode === "self" ? (selfOwner ? [selfOwner] : []) : payload.owners.filter((owner) => !commercialsOnly || (owner.role !== "manager" && owner.role !== "admin"));
    const visibleIds = new Set(visibleOwners.map((owner) => owner.sf_user_id));
    const pulseFor = (owner: Owner) => weeks.map(({ start }) => payload.pulse.find((point) => point.sf_user_id === owner.sf_user_id && point.week_start === start) || { sf_user_id: owner.sf_user_id, week: "", week_start: start, calls: 0, meetings: 0, proposals: 0 });
    const pipelineFor = (owner: Owner) => weeks.map(({ start }) => payload.pipeline.find((point) => point.sf_user_id === owner.sf_user_id && point.week_start === start) || { sf_user_id: owner.sf_user_id, week: "", week_start: start, generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: emptyWonByType(), won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null });
    const pipeline = weeks.map(({ start, label }) => {
      const points = payload.pipeline.filter((point) => point.week_start === start && visibleIds.has(point.sf_user_id));
      return { week_start: start, label, generated_amount: points.reduce((sum, point) => sum + point.generated_amount, 0), won_amount: points.reduce((sum, point) => sum + point.won_amount, 0), generated_count: points.reduce((sum, point) => sum + point.generated_count, 0), won_count: points.reduce((sum, point) => sum + point.won_count, 0) };
    });
    const effort = weeks.map(({ start }) => payload.effort.filter((point) => point.week_start === start && visibleIds.has(point.sf_user_id)).reduce((total, point) => ({ progressions: total.progressions + point.progressions, open: total.open + point.open_opps_at_start }), { progressions: 0, open: 0 }));
    const quarterFor = (owner: Owner) => payload.quarter.find((point) => point.sf_user_id === owner.sf_user_id);
    return { payload, weeks, latestWeek, visibleOwners, pulseFor, pipelineFor, quarterFor, pipeline, effort };
  }, [commercialsOnly, mode, result]);

  if (error) return <main className="weekly-app weekly-app__state"><GlassCard className="weekly-error"><h2>Performance indisponible</h2><p>La récupération des données n’a pas abouti.</p><Button onClick={() => void refresh()}>Réessayer</Button></GlassCard></main>;
  if (!model) return <Skeleton />;
  const { payload, latestWeek, visibleOwners, pulseFor, pipelineFor, quarterFor, pipeline, effort } = model;
  const activeWeek = selectedWeek || latestWeek;
  const selectedPipeline = pipeline.find((point) => point.week_start === activeWeek) || pipeline.at(-1);
  const currentEffort = effort.at(-1) || { progressions: 0, open: 0 };
  const calmWeeks = effort.filter((point) => point.progressions === 0).length;
  const calmWeekLabels = model.weeks.filter((_, index) => effort[index]?.progressions === 0).slice(-3).map((week) => week.label).join(", ");
  const hasActivity = payload.pulse.some((point) => point.calls || point.meetings || point.proposals) || payload.pipeline.some((point) => point.generated_amount || point.won_amount) || payload.effort.some((point) => point.progressions);

  return <main className="weekly-app">
    <header className="weekly-header">
      <div><Tag variant="accent">Performance</Tag><h2>Weekly Perf</h2></div>
      <div className="weekly-period" aria-label="Période"><Button variant={period === 8 ? "primary" : "secondary"} onClick={() => setPeriod(8)}>8 semaines</Button><Button variant={period === 4 ? "primary" : "secondary"} onClick={() => setPeriod(4)}>4 semaines</Button></div>
    </header>
    {payload.warning === "sf_user_unmapped" && <div className="weekly-warning" role="status">Compte Salesforce non lié — passez par le Hub ou le login Salesforce.</div>}
    <div className="weekly-controls">
      {payload.view === "team" && <div className="weekly-toggle" aria-label="Vue"><Button variant={mode === "self" ? "primary" : "secondary"} onClick={() => setMode("self")}>Moi</Button><Button variant={mode === "team" ? "primary" : "secondary"} onClick={() => setMode("team")}>Équipe</Button></div>}
      {payload.view === "team" && mode === "team" && <label className="weekly-checkbox"><input type="checkbox" checked={commercialsOnly} onChange={(event) => setCommercialsOnly(event.target.checked)} /> Commerciaux seulement</label>}
      <div className="weekly-toggle weekly-display-toggle" aria-label="Affichage"><Button variant={displayMode === "cards" ? "primary" : "secondary"} onClick={() => setDisplayMode("cards")}>Cards</Button><Button variant={displayMode === "table" ? "primary" : "secondary"} onClick={() => setDisplayMode("table")}>Tableau</Button></div>
    </div>
    {!hasActivity ? <GlassCard className="weekly-empty"><h3>Une semaine encore calme</h3><p>Les activités Salesforce apparaîtront ici au fil des saisies.</p><span>Consultez Call Manager pour enregistrer vos appels.</span></GlassCard> : <>
      {displayMode === "table" ? <section className="weekly-section"><div className="weekly-section-heading"><p>Rituel équipe</p><h3>Suivi semaine par semaine</h3></div><div className="weekly-tables weekly-view-transition">{visibleOwners.map((owner) => <MetricTable key={owner.sf_user_id} owner={owner} weeks={model.weeks} pulse={pulseFor(owner)} pipeline={pipelineFor(owner)} quarter={quarterFor(owner)} />)}</div></section> : <>
        <section className="weekly-section"><div className="weekly-section-heading"><p>Pulse</p><h3>Qui a bougé cette semaine ?</h3></div><div className="weekly-pulse-grid weekly-view-transition">{visibleOwners.map((owner, ownerIndex) => {
          const pulseSeries = pulseFor(owner); const pipelineSeries = pipelineFor(owner); const current = pulseSeries.at(-1)!; const currentPipeline = pipelineSeries.at(-1)!; const badge = roleLabel(owner.role);
          return <GlassCard className="weekly-pulse-card weekly-pulse-card--current" key={owner.sf_user_id} style={{ "--weekly-delay": `${ownerIndex * 70}ms` } as React.CSSProperties}>
            <div className="weekly-person"><h4>{owner.name}</h4>{badge && <Tag variant="muted">{badge}</Tag>}</div>
            <div className="weekly-metrics">{([ ["Appels", current.calls, pulseSeries.map((point) => point.calls)], ["RDV", current.meetings, pulseSeries.map((point) => point.meetings)], ["Opps détectées", currentPipeline.generated_count, pipelineSeries.map((point) => point.generated_count)], ["Propositions", current.proposals, pulseSeries.map((point) => point.proposals)] ] as const).map(([label, value, values]) => <div key={label}><span>{label}</span><strong className="xos-numeric">{value}</strong><Sparkline values={[...values]} /></div>)}</div>
            <div className="weekly-revenue"><div><span>CA signé</span><strong className="xos-numeric">{money.format(currentPipeline.won_amount)}</strong></div><div className="weekly-breakdown" aria-label="Répartition du CA signé">{(Object.entries(currentPipeline.won_by_type) as Array<[keyof WonByType, number]>).map(([type, value]) => <span className={`weekly-breakdown-${type}`} key={type} style={{ width: currentPipeline.won_amount ? `${value / currentPipeline.won_amount * 100}%` : "0%" }} title={`${type}: ${money.format(value)}`} />)}</div><div className="weekly-breakdown-labels"><span>Catalogue</span><span>Sur-mesure</span><span>Conseil</span></div></div>
            <QuarterGauge data={quarterFor(owner)} />
          </GlassCard>;
        })}</div></section>
        <section className="weekly-section"><div className="weekly-section-heading"><p>Pipeline</p><h3>Généré, puis gagné</h3></div><GlassCard className="weekly-chart-card"><div className="weekly-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={pipeline} onMouseMove={(state) => { const point = pipeline.find((item) => item.label === state.activeLabel); if (point) setSelectedWeek(point.week_start); }}><XAxis dataKey="label" stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} /><YAxis hide /><Tooltip formatter={(value) => money.format(Number(value))} contentStyle={{ background: "var(--xos-window-content-bg)", border: "1px solid var(--xos-border)" }} /><Bar dataKey="generated_amount" name="Généré" fill="var(--xos-accent)" radius={[4, 4, 0, 0]} /><Bar dataKey="won_amount" name="Gagné" fill="var(--xos-alert)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div><p className="weekly-closing">{selectedPipeline?.label} · closing <strong className="xos-numeric">{selectedPipeline?.generated_count ? percent.format(selectedPipeline.won_count / selectedPipeline.generated_count) : "—"}</strong> en nombre · <strong className="xos-numeric">{selectedPipeline?.generated_amount ? percent.format(selectedPipeline.won_amount / selectedPipeline.generated_amount) : "—"}</strong> en valeur</p></GlassCard></section>
        <section className="weekly-section"><div className="weekly-section-heading"><p>Effort</p><h3>Le pipeline avance-t-il ?</h3></div><GlassCard className="weekly-effort"><div><span>Progressions cette semaine</span><strong className="weekly-effort-value xos-numeric">{currentEffort.progressions}</strong><small className="xos-numeric">{currentEffort.open ? percent.format(currentEffort.progressions / currentEffort.open) : "—"} du pipeline ouvert</small></div><p><span>Semaines calmes : {calmWeeks}</span>{calmWeekLabels && <small>{calmWeekLabels}</small>}</p></GlassCard></section>
      </>}
    </>}
  </main>;
}
