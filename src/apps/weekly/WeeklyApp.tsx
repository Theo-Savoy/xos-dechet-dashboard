import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, GlassCard, Tag } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import "./weekly.css";

type Owner = { sf_user_id: string; name: string; email: string | null; role: "commercial" | "manager" | "admin" | null };
type Pulse = { sf_user_id: string; week: string; week_start: string; calls: number; meetings: number; proposals: number };
type Pipeline = { sf_user_id: string; week: string; week_start: string; generated_count: number; generated_amount: number; won_count: number; won_amount: number; closing_rate_count: number | null; closing_rate_amount: number | null };
type Effort = { sf_user_id: string; week: string; week_start: string; progressions: number; open_opps_at_start: number; effort_rate: number | null };
type PerfResponse = { weeks: number; range: { from: string; to: string }; view: "self" | "team"; owners: Owner[]; pulse: Pulse[]; pipeline: Pipeline[]; effort: Effort[]; warning?: "sf_user_unmapped" };
type Week = { start: string; label: string };

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const weekLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

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

function Skeleton() {
  return <main className="weekly-app"><header className="weekly-header"><div className="weekly-skeleton weekly-skeleton--tag" /><div className="weekly-skeleton weekly-skeleton--title" /></header><section className="weekly-pulse-grid">{Array.from({ length: 3 }, (_, index) => <GlassCard className="weekly-pulse-card weekly-skeleton-card" key={index}><div className="weekly-skeleton weekly-skeleton--line" /><div className="weekly-skeleton weekly-skeleton--metrics" /></GlassCard>)}</section></main>;
}

export default function WeeklyApp() {
  const [period, setPeriod] = useState(8);
  const [result, setResult] = useState<{ payload: PerfResponse; email: string | null } | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"self" | "team">("self");
  const [commercialsOnly, setCommercialsOnly] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(false);
    try {
      const next = await perfRequest(period);
      setResult(next);
      setMode("self");
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
    const pipeline = weeks.map(({ start, label }) => {
      const points = payload.pipeline.filter((point) => point.week_start === start && visibleIds.has(point.sf_user_id));
      return { week_start: start, label, generated_amount: points.reduce((sum, point) => sum + point.generated_amount, 0), won_amount: points.reduce((sum, point) => sum + point.won_amount, 0), generated_count: points.reduce((sum, point) => sum + point.generated_count, 0), won_count: points.reduce((sum, point) => sum + point.won_count, 0) };
    });
    const effort = weeks.map(({ start }) => payload.effort.filter((point) => point.week_start === start && visibleIds.has(point.sf_user_id)).reduce((total, point) => ({ progressions: total.progressions + point.progressions, open: total.open + point.open_opps_at_start }), { progressions: 0, open: 0 }));
    return { payload, weeks, latestWeek, visibleOwners, pulseFor, pipeline, effort };
  }, [commercialsOnly, mode, result]);

  if (error) return <main className="weekly-app weekly-app__state"><GlassCard className="weekly-error"><h2>Performance indisponible</h2><p>La récupération des données n’a pas abouti.</p><Button onClick={() => void refresh()}>Réessayer</Button></GlassCard></main>;
  if (!model) return <Skeleton />;
  const { payload, latestWeek, visibleOwners, pulseFor, pipeline, effort } = model;
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
    {payload.view === "team" && <div className="weekly-controls"><div className="weekly-toggle" aria-label="Vue"><Button variant={mode === "self" ? "primary" : "secondary"} onClick={() => setMode("self")}>Moi</Button><Button variant={mode === "team" ? "primary" : "secondary"} onClick={() => setMode("team")}>Équipe</Button></div>{mode === "team" && <label className="weekly-checkbox"><input type="checkbox" checked={commercialsOnly} onChange={(event) => setCommercialsOnly(event.target.checked)} /> Commerciaux seulement</label>}</div>}
    {!hasActivity ? <GlassCard className="weekly-empty"><h3>Une semaine encore calme</h3><p>Les activités Salesforce apparaîtront ici au fil des saisies.</p><span>Consultez Call Manager pour enregistrer vos appels.</span></GlassCard> : <>
      <section className="weekly-section"><div className="weekly-section-heading"><p>Pulse</p><h3>Qui a bougé cette semaine ?</h3></div><div className="weekly-pulse-grid weekly-view-transition">{visibleOwners.map((owner, ownerIndex) => { const series = pulseFor(owner); const current = series.at(-1)!; const badge = roleLabel(owner.role); return <GlassCard className="weekly-pulse-card weekly-pulse-card--current" key={owner.sf_user_id} style={{ "--weekly-delay": `${ownerIndex * 70}ms` } as React.CSSProperties}><div className="weekly-person"><h4>{owner.name}</h4>{badge && !commercialsOnly && <Tag variant="muted">{badge}</Tag>}</div><div className="weekly-metrics">{([ ["Appels", "calls"], ["RDV", "meetings"], ["Propositions", "proposals"] ] as const).map(([label, metric]) => <div key={metric}><span>{label}</span><strong className="xos-numeric">{current[metric]}</strong><Sparkline values={series.map((point) => point[metric])} /></div>)}</div></GlassCard>; })}</div></section>
      <section className="weekly-section"><div className="weekly-section-heading"><p>Pipeline</p><h3>Généré, puis gagné</h3></div><GlassCard className="weekly-chart-card"><div className="weekly-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={pipeline} onMouseMove={(state) => { const point = pipeline.find((item) => item.label === state.activeLabel); if (point) setSelectedWeek(point.week_start); }}><XAxis dataKey="label" stroke="var(--xos-text-muted)" tickLine={false} axisLine={false} /><YAxis hide /><Tooltip formatter={(value) => money.format(Number(value))} contentStyle={{ background: "var(--xos-window-content-bg)", border: "1px solid var(--xos-border)" }} /><Bar dataKey="generated_amount" name="Généré" fill="var(--xos-accent)" radius={[4, 4, 0, 0]} /><Bar dataKey="won_amount" name="Gagné" fill="var(--xos-alert)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div><p className="weekly-closing">{selectedPipeline?.label} · closing <strong className="xos-numeric">{selectedPipeline?.generated_count ? percent.format(selectedPipeline.won_count / selectedPipeline.generated_count) : "—"}</strong> en nombre · <strong className="xos-numeric">{selectedPipeline?.generated_amount ? percent.format(selectedPipeline.won_amount / selectedPipeline.generated_amount) : "—"}</strong> en valeur</p></GlassCard></section>
      <section className="weekly-section"><div className="weekly-section-heading"><p>Effort</p><h3>Le pipeline avance-t-il ?</h3></div><GlassCard className="weekly-effort"><div><span>Progressions cette semaine</span><strong className="weekly-effort-value xos-numeric">{currentEffort.progressions}</strong><small className="xos-numeric">{currentEffort.open ? percent.format(currentEffort.progressions / currentEffort.open) : "—"} du pipeline ouvert</small></div><p><span>Semaines calmes : {calmWeeks}</span>{calmWeekLabels && <small>{calmWeekLabels}</small>}</p></GlassCard></section>
    </>}
  </main>;
}
