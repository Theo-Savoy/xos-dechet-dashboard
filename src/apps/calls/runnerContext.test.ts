import { describe, expect, it } from "vitest";
import { pendingContactsAhead, resolveContextContactId } from "./runnerContext";
import type { SessionContact } from "./types";

const base = {
  position: 0,
  sf_contact_id: "003",
  sf_account_id: null,
  account_name: null,
  phone: null,
  title: null,
  linkedin_url: null,
  outcome: null,
  comments: null,
  sf_task_id: null,
  sf_event_id: null,
  called_at: null,
} as const;

describe("resolveContextContactId", () => {
  const contacts: SessionContact[] = [
    { ...base, id: 1, contact_name: "Alice", status: "called" },
    { ...base, id: 2, contact_name: "Bob", status: "pending" },
  ];

  it("prefers awaiting event contact", () => {
    expect(resolveContextContactId(contacts, 1, 2)).toBe(1);
  });

  it("keeps focused contact even when already called (recall inbox)", () => {
    expect(resolveContextContactId(contacts, null, 1)).toBe(1);
  });

  it("falls back to next pending when focus is missing", () => {
    expect(resolveContextContactId(contacts, null, 99)).toBe(2);
  });

  it("keeps focused pending contact when user opened their fiche", () => {
    expect(resolveContextContactId(contacts, null, 2)).toBe(2);
  });
});

describe("pendingContactsAhead", () => {
  const contacts: SessionContact[] = [
    { ...base, id: 1, contact_name: "A", status: "pending" },
    { ...base, id: 2, contact_name: "B", status: "called" },
    { ...base, id: 3, contact_name: "C", status: "pending" },
    { ...base, id: 4, contact_name: "D", status: "pending" },
    { ...base, id: 5, contact_name: "E", status: "pending" },
  ];

  it("takes the next pending rows after the current contact", () => {
    expect(pendingContactsAhead(contacts, 1, 2).map((c) => c.id)).toEqual([3, 4]);
  });

  it("does not prefetch earlier pending contacts when focus jumped ahead", () => {
    expect(pendingContactsAhead(contacts, 3, 5).map((c) => c.id)).toEqual([4, 5]);
  });

  it("starts from the beginning when there is no current contact", () => {
    expect(pendingContactsAhead(contacts, null, 2).map((c) => c.id)).toEqual([1, 3]);
  });
});
