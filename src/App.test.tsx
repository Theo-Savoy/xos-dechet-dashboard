// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth/useSession", () => ({
  useSession: vi.fn(),
}));

vi.mock("./os/Desktop", () => ({
  Desktop: () => <div data-testid="desktop" />,
}));

vi.mock("./components/BootScreen", () => ({
  BootScreen: () => <div data-testid="boot-screen" />,
}));

vi.mock("./auth/LoginScreen", () => ({
  LoginScreen: () => <div data-testid="login-screen" />,
}));

// Default matchMedia mock — returns "no preference"
const defaultMatchMedia = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});
window.matchMedia = vi.fn().mockImplementation(defaultMatchMedia);

import App from "./App";
import { useSession } from "./auth/useSession";

const mockUseSession = vi.mocked(useSession);

afterEach(() => {
  cleanup();
  vi.mocked(window.matchMedia).mockImplementation(defaultMatchMedia);
});

describe("App — loading state", () => {
  it("renders boot screen while session is loading", () => {
    mockUseSession.mockReturnValue({
      session: null,
      loading: true,
      bridgeError: false,
    });

    render(<App />);

    expect(screen.getByTestId("boot-screen")).toBeTruthy();
    expect(screen.queryByTestId("desktop")).toBeNull();
    expect(screen.queryByTestId("login-screen")).toBeNull();
  });
});

describe("App — bridgeError state", () => {
  it("renders error message and retry button when bridgeError is true", () => {
    mockUseSession.mockReturnValue({
      session: null,
      loading: false,
      bridgeError: true,
    });

    render(<App />);

    expect(screen.getByText("Impossible de préparer l'accès au CRM.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });

  it("does not render Desktop or LoginScreen when bridgeError is true", () => {
    mockUseSession.mockReturnValue({
      session: null,
      loading: false,
      bridgeError: true,
    });

    render(<App />);

    expect(screen.queryByTestId("desktop")).toBeNull();
    expect(screen.queryByTestId("login-screen")).toBeNull();
  });

  it("renders LoginScreen when not loading, no error, no session", () => {
    mockUseSession.mockReturnValue({
      session: null,
      loading: false,
      bridgeError: false,
    });

    render(<App />);

    expect(screen.getByTestId("login-screen")).toBeTruthy();
    expect(screen.queryByTestId("desktop")).toBeNull();
  });

  it("renders Desktop when session is ready", () => {
    mockUseSession.mockReturnValue({
      session: { user: { email: "theo@xos-learning.fr" }, access_token: "tok" } as never,
      loading: false,
      bridgeError: false,
    });

    render(<App />);

    expect(screen.getByTestId("desktop")).toBeTruthy();
  });

  it("reveals desktop immediately when prefers-reduced-motion is reduce", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    mockUseSession.mockReturnValue({
      session: { user: { email: "theo@xos-learning.fr" }, access_token: "tok" } as never,
      loading: false,
      bridgeError: false,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId("boot-screen")).toBeNull();
    });
    expect(screen.getByTestId("desktop")).toBeTruthy();
  });
});
