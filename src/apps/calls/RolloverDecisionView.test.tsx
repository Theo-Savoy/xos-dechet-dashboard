// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RolloverDecisionView } from "./RolloverDecisionView";
import type { SessionContact, SessionDetail } from "./types";

afterEach(cleanup);

const session: SessionDetail = {
  id: 7,
  name: "Prospection Lyon",
  status: "completed",
  created_at: "2026-07-15T10:00:00Z",
  scheduled_for: "2026-07-15",
};

const contact = (id: number, name: string): SessionContact => ({
  id,
  position: id,
  sf_contact_id: `00300000000000${id}`,
  sf_account_id: null,
  contact_name: name,
  account_name: "Acme",
  phone: null,
  title: null,
  linkedin_url: null,
  status: "pending",
  outcome: null,
  comments: null,
  sf_task_id: null,
  sf_event_id: null,
  called_at: null,
});

describe("RolloverDecisionView", () => {
  it("uses action buttons per contact and requires confirmation before bulk removal", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <RolloverDecisionView
        session={session}
        contacts={[contact(1, "Alice Martin"), contact(2, "Bruno Martin")]}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retirer" }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Contacter Alice Martin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retirer Alice Martin" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Appliquer les décisions" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Confirmer le retrait" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retirer les 2 contacts" }));
    expect(onApply).toHaveBeenCalledWith([
      { contactId: 1, action: "remove", scheduledFor: null },
      { contactId: 2, action: "remove", scheduledFor: null },
    ]);
  });

  it("provides a working route back to Combo", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RolloverDecisionView
        session={session}
        contacts={[contact(1, "Alice Martin")]}
        onApply={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Retour à Combo/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
