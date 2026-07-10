import { describe, expect, it } from "vitest";
import { appRegistry, getAppManifest } from "./registry";

describe("appRegistry", () => {
  it("registers the two fixture apps and the shared UI demo", () => {
    expect(appRegistry.map((app) => app.id)).toEqual([
      "overview-demo",
      "notes-demo",
      "ui-demo",
    ]);
  });

  it("exposes unique ids and usable default window sizes", () => {
    expect(new Set(appRegistry.map((app) => app.id)).size).toBe(appRegistry.length);
    for (const app of appRegistry) {
      expect(app.title.length).toBeGreaterThan(0);
      expect(app.defaultSize.w).toBeGreaterThanOrEqual(480);
      expect(app.defaultSize.h).toBeGreaterThanOrEqual(360);
    }
  });

  it("finds a manifest by id", () => {
    expect(getAppManifest("notes-demo")?.title).toBe("Notes d’équipe");
    expect(getAppManifest("unknown")).toBeUndefined();
  });
});
