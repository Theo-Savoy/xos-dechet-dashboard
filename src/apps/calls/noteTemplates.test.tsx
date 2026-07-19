// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_LABELS } from "./noteTemplates.helpers";
import {
  formatMeddicValue,
  MEDDIC_OPTIONS,
  NoteTemplateSections,
  parseMeddicNote,
  RESULTAT_TO_MEDDIC_CATEGORIES,
  upsertMeddicCategory,
  visibleMeddicCategories,
} from "./noteTemplates";

afterEach(cleanup);

describe("parseMeddicNote / upsertMeddicCategory", () => {
  it("extracts manual text and structured category lines", () => {
    const note = "Appel intéressant\nDouleur : Pas de douleur exprimée\nBudget : Budget validé";
    expect(parseMeddicNote(note)).toEqual({
      manual: "Appel intéressant",
      categories: {
        douleur: "Pas de douleur exprimée",
        budget: "Budget validé",
      },
    });
  });

  it("replaces an existing category instead of duplicating", () => {
    const initial = "Douleur : Douleur floue";
    const next = upsertMeddicCategory(initial, "douleur", "Pas de douleur exprimée");
    expect(next).toBe("Douleur : Pas de douleur exprimée");
    expect(next.match(/Douleur/g)?.length).toBe(1);
  });

  it("preserves manual text when upserting a structured line", () => {
    const initial = "Notes libres sur l'échange";
    const next = upsertMeddicCategory(initial, "budget", "Budget en attente");
    expect(next).toBe("Notes libres sur l'échange\nBudget : Budget en attente");
  });

  it("formats budget month detail into a single structured value", () => {
    expect(formatMeddicValue("Budget validé pour tel mois", "mars")).toBe("Budget validé pour mars");
  });
});

describe("visibleMeddicCategories", () => {
  it("keeps filled categories visible when the resultat changes", () => {
    const visible = visibleMeddicCategories(["timing"], ["budget", "douleur"]);
    expect(visible).toContain("timing");
    expect(visible).toContain("budget");
    expect(visible).toContain("douleur");
  });
});

describe("RESULTAT_TO_MEDDIC_CATEGORIES", () => {
  it("exposes only timing for unreached outcomes", () => {
    expect(RESULTAT_TO_MEDDIC_CATEGORIES["Appel non décroché"]).toEqual(["timing"]);
    expect(RESULTAT_TO_MEDDIC_CATEGORIES["Message répondeur"]).toEqual(["timing"]);
  });

  it("exposes 8 categories for RDV planifié", () => {
    expect(RESULTAT_TO_MEDDIC_CATEGORIES["RDV planifié"]).toHaveLength(8);
  });
});

describe("NoteTemplateSections", () => {
  it("renders all applicable sections for the outcome", () => {
    render(<NoteTemplateSections value="" onChange={vi.fn()} resultat="RDV planifié" />);
    expect(screen.getByRole("group", { name: "Modèles de note MEDDIC" })).toBeTruthy();
    for (const category of RESULTAT_TO_MEDDIC_CATEGORIES["RDV planifié"]) {
      expect(screen.getByText(CATEGORY_LABELS[category])).toBeTruthy();
    }
  });

  it("keeps other sections visible after selecting Douleur", async () => {
    const user = userEvent.setup();
    render(<NoteTemplateSections value="" onChange={vi.fn()} resultat="RDV planifié" />);

    const douleurToggle = screen.getByRole("button", { name: /Douleur/i });
    await user.click(douleurToggle);
    await user.click(screen.getByRole("button", { name: "Choisir Douleur" }));
    await user.click(screen.getByRole("option", { name: "Pas de douleur exprimée" }));

    expect(screen.getByText("Budget")).toBeTruthy();
    expect(screen.getByText("Champion")).toBeTruthy();
    expect(screen.getByText("Décideur")).toBeTruthy();
  });

  it("shows a locked section summary after validation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NoteTemplateSections value="" onChange={onChange} resultat="Appel argumenté" />);

    await user.click(screen.getByRole("button", { name: /Douleur/i }));
    await user.click(screen.getByRole("button", { name: "Choisir Douleur" }));
    await user.click(screen.getByRole("option", { name: "Pas de douleur exprimée" }));

    expect(onChange).toHaveBeenCalledWith("Douleur : Pas de douleur exprimée");
    render(
      <NoteTemplateSections
        value="Douleur : Pas de douleur exprimée"
        onChange={onChange}
        resultat="Appel argumenté"
      />,
    );
    expect(screen.getByText("Pas de douleur exprimée")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Modifier Douleur" })).toBeTruthy();
  });

  it("replaces the previous Douleur value when modified", async () => {
    const user = userEvent.setup();
    let note = "Douleur : Douleur floue";
    const onChange = vi.fn((next: string) => {
      note = next;
    });

    const { rerender } = render(
      <NoteTemplateSections value={note} onChange={onChange} resultat="Appel argumenté" />,
    );

    await user.click(screen.getByRole("button", { name: "Modifier Douleur" }));
    await user.click(screen.getByRole("button", { name: "Choisir Douleur" }));
    await user.click(screen.getByRole("option", { name: "Pas de douleur exprimée" }));

    rerender(<NoteTemplateSections value={note} onChange={onChange} resultat="Appel argumenté" />);
    expect(note).toBe("Douleur : Pas de douleur exprimée");
    expect(note.match(/Douleur/g)?.length).toBe(1);
  });

  it("keeps budget month detail in the structured note", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NoteTemplateSections value="" onChange={onChange} resultat="RDV planifié" />);

    await user.click(screen.getByRole("button", { name: /Budget/i }));
    await user.click(screen.getByRole("button", { name: "Choisir Budget" }));
    await user.click(screen.getByRole("option", { name: "Budget validé pour tel mois" }));
    await user.type(screen.getByLabelText("Précision pour Budget"), "mars");
    await user.click(screen.getByRole("button", { name: "Valider" }));

    expect(onChange).toHaveBeenCalledWith("Budget : Budget validé pour mars");
  });

  it("does not overwrite manual text when adding a structured section", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <NoteTemplateSections
        value="Notes manuelles"
        onChange={onChange}
        resultat="Appel argumenté"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Douleur/i }));
    await user.click(screen.getByRole("button", { name: "Choisir Douleur" }));
    await user.click(screen.getByRole("option", { name: "Douleur conformité" }));

    expect(onChange).toHaveBeenCalledWith("Notes manuelles\nDouleur : Douleur conformité");
  });

  it("exposes aria-expanded on section toggles", () => {
    render(<NoteTemplateSections value="" onChange={vi.fn()} resultat="Appel décroché" />);
    const toggles = screen.getAllByRole("button", { expanded: false });
    expect(toggles.length).toBeGreaterThan(0);
    for (const toggle of toggles) {
      expect(toggle.getAttribute("aria-controls")).toBeTruthy();
    }
  });

  it("uses a compact grid layout class", () => {
    const { container } = render(
      <NoteTemplateSections value="" onChange={vi.fn()} resultat="Appel décroché" />,
    );
    expect(container.querySelector(".calls-medic-sections")).toBeTruthy();
  });

  it("keeps every option reachable for a category", async () => {
    const user = userEvent.setup();
    render(<NoteTemplateSections value="" onChange={vi.fn()} resultat="Appel non décroché" />);
    await user.click(screen.getByRole("button", { name: /Timing/i }));
    const panel = screen.getByRole("region", { name: /Timing/i });
    await user.click(within(panel).getByRole("button", { name: "Choisir Timing" }));
    for (const opt of MEDDIC_OPTIONS.timing) {
      expect(screen.getByRole("option", { name: opt.label })).toBeTruthy();
    }
  });
});
