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

export async function fetchProspectionCockpit(
  token: string,
  period: CockpitPeriod,
  anchor?: string | null,
): Promise<ProspectionCockpit> {
  const params = new URLSearchParams({
    resource: "prospection_cockpit",
    period,
  });
  if (anchor) params.set("anchor", anchor);

  const res = await fetch(`/api/calls?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
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
}
