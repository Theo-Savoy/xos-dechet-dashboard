import { describe, expect, it } from "vitest";
import { appRegistry, getAppManifest } from "./registry";

describe("appRegistry", () => {
  it("always includes cleaner and calls", () => {
    const ids = appRegistry.map((app) => app.id);
    expect(ids).toContain("cleaner");
    expect(ids).toContain("calls");
  });

  it("includes demo fixtures only in DEV mode", () => {
    if (import.meta.env.DEV) {
      expect(appRegistry.map((app) => app.id)).toEqual([
        "cleaner",
        "calls",
        "overview-demo",
        "notes-demo",
        "ui-demo",
      ]);
    } else {
      expect(appRegistry.map((app) => app.id)).toEqual(["cleaner", "calls"]);
    }
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
    expect(getAppManifest("cleaner")?.title).toBe("CRM Cleaner");
    expect(getAppManifest("unknown")).toBeUndefined();
  });
});
