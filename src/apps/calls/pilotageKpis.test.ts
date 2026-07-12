import { describe, expect, it } from "vitest";
import { filterSessionsModeKpis } from "./pilotageKpis";
import type { CockpitSessionRow, ProspectionCockpit } from "./pilotageApi";
import type { PeriodKpis } from "./types";

function teamKpis(overrides: Partial<PeriodKpis> = {}): PeriodKpis {
  return {
    calls: 12,
    decroche: 8,
    argumente: 5,
    rdv: 2,
    npa: 1,
    rate_decroche: 66.7,
    rate_argumente: 41.7,
    rate_rdv_per_decroche: 25,
    rate_rdv_per_argumente: 40,
    ...overrides,
  };
}

function session(id: number, kpis: Partial<PeriodKpis> = {}): CockpitSessionRow {
  return {
    id,
    name: `Session ${id}`,
    status: "active",
    session_type: "prospection",
    scheduled_for: null,
    created_at: "2026-07-12T10:00:00Z",
    completed_at: null,
    owner: { user_id: "u1", sf_user_id: "005A", label: "Alice" },
    counts: { total: 10, called: 5, skipped: 0, pending: 5 },
    kpis: teamKpis({ calls: 0, decroche: 0, argumente: 0, rdv: 0, npa: 0, ...kpis }),
  };
}

function cockpit(
  sessions: CockpitSessionRow[],
  team = teamKpis(),
): ProspectionCockpit {
  return {
    view: "team",
    period: "day",
    range: { start: "2026-07-12", end: "2026-07-13", anchor: "2026-07-12" },
    team_kpis: team,
    by_caller: [],
    by_rdv_owner: [],
    sessions,
    rdv_attributions: [],
  };
}

describe("filterSessionsModeKpis", () => {
  it("uses team KPIs when every session is selected", () => {
    const data = cockpit([session(1), session(2)]);
    const result = filterSessionsModeKpis(data, data.sessions, new Set([1, 2]));
    expect(result.kpis).toEqual(data.team_kpis);
    expect(result.allCallers).toBe(true);
  });

  it("does not zero KPIs when selection ids partially overlap after day switch", () => {
    const data = cockpit([session(10), session(11)], teamKpis({ calls: 9, rdv: 1 }));
    const result = filterSessionsModeKpis(data, data.sessions, new Set([9, 10]));
    expect(result.kpis).toEqual(data.team_kpis);
    expect(result.allCallers).toBe(true);
  });

  it("returns empty KPIs only when user explicitly deselected all sessions", () => {
    const data = cockpit([session(1)]);
    const result = filterSessionsModeKpis(data, data.sessions, new Set());
    expect(result.kpis.calls).toBe(0);
    expect(result.allCallers).toBe(false);
  });
});
