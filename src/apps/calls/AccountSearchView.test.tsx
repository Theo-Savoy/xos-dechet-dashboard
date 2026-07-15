// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSearchView } from "./AccountSearchView";
import { fetchAccountsSearch } from "./api";
import type { AccountSearchHit } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, fetchAccountsSearch: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const acme: AccountSearchHit = {
  id: "001000000000001AAA",
  name: "ACME",
  industry: "Services informatiques",
  owner_name: "Paul Martin",
  type_client: "Client",
  tier: "A",
  effectif: "251 - 500",
  contacts: [
    {
      sf_contact_id: "003000000000001AAA",
      contact_name: "Marie Dupont",
      title: "Responsable formation",
      phone: null,
      mobile_phone: "+33600000000",
      email: "marie@acme.fr",
      decision_level: "+",
    },
  ],
};

const acmeSubsidiary: AccountSearchHit = {
  id: "001000000000002AAA",
  name: "ACME Europe",
  industry: "Services informatiques",
  owner_name: "Paul Martin",
  type_client: "Prospect",
  tier: "B",
  effectif: "51 - 250",
  contacts: [
    {
      sf_contact_id: "003000000000002AAA",
      contact_name: "Jean Petit",
      title: "Directeur formation",
      phone: null,
      mobile_phone: "+33600000001",
      email: "jean@acme-europe.fr",
      decision_level: "+",
    },
    {
      sf_contact_id: "003000000000003AAA",
      contact_name: "Alice Martin",
      title: "Chargée de formation",
      phone: null,
      mobile_phone: "+33600000002",
      email: "alice@acme-europe.fr",
      decision_level: "-",
    },
  ],
};

const zeroContactAccount: AccountSearchHit = {
  id: "001000000000003AAA",
  name: "Wayne Enterprises",
  industry: null,
  owner_name: null,
  type_client: null,
  tier: null,
  effectif: null,
  contacts: [],
};

function renderView(overrides: Partial<Parameters<typeof AccountSearchView>[0]> = {}) {
  const onCreateAudience = vi.fn();
  const utils = render(
    <AccountSearchView
      token="token-123"
      onBack={vi.fn()}
      onCreateAudience={onCreateAudience}
      creating={false}
      createError={null}
      {...overrides}
    />,
  );
  return { ...utils, onCreateAudience };
}

describe("AccountSearchView", () => {
  it("searches, renders grouped account cards, previews the FFD packing, and creates audience sessions", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({
      accounts: [acme, acmeSubsidiary],
      truncated: false,
    });
    const { onCreateAudience } = renderView();

    await user.type(screen.getByLabelText("Nom du compte"), "ACME");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));

    await waitFor(() => expect(fetchAccountsSearch).toHaveBeenCalledWith("token-123", { q: "ACME", filters: expect.any(Object) }));

    expect(await screen.findByText("ACME")).toBeTruthy();
    expect(screen.getByText("ACME Europe")).toBeTruthy();
    expect(screen.getByText("1 contact")).toBeTruthy();
    expect(screen.getByText("2 contacts")).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: "Sélectionner ACME" }));
    expect(screen.getByText(/1 contact dans 1 compte sélectionné/)).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: "Sélectionner ACME Europe" }));
    expect(screen.getByText(/3 contacts dans 2 comptes sélectionnés/)).toBeTruthy();

    expect(screen.getByText("Aperçu : 1 séance")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Créer 1 séance ABM" }));
    expect(onCreateAudience).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          expect.objectContaining({
            account_ids: expect.arrayContaining(["001000000000001AAA", "001000000000002AAA"]),
          }),
        ],
        targetSize: 50,
        maxSessions: 5,
        namePrefix: "ACME",
        excludedCount: 0,
      }),
    );
  });

  it("allows searching with filters only (no name)", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({ accounts: [acme], truncated: false });
    renderView();

    const searchButton = screen.getByRole("button", { name: "Rechercher" }) as HTMLButtonElement;
    expect(searchButton.disabled).toBe(true);

    await user.click(screen.getByText("Filtres entreprise"));
    await user.click(screen.getByRole("button", { name: "A" }));

    expect(searchButton.disabled).toBe(false);
    await user.click(searchButton);

    await waitFor(() => expect(fetchAccountsSearch).toHaveBeenCalledWith("token-123", { q: "", filters: expect.objectContaining({ tiers: ["A"] }) }));
  });

  it("shows an error message when the search fails", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({ accounts: [], truncated: false });

    renderView();

    await user.type(screen.getByLabelText("Nom du compte"), "INCONNU");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));

    expect(await screen.findByText("Aucun compte ne correspond à cette recherche.")).toBeTruthy();
  });

  it("shows a clear message when every selected contact is already excluded", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({ accounts: [zeroContactAccount], truncated: false, excluded_count: 1 });

    renderView();

    await user.type(screen.getByLabelText("Nom du compte"), "Wayne");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));
    await screen.findByText("Wayne Enterprises");

    await user.click(screen.getByRole("checkbox", { name: "Sélectionner Wayne Enterprises" }));

    expect(screen.getByText("Tous les contacts sélectionnés sont déjà en séance active. Aucune séance ne sera créée.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Créer .* séance/ })).toBeNull();
  });

  it("does not show the packing panel until at least one account is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({ accounts: [acme], truncated: false });

    renderView();

    await user.type(screen.getByLabelText("Nom du compte"), "ACME");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));
    await screen.findByText("ACME");

    expect(screen.queryByText("Découper en plusieurs séances")).toBeNull();
  });
});
