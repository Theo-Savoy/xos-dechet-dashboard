// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunnerView } from "./RunnerView";
import type { SessionContact, SessionDetail } from "./types";

const callsCss = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  return fs.readFileSync("src/apps/calls/calls.css", "utf8");
});

beforeEach(() => {
  window.localStorage?.setItem("xos-combo-demo-seen", "1");
  window.localStorage?.setItem("xos-combo-sounds", "0");
});

afterEach(() => {
  cleanup();
});

const session: SessionDetail = {
  id: 1,
  name: "Séance test",
  status: "active",
  created_at: "2026-07-10T10:00:00Z",
};

const bob = {
  id: 2,
  position: 1,
  sf_contact_id: "003000000000002",
  sf_account_id: null,
  contact_name: "Bob Durand",
  account_name: "Acme",
  phone: "0102030405",
  email: "bob@acme.fr",
  title: "Responsable formation",
  linkedin_url: null,
  status: "pending",
  outcome: null,
  comments: null,
  sf_task_id: null,
  sf_event_id: null,
  called_at: null,
} as SessionContact;

const alice = { ...bob, id: 3, contact_name: "Alice Martin" } as SessionContact;

const baseProps = {
  session,
  hubSessions: [] as [],
  loading: false,
  error: null as string | null,
  contactContext: null,
  contextContactId: null,
  awaitingEvent: null,
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

function contactCards(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".calls-contact-card"));
}

describe("RunnerView contact card transition", () => {
  it("starts idle on the first focused contact", () => {
    render(<RunnerView {...baseProps} contacts={[bob]} currentContact={bob} />);
    expect(screen.getByRole("heading", { name: "Bob Durand" })).toBeTruthy();
    expect(contactCards()).toHaveLength(1);
    expect(contactCards()[0]?.className).toContain("calls-contact-card--idle");
  });

  it("keeps a single card and fades text during the transition", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <RunnerView {...baseProps} contacts={[bob, alice]} currentContact={bob} />,
    );

    rerender(
      <RunnerView
        {...baseProps}
        contacts={[{ ...bob, status: "called" }, alice]}
        currentContact={alice}
      />,
    );

    // Un seul conteneur : texte déjà swapé, fade-in en cours.
    expect(contactCards()).toHaveLength(1);
    expect(contactCards()[0]?.className).toContain("calls-contact-card--incoming");
    expect(screen.getByRole("heading", { name: "Alice Martin" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(contactCards()).toHaveLength(1);
    expect(contactCards()[0]?.className).toContain("calls-contact-card--idle");
    vi.useRealTimers();
  });

  it("activates incoming then idle classes during the fade", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <RunnerView {...baseProps} contacts={[bob, alice]} currentContact={bob} />,
    );

    rerender(
      <RunnerView
        {...baseProps}
        contacts={[{ ...bob, status: "called" }, alice]}
        currentContact={alice}
      />,
    );

    const incoming = contactCards().find((card) => card.className.includes("calls-contact-card--incoming"));
    expect(incoming).toBeTruthy();

    act(() => {
      vi.runAllTimers();
    });

    expect(contactCards()[0]?.className).toContain("calls-contact-card--idle");
    vi.useRealTimers();
  });

  it("cleans up transition timers on unmount", () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { rerender, unmount } = render(
      <RunnerView {...baseProps} contacts={[bob, alice]} currentContact={bob} />,
    );

    rerender(
      <RunnerView
        {...baseProps}
        contacts={[{ ...bob, status: "called" }, alice]}
        currentContact={alice}
      />,
    );

    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it("includes reduced-motion rules for contact card transitions", () => {
    expect(callsCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(callsCss).toContain(".calls-contact-card--outgoing");
    expect(callsCss).toContain(".calls-contact-card--incoming");
  });

  it("shows a checkmark for 600ms right after a successful log", () => {
    vi.useFakeTimers();
    render(<RunnerView {...baseProps} contacts={[bob]} currentContact={bob} />);

    expect(document.querySelector(".calls-log-checkmark")).toBeNull();
    act(() => {
      screen.getByRole("button", { name: /Consigner & suivant/i }).click();
    });
    expect(document.querySelector(".calls-log-checkmark")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(document.querySelector(".calls-log-checkmark")).toBeNull();
    vi.useRealTimers();
  });
});
