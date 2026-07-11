// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("blocks a past event with an inline alert", async () => {
    const user = userEvent.setup();
    render(<EventPanel contactName="Alice" loading={false} onSubmit={vi.fn()} />);

    await user.clear(screen.getByLabelText("Date & heure"));
    await user.type(screen.getByLabelText("Date & heure"), "2000-01-01T10:00");
    await user.click(screen.getByRole("button", { name: /enregistrer le rdv/i }));

    expect(screen.getByRole("alert").textContent?.toLowerCase()).toContain("date");
  });

  it("labels invitees as CRM IDs and rejects an invalid ID before submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<EventPanel contactName="Alice" loading={false} onSubmit={onSubmit} />);

    const invitees = screen.getByLabelText("IDs CRM");
    await user.type(invitees, "not-an-id{Enter}");
    await user.click(screen.getByRole("button", { name: /enregistrer le rdv/i }));

    expect(screen.getByRole("alert").textContent).toContain("15 ou 18");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("RunnerView", () => {
  const runnerProps = {
    session,
    hubSessions: [] as [],
    loading: false,
    error: null as string | null,
    contactContext: null,
    contextLoading: false,
    onBack: vi.fn(),
    onFocusContact: vi.fn(),
    onLogAndNext: vi.fn(),
    onLogRdvAndNext: vi.fn(),
    onLogEvent: vi.fn(),
    onDeferContacts: vi.fn(),
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
    expect(screen.getByText("RF")).toBeTruthy();
    expect(screen.getByRole("link", { name: "LinkedIn" }).getAttribute("href")).toBe(
      "https://linkedin.com/in/bob",
    );
    expect(screen.getByRole("button", { name: "Appel argumenté" })).toBeTruthy();
    expect(screen.queryByLabelText("Durée (secondes)")).toBeNull();
    expect(screen.getByText("Contacts")).toBeTruthy();
    expect(screen.getByText("Restant")).toBeTruthy();
  });

  it("toggles to list mode with session statuses", () => {
    render(
      <RunnerView
        {...runnerProps}
        contacts={[alice, bob]}
        currentContact={bob}
        awaitingEvent={null}
      />,
    );

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
    expect(screen.getByRole("button", { name: "Logguer appel + RDV & suivant" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Logguer & suivant" })).toBeNull();
  });

  it("exposes poste, email and phone in the session list", () => {
    render(
      <RunnerView
        {...runnerProps}
        contacts={[alice, bob]}
        currentContact={bob}
        awaitingEvent={null}
      />,
    );

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
    expect(screen.getByLabelText("Date de rappel")).toBeTruthy();
    expect(screen.getByLabelText("Définir la date de rappel dans X jours")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Logguer & suivant/i }));
    expect(onLogAndNext).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        resultat: "Appel décroché",
        recallAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("opens defer panel for Non contacté", async () => {
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

    await user.click(screen.getByLabelText("Sélectionner Bob Durand"));
    await user.click(screen.getByRole("button", { name: "Non contacté" }));
    expect(screen.getByText(/Associer à une séance existante/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Créer une séance de relance" })).toBeTruthy();
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
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onNewSession={vi.fn()}
        onOpenSession={vi.fn()}
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
    contactLimit: 200 as const,
    onContactLimitChange: vi.fn(),
    maxPerCompany: null as null,
    onMaxPerCompanyChange: vi.fn(),
    onPreview: vi.fn(),
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
        <FilterBuilder {...filterBuilderProps} />
        <DedupBanner
          dedup={[{ sf_contact_id: "003000000000001", in_session_of: "Séance A" }]}
          mode="avertir"
          onModeChange={vi.fn()}
        />
      </>,
    );

    expect(screen.getByText("Secteurs d'activité")).toBeTruthy();
    expect(screen.getByText("Tier")).toBeTruthy();
    expect(screen.getByText(/Compte principal \(ID CRM/)).toBeTruthy();
    expect(screen.getByLabelText("Contacts max")).toBeTruthy();
    expect(screen.getByLabelText("Maximum de contacts par entreprise")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Avertir" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("Sales" + "force");
    expect(screen.queryByText("Durée min (sec)")).toBeNull();
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

    expect(screen.getByLabelText("Finance")).toBeTruthy();
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
        error={null}
        preview={preview}
        dedup={[]}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onPreview={vi.fn()}
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
    );
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
        error={null}
        preview={cappedPreview}
        dedup={[]}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onPreview={vi.fn()}
        onLoadPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText("2 sélectionnés / 2")).toBeTruthy();
    expect(screen.getByText(/max 1\/entreprise/i)).toBeTruthy();
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
    error: null,
    preview,
    dedup,
    presets: [] as [],
    presetsLoading: false,
    savingPreset: false,
    currentUserId: "user-1",
    onBack: vi.fn(),
    onPreview: vi.fn(),
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
        error="Échec d'enregistrement de la liste d'appels (base de données)"
        preview={[]}
        dedup={[]}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={vi.fn()}
        onPreview={vi.fn()}
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
