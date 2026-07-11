import { afterEach, describe, expect, it, vi } from "vitest";
import mapping from "./mapping.js";
import { logCall, parisToday } from "./salesforce.js";

describe("logCall Salesforce payload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes Completed status, ActivityDate, and omits zero duration", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "00T000000000001" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await logCall(
      "token",
      {
        contactId: "003000000000001",
        accountId: "001000000000001",
        resultat: "Appel décroché",
        comments: "OK",
        durationSec: 0,
        ownerId: "005000000000001",
        actorName: "Theo",
      },
      mapping,
    );

    expect(result.record?.id).toBe("00T000000000001");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.Status).toBe("Completed");
    expect(body.ActivityDate).toBe(parisToday());
    expect(body.Resultat_call__c).toBe("Appel décroché");
    expect(body.TaskSubtype).toBe("Call");
    expect(body.WhoId).toBe("003000000000001");
    expect(body.WhatId).toBe("001000000000001");
    expect(body.CallDurationInSeconds).toBeUndefined();
    expect(body.Priority).toBe("Normal");
  });

  it("includes CallDurationInSeconds only when > 0", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "00T000000000002" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await logCall(
      "token",
      {
        contactId: "003000000000001",
        resultat: "Appel argumenté",
        durationSec: 90,
      },
      mapping,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.CallDurationInSeconds).toBe(90);
  });
});
