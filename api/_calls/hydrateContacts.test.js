import { describe, expect, it, vi } from "vitest";
import mapping from "../_crm/mapping.js";
import { hydrateSessionContactsFromCrm } from "./hydrateContacts.js";

const mockFetchContactBasicsByIds = vi.fn();

vi.mock("../_crm/salesforce.js", () => ({
  fetchContactBasicsByIds: (...args) => mockFetchContactBasicsByIds(...args),
}));

describe("hydrateSessionContactsFromCrm", () => {
  it("fills missing email and title from CRM and persists updates", async () => {
    mockFetchContactBasicsByIds.mockResolvedValue({
      byId: new Map([
        ["003AAA", { email: "alice@acme.fr", title: "Responsable du Département Innovations Tech" }],
      ]),
    });

    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const client = {
      from: vi.fn().mockReturnValue({ update }),
    };

    const contacts = [
      {
        id: 1,
        sf_contact_id: "003AAA",
        contact_name: "Alice",
        email: null,
        title: null,
      },
    ];

    const enriched = await hydrateSessionContactsFromCrm(client, contacts, "sf-token", mapping);
    expect(enriched[0].email).toBe("alice@acme.fr");
    expect(enriched[0].title).toBe("Responsable du Département Innovations Tech");
    expect(client.from).toHaveBeenCalledWith("call_session_contacts");
    expect(update).toHaveBeenCalledWith({
      email: "alice@acme.fr",
      title: "Responsable du Département Innovations Tech",
    });
  });

  it("skips CRM lookup when all fields are already present", async () => {
    mockFetchContactBasicsByIds.mockClear();
    const contacts = [
      {
        id: 1,
        sf_contact_id: "003AAA",
        email: "alice@acme.fr",
        title: "DRH",
      },
    ];
    const enriched = await hydrateSessionContactsFromCrm(null, contacts, "sf-token", mapping);
    expect(enriched).toEqual(contacts);
    expect(mockFetchContactBasicsByIds).not.toHaveBeenCalled();
  });
});
