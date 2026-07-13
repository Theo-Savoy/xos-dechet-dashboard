import { describe, expect, it } from "vitest";
import { defaultRdvSubjectId } from "./rdvSubjects";

describe("defaultRdvSubjectId", () => {
  it("defaults to découverte prospect for a Prospect account in prospection", () => {
    expect(defaultRdvSubjectId("prospection", "Prospect")).toBe("decouverte_prospect");
  });

  it("defaults to détection enjeux for a Client account in prospection", () => {
    expect(defaultRdvSubjectId("prospection", "Client")).toBe("detection_enjeux");
    expect(defaultRdvSubjectId("prospection", "Client inactif")).toBe("detection_enjeux");
  });

  it("keeps session-specific defaults when account type is unknown", () => {
    expect(defaultRdvSubjectId("suivi_clients", "Prospect")).toBe("suivi_client");
    expect(defaultRdvSubjectId("suivi_opportunites", "Client")).toBe("suivi_opportunite");
  });

  it("falls back to first subject when account type is missing", () => {
    expect(defaultRdvSubjectId("prospection")).toBe("decouverte_prospect");
    expect(defaultRdvSubjectId("prospection", null)).toBe("decouverte_prospect");
  });
});
