// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPanel } from "./EventPanel";
import { DedupBanner } from "./DedupBanner";
import { FilterBuilder } from "./FilterBuilder";
import { NewSessionView } from "./NewSessionView";
import { RecapView } from "./RecapView";
import { RunnerView } from "./RunnerView";
import { SessionsView } from "./SessionsView";
import { PicklistMultiSelect } from "./filterControls";
import type { SessionContact, SessionDetail } from "./types";
import { emptyFilterTree, normalizeFilterTree } from "../../crm";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  try {
    window.localStorage?.setItem("xos-combo-demo-seen", "1");
    window.localStorage?.setItem("xos-combo-sounds", "0");
  } catch {
    /* jsdom without localStorage */
  }
});

const session: SessionDetail = {
  id: 1,
  name: "Séance test",
  status: "active",
  created_at: "2026-07-10T10:00:00Z",
};

const alice = {
  id: 1,
  position: 1,
  sf_contact_id: "003000000000001",
  sf_account_id: null,
  contact_name: "Alice Martin",
  account_name: "Acme",
  phone: "0102030405",
  email: "alice@acme.fr",
  title: "Responsable formation",
  linkedin_url: "https://linkedin.com/in/alice",
  status: "called",
  outcome: "RDV planifié",
  comments: null,
  sf_task_id: null,
  sf_event_id: null,
  called_at: null,
} as SessionContact;

const bob = { ...alice, id: 2, contact_name: "Bob Durand", status: "pending", outcome: null } as SessionContact;

describe("EventPanel", () => {
  it("initializes datetime-local in local time rather than slicing a UTC string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T10:07:00Z"));
    render(<EventPanel contactName="Alice" loading={false} onSubmit={vi.fn()} />);

    const expected = new Date(Date.now() + 60 * 60 * 1000);
    expected.setMinutes(Math.ceil(expected.getMinutes() / 15) * 15, 0, 0);
    const localValue = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}T${String(expected.getHours()).padStart(2, "0")}:${String(expected.getMinutes()).padStart(2, "0")}`;
    expect((screen.getByLabelText("Date & heure") as HTMLInputElement).value).toBe(localValue);
  });

  it("keeps submission disabled until the event start is valid", async () => {
    const user = userEvent.setup();
    render(<EventPanel contactName="Alice" loading={false} onSubmit={vi.fn()} />);

    await user.clear(screen.getByLabelText("Date & heure"));
    await user.type(screen.getByLabelText("Date & heure"), "2000-01-01T10:00");
    const submit = screen.getByRole("button", { name: /enregistrer le rdv/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(submit.getAttribute("title")).toContain("à venir");
  });

  it("defaults to discovery subject and 60 min for prospection", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <EventPanel
        contactName="Alice"
        loading={false}
        onSubmit={onSubmit}
        sessionType="prospection"
        accountCustomerType="Prospect"
      />,
    );

    expect(screen.getByRole("button", { name: /Rdv découverte prospect/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /Rdv détection enjeux client/i })).toBeNull();
    expect(screen.getByRole("button", { name: /60\s*min/i }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /enregistrer le rdv/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.any(String),
      60,
      { subject: "Rdv découverte prospect", ownerSfUserId: null },
    );
  });

  it("defaults to detection enjeux for a Client account in prospection", () => {
    render(
      <EventPanel
        contactName="Alice"
        loading={false}
        onSubmit={vi.fn()}
        sessionType="prospection"
        accountCustomerType="Client"
      />,
    );

    expect(screen.getByRole("button", { name: /Rdv détection enjeux client/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /Rdv découverte prospect/i })).toBeNull();
  });

  it("resets RDV subject when switching to another contact account type", async () => {
    const { rerender } = render(
      <EventPanel
        contactName="Alice"
        loading={false}
        onSubmit={vi.fn()}
        sessionType="prospection"
        accountCustomerType="Client"
      />,
    );

    expect(screen.getByRole("button", { name: /Rdv détection enjeux client/i }).getAttribute("aria-pressed")).toBe("true");

    rerender(
      <EventPanel
        contactName="Bob"
        loading={false}
        onSubmit={vi.fn()}
        sessionType="prospection"
        accountCustomerType="Prospect"
      />,
    );

    expect(screen.getByRole("button", { name: /Rdv découverte prospect/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("defaults SDR attribution to a commercial colleague", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <EventPanel
        contactName="Alice"
        loading={false}
        onSubmit={onSubmit}
        currentSfUserId="005Sb000007b6dWIAQ"
        team={[
          { user_id: "user-1", label: "Yanis", sf_user_id: "005Sb000007b6dWIAQ" },
          { user_id: "user-2", label: "Christophe", sf_user_id: "005000000000002" },
          { user_id: "user-3", label: "Paul", sf_user_id: "005000000000003" },
        ]}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Attribué à" });
    expect(within(group).getByRole("radio", { name: "Christophe" }).getAttribute("aria-checked")).toBe("true");
    expect(within(group).queryByRole("radio", { name: /^Moi$/ })).toBeNull();
    await user.click(within(group).getByRole("radio", { name: "Paul" }));
    await user.click(screen.getByRole("button", { name: /enregistrer le rdv/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.any(String),
      60,
      { subject: "Rdv découverte prospect", ownerSfUserId: "005000000000003" },
    );
  });
});

describe("RunnerView", () => {
  const runnerProps = {
    session,
    hubSessions: [] as [],
    loading: false,
    error: null as string | null,
    contactContext: null,
    contextContactId: null,
    onBack: vi.fn(),
    onFocusContact: vi.fn(),
    onLogAndNext: vi.fn(),
    onLogRdvAndNext: vi.fn(),
    onLogEvent: vi.fn(),
    onDeferContacts: vi.fn(),
    onRemoveContacts: vi.fn(),
    onUpdateRecall: vi.fn(),
    onLogMany: vi.fn(),
  };

  it("keeps the logged contact in the prioritized event panel", () => {
    render(
      <RunnerView
        {...runnerProps}
        contacts={[alice, bob]}
        currentContact={bob}
        awaitingEvent={alice}
      />,
    );

    expect(screen.getByRole("heading", { name: "Finaliser le RDV — Alice Martin" })).toBeTruthy();
  });

  it("shows title, LinkedIn and result buttons on the contact card", async () => {
    const user = userEvent.setup();
    const current = { ...bob, title: "RF", linkedin_url: "https://linkedin.com/in/bob", status: "pending" as const };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    expect(screen.getByText("RF · Acme")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir sur LinkedIn" }).getAttribute("href")).toBe(
      "https://linkedin.com/in/bob",
    );
    expect(screen.getByRole("button", { name: "Appel argumenté" })).toBeTruthy();
    expect(screen.queryByLabelText("Durée (secondes)")).toBeNull();
    expect(screen.getByText("Contacts")).toBeTruthy();
    expect(screen.getByText("Restant")).toBeTruthy();
  });

  it("auto-opens the first pending fiche with next-contact and recall hints", () => {
    const next = { ...bob, id: 3, contact_name: "Claire", position: 3 };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[bob, next]}
        currentContact={bob}
        awaitingEvent={null}
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Bob Durand" })).toBeTruthy();
    expect(screen.getByText("Claire")).toBeTruthy();
    expect(screen.getByText("ou")).toBeTruthy();
  });

  it("logs with ⌘↵ for a planned meeting via the Event panel", async () => {
    const user = userEvent.setup();
    const onLogAndNext = vi.fn();
    const onLogRdvAndNext = vi.fn();
    render(
      <RunnerView
        {...runnerProps}
        contacts={[bob]}
        currentContact={bob}
        awaitingEvent={null}
        onLogAndNext={onLogAndNext}
        onLogRdvAndNext={onLogRdvAndNext}
      />,
    );

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    expect(onLogAndNext).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "RDV planifié" }));
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(onLogAndNext).toHaveBeenCalledTimes(1);
    expect(onLogRdvAndNext).toHaveBeenCalledTimes(1);
    expect(onLogRdvAndNext.mock.calls[0][0]).toBe(bob.id);
    expect(onLogRdvAndNext.mock.calls[0][1]).toMatchObject({ resultat: "RDV planifié" });
  });

  it("toggles to list mode with session statuses", async () => {
    const user = userEvent.setup();
    render(
      <RunnerView
        {...runnerProps}
        contacts={[alice, bob]}
        currentContact={bob}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.getByText("Liste de la séance")).toBeTruthy();
    expect(screen.getByText("RDV planifié")).toBeTruthy();
    expect(screen.getAllByText("À faire").length).toBeGreaterThan(0);
  });

  it("shows Event panel inline when RDV planifié is selected", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.click(screen.getByRole("button", { name: "RDV planifié" }));

    expect(screen.getByRole("heading", { name: "Détails du RDV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Consigner appel + RDV & suivant" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Consigner & suivant" })).toBeNull();
  });

  it("exposes poste, email and phone in the session list", async () => {
    const user = userEvent.setup();
    render(
      <RunnerView
        {...runnerProps}
        contacts={[alice, bob]}
        currentContact={bob}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.getByText("Poste")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("Tél.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "0102030405" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "alice@acme.fr" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Responsable formation").length).toBeGreaterThan(0);
    expect(screen.getByText("Non contactés")).toBeTruthy();
    expect(screen.queryByText("Résultat")).toBeNull();
  });

  it("shows email on the contact fiche", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null, email: "bob@acme.fr" };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    expect(screen.getByRole("link", { name: "bob@acme.fr" }).getAttribute("href")).toBe("mailto:bob@acme.fr");
  });

  it("falls back to CRM context email on the contact fiche", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null, email: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        contactContext={{
          contact_record_url: null,
          account_record_url: null,
          email: "bob@acme.fr",
          title: null,
          npa: false,
          tasks: [],
          opportunities: [],
        }}
        contextContactId={current.id}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    expect(screen.getByRole("link", { name: "bob@acme.fr" }).getAttribute("href")).toBe("mailto:bob@acme.fr");
  });

  it("does not show previous contact CRM history when context is stale", () => {
    const current = { ...bob, id: 9, status: "pending" as const, outcome: null, contact_name: "Carla" };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        contactContext={{
          contact_record_url: null,
          account_record_url: null,
          email: null,
          title: null,
          npa: false,
          tasks: [{ id: "00T1", activity_date: "2026-07-01", result: "Appel décroché", subject: null, description: null, record_url: null }],
          opportunities: [],
        }}
        contextContactId={2}
        awaitingEvent={null}
      />,
    );

    const historyPanel = screen.getByRole("heading", { name: "Historique d'appels" }).closest(".calls-context-panel");
    expect(historyPanel).toBeTruthy();
    expect(within(historyPanel as HTMLElement).queryByText("Appel décroché")).toBeNull();
  });

  it("contains each expanded CRM context list independently", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null };
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      id: `00T${index}`,
      activity_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      result: `Appel ${index + 1}`,
      subject: null,
      description: null,
      record_url: null,
    }));
    const opportunities = Array.from({ length: 6 }, (_, index) => ({
      id: `006${index}`,
      name: `Opportunité ${index + 1}`,
      stage_name: "Prospection",
      amount: null,
      close_date: null,
      is_closed: false,
      is_won: false,
      linked_to_contact: false,
      record_url: null,
    }));

    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        contactContext={{
          contact_record_url: null,
          account_record_url: null,
          email: null,
          title: null,
          npa: false,
          tasks,
          opportunities,
          events: [],
        }}
        contextContactId={current.id}
        awaitingEvent={null}
      />,
    );

    const historyPanel = screen.getByRole("heading", { name: "Historique d'appels" }).closest(".calls-context-panel");
    const opportunitiesPanel = screen.getByRole("heading", { name: "Opportunités du compte" }).closest(".calls-context-panel");
    expect(historyPanel).toBeTruthy();
    expect(opportunitiesPanel).toBeTruthy();
    expect(within(historyPanel as HTMLElement).getAllByRole("listitem")).toHaveLength(5);
    expect(within(opportunitiesPanel as HTMLElement).getAllByRole("listitem")).toHaveLength(5);

    await user.click(within(historyPanel as HTMLElement).getByRole("button", { name: "Voir tout (6)" }));

    const expandedHistoryList = within(historyPanel as HTMLElement).getByRole("list");
    expect(expandedHistoryList.classList.contains("calls-context-list--expanded")).toBe(true);
    expect(within(historyPanel as HTMLElement).getAllByRole("listitem")).toHaveLength(6);
    expect(within(opportunitiesPanel as HTMLElement).getAllByRole("listitem")).toHaveLength(5);
    expect(within(opportunitiesPanel as HTMLElement).getByRole("button", { name: "Voir tout (6)" })).toBeTruthy();
  });

  it("bulk-logs the same outcome for selected contacts", async () => {
    const user = userEvent.setup();
    const onLogMany = vi.fn();
    const pendingA = { ...bob, id: 2, status: "pending" as const, outcome: null };
    const pendingB = { ...bob, id: 3, contact_name: "Claire", status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        onLogMany={onLogMany}
        contacts={[pendingA, pendingB]}
        currentContact={pendingA}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByLabelText("Sélectionner Bob Durand"));
    await user.click(screen.getByLabelText("Sélectionner Claire"));
    await user.click(screen.getByRole("button", { name: "Appel décroché" }));
    await user.click(screen.getByRole("button", { name: "Consigner pour 2" }));

    expect(onLogMany).toHaveBeenCalledWith(
      [2, 3],
      expect.objectContaining({ resultat: "Appel décroché", recallAt: null }),
    );
  });

  it("lets the user schedule a recall after an answered call", async () => {
    const user = userEvent.setup();
    const onLogAndNext = vi.fn();
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        onLogAndNext={onLogAndNext}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.click(screen.getByRole("button", { name: "Appel décroché" }));
    expect(screen.getByLabelText(/Planifier un rappel/i)).toBeTruthy();
    await user.click(screen.getByLabelText(/Planifier un rappel/i));
    expect(screen.getByRole("group", { name: "Choisir la date de rappel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+3 j/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Consigner & suivant/i }));
    expect(onLogAndNext).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        resultat: "Appel décroché",
        recallAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("allows skipping recall on unanswered without NPA", async () => {
    const user = userEvent.setup();
    const onLogAndNext = vi.fn();
    const current = { ...bob, status: "pending" as const, outcome: null, attempt_count: 1 };
    render(
      <RunnerView
        {...runnerProps}
        onLogAndNext={onLogAndNext}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    expect(screen.getByText("2e tentative")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Appel non décroché" }));
    expect((screen.getByLabelText(/Planifier un rappel/i) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByLabelText(/Planifier un rappel/i));
    expect(screen.getByText(/Pas de rappel cette fois/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Consigner & suivant/i }));
    expect(onLogAndNext).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        resultat: "Appel non décroché",
        recallAt: null,
        doNotCall: false,
      }),
    );
  });

  it("removes a pending contact from the session after confirm", async () => {
    const user = userEvent.setup();
    const onRemoveContacts = vi.fn();
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        onRemoveContacts={onRemoveContacts}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.click(screen.getByRole("button", { name: "Retirer" }));
    const dialog = screen.getByRole("dialog", { name: "Retirer de la séance" });
    await user.click(within(dialog).getByRole("button", { name: "Retirer" }));
    expect(onRemoveContacts).toHaveBeenCalledWith([current.id]);
  });

  it("reschedules a recall from the recall queue", async () => {
    const user = userEvent.setup();
    const onUpdateRecall = vi.fn();
    const current = {
      ...bob,
      status: "pending" as const,
      outcome: "Appel non décroché" as const,
      recall_at: "2026-07-12",
      origin_session_id: 9,
      origin_session_name: "Séance A",
    };
    render(
      <RunnerView
        {...runnerProps}
        variant="recalls"
        onUpdateRecall={onUpdateRecall}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.click(screen.getByRole("button", { name: "Modifier la date de rappel" }));
    const dialog = screen.getByRole("dialog", { name: "Modifier la date de rappel" });
    await user.click(within(dialog).getByRole("button", { name: "20" }));
    expect(onUpdateRecall).toHaveBeenCalledWith([current.id], "2026-07-20");
  });

  it("bulk-reschedules multiple recalls from the list selection", async () => {
    const user = userEvent.setup();
    const onUpdateRecall = vi.fn();
    const a = {
      ...bob,
      id: 11,
      status: "pending" as const,
      outcome: "Appel non décroché" as const,
      recall_at: "2026-07-12",
      origin_session_id: 9,
      origin_session_name: "Séance A",
    };
    const b = {
      ...a,
      id: 12,
      contact_name: "Claire",
      recall_at: "2026-07-12",
    };
    render(
      <RunnerView
        {...runnerProps}
        variant="recalls"
        onUpdateRecall={onUpdateRecall}
        contacts={[a, b]}
        currentContact={a}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByLabelText("Sélectionner Bob Durand"));
    await user.click(screen.getByLabelText("Sélectionner Claire"));
    await user.click(screen.getByRole("button", { name: /Reporter \(2\)/i }));
    const dialog = await screen.findByRole("dialog", { name: "Reporter les rappels" });
    await user.click(within(dialog).getByRole("button", { name: "Aujourd'hui" }));
    expect(onUpdateRecall).toHaveBeenCalledWith(
      [11, 12],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("bulk-reschedules called contacts with a recall inside a classic session", async () => {
    const user = userEvent.setup();
    const onUpdateRecall = vi.fn();
    const calledA = {
      ...bob,
      id: 21,
      status: "called" as const,
      outcome: "Appel non décroché" as const,
      recall_at: "2026-07-12",
    };
    const calledB = {
      ...calledA,
      id: 22,
      contact_name: "Claire",
      recall_at: "2026-07-14",
    };
    render(
      <RunnerView
        {...runnerProps}
        onUpdateRecall={onUpdateRecall}
        contacts={[calledA, calledB]}
        currentContact={null}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByLabelText("Sélectionner Bob Durand"));
    await user.click(screen.getByLabelText("Sélectionner Claire"));
    await user.click(screen.getByRole("button", { name: /Reporter \(2\)/i }));
    const dialog = await screen.findByRole("dialog", { name: "Reporter les rappels" });
    await user.click(within(dialog).getByRole("button", { name: "Aujourd'hui" }));
    expect(onUpdateRecall).toHaveBeenCalledWith([21, 22], expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("filters the recall queue by origin session", async () => {
    const user = userEvent.setup();
    const a = {
      ...bob,
      id: 31,
      status: "pending" as const,
      outcome: "Appel non décroché" as const,
      recall_at: "2026-07-12",
      origin_session_id: 3,
      origin_session_name: "Prospection Lyon",
      attempt_count: 1,
    };
    const b = {
      ...a,
      id: 32,
      contact_name: "Claire",
      origin_session_id: 4,
      origin_session_name: "Relance Paris",
    };
    render(
      <RunnerView
        {...runnerProps}
        variant="recalls"
        contacts={[a, b]}
        currentContact={a}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.getByText("Bob Durand")).toBeTruthy();
    expect(screen.getByText("Claire")).toBeTruthy();
    expect(screen.getAllByText("2e tentative").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Prospection Lyon/i }));
    expect(screen.getByText("Bob Durand")).toBeTruthy();
    expect(screen.queryByText("Claire")).toBeNull();
  });

  it("opens the command bar with ⌘K and runs a resultat action", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: "Command bar Combo" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Appel décroché/i }));
    expect(screen.getByRole("button", { name: /Appel décroché/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("selects a resultat with digit shortcuts", async () => {
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    fireEvent.keyDown(document, { key: "F", code: "KeyF" });
    // QWERTY "3" ou AZERTY """ — on lit Digit3
    fireEvent.keyDown(document, { key: '"', code: "Digit3" });
    expect(screen.getByRole("button", { name: /Appel décroché/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens Combo command bar with ⌘K even if the OS launcher also listens", () => {
    const launcher = vi.fn((event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
      }
    });
    window.addEventListener("keydown", launcher);
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    fireEvent.keyDown(document, { key: "k", code: "KeyK", metaKey: true, bubbles: true });
    expect(screen.getByRole("dialog", { name: "Command bar Combo" })).toBeTruthy();
    expect(screen.queryByText(/pour ouvrir/i)).toBeNull();
    window.removeEventListener("keydown", launcher);
  });
  it("sets recall delay with Shift+digit via keyboard code (AZERTY-safe)", () => {
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    fireEvent.keyDown(document, { key: "F" });
    fireEvent.keyDown(document, { key: "3", code: "Digit3", shiftKey: true });
    expect(screen.getByRole("button", { name: "+3 j" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens shortcut help with ? and closes with Escape", () => {
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    fireEvent.keyDown(document, { key: "?" });
    expect(screen.getByRole("dialog", { name: "Aide raccourcis Combo" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Aide raccourcis Combo" })).toBeNull();
  });

  it("marks the combo demo as seen when dismissed with Escape", async () => {
    const { ComboOnboardingDemo } = await import("./ComboOnboardingDemo");
    const store: Record<string, string> = {};
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = String(value);
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });
    const onClose = vi.fn();
    render(<ComboOnboardingDemo open onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Démo Combo" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(store["xos-combo-demo-seen"]).toBe("1");
  });

  it("ignores digit shortcuts while typing in comments", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    const comments = screen.getByLabelText("Commentaires");
    await user.click(comments);
    await user.keyboard("3");
    expect(screen.getByRole("button", { name: /Appel non décroché/i }).getAttribute("aria-pressed")).toBe("true");
    expect((comments as HTMLTextAreaElement).value).toContain("3");
  });

  it("keeps the in-progress result and comments when changing the default recall delay", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.click(screen.getByRole("button", { name: "Appel décroché" }));
    await user.type(screen.getByPlaceholderText("Notes sur l'appel…"), "À rappeler après validation");
    await user.click(screen.getByLabelText("Planifier un rappel"));
    await user.click(screen.getByRole("button", { name: "+7 j" }));

    expect(screen.getByRole("button", { name: "Appel décroché" }).getAttribute("aria-pressed")).toBe("true");
    const comments = screen.getByLabelText("Commentaires") as HTMLTextAreaElement;
    expect(comments.value).toBe("À rappeler après validation");
    expect(comments.placeholder).toBe("Motif du rappel…");
  });

  it("opens continuation session panel from Reporter with date", async () => {
    const user = userEvent.setup();
    const onDeferContacts = vi.fn();
    const pendingA = { ...bob, id: 2, status: "pending" as const, outcome: null };
    const pendingB = { ...bob, id: 3, contact_name: "Claire", status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        session={{ ...session, name: "Prospection Lyon" }}
        onDeferContacts={onDeferContacts}
        contacts={[pendingA, pendingB]}
        currentContact={pendingA}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.queryByRole("button", { name: /Créer séance #2/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Sélectionner \(2\)/i }));
    await user.click(screen.getByRole("button", { name: "Reporter" }));
    expect(screen.getByText(/Reporter → Prospection Lyon #2/i)).toBeTruthy();
    expect(screen.getByLabelText("Date de la séance")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Créer Prospection Lyon #2/i }));
    expect(onDeferContacts).toHaveBeenCalledWith(
      [2, 3],
      expect.objectContaining({
        targetSessionId: null,
        name: "Prospection Lyon #2",
      }),
    );
  });

  it("opens defer panel for Reporter", async () => {
    const user = userEvent.setup();
    const current = { ...bob, status: "pending" as const, outcome: null };
    render(
      <RunnerView
        {...runnerProps}
        session={{ ...session, name: "Séance test" }}
        contacts={[current]}
        currentContact={current}
        awaitingEvent={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByLabelText("Sélectionner Bob Durand"));
    await user.click(screen.getByRole("button", { name: "Reporter" }));
    expect(screen.getByText(/Reporter → Séance test #2/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Créer Séance test #2/i })).toBeTruthy();
  });

  it("advances focus after Consigner & suivant when parent clears focusedContactId", async () => {
    const user = userEvent.setup();
    const onLogAndNext = vi.fn();
    const pendingA = { ...bob, id: 2, status: "pending" as const, outcome: null };
    const pendingB = {
      ...bob,
      id: 3,
      contact_name: "Claire",
      status: "pending" as const,
      outcome: null,
    };
    const { rerender } = render(
      <RunnerView
        {...runnerProps}
        contacts={[pendingA, pendingB]}
        currentContact={pendingA}
        focusedContactId={2}
        awaitingEvent={null}
        onLogAndNext={onLogAndNext}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fiche" }));
    expect(screen.getByRole("heading", { level: 3, name: "Bob Durand" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Consigner & suivant/i }));
    expect(onLogAndNext).toHaveBeenCalledWith(2, expect.any(Object));

    const calledA = { ...pendingA, status: "called" as const, outcome: "Appel non décroché" as const };
    rerender(
      <RunnerView
        {...runnerProps}
        contacts={[calledA, pendingB]}
        currentContact={pendingB}
        focusedContactId={null}
        awaitingEvent={null}
        onLogAndNext={onLogAndNext}
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Claire" })).toBeTruthy();
    expect(screen.queryByText(/Contact déjà traité/i)).toBeNull();
  });

  it("stays in list mode after bulk logging from the session list", async () => {
    const user = userEvent.setup();
    const onLogMany = vi.fn();
    const pendingA = { ...bob, id: 2, status: "pending" as const, outcome: null };
    const pendingB = {
      ...bob,
      id: 3,
      contact_name: "Claire",
      status: "pending" as const,
      outcome: null,
    };
    const { rerender } = render(
      <RunnerView
        {...runnerProps}
        contacts={[pendingA, pendingB]}
        currentContact={pendingA}
        awaitingEvent={null}
        onLogMany={onLogMany}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.getByText("Liste de la séance")).toBeTruthy();
    await user.click(screen.getByLabelText("Sélectionner Bob Durand"));
    await user.click(screen.getByRole("button", { name: /Consigner pour 1/i }));
    expect(onLogMany).toHaveBeenCalled();

    const calledA = { ...pendingA, status: "called" as const, outcome: "Appel non décroché" as const };
    rerender(
      <RunnerView
        {...runnerProps}
        contacts={[calledA, pendingB]}
        currentContact={pendingB}
        focusedContactId={null}
        awaitingEvent={null}
        onLogMany={onLogMany}
      />,
    );

    expect(screen.getByText("Liste de la séance")).toBeTruthy();
    expect(screen.queryByText("Consigner l'appel")).toBeNull();
    expect(screen.getByText("Appel non décroché")).toBeTruthy();
  });
});

describe("RecapView", () => {
  it("uses the GET outcome field and announces a follow-up error", () => {
    render(
      <RecapView
        session={{ ...session, status: "completed" }}
        contacts={[alice]}
        followUpLoading={false}
        error="Aucun contact ne nécessite de relance."
        onBack={vi.fn()}
        onCreateFollowUp={vi.fn()}
      />,
    );

    expect(screen.getByText("RDV planifié")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Aucun contact ne nécessite de relance.");
  });

  it("prefills a readable name suggestion and a date for the follow-up session, next to the non-contacted list", async () => {
    const user = userEvent.setup();
    const onCreateFollowUp = vi.fn();
    const skippedContact = {
      ...alice,
      id: 2,
      contact_name: "Bob Durand",
      status: "skipped" as const,
      outcome: null,
    };
    render(
      <RecapView
        session={{ ...session, name: "Prospection Lyon", status: "completed" }}
        contacts={[skippedContact]}
        followUpLoading={false}
        error={null}
        onBack={vi.fn()}
        onCreateFollowUp={onCreateFollowUp}
      />,
    );

    const nameInput = screen.getByLabelText("Nom de la séance 2") as HTMLInputElement;
    expect(nameInput.value).toMatch(/^Prospection Lyon — Relance /);
    expect(screen.getByLabelText("Date de la séance 2")).toBeTruthy();

    // Le bouton de préparation de la relance est juste après la liste des
    // non-contactés dans le flux visuel de la page.
    const skippedListIndex = screen.getByText("Non contactés — reportés en follow-up")
      .compareDocumentPosition(screen.getByRole("button", { name: "Préparer la relance" }));
    expect(skippedListIndex & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Préparer la relance" }));
    expect(onCreateFollowUp).toHaveBeenCalledWith(nameInput.value, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
});

describe("SessionsView hub filters", () => {
  it("filters hub sessions between upcoming and done", async () => {
    const user = userEvent.setup();
    const sessions = [
      {
        id: 1,
        name: "À faire demain",
        status: "active" as const,
        created_at: "2026-07-10T10:00:00Z",
        scheduled_for: "2026-07-12",
        session_type: "prospection" as const,
        total: 10,
        called: 2,
        skipped: 0,
        pending: 8,
      },
      {
        id: 2,
        name: "Déjà faite",
        status: "completed" as const,
        created_at: "2026-07-01T10:00:00Z",
        scheduled_for: "2026-07-01",
        session_type: "relance" as const,
        total: 5,
        called: 5,
        skipped: 0,
        pending: 0,
      },
    ];

    render(
      <SessionsView
        sessions={sessions}
        stats={null}
        recallCount={0}
        recallsLoading={false}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onNewSession={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenRecalls={vi.fn()}
        onUpdateSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    expect(screen.getByText("À faire demain")).toBeTruthy();
    expect(screen.queryByText("Déjà faite")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Réalisées/i }));
    expect(screen.getByText("Déjà faite")).toBeTruthy();
    expect(screen.queryByText("À faire demain")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Toutes$/i }));
    expect(screen.getByText("À faire demain")).toBeTruthy();
    expect(screen.getByText("Déjà faite")).toBeTruthy();
  });

  it("lists future active sessions under Planifiées with a visible badge", async () => {
    const user = userEvent.setup();
    const sessions = [
      {
        id: 1,
        name: "À lancer maintenant",
        status: "active" as const,
        created_at: "2026-07-18T10:00:00Z",
        scheduled_for: "2026-07-18",
        session_type: "prospection" as const,
        total: 10,
        called: 0,
        skipped: 0,
        pending: 10,
      },
      {
        id: 2,
        name: "Comptes stratégiques septembre",
        status: "active" as const,
        created_at: "2026-07-18T10:00:00Z",
        scheduled_for: "2099-09-15",
        session_type: "prospection" as const,
        total: 20,
        called: 0,
        skipped: 0,
        pending: 20,
      },
    ];

    render(
      <SessionsView
        sessions={sessions}
        stats={null}
        recallCount={0}
        recallsLoading={false}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onNewSession={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenRecalls={vi.fn()}
        onUpdateSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    expect(screen.getByText("À lancer maintenant")).toBeTruthy();
    expect(screen.queryByText("Comptes stratégiques septembre")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Planifiées/i }));
    expect(screen.getByText("Comptes stratégiques septembre")).toBeTruthy();
    expect(screen.queryByText("À lancer maintenant")).toBeNull();
    expect(screen.getByText("Planifiée")).toBeTruthy();
  });

  it("confirms session deletion in a custom modal", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDeleteSession = vi.fn().mockResolvedValue(undefined);
    const sessions = [
      {
        id: 1,
        name: "Secteur public",
        status: "active" as const,
        created_at: "2026-07-10T10:00:00Z",
        scheduled_for: "2026-07-12",
        session_type: "prospection" as const,
        total: 10,
        called: 2,
        skipped: 0,
        pending: 8,
      },
    ];

    render(
      <SessionsView
        sessions={sessions}
        stats={null}
        recallCount={0}
        recallsLoading={false}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onNewSession={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenRecalls={vi.fn()}
        onUpdateSession={vi.fn()}
        onDeleteSession={onDeleteSession}
      />,
    );

    confirmSpy.mockClear();
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Supprimer la séance" });
    expect(within(dialog).getByText(/Secteur public/i)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(onDeleteSession).toHaveBeenCalledWith(1));
    expect(screen.queryByRole("dialog", { name: "Supprimer la séance" })).toBeNull();

    confirmSpy.mockRestore();
  });

  it("opens the recalls queue from the hub", async () => {
    const user = userEvent.setup();
    const onOpenRecalls = vi.fn();
    render(
      <SessionsView
        sessions={[]}
        stats={null}
        recallCount={1}
        recallsLoading={false}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onNewSession={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenRecalls={onOpenRecalls}
        onUpdateSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Rappels/i }));
    expect(onOpenRecalls).toHaveBeenCalled();
  });
});

describe("PicklistMultiSelect", () => {
  it("associates its visible label with the searchable input", () => {
    render(
      <PicklistMultiSelect
        label="Secteurs"
        options={[{ value: "Finance", label: "Finance" }]}
        value={[]}
        onChange={vi.fn()}
        searchPlaceholder="Filtrer"
      />,
    );

    expect(screen.getByRole("searchbox", { name: "Secteurs" }).getAttribute("placeholder")).toBe("Filtrer");
  });

  it("shows legacy free-text values as removable obsolete chips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PicklistMultiSelect
        label="Secteurs"
        options={[{ value: "Finance", label: "Finance" }]}
        value={["Finance", "Secteur inventé"]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Secteur inventé")).toBeTruthy();
    expect(screen.getByText("(obsolète)")).toBeTruthy();
    expect(screen.getByText("2 sélectionnés")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retirer Secteur inventé" }));
    expect(onChange).toHaveBeenCalledWith(["Finance"]);
  });

  it("clears all selected values from the toolbar action", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PicklistMultiSelect
        label="Secteurs"
        options={[
          { value: "Finance", label: "Finance" },
          { value: "Transports", label: "Transports" },
        ]}
        value={["Finance", "Transports"]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Tout effacer" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("call targeting copy and controls", () => {
  const filterBuilderProps = {
    filters: emptyFilterTree(),
    onChange: vi.fn(),
    previewCount: null as number | null,
    previewLoading: false,
    matchCount: null as number | null,
    matchCountCapped: false,
    matchCountLoading: false,
    matchCountError: null,
    contactLimit: 200 as const,
    onContactLimitChange: vi.fn(),
    maxPerCompany: null as null,
    onMaxPerCompanyChange: vi.fn(),
    presets: [] as [],
    presetsLoading: false,
    savingPreset: false,
    currentUserId: "user-1",
    onLoadPreset: vi.fn(),
    onSavePreset: vi.fn(),
    onDeletePreset: vi.fn(),
  };

  it("uses CRM-generic copy and exposes dedup toggle state", () => {
    render(
      <>
        <FilterBuilder
          {...filterBuilderProps}
          team={[
            { user_id: "user-1", label: "Alice", sf_user_id: "005A" },
            { user_id: "user-2", label: "Christophe Hirtz", sf_user_id: "0055I000002lY9QQAU" },
            { user_id: "user-3", label: "Paul Rathouin", sf_user_id: "005AZ000000fLYkYAM" },
            { user_id: "user-4", label: "Jérôme Bosio", sf_user_id: "005b0000005zfnvAAA" },
            { user_id: "user-5", label: "Yanis Agharbi", sf_user_id: "005Sb000007b6dWIAQ" },
            { user_id: "user-6", label: "Théo Savoy", sf_user_id: "005AZ000000X5nDYAS" },
          ]}
        />
        <DedupBanner
          dedup={[{ sf_contact_id: "003000000000001", in_session_of: "Séance A" }]}
          mode="avertir"
          onModeChange={vi.fn()}
        />
      </>,
    );

    expect(screen.getByText("Secteurs d'activité")).toBeTruthy();
    expect(screen.getByText("Tier")).toBeTruthy();
    expect(screen.getByText("Propriétaire du compte")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Christophe Hirtz" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Paul Rathouin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Jérôme Bosio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yanis Agharbi" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Théo Savoy" })).toBeNull();
    expect(screen.getByText(/Compte principal \(ID CRM/)).toBeTruthy();
    expect(screen.getByLabelText("Contacts max")).toBeTruthy();
    expect(screen.getByLabelText("Maximum de contacts par entreprise")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Avertir" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Durée min (sec)")).toBeNull();
  });

  it("surfaces live count errors instead of the idle placeholder", () => {
    render(
      <FilterBuilder
        {...filterBuilderProps}
        matchCount={null}
        matchCountError="Salesforce a refusé la requête"
      />,
    );
    expect(screen.getByText("Comptage impossible")).toBeTruthy();
    expect(screen.queryByText("Filtres → comptage live")).toBeNull();
  });

  it("shows opportunity filter guidance when open and lost are both selected", () => {
    render(
      <FilterBuilder
        {...filterBuilderProps}
        filters={{
          ...emptyFilterTree(),
          entreprise: {
            ...emptyFilterTree().entreprise,
            opp_ouverte: true,
            opp_perdue: true,
          },
        }}
      />,
    );
    expect(screen.getByRole("note")).toBeTruthy();
    expect(screen.getByText(/ouverte.*perdue|perdue.*ouverte/i)).toBeTruthy();
  });

  it("shows guidance when lost is set to Non", () => {
    render(
      <FilterBuilder
        {...filterBuilderProps}
        filters={{
          ...emptyFilterTree(),
          entreprise: {
            ...emptyFilterTree().entreprise,
            opp_perdue: false,
          },
        }}
      />,
    );
    expect(screen.getByText(/sans opportunité au stade perdu/i)).toBeTruthy();
    const nonButtons = screen.getAllByRole("button", { name: "Non" });
    expect(nonButtons.every((btn) => !(btn as HTMLButtonElement).disabled)).toBe(true);
  });

  it("only shows preset deletion to the current preset owner", async () => {
    const user = userEvent.setup();
    render(
      <FilterBuilder
        {...filterBuilderProps}
        presets={[
          { id: 1, name: "Partagé à moi", filters: emptyFilterTree(), shared: true, owner: "user-1" },
          { id: 2, name: "Partagé par un collègue", filters: emptyFilterTree(), shared: true, owner: "user-2" },
        ]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Preset"), "2");
    expect(screen.queryByRole("button", { name: "Supprimer" })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Preset"), "1");
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeTruthy();
  });

  it("renders a normalized v2.0 preset without crashing on missing fonctions", () => {
    const legacyPreset = normalizeFilterTree({
      entreprise: { secteurs: ["Finance"] },
      contact: { a_telephone: true, exclure_npa: true },
      relance: { jamais_appele: true, duree_min_sec: 10, duree_max_sec: 90 },
    });

    render(<FilterBuilder {...filterBuilderProps} filters={legacyPreset} />);

    expect(screen.getByText("Finance")).toBeTruthy();
    expect(screen.getByText("(obsolète)")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Jamais appelé/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("Durée min (sec)")).toBeNull();
  });
});

describe("preview selection and enriched rows", () => {
  const preview = [
    {
      sf_contact_id: "003000000000001",
      sf_account_id: null,
      contact_name: "Alice Martin",
      account_name: "Acme",
      phone: "0102030405",
      title: "RF",
      linkedin_url: "https://linkedin.com/in/alice",
    },
    {
      sf_contact_id: "003000000000002",
      sf_account_id: null,
      contact_name: "Bob Durand",
      account_name: "Beta",
      phone: null,
      title: null,
      linkedin_url: null,
    },
  ];

  it("lets the user deselect contacts before launching a session", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={vi.fn()}
        contactLimit={200}
        onContactLimitChange={vi.fn()}
        maxPerCompany={null}
        onMaxPerCompanyChange={vi.fn()}
        loading={false}
        previewLoading={false}
        matchCount={null}
        matchCountCapped={false}
        matchCountLoading={false}
        matchCountError={null}
        error={null}
        preview={preview}
        dedup={[]}
        previewTruncated={false}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onLoadPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(screen.getByText("2 sélectionnés / 2")).toBeTruthy();
    const bobRow = screen.getByText("Bob Durand").closest("li");
    expect(bobRow).toBeTruthy();
    await user.click(within(bobRow!).getByRole("checkbox"));
    await user.type(screen.getByLabelText("Nom de la séance"), "Test");
    await user.click(screen.getByRole("button", { name: "Lancer la séance" }));
    expect(onCreate).toHaveBeenCalledWith(
      "Test",
      [preview[0]],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      "prospection",
      [],
    );
  });

  it("can split a normal contact list with the shared audience packing contract", async () => {
    const user = userEvent.setup();
    const onCreateAudience = vi.fn();
    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={vi.fn()}
        contactLimit={200}
        onContactLimitChange={vi.fn()}
        maxPerCompany={null}
        onMaxPerCompanyChange={vi.fn()}
        loading={false}
        previewLoading={false}
        matchCount={null}
        matchCountCapped={false}
        matchCountLoading={false}
        matchCountError={null}
        error={null}
        preview={preview}
        dedup={[]}
        previewTruncated={false}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onLoadPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
        onCreate={vi.fn()}
        onCreateAudience={onCreateAudience}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Découper en plusieurs séances/i }));
    fireEvent.change(screen.getByLabelText("Taille cible par séance"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Nombre max de séances"), { target: { value: "2" } });
    await user.type(screen.getByLabelText("Nom de la séance"), "Liste test");
    await user.click(screen.getByRole("button", { name: "Créer 2 séances" }));

    expect(onCreateAudience).toHaveBeenCalledWith(expect.objectContaining({
      targetSize: 1,
      maxSessions: 2,
      namePrefix: "Liste test",
      groups: expect.any(Array),
    }));
  });

  it("selects all preview contacts when max per company was applied at fetch time", () => {
    const cappedPreview = [
      {
        sf_contact_id: "003000000000002",
        sf_account_id: "001AAA",
        contact_name: "Bob Durand",
        account_name: "Acme",
        phone: null,
        title: "Directeur formation",
        linkedin_url: null,
      },
      {
        sf_contact_id: "003000000000003",
        sf_account_id: "001BBB",
        contact_name: "Carla Petit",
        account_name: "Beta",
        phone: null,
        title: null,
        linkedin_url: null,
      },
    ];

    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={vi.fn()}
        contactLimit={200}
        onContactLimitChange={vi.fn()}
        maxPerCompany={1}
        onMaxPerCompanyChange={vi.fn()}
        loading={false}
        previewLoading={false}
        matchCount={null}
        matchCountCapped={false}
        matchCountLoading={false}
        matchCountError={null}
        error={null}
        preview={cappedPreview}
        dedup={[]}
        previewTruncated={false}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onLoadPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText("2 sélectionnés / 2")).toBeTruthy();
    expect(screen.getByText(/max 1\/entreprise/i)).toBeTruthy();
  });

  it("shows a partial-results banner when the fetch was truncated", () => {
    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={vi.fn()}
        contactLimit={200}
        onContactLimitChange={vi.fn()}
        maxPerCompany={null}
        onMaxPerCompanyChange={vi.fn()}
        loading={false}
        previewLoading={false}
        matchCount={null}
        matchCountCapped={false}
        matchCountLoading={false}
        matchCountError={null}
        error={null}
        preview={preview}
        dedup={[]}
        previewTruncated
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onLoadPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText(/Résultats partiels/i)).toBeTruthy();
  });
});

describe("dedup modes in preview selection", () => {
  const preview = [
    {
      sf_contact_id: "003000000000001",
      sf_account_id: null,
      contact_name: "Alice Martin",
      account_name: "Acme",
      phone: "0102030405",
      title: "RF",
      linkedin_url: null,
    },
    {
      sf_contact_id: "003000000000002",
      sf_account_id: null,
      contact_name: "Bob Durand",
      account_name: "Beta",
      phone: null,
      title: null,
      linkedin_url: null,
    },
  ];
  const dedup = [{ sf_contact_id: "003000000000001", in_session_of: "Paul" }];

  const baseProps = {
    filters: emptyFilterTree(),
    onFiltersChange: vi.fn(),
    contactLimit: 200 as const,
    onContactLimitChange: vi.fn(),
    maxPerCompany: null as null,
    onMaxPerCompanyChange: vi.fn(),
    loading: false,
    previewLoading: false,
    matchCount: null as number | null,
    matchCountCapped: false,
    matchCountLoading: false,
    matchCountError: null,
    error: null,
    preview,
    dedup,
    previewTruncated: false,
    presets: [] as [],
    presetsLoading: false,
    savingPreset: false,
    currentUserId: "user-1",
    onBack: vi.fn(),
    onLoadPreset: vi.fn(),
    onSavePreset: vi.fn(),
    onDeletePreset: vi.fn(),
    onCreate: vi.fn(),
  };

  it("keeps duplicates checked and tagged in Avertir mode", () => {
    render(<NewSessionView {...baseProps} />);

    expect(screen.getByText("Déjà en séance — Paul")).toBeTruthy();
    const aliceRow = screen.getByText("Alice Martin").closest("li");
    expect((within(aliceRow!).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("2 sélectionnés / 2")).toBeTruthy();
  });

  it("unchecks duplicates by default but keeps the warning tag in Exclure mode", async () => {
    const user = userEvent.setup();
    render(<NewSessionView {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Exclure" }));
    expect(screen.getByText("Déjà en séance — Paul")).toBeTruthy();
    const aliceRow = screen.getByText("Alice Martin").closest("li");
    expect((within(aliceRow!).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("1 sélectionné / 2")).toBeTruthy();
  });
});

describe("error announcements", () => {
  it("announces a new-session error to assistive technology", () => {
    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={vi.fn()}
        contactLimit={200}
        onContactLimitChange={vi.fn()}
        maxPerCompany={null}
        onMaxPerCompanyChange={vi.fn()}
        loading={false}
        previewLoading={false}
        matchCount={null}
        matchCountCapped={false}
        matchCountLoading={false}
        matchCountError={null}
        error="Échec d'enregistrement de la liste d'appels (base de données)"
        preview={[]}
        dedup={[]}
        previewTruncated={false}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onLoadPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Échec d'enregistrement de la liste d'appels (base de données)",
    );
  });
});
