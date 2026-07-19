import type { MeddicCategory } from "./noteTemplates";

export const CATEGORY_LABELS: Record<MeddicCategory, string> = {
  interet_produit: "Intérêt produit",
  maturite: "Maturité",
  douleur: "Douleur",
  metrique: "Métrique / ROI",
  champion: "Champion",
  decideur: "Décideur",
  concurrence: "Concurrence",
  budget: "Budget",
  timing: "Timing",
  engagement: "Engagement",
};

/** Ordre d'affichage stable des sections MEDDIC. */
export const CATEGORY_ORDER: readonly MeddicCategory[] = [
  "douleur",
  "metrique",
  "champion",
  "decideur",
  "budget",
  "timing",
  "maturite",
  "concurrence",
  "engagement",
  "interet_produit",
];

export type ParsedMeddicNote = {
  manual: string;
  categories: Partial<Record<MeddicCategory, string>>;
};

/** Extrait le texte libre et les lignes structurées « Catégorie : valeur ». */
export function parseMeddicNote(note: string): ParsedMeddicNote {
  const manualLines: string[] = [];
  const categories: Partial<Record<MeddicCategory, string>> = {};

  for (const rawLine of note.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const matched = matchStructuredLine(line);
    if (matched) {
      categories[matched.category] = matched.value;
    } else {
      manualLines.push(rawLine);
    }
  }

  return { manual: manualLines.join("\n").trim(), categories };
}

function matchStructuredLine(line: string): { category: MeddicCategory; value: string } | null {
  for (const category of CATEGORY_ORDER) {
    const label = CATEGORY_LABELS[category];
    const prefix = `${label} : `;
    if (line.startsWith(prefix)) {
      return { category, value: line.slice(prefix.length).trim() };
    }
  }
  return null;
}

/** Reconstruit la note en conservant le texte libre puis les lignes structurées. */
export function rebuildMeddicNote(
  manual: string,
  categories: Partial<Record<MeddicCategory, string>>,
  orderedCategories: readonly MeddicCategory[] = CATEGORY_ORDER,
): string {
  const structuredLines = orderedCategories
    .filter((category) => categories[category]?.trim())
    .map((category) => `${CATEGORY_LABELS[category]} : ${categories[category]!.trim()}`);

  return [manual.trim(), ...structuredLines].filter(Boolean).join("\n");
}

/** Remplace ou ajoute la valeur d'une catégorie sans dupliquer. */
export function upsertMeddicCategory(
  note: string,
  category: MeddicCategory,
  displayValue: string,
): string {
  const { manual, categories } = parseMeddicNote(note);
  categories[category] = displayValue.trim();
  const activeCategories = CATEGORY_ORDER.filter((cat) => categories[cat]?.trim());
  return rebuildMeddicNote(manual, categories, activeCategories);
}

/** Retire une catégorie structurée de la note. */
export function removeMeddicCategory(note: string, category: MeddicCategory): string {
  const { manual, categories } = parseMeddicNote(note);
  delete categories[category];
  const activeCategories = CATEGORY_ORDER.filter((cat) => categories[cat]?.trim());
  return rebuildMeddicNote(manual, categories, activeCategories);
}

/** Formate une option MEDDIC avec précision variable (mois, date…). */
export function formatMeddicValue(optionValue: string, detail?: string): string {
  const trimmedDetail = detail?.trim();
  if (!trimmedDetail) return optionValue;

  if (optionValue === "Budget validé pour tel mois") {
    return `Budget validé pour ${trimmedDetail}`;
  }
  if (optionValue === "Contrat expire telle date") {
    return `Contrat expire ${trimmedDetail}`;
  }
  return `${optionValue} (${trimmedDetail})`;
}

/** Catégories visibles : applicables au résultat + déjà renseignées. */
export function visibleMeddicCategories(
  resultatCategories: readonly MeddicCategory[],
  filledCategories: readonly MeddicCategory[],
): MeddicCategory[] {
  const set = new Set<MeddicCategory>([...resultatCategories, ...filledCategories]);
  return CATEGORY_ORDER.filter((category) => set.has(category));
}
