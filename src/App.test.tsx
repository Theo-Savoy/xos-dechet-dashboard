// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/useSession", () => ({
  useSession: vi.fn(),
}));

vi.mock("./os/Desktop", () => ({
  Desktop: () => <div data-testid="desktop" />,
}));

vi.mock("./lib/LoginScreen", () => ({
  LoginScreen: () => <div data-testid="login-screen" />,
}));

import App from "./App";
import { useSession } from "./lib/useSession";

const mockUseSession = vi.mocked(useSession);

afterEach(cleanup);

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
});
