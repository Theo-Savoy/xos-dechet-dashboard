import { describe, expect, it } from "vitest";
import { resolveContextContactId } from "./runnerContext";
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
