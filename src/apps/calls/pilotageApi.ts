import type { PeriodKpis } from "./types";

export type CockpitPeriod = "day" | "week" | "month";

export type CockpitPerson = {
  user_id: string | null;
  sf_user_id: string | null;
  label: string;
};

export type CockpitCallerRow = {
  user_id: string;
  sf_user_id: string | null;
  label: string;
  role: string;
  tracking: string;
  sessions_active: number;
  sessions_completed: number;
  kpis: PeriodKpis;
};

/** Slim caller row used inside by_day. */
export type CockpitDayCallerRow = {
  user_id: string;
  label: string;
  kpis: PeriodKpis;
};

export type CockpitDayRow = {
  date: string;
  label: string;
  kpis: PeriodKpis;
  by_caller: CockpitDayCallerRow[];
};

export type CockpitRdvOwnerRow = {
  sf_user_id: string | null;
  label: string;
  rdv: number;
  from_sdr: number;
};

export type CockpitSessionRow = {
  id: number;
  name: string;
  status: "active" | "completed";
  session_type: string;
  scheduled_for: string | null;
  created_at: string;
  completed_at: string | null;
  owner: CockpitPerson;
  counts: { total: number; called: number; skipped: number; pending: number };
  kpis: PeriodKpis;
  /** Shared / multi-member session (optional until backend ships). */
  shared?: boolean;
  member_count?: number;
};

export type CockpitRdvAttribution = {
  session_id: number;
  session_name: string;
  session_contact_id: number;
  contact_name: string;
  account_name: string | null;
  called_at: string | null;
  sf_event_id: string | null;
  caller: CockpitPerson;
  rdv_owner_sf_user_id: string | null;
  rdv_owner_label: string;
};

export type CockpitHeatmapDay = {
  date: string;
  label: string;
  calls: number;
  rdv: number;
};

export type CockpitRange = {
  start: string;
  end: string;
  anchor: string | null;
};

export type ProspectionCockpit = {
  view: "team";
  period: CockpitPeriod;
  range?: CockpitRange;
  heatmap?: CockpitHeatmapDay[];
  team_kpis: PeriodKpis;
  by_caller: CockpitCallerRow[];
  /** Present once backend ships day breakdown; client treats missing as []. */
  by_day?: CockpitDayRow[];
  by_rdv_owner: CockpitRdvOwnerRow[];
  sessions: CockpitSessionRow[];
  rdv_attributions: CockpitRdvAttribution[];
};

export class PilotageApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
    this.name = "PilotageApiError";
  }
}

type CockpitCacheEntry = {
  token: string;
  at: number;
  data?: ProspectionCockpit;
  promise?: Promise<ProspectionCockpit>;
};

const COCKPIT_CACHE_TTL_MS = 60_000;
const cockpitCache = new Map<string, CockpitCacheEntry>();

function cockpitCacheKey(period: CockpitPeriod, anchor?: string | null): string {
  return `${period}:${anchor ?? "default"}`;
}

export function invalidateProspectionCockpitCache(): void {
  cockpitCache.clear();
}

export function prefetchProspectionCockpit(
  token: string,
  period: CockpitPeriod,
  anchor?: string | null,
): void {
  if (!token) return;
  void fetchProspectionCockpit(token, period, anchor).catch(() => {
    /* ignore */
  });
}

export async function fetchProspectionCockpit(
  token: string,
  period: CockpitPeriod,
  anchor?: string | null,
  opts?: { force?: boolean },
): Promise<ProspectionCockpit> {
  const force = opts?.force === true;
  const key = cockpitCacheKey(period, anchor);
  const now = Date.now();
  const cached = cockpitCache.get(key);

  if (
    !force
    && cached
    && cached.token === token
    && cached.data
    && now - cached.at < COCKPIT_CACHE_TTL_MS
  ) {
    return cached.data;
  }
  if (!force && cached && cached.token === token && cached.promise) {
    return cached.promise;
  }

  const params = new URLSearchParams({
    resource: "prospection_cockpit",
    period,
  });
  if (anchor) params.set("anchor", anchor);

  const promise = fetch(`/api/calls?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }).then(async (res) => {
    if (!res.ok) {
      let code = `http_${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) code = body.error;
      } catch {
        /* ignore */
      }
      throw new PilotageApiError(res.status, code);
    }
    return res.json() as Promise<ProspectionCockpit>;
  }).then((data) => {
    cockpitCache.set(key, { token, at: Date.now(), data });
    return data;
  });

  cockpitCache.set(key, { token, at: now, promise });
  try {
    return await promise;
  } catch (err) {
    const current = cockpitCache.get(key);
    if (current?.promise === promise) cockpitCache.delete(key);
    throw err;
  }
}
