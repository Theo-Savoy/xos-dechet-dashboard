// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreSessionFlow } from "./PreSessionFlow";
import type { SessionContact, SessionDetail } from "./types";

const callsCss = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  return fs.readFileSync("src/apps/calls/calls.css", "utf8");
});

afterEach(cleanup);

const session: SessionDetail = {
  id: 1,
  name: "Séance test",
  status: "active",
  created_at: "2026-07-10T10:00:00Z",
};

const contact: SessionContact = {
  id: 1,
  position: 1,
  sf_contact_id: "003000000000001",
  sf_account_id: "001000000000001",
  contact_name: "Alice Martin",
  account_name: "Acme",
  phone: "0102030405",
  title: "Responsable formation",
  linkedin_url: null,
  status: "pending",
  outcome: null,
  comments: null,
  sf_task_id: null,
  sf_event_id: null,
  called_at: null,
};

describe("PreSessionFlow", () => {
  it("closes on Escape and restores focus to the element that opened it", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onCancel = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <PreSessionFlow
          session={session}
          contacts={[contact]}
          onLaunch={vi.fn().mockResolvedValue(undefined)}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      ) : null;
    }

    render(<Harness />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("offers objectives as accessible selection chips from 1 to 8", async () => {
    const user = userEvent.setup();
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Définir mon objectif" }));
    expect(screen.getAllByRole("button", { name: /RDV$/ })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "5 RDV" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "6 RDV" }));
    expect(screen.getByRole("button", { name: "6 RDV" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Objectif choisi : 6 RDV/)).toBeTruthy();
  });

  it("shows the current phase in a clear preparation indicator", () => {
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("list", { name: "Étapes de préparation" })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: /Revue.*en cours/i })).toBeTruthy();
  });

  it("lets a valid objective start the accessible warmup countdown", async () => {
    const user = userEvent.setup();
    render(
      <PreSessionFlow
        session={session}
        contacts={[contact]}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Définir mon objectif" }));
    await user.click(screen.getByRole("button", { name: "6 RDV" }));
    await user.click(screen.getByRole("button", { name: "Lancer le warmup" }));

    expect(screen.getByRole("status").textContent).toContain("3");
    expect(screen.getByText(/Respire\. Une conversation à la fois\./)).toBeTruthy();
  });

  it("exposes the pre-session responsive safeguards in the calls stylesheet", async () => {
    expect(callsCss).toContain(".calls-pre-session");
    expect(callsCss).toContain("max-height: calc(100dvh - 2rem)");
    expect(callsCss).toContain(".calls-pre-session__accounts");
    expect(callsCss).toContain("backdrop-filter: blur(24px) saturate(145%)");
    expect(callsCss).toContain(".calls-stat__progress");
    expect(callsCss).toContain(".calls-stat--rdv-heat-1");
  });
});
