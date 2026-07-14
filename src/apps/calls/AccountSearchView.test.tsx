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

describe("AccountSearchView", () => {
  it("searches, renders grouped account cards, and lets the user multi-select before creating a session", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({
      accounts: [acme, acmeSubsidiary],
      truncated: false,
    });
    const onCreateAbmSession = vi.fn();

    render(
      <AccountSearchView token="token-123" onBack={vi.fn()} onCreateAbmSession={onCreateAbmSession} />,
    );

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

    await user.click(screen.getByRole("button", { name: "Créer séance ABM" }));
    expect(onCreateAbmSession).toHaveBeenCalledWith(
      expect.arrayContaining(["001000000000001AAA", "001000000000002AAA"]),
    );
  });

  it("shows an error message when the search fails", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({ accounts: [], truncated: false });

    render(<AccountSearchView token="token-123" onBack={vi.fn()} onCreateAbmSession={vi.fn()} />);

    await user.type(screen.getByLabelText("Nom du compte"), "INCONNU");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));

    expect(await screen.findByText("Aucun compte ne correspond à cette recherche.")).toBeTruthy();
  });

  it("disables the create-session button until at least one account is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAccountsSearch).mockResolvedValue({ accounts: [acme], truncated: false });

    render(<AccountSearchView token="token-123" onBack={vi.fn()} onCreateAbmSession={vi.fn()} />);

    await user.type(screen.getByLabelText("Nom du compte"), "ACME");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));
    await screen.findByText("ACME");

    const createButton = screen.getByRole("button", { name: "Créer séance ABM" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });
});
