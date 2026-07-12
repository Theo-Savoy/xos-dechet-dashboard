import type { CockpitSessionRow, ProspectionCockpit } from "./pilotageApi";
import type { PeriodKpis } from "./types";
import type { CockpitPeriod } from "./pilotageApi";

export function emptyKpis(): PeriodKpis {
  return {
    calls: 0,
    decroche: 0,
    argumente: 0,
    rdv: 0,
    npa: 0,
    rate_decroche: 0,
    rate_argumente: 0,
    rate_rdv_per_decroche: 0,
    rate_rdv_per_argumente: 0,
  };
}

function rate(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
}

/** Sum absolute counts across KPI rows and recompute rates. */
export function mergeKpis(list: PeriodKpis[]): PeriodKpis {
  if (list.length === 0) return emptyKpis();
  const calls = list.reduce((s, k) => s + k.calls, 0);
  const decroche = list.reduce((s, k) => s + k.decroche, 0);
  const argumente = list.reduce((s, k) => s + k.argumente, 0);
  const rdv = list.reduce((s, k) => s + k.rdv, 0);
  const npa = list.reduce((s, k) => s + k.npa, 0);
  return {
    calls,
    decroche,
    argumente,
    rdv,
    npa,
    rate_decroche: rate(decroche, calls),
    rate_argumente: rate(argumente, calls),
    rate_rdv_per_decroche: rate(rdv, decroche),
    rate_rdv_per_argumente: rate(rdv, argumente),
  };
}

export function normalizeSessionId(id: number | string): number {
  return typeof id === "number" ? id : Number(id);
}

export function selectionStaleForSessions(
  sessions: CockpitSessionRow[],
  selectedSessionIds: Set<number>,
): boolean {
  if (sessions.length === 0 || selectedSessionIds.size === 0) return false;
  const currentIds = new Set(sessions.map((s) => normalizeSessionId(s.id)));
  for (const id of selectedSessionIds) {
    if (!currentIds.has(normalizeSessionId(id))) return true;
  }
  return false;
}

/** KPIs équipe / séances en mode « Séances ». */
export function filterSessionsModeKpis(
  data: ProspectionCockpit,
  sessions: CockpitSessionRow[],
  selectedSessionIds: Set<number>,
): { kpis: PeriodKpis; allCallers: boolean } {
  if (sessions.length === 0) {
    return { kpis: data.team_kpis, allCallers: true };
  }
  if (selectedSessionIds.size === 0) {
    return { kpis: emptyKpis(), allCallers: false };
  }
  if (selectionStaleForSessions(sessions, selectedSessionIds)) {
    return { kpis: data.team_kpis, allCallers: true };
  }
  const picked = sessions.filter((s) => selectedSessionIds.has(normalizeSessionId(s.id)));
  if (picked.length === sessions.length) {
    return { kpis: data.team_kpis, allCallers: true };
  }
  return { kpis: mergeKpis(picked.map((s) => s.kpis)), allCallers: false };
}

export function cockpitDataInSync(
  data: ProspectionCockpit,
  period: CockpitPeriod,
  anchor: string | null,
): boolean {
  if (data.period !== period) return false;
  if (period !== "day") return true;
  if (!anchor) return true;
  return data.range?.anchor === anchor;
}
