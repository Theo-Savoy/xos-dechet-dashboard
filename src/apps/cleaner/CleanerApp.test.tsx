// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "cleaner-jwt" } } }),
}));
vi.mock("../../lib/supabase", () => ({ supabase: { auth: { getSession } } }));
import { appRegistry, getAppManifest } from "../../os/registry";
import CleanerApp from "./CleanerApp";

afterEach(cleanup);

describe("Cleaner app manifest", () => {
  it("is registered with id 'cleaner'", () => {
    const manifest = getAppManifest("cleaner");
    expect(manifest).toBeDefined();
    expect(manifest?.id).toBe("cleaner");
  });

  it("has title 'CRM Cleaner'", () => {
    const manifest = getAppManifest("cleaner");
    expect(manifest?.title).toBe("CRM Cleaner");
  });

  it("has a desktop-appropriate default size (fits 1366×768 viewport)", () => {
    const manifest = getAppManifest("cleaner");
    expect(manifest?.defaultSize.w).toBeGreaterThanOrEqual(1000);
    expect(manifest?.defaultSize.h).toBeGreaterThanOrEqual(500);
    expect(manifest?.defaultSize.h).toBeLessThanOrEqual(600);
  });

  it("has a unique id among all registered apps", () => {
    const ids = appRegistry.map((app) => app.id);
    expect(ids.filter((id) => id === "cleaner")).toHaveLength(1);
  });
});

describe("CleanerApp component", () => {
  it("renders an iframe with src='/dashboard.html'", () => {
    render(<CleanerApp />);
    const iframe = screen.getByTitle("CRM Cleaner");
    expect(iframe).toBeTruthy();
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("src")).toBe("/dashboard.html");
  });

  it("has an accessible title attribute on the iframe", () => {
    render(<CleanerApp />);
    const iframe = screen.getByTitle("CRM Cleaner");
    expect(iframe.getAttribute("title")).toBe("CRM Cleaner");
  });

  it("passes the authenticated session to the same-origin legacy dashboard", async () => {
    render(<CleanerApp />);
    const iframe = screen.getByTitle("CRM Cleaner") as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
    fireEvent.load(iframe);

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: "xos:auth", accessToken: "cleaner-jwt" },
      window.location.origin,
    ));
  });
});
