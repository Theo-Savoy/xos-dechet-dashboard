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
  it("keeps the logged contact in the prioritized event panel", () => {
    render(
      <RunnerView
        session={session}
        contacts={[alice, bob]}
        currentContact={bob}
        loading={false}
        error={null}
        awaitingEvent={alice}
        onBack={vi.fn()}
        onLogAndNext={vi.fn()}
        onLogEvent={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "RDV planifié — Alice Martin" })).toBeTruthy();
  });

  it("shows title and LinkedIn on the contact card", () => {
    const current = { ...bob, title: "RF", linkedin_url: "https://linkedin.com/in/bob" };
    render(
      <RunnerView
        session={session}
        contacts={[current]}
        currentContact={current}
        loading={false}
        error={null}
        awaitingEvent={null}
        onBack={vi.fn()}
        onLogAndNext={vi.fn()}
        onLogEvent={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText("RF")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Profil LinkedIn" }).getAttribute("href")).toBe(
      "https://linkedin.com/in/bob",
    );
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
    await user.click(screen.getByRole("button", { name: "Retirer Secteur inventé" }));
    expect(onChange).toHaveBeenCalledWith(["Finance"]);
  });
});

describe("call targeting copy and controls", () => {
  const filterBuilderProps = {
    filters: emptyFilterTree(),
    onChange: vi.fn(),
    previewCount: null as number | null,
    previewLoading: false,
    contactLimit: 200 as const,
    onContactLimitChange: vi.fn(),
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
        loading={false}
        previewLoading={false}
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
    expect(onCreate).toHaveBeenCalledWith("Test", [preview[0]], expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("caps selection to N contacts from the same company", async () => {
    const user = userEvent.setup();
    const sameCompanyPreview = [
      {
        sf_contact_id: "003000000000001",
        sf_account_id: "001AAA",
        contact_name: "Alice Martin",
        account_name: "Acme",
        phone: "0102030405",
        title: "RF",
        linkedin_url: null,
      },
      {
        sf_contact_id: "003000000000002",
        sf_account_id: "001AAA",
        contact_name: "Bob Durand",
        account_name: "Acme",
        phone: null,
        title: null,
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
        loading={false}
        previewLoading={false}
        error={null}
        preview={sameCompanyPreview}
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

    expect(screen.getByText("3 sélectionnés / 3")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Maximum de contacts par entreprise"), "1");
    expect(screen.getByText("2 sélectionnés / 3")).toBeTruthy();

    const bobRow = screen.getByText("Bob Durand").closest("li");
    expect((within(bobRow!).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((within(bobRow!).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
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
    loading: false,
    previewLoading: false,
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
        loading={false}
        previewLoading={false}
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
