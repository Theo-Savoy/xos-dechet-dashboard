// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewSessionView } from "./NewSessionView";
import { emptyFilterTree } from "../../crm";
import type { ContactPreview } from "./types";

afterEach(cleanup);

const noop = vi.fn();

function baseProps(preview: ContactPreview[] = [], previewLoading = false) {
  return {
    filters: emptyFilterTree(),
    onFiltersChange: noop,
    contactLimit: 100 as const,
    onContactLimitChange: noop,
    maxPerCompany: null,
    onMaxPerCompanyChange: noop,
    loading: false,
    previewLoading,
    matchCount: null,
    matchCountCapped: false,
    matchCountLoading: false,
    matchCountError: null,
    error: null,
    preview,
    dedup: [],
    previewTruncated: false,
    presets: [],
    presetsLoading: false,
    savingPreset: false,
    currentUserId: "user-1",
    onBack: noop,
    onLoadPreset: noop,
    onSavePreset: noop,
    onDeletePreset: noop,
    onCreate: noop,
  };
}

describe("NewSessionView — UX writing (spec §4.3)", () => {
  it("labels account-precise targeting as 'Comptes précis (ABM)' rather than jargon", () => {
    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={noop}
        contactLimit={100}
        onContactLimitChange={noop}
        maxPerCompany={null}
        onMaxPerCompanyChange={noop}
        loading={false}
        previewLoading={false}
        matchCount={null}
        matchCountCapped={false}
        matchCountLoading={false}
        matchCountError={null}
        error={null}
        preview={[]}
        dedup={[]}
        previewTruncated={false}
        presets={[]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onBack={noop}
        onOpenAccountSearch={noop}
        onLoadPreset={noop}
        onSavePreset={noop}
        onDeletePreset={noop}
        onCreate={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Comptes précis (ABM)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mode ABM" })).toBeNull();
  });

  it("shows the live preview count in plain terrain language", () => {
    const preview = [
      {
        sf_contact_id: "003a",
        sf_account_id: "001a",
        contact_name: "Alice Martin",
        account_name: "Acme",
        phone: "0102030405",
      },
    ];
    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={noop}
        contactLimit={100}
        onContactLimitChange={noop}
        maxPerCompany={null}
        onMaxPerCompanyChange={noop}
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
        onBack={noop}
        onLoadPreset={noop}
        onSavePreset={noop}
        onDeletePreset={noop}
        onCreate={noop}
      />,
    );
    expect(screen.getByRole("heading", { name: "Aperçu — 1 contact trouvé" })).toBeTruthy();
  });

  it("never renders a manual preview button — the list refreshes on its own", () => {
    render(<NewSessionView {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "Aperçu de la liste" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prévisualiser" })).toBeNull();
  });

  it("shows a 'Mise à jour…' status while a refresh is in flight", () => {
    render(<NewSessionView {...baseProps([], true)} />);
    expect(screen.getByText("Mise à jour…")).toBeTruthy();
  });

  it("keeps existing selections across a preview refresh and only drops contacts that disappeared", async () => {
    const user = userEvent.setup();
    const alice: ContactPreview = {
      sf_contact_id: "003a",
      sf_account_id: "001a",
      contact_name: "Alice Martin",
      account_name: "Acme",
      phone: "0102030405",
    };
    const bruno: ContactPreview = {
      sf_contact_id: "003b",
      sf_account_id: "001a",
      contact_name: "Bruno Martin",
      account_name: "Acme",
      phone: "0102030406",
    };
    const chloe: ContactPreview = {
      sf_contact_id: "003c",
      sf_account_id: "001b",
      contact_name: "Chloé Dupont",
      account_name: "Beta",
      phone: "0102030407",
    };

    const isChecked = (label: string) =>
      (screen.getByLabelText(label) as HTMLInputElement).checked;

    const { rerender } = render(<NewSessionView {...baseProps([alice, bruno])} />);

    // Chargement initial : tout est sélectionné par défaut.
    expect(isChecked("Sélectionner Alice Martin")).toBe(true);
    expect(isChecked("Sélectionner Bruno Martin")).toBe(true);

    // L'utilisateur désélectionne manuellement Bruno.
    await user.click(screen.getByLabelText("Sélectionner Bruno Martin"));
    expect(isChecked("Sélectionner Bruno Martin")).toBe(false);

    // Un refresh live (nouveau filtre) renvoie Alice + un nouveau contact,
    // Bruno a disparu de la liste.
    rerender(<NewSessionView {...baseProps([alice, chloe])} />);

    // Alice reste sélectionnée (sa sélection manuelle/initiale survit),
    // le nouveau contact n'est pas auto-sélectionné, Bruno a disparu.
    expect(isChecked("Sélectionner Alice Martin")).toBe(true);
    expect(screen.queryByLabelText("Sélectionner Bruno Martin")).toBeNull();
    expect(isChecked("Sélectionner Chloé Dupont")).toBe(false);
  });
});
