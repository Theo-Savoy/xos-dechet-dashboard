// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendNoteChip, NoteTemplateChips } from "./formControls";

afterEach(cleanup);

describe("NoteTemplateChips", () => {
  it("renders the MEDDIC-lite chips only when the comment is empty", () => {
    render(<NoteTemplateChips value="" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Modèles de note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Intérêt produit A" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Décision ce trimestre" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Métrique identifiée" })).toBeTruthy();
  });

  it("stays hidden once the comment already has content", () => {
    render(<NoteTemplateChips value="déjà écrit" onChange={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Modèles de note" })).toBeNull();
  });

  it("adds the chip text directly when the comment is empty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NoteTemplateChips value="" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Curieux" }));
    expect(onChange).toHaveBeenCalledWith("Curieux");
  });

  it("joins an existing comment and the chip with a comma separator", () => {
    expect(appendNoteChip("Champion identifié", "Curieux")).toBe("Champion identifié, Curieux");
    expect(appendNoteChip("", "Curieux")).toBe("Curieux");
  });
});
