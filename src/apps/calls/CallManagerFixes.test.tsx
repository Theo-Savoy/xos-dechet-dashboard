// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventPanel } from "./EventPanel";
import { DedupBanner } from "./DedupBanner";
import { FilterBuilder } from "./FilterBuilder";
import { NewSessionView } from "./NewSessionView";
import { RecapView } from "./RecapView";
import { RunnerView } from "./RunnerView";
import { TagInput } from "./filterControls";
import type { SessionContact, SessionDetail } from "./types";
import { emptyFilterTree } from "../../crm";

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

describe("TagInput", () => {
  it("associates its visible label with the editable input", () => {
    render(<TagInput label="Secteurs" value={[]} onChange={vi.fn()} placeholder="Finance" />);

    expect((screen.getByLabelText("Secteurs") as HTMLInputElement).placeholder).toBe("Finance");
  });
});

describe("call targeting copy and controls", () => {
  it("uses CRM-generic copy and exposes dedup toggle state", () => {
    render(
      <>
        <FilterBuilder
          filters={emptyFilterTree()}
          onChange={vi.fn()}
          previewCount={null}
          previewLoading={false}
          onPreview={vi.fn()}
          presets={[]}
          presetsLoading={false}
          savingPreset={false}
          currentUserId="user-1"
          onLoadPreset={vi.fn()}
          onSavePreset={vi.fn()}
          onDeletePreset={vi.fn()}
        />
        <DedupBanner
          dedup={[{ sf_contact_id: "003000000000001", in_session_of: "Séance A" }]}
          mode="avertir"
          onModeChange={vi.fn()}
        />
      </>,
    );

    expect(screen.getByText("Secteurs d’activité")).toBeTruthy();
    expect(screen.getByText(/Compte principal \(ID CRM/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Avertir" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("Sales" + "force");
  });

  it("only shows preset deletion to the current preset owner", async () => {
    const user = userEvent.setup();
    render(
      <FilterBuilder
        filters={emptyFilterTree()}
        onChange={vi.fn()}
        previewCount={null}
        previewLoading={false}
        onPreview={vi.fn()}
        presets={[
          { id: 1, name: "Partagé à moi", filters: emptyFilterTree(), shared: true, owner: "user-1" },
          { id: 2, name: "Partagé par un collègue", filters: emptyFilterTree(), shared: true, owner: "user-2" },
        ]}
        presetsLoading={false}
        savingPreset={false}
        currentUserId="user-1"
        onLoadPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Preset"), "2");
    expect(screen.queryByRole("button", { name: "Supprimer" })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Preset"), "1");
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeTruthy();
  });
});

describe("error announcements", () => {
  it("announces a new-session error to assistive technology", () => {
    render(
      <NewSessionView
        filters={emptyFilterTree()}
        onFiltersChange={vi.fn()}
        loading={false}
        previewLoading={false}
        error="Une erreur est survenue."
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

    expect(screen.getByRole("alert").textContent).toContain("Une erreur est survenue.");
  });
});
