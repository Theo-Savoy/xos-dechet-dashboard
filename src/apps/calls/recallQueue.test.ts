import { describe, expect, it } from "vitest";
import {
  countRecallDateFilters,
  listRecallOriginSessions,
  matchesRecallDateFilter,
  matchesRecallSessionFilter,
  recallsToSessionContacts,
} from "./recallQueue";
import type { RecallInboxItem } from "./types";

const sample: RecallInboxItem = {
  id: 10,
  session_id: 3,
  session_name: "Prospection SP",
  session_status: "active",
  contact_name: "Alice",
  account_name: "Acme",
  phone: null,
  recall_at: "2026-07-11",
  outcome: "Appel non décroché",
  attempt_count: 1,
  sf_contact_id: "003AAA",
};

describe("recallQueue", () => {
  it("maps recalls to pending session contacts with origin metadata", () => {
    const contacts = recallsToSessionContacts([sample]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      id: 10,
      status: "pending",
      origin_session_id: 3,
      origin_session_name: "Prospection SP",
      recall_at: "2026-07-11",
    });
  });

  it("filters recall dates", () => {
    expect(matchesRecallDateFilter("2026-07-11", "today", "2026-07-11")).toBe(true);
    expect(matchesRecallDateFilter("2026-07-10", "overdue", "2026-07-11")).toBe(true);
    expect(matchesRecallDateFilter("2026-07-12", "upcoming", "2026-07-11")).toBe(true);
    expect(matchesRecallDateFilter("2026-07-12", "today", "2026-07-11")).toBe(false);
  });

  it("counts recall buckets", () => {
    const counts = countRecallDateFilters(
      [
        sample,
        { ...sample, id: 11, recall_at: "2026-07-10" },
        { ...sample, id: 12, recall_at: "2026-07-20" },
      ],
      "2026-07-11",
    );
    expect(counts).toEqual({ today: 1, overdue: 1, upcoming: 1, all: 3 });
  });

  it("lists and matches origin sessions", () => {
    const contacts = recallsToSessionContacts([
      sample,
      { ...sample, id: 11, session_id: 4, session_name: "Relance Nord" },
      { ...sample, id: 12, session_id: 3, session_name: "Prospection SP" },
    ]);
    expect(listRecallOriginSessions(contacts)).toEqual([
      { id: 3, name: "Prospection SP", count: 2 },
      { id: 4, name: "Relance Nord", count: 1 },
    ]);
    expect(matchesRecallSessionFilter(3, "all")).toBe(true);
    expect(matchesRecallSessionFilter(3, 3)).toBe(true);
    expect(matchesRecallSessionFilter(4, 3)).toBe(false);
  });
});
