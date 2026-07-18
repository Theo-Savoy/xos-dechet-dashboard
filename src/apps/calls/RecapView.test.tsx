// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecapView } from "./RecapView";
import { tomorrowParisIso, formatIsoDateFr } from "./formControls.helpers";
import type { SessionContact, SessionDetail } from "./types";

afterEach(cleanup);

const baseSession: SessionDetail = {
  id: 1,
  name: "Séance test",
  status: "active",
  created_at: "2026-07-10T09:00:00Z",
  engaged_at: "2026-07-10T09:00:00Z",
};

function contact(overrides: Partial<SessionContact>): SessionContact {
  return {
    id: overrides.id ?? 1,
    position: 1,
    sf_contact_id: `003${overrides.id ?? 1}`,
    sf_account_id: "001",
    contact_name: "Alice Martin",
    account_name: "Acme",
    phone: "0102030405",
    title: null,
    linkedin_url: null,
    status: "called",
    outcome: "RDV planifié",
    comments: null,
    sf_task_id: null,
    sf_event_id: null,
    called_at: "2026-07-10T09:10:00Z",
    ...overrides,
  };
}

const noop = vi.fn();

describe("RecapView nudges", () => {
  it("always shows the pace nudge when calls were logged", () => {
    const contacts = [contact({ id: 1, called_at: "2026-07-10T09:10:00Z" }), contact({ id: 2, called_at: "2026-07-10T09:20:00Z" })];
    render(
      <RecapView
        session={baseSession}
        contacts={contacts}
        followUpLoading={false}
        error={null}
        onBack={noop}
        onCreateFollowUp={noop}
      />,
    );
    expect(screen.getByText(/appels\/min · \d+ min\/appel en moyenne/)).toBeTruthy();
  });

  it("shows a positive new-record nudge when the weekly stats say so", () => {
    const contacts = [contact({ id: 1 })];
    render(
      <RecapView
        session={baseSession}
        contacts={contacts}
        followUpLoading={false}
        error={null}
        weeklyCallStats={{ callsThisWeek: 124, isNewRecord: true }}
        onBack={noop}
        onCreateFollowUp={noop}
      />,
    );
    expect(screen.getByText("Nouveau record hebdo : 124 appels cette semaine")).toBeTruthy();
  });

  it("frames a non-record week as 'dans ta moyenne', never as underperforming", () => {
    const contacts = [contact({ id: 1 })];
    render(
      <RecapView
        session={baseSession}
        contacts={contacts}
        followUpLoading={false}
        error={null}
        weeklyCallStats={{ callsThisWeek: 40, isNewRecord: false }}
        onBack={noop}
        onCreateFollowUp={noop}
      />,
    );
    expect(screen.getByText(/Tu es dans ta moyenne, .* appels\/min/)).toBeTruthy();
    expect(screen.queryByText(/n'as pas battu/)).toBeNull();
  });

  it("suggests a follow-up session for uncontacted contacts", () => {
    const contacts = [contact({ id: 1 }), contact({ id: 2, status: "pending", called_at: null, outcome: null })];
    render(
      <RecapView
        session={baseSession}
        contacts={contacts}
        followUpLoading={false}
        error={null}
        onBack={noop}
        onCreateFollowUp={noop}
      />,
    );
    const expectedDate = formatIsoDateFr(tomorrowParisIso());
    expect(screen.getByText(new RegExp(`1 contact non contacté — créer la séance de relance du ${expectedDate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\?`))).toBeTruthy();
  });

  it("flags a session closed while contacts were still pending, without moralizing", () => {
    const contacts = [contact({ id: 1, status: "pending", called_at: null, outcome: null })];
    render(
      <RecapView
        session={{ ...baseSession, status: "completed" }}
        contacts={contacts}
        followUpLoading={false}
        error={null}
        onBack={noop}
        onCreateFollowUp={noop}
      />,
    );
    expect(screen.getByText("Séance clôturée sans être terminée — 1 contact à trancher")).toBeTruthy();
    expect(screen.queryByText(/aurais pu/)).toBeNull();
  });
});
