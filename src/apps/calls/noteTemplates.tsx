import { useCallback, useId, useMemo, useState } from "react";
import { Select } from "../../components/ui";
import type { ResultatCall } from "../../crm";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  formatMeddicValue,
  parseMeddicNote,
  upsertMeddicCategory,
  visibleMeddicCategories,
} from "./noteTemplates.helpers";

export type MeddicCategory =
  | "interet_produit"
  | "maturite"
  | "douleur"
  | "metrique"
  | "champion"
  | "decideur"
  | "concurrence"
  | "budget"
  | "timing"
  | "engagement";

export type MeddicOption = {
  label: string;
  value: string;
  needsDetail?: boolean;
  detailPlaceholder?: string;
};

/** Framework MEDDIC lite : options terrain par catégorie, pour structurer une note d'appel. */
export const MEDDIC_OPTIONS: Record<MeddicCategory, readonly MeddicOption[]> = {
  interet_produit: [
    { label: "Intérêt produit A", value: "Intérêt produit A" },
    { label: "Intérêt produit B", value: "Intérêt produit B" },
    { label: "Intérêt produit C", value: "Intérêt produit C" },
    { label: "Pas d'intérêt produit", value: "Pas d'intérêt produit" },
    { label: "Intérêt produit mais pas prioritaire", value: "Intérêt produit mais pas prioritaire" },
  ],
  maturite: [
    { label: "Curieux", value: "Curieux" },
    { label: "Évalue", value: "Évalue" },
    { label: "Compare à la concurrence", value: "Compare à la concurrence" },
    { label: "Décision imminente", value: "Décision imminente" },
    { label: "Pas de projet", value: "Pas de projet" },
    { label: "Pas de besoin", value: "Pas de besoin" },
    { label: "Projet reporté", value: "Projet reporté" },
  ],
  douleur: [
    { label: "Douleur identifiée", value: "Douleur identifiée" },
    { label: "Douleur floue", value: "Douleur floue" },
    { label: "Pas de douleur exprimée", value: "Pas de douleur exprimée" },
    { label: "Douleur budget", value: "Douleur budget" },
    { label: "Douleur conformité", value: "Douleur conformité" },
    { label: "Douleur formation équipe", value: "Douleur formation équipe" },
    { label: "Douleur opérationnelle", value: "Douleur opérationnelle" },
  ],
  metrique: [
    { label: "Métrique identifiée", value: "Métrique identifiée" },
    { label: "ROI calculé", value: "ROI calculé" },
    { label: "ROI flou", value: "ROI flou" },
    { label: "Pas de métrique", value: "Pas de métrique" },
    { label: "Métrique satisfaction", value: "Métrique satisfaction" },
    { label: "Métrique rétention", value: "Métrique rétention" },
    { label: "Métrique volume", value: "Métrique volume" },
  ],
  champion: [
    { label: "Champion identifié", value: "Champion identifié" },
    { label: "Champion exécutif", value: "Champion exécutif" },
    { label: "Champion opérationnel", value: "Champion opérationnel" },
    { label: "Pas de champion", value: "Pas de champion" },
    { label: "Champion à identifier", value: "Champion à identifier" },
  ],
  decideur: [
    { label: "Décideur connu", value: "Décideur connu" },
    { label: "Décideur économique", value: "Décideur économique" },
    { label: "Décideur opérationnel", value: "Décideur opérationnel" },
    { label: "Décideur technique", value: "Décideur technique" },
    { label: "Pas de décideur identifié", value: "Pas de décideur identifié" },
    { label: "Comité de décision", value: "Comité de décision" },
    { label: "Décision à plusieurs", value: "Décision à plusieurs" },
  ],
  concurrence: [
    { label: "En concurrence", value: "En concurrence" },
    { label: "Concurrent identifié", value: "Concurrent identifié" },
    { label: "Pas de concurrence", value: "Pas de concurrence" },
    { label: "Notre solution déjà en place", value: "Notre solution déjà en place" },
    { label: "Renouvellement en cours", value: "Renouvellement en cours" },
  ],
  budget: [
    { label: "Budget validé", value: "Budget validé" },
    { label: "Budget en attente", value: "Budget en attente" },
    { label: "Budget flou", value: "Budget flou" },
    { label: "Pas de budget", value: "Pas de budget" },
    {
      label: "Budget validé pour tel mois",
      value: "Budget validé pour tel mois",
      needsDetail: true,
      detailPlaceholder: "ex. mars, Q2…",
    },
    { label: "Budget annuel validé", value: "Budget annuel validé" },
    {
      label: "Contrat expire telle date",
      value: "Contrat expire telle date",
      needsDetail: true,
      detailPlaceholder: "ex. 15/03/2026",
    },
  ],
  timing: [
    { label: "Décision ce mois", value: "Décision ce mois" },
    { label: "Décision ce trimestre", value: "Décision ce trimestre" },
    { label: "Décision Q+1", value: "Décision Q+1" },
    { label: "Décision Q+2", value: "Décision Q+2" },
    { label: "Pas de timing défini", value: "Pas de timing défini" },
    { label: "Décision reportée", value: "Décision reportée" },
  ],
  engagement: [
    { label: "Premier contact", value: "Premier contact" },
    { label: "Engagement à approfondir", value: "Engagement à approfondir" },
    { label: "Engagement tiède", value: "Engagement tiède" },
    { label: "Engagement fort", value: "Engagement fort" },
    { label: "Désengagement", value: "Désengagement" },
    { label: "À recontacter plus tard", value: "À recontacter plus tard" },
  ],
};

/** @deprecated Alias conservé pour les tests existants. */
export const MEDDIC_CHIPS = MEDDIC_OPTIONS;

/** Catégories MEDDIC pertinentes selon le résultat de l'appel. */
export const RESULTAT_TO_MEDDIC_CATEGORIES: Record<ResultatCall, readonly MeddicCategory[]> = {
  "Appel non décroché": ["timing"],
  "Message répondeur": ["timing"],
  "Appel décroché": ["douleur", "maturite", "concurrence"],
  "Appel argumenté": ["douleur", "metrique", "champion", "concurrence", "engagement", "interet_produit"],
  "RDV planifié": [
    "douleur",
    "metrique",
    "champion",
    "decideur",
    "budget",
    "timing",
    "engagement",
    "interet_produit",
  ],
};

const PLACEHOLDER_VALUE = "__non_renseigne__";

function findOptionForValue(category: MeddicCategory, storedValue: string): MeddicOption | null {
  for (const option of MEDDIC_OPTIONS[category]) {
    if (option.value === storedValue) return option;
    if (option.needsDetail) {
      const formatted = formatMeddicValue(option.value, "PLACEHOLDER");
      const prefix = formatted.replace("PLACEHOLDER", "");
      if (storedValue.startsWith(prefix.trim())) return option;
    }
  }
  return null;
}

function extractDetail(storedValue: string, option: MeddicOption): string {
  if (option.value === "Budget validé pour tel mois" && storedValue.startsWith("Budget validé pour ")) {
    return storedValue.slice("Budget validé pour ".length);
  }
  if (option.value === "Contrat expire telle date" && storedValue.startsWith("Contrat expire ")) {
    return storedValue.slice("Contrat expire ".length);
  }
  const formatted = formatMeddicValue(option.value, "PLACEHOLDER");
  const prefix = formatted.replace("PLACEHOLDER", "");
  if (storedValue.startsWith(prefix)) {
    return storedValue.slice(prefix.length).replace(/^\(/, "").replace(/\)$/, "");
  }
  return "";
}

type MeddicSectionProps = {
  category: MeddicCategory;
  storedValue: string | undefined;
  isOpen: boolean;
  isEditing: boolean;
  pendingOption: string;
  pendingDetail: string;
  onToggle: () => void;
  onEdit: () => void;
  onOptionChange: (value: string) => void;
  onDetailChange: (detail: string) => void;
  onConfirm: () => void;
  sectionId: string;
  panelId: string;
};

function MeddicSection({
  category,
  storedValue,
  isOpen,
  isEditing,
  pendingOption,
  pendingDetail,
  onToggle,
  onEdit,
  onOptionChange,
  onDetailChange,
  onConfirm,
  sectionId,
  panelId,
}: MeddicSectionProps) {
  const label = CATEGORY_LABELS[category];
  const locked = Boolean(storedValue?.trim()) && !isEditing;
  const options = MEDDIC_OPTIONS[category];
  const selectedOption = options.find((opt) => opt.value === pendingOption) ?? options[0];
  const needsDetail = selectedOption?.needsDetail ?? false;
  const canConfirm = pendingOption !== PLACEHOLDER_VALUE && (!needsDetail || pendingDetail.trim().length > 0);

  return (
    <div
      className={`calls-medic-section${locked ? " calls-medic-section--locked" : ""}${isOpen ? " calls-medic-section--open" : ""}`}
    >
      <div className="calls-medic-section__head">
        <button
          type="button"
          id={sectionId}
          className="calls-medic-section__toggle"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="calls-medic-section__label">{label}</span>
          {locked ? (
            <span className="calls-medic-section__value">{storedValue}</span>
          ) : (
            <span className="calls-medic-section__placeholder">Non renseigné</span>
          )}
        </button>
        {locked && (
          <button
            type="button"
            className="calls-medic-section__edit"
            aria-label={`Modifier ${label}`}
            onClick={onEdit}
          >
            Modifier
          </button>
        )}
      </div>
      {isOpen && (
        <div id={panelId} className="calls-medic-section__panel" role="region" aria-labelledby={sectionId}>
          <Select
            className="calls-medic-section__select"
            aria-label={`Choisir ${label}`}
            value={pendingOption}
            onChange={onOptionChange}
            options={[
              { value: PLACEHOLDER_VALUE, label: "Non renseigné" },
              ...options.map((opt) => ({ value: opt.value, label: opt.label })),
            ]}
            renderValue={(selected) =>
              selected[0]?.value === PLACEHOLDER_VALUE ? "Non renseigné" : selected[0]?.label
            }
          />
          {needsDetail && pendingOption !== PLACEHOLDER_VALUE && (
            <label className="calls-medic-section__detail">
              <span className="visually-hidden">Précision pour {label}</span>
              <input
                type="text"
                className="calls-medic-section__detail-input"
                value={pendingDetail}
                placeholder={selectedOption.detailPlaceholder ?? "Précision…"}
                aria-label={`Précision pour ${label}`}
                onChange={(event) => onDetailChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canConfirm) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            </label>
          )}
          {pendingOption !== PLACEHOLDER_VALUE && (
            <button
              type="button"
              className="calls-medic-section__confirm"
              disabled={!canConfirm}
              onClick={onConfirm}
            >
              Valider
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Template compact par sections MEDDIC — persistant pendant l'appel. */
export function NoteTemplateSections({
  value,
  onChange,
  resultat,
}: {
  value: string;
  onChange: (next: string) => void;
  resultat: ResultatCall;
}) {
  const baseId = useId();
  const parsed = useMemo(() => parseMeddicNote(value), [value]);
  const applicable = RESULTAT_TO_MEDDIC_CATEGORIES[resultat] ?? [];
  const filledCategories = useMemo(
    () => CATEGORY_ORDER.filter((category) => parsed.categories[category]?.trim()),
    [parsed.categories],
  );
  const categories = useMemo(
    () => visibleMeddicCategories(applicable, filledCategories),
    [applicable, filledCategories],
  );

  const [openCategory, setOpenCategory] = useState<MeddicCategory | null>(null);
  const [editingCategory, setEditingCategory] = useState<MeddicCategory | null>(null);
  const [pendingOptions, setPendingOptions] = useState<Partial<Record<MeddicCategory, string>>>({});
  const [pendingDetails, setPendingDetails] = useState<Partial<Record<MeddicCategory, string>>>({});

  const getPendingOption = useCallback(
    (category: MeddicCategory): string => {
      if (pendingOptions[category]) return pendingOptions[category]!;
      const stored = parsed.categories[category];
      if (stored) {
        const match = findOptionForValue(category, stored);
        if (match) return match.value;
      }
      return PLACEHOLDER_VALUE;
    },
    [parsed.categories, pendingOptions],
  );

  const getPendingDetail = useCallback(
    (category: MeddicCategory): string => {
      if (pendingDetails[category] !== undefined) return pendingDetails[category]!;
      const stored = parsed.categories[category];
      if (stored) {
        const match = findOptionForValue(category, stored);
        if (match?.needsDetail) return extractDetail(stored, match);
      }
      return "";
    },
    [parsed.categories, pendingDetails],
  );

  const commitCategory = useCallback(
    (category: MeddicCategory, optionValue: string, detail: string) => {
      const displayValue = formatMeddicValue(optionValue, detail);
      onChange(upsertMeddicCategory(value, category, displayValue));
      setOpenCategory(null);
      setEditingCategory(null);
      setPendingOptions((current) => {
        const next = { ...current };
        delete next[category];
        return next;
      });
      setPendingDetails((current) => {
        const next = { ...current };
        delete next[category];
        return next;
      });
    },
    [onChange, value],
  );

  if (categories.length === 0) return null;

  return (
    <div className="calls-medic-sections" role="group" aria-label="Modèles de note MEDDIC">
      {categories.map((category) => {
        const storedValue = parsed.categories[category];
        const isEditing = editingCategory === category;
        const locked = Boolean(storedValue?.trim()) && !isEditing;
        const isOpen = openCategory === category || (isEditing && !locked);
        const sectionId = `${baseId}-${category}-head`;
        const panelId = `${baseId}-${category}-panel`;

        return (
          <MeddicSection
            key={category}
            category={category}
            storedValue={storedValue}
            isOpen={isOpen}
            isEditing={isEditing}
            pendingOption={getPendingOption(category)}
            pendingDetail={getPendingDetail(category)}
            sectionId={sectionId}
            panelId={panelId}
            onToggle={() => {
              if (locked) return;
              setOpenCategory((current) => (current === category ? null : category));
              setEditingCategory(null);
            }}
            onEdit={() => {
              setEditingCategory(category);
              setOpenCategory(category);
            }}
            onOptionChange={(nextValue) => {
              setPendingOptions((current) => ({ ...current, [category]: nextValue }));
              const option = MEDDIC_OPTIONS[category].find((opt) => opt.value === nextValue);
              if (option && !option.needsDetail && nextValue !== PLACEHOLDER_VALUE) {
                commitCategory(category, nextValue, "");
              }
            }}
            onDetailChange={(detail) => {
              setPendingDetails((current) => ({ ...current, [category]: detail }));
            }}
            onConfirm={() => {
              const optionValue = getPendingOption(category);
              if (optionValue === PLACEHOLDER_VALUE) return;
              commitCategory(category, optionValue, getPendingDetail(category));
            }}
          />
        );
      })}
    </div>
  );
}

export {
  formatMeddicValue,
  parseMeddicNote,
  rebuildMeddicNote,
  removeMeddicCategory,
  upsertMeddicCategory,
  visibleMeddicCategories,
} from "./noteTemplates.helpers";
