// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithOtp, signInWithOAuth } = vi.hoisted(() => ({
  signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
  signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { signInWithOtp, signInWithOAuth },
  },
}));

import { LoginScreen, SALESFORCE_PROVIDER } from "./LoginScreen";

describe("LoginScreen — email normalization", () => {
  beforeEach(() => {
    signInWithOtp.mockClear();
    window.history.replaceState({}, "", "/");
  });
  afterEach(cleanup);

  it("normalizes uppercase email with spaces to lowercased trimmed email", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(
      screen.getByPlaceholderText("nom@xos-learning.fr"),
      "  Jean.Dupont@XOS-LEARNING.FR  ",
    );
    await user.click(
      screen.getByRole("button", { name: "Recevoir un lien de connexion" }),
    );

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "jean.dupont@xos-learning.fr",
      options: { emailRedirectTo: window.location.origin },
    });
  });

  it("shows clear error for non-xos domain and does not call signInWithOtp", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(
      screen.getByPlaceholderText("nom@xos-learning.fr"),
      "toto@gmail.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Recevoir un lien de connexion" }),
    );

    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Seules les adresses @xos-learning\.fr sont autorisées/),
    ).toBeTruthy();
  });
});

describe("LoginScreen — dual auth layout", () => {
  beforeEach(() => {
    signInWithOtp.mockClear();
    signInWithOAuth.mockClear();
    window.history.replaceState({}, "", "/");
  });
  afterEach(cleanup);

  it("exposes Salesforce login alongside the magic-link form", () => {
    render(<LoginScreen />);

    expect(
      screen.getByRole("button", { name: "Se connecter avec Salesforce" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Recevoir un lien de connexion" }),
    ).toBeTruthy();
    expect(screen.getByRole("separator", { name: "ou" })).toBeTruthy();
  });

  it("starts Salesforce OAuth via the Supabase custom provider", async () => {
    const user = userEvent.setup();

    render(<LoginScreen />);
    await user.click(
      screen.getByRole("button", { name: "Se connecter avec Salesforce" }),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: SALESFORCE_PROVIDER,
      options: { redirectTo: window.location.origin },
    });
  });

  it("shows an error and re-enables the button when signInWithOAuth fails", async () => {
    const user = userEvent.setup();
    signInWithOAuth.mockResolvedValueOnce({ data: {}, error: { message: "boom" } });

    render(<LoginScreen />);
    await user.click(
      screen.getByRole("button", { name: "Se connecter avec Salesforce" }),
    );

    expect(screen.getByRole("alert").textContent).toContain("Impossible de démarrer");
  });

  it("surfaces Supabase OAuth error_description from the redirect", () => {
    window.history.replaceState({}, "", "/?error=server_error&error_description=Email+non+autorise");
    render(<LoginScreen />);
    expect(screen.getByRole("alert").textContent).toContain("Email non autorise");
  });

  it("surfaces auth_error query messages for the OAuth callback path", () => {
    window.history.replaceState({}, "", "/?auth_error=oauth_denied");
    render(<LoginScreen />);
    expect(screen.getByRole("alert").textContent).toContain("annulée");
  });
});
