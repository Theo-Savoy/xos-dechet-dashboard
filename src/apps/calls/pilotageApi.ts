import type { PeriodKpis } from "./types";

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

export type ProspectionCockpit = {
  view: "team";
  period: "week" | "month";
  team_kpis: PeriodKpis;
  by_caller: CockpitCallerRow[];
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
  period: "week" | "month",
): Promise<ProspectionCockpit> {
  const res = await fetch(`/api/calls?resource=prospection_cockpit&period=${period}`, {
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
