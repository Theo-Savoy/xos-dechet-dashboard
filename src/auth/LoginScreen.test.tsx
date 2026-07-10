// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithOtp } = vi.hoisted(() => ({
  signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { signInWithOtp },
  },
}));

import { LoginScreen } from "./LoginScreen";

describe("LoginScreen — email normalization", () => {
  beforeEach(() => signInWithOtp.mockClear());
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
