import { describe, expect, it } from "vitest";
import { defaultRdvSubjectId, rdvSubjectsForSession } from "./rdvSubjects";

describe("rdvSubjectsForSession", () => {
  it("limits prospection prospects to découverte only", () => {
    const subjects = rdvSubjectsForSession("prospection", "Prospect");
    expect(subjects.map((s) => s.id)).toEqual(["decouverte_prospect"]);
  });

  it("limits prospection clients to détection enjeux only", () => {
    const subjects = rdvSubjectsForSession("prospection", "Client");
    expect(subjects.map((s) => s.id)).toEqual(["detection_enjeux"]);
    expect(rdvSubjectsForSession("prospection", "Client inactif").map((s) => s.id)).toEqual([
      "detection_enjeux",
    ]);
  });

  it("keeps session-wide options when account type is unknown", () => {
    expect(rdvSubjectsForSession("prospection").map((s) => s.id)).toEqual([
      "decouverte_prospect",
      "detection_enjeux",
    ]);
  });
});

describe("defaultRdvSubjectId", () => {
  it("defaults to découverte prospect for a Prospect account in prospection", () => {
    expect(defaultRdvSubjectId("prospection", "Prospect")).toBe("decouverte_prospect");
  });

  it("defaults to détection enjeux for a Client account in prospection", () => {
    expect(defaultRdvSubjectId("prospection", "Client")).toBe("detection_enjeux");
    expect(defaultRdvSubjectId("prospection", "Client inactif")).toBe("detection_enjeux");
  });

  it("keeps session-specific defaults when account type is known", () => {
    expect(defaultRdvSubjectId("suivi_clients", "Prospect")).toBe("decouverte_prospect");
    expect(defaultRdvSubjectId("suivi_clients", "Client")).toBe("suivi_client");
    expect(defaultRdvSubjectId("suivi_opportunites", "Client")).toBe("suivi_opportunite");
    expect(defaultRdvSubjectId("suivi_opportunites", "Prospect")).toBe("suivi_opportunite");
  });

  it("falls back to first subject when account type is missing", () => {
    expect(defaultRdvSubjectId("prospection")).toBe("decouverte_prospect");
    expect(defaultRdvSubjectId("prospection", null)).toBe("decouverte_prospect");
  });
});
