import { useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  CONTACT_LIMIT_OPTIONS,
  CONTACT_LIST_UNLIMITED,
  EFFECTIF_TRANCHES,
  FONCTION_PRESETS,
  NIVEAU_DECISION_OPTIONS,
  RESULTAT_CALL_VALUES,
  SECTEUR_VALUES,
  TIER_VALUES,
  TYPE_CLIENT_VALUES,
  type CallTargetPreset,
  type ContactLimit,
  type FilterTree,
} from "../../crm";
import { asOptions, ChipGroup, PicklistMultiSelect, TriState } from "./filterControls";

type FilterBuilderProps = {
  filters: FilterTree;
  onChange: (next: FilterTree) => void;
  previewCount: number | null;
  previewLoading: boolean;
  contactLimit: ContactLimit;
  onContactLimitChange: (limit: ContactLimit) => void;
  onPreview: () => void;
  presets: CallTargetPreset[];
  presetsLoading: boolean;
  savingPreset: boolean;
  currentUserId: string;
  onLoadPreset: (preset: CallTargetPreset) => void;
  onSavePreset: (name: string, shared: boolean) => void;
  onDeletePreset: (id: number) => void;
};

function limitLabel(limit: ContactLimit): string {
  return limit === CONTACT_LIST_UNLIMITED ? "Pas de limite (max 2000)" : String(limit);
}

export function FilterBuilder({
  filters,
  onChange,
  previewCount,
  previewLoading,
  contactLimit,
  onContactLimitChange,
  onPreview,
  presets,
  presetsLoading,
  savingPreset,
  currentUserId,
  onLoadPreset,
  onSavePreset,
  onDeletePreset,
}: FilterBuilderProps) {
  const [presetName, setPresetName] = useState("");
  const [presetShared, setPresetShared] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");

  const setEntreprise = (patch: Partial<FilterTree["entreprise"]>) =>
    onChange({ ...filters, entreprise: { ...filters.entreprise, ...patch } });
  const setContact = (patch: Partial<FilterTree["contact"]>) =>
    onChange({ ...filters, contact: { ...filters.contact, ...patch } });
  const setRelance = (patch: Partial<FilterTree["relance"]>) =>
    onChange({ ...filters, relance: { ...filters.relance, ...patch } });

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    onSavePreset(name, presetShared);
    setPresetName("");
    setPresetShared(false);
  };
  const selectedPreset = presets.find((preset) => String(preset.id) === selectedPresetId);

  return (
    <GlassCard className="calls-filterbuilder">
      <div className="calls-fb-presets">
        <label className="calls-field calls-field--inline">
          <span>Preset</span>
          <select
            className="calls-select"
            value={selectedPresetId}
            disabled={presetsLoading || presets.length === 0}
            onChange={(e) => {
              setSelectedPresetId(e.target.value);
              const preset = presets.find((p) => String(p.id) === e.target.value);
              if (preset) onLoadPreset(preset);
            }}
          >
            <option value="">{presetsLoading ? "Chargement…" : "— Charger un preset —"}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.shared ? " (partagé)" : ""}
              </option>
            ))}
          </select>
        </label>
        {selectedPreset?.owner === currentUserId && (
          <Button
            variant="secondary"
            onClick={() => {
              onDeletePreset(Number(selectedPresetId));
              setSelectedPresetId("");
            }}
          >
            Supprimer
          </Button>
        )}
        <div className="calls-fb-save">
          <input
            type="text"
            className="calls-input"
            placeholder="Nom du preset à sauver"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <label className="calls-checkbox calls-checkbox--tight">
            <input
              type="checkbox"
              checked={presetShared}
              onChange={(e) => setPresetShared(e.target.checked)}
            />
            Partager à l&apos;équipe
          </label>
          <Button
            variant="secondary"
            onClick={handleSavePreset}
            disabled={savingPreset || !presetName.trim()}
          >
            {savingPreset ? "Sauvegarde…" : "Sauvegarder"}
          </Button>
        </div>
      </div>

      <details className="calls-fb-section" open>
        <summary>Entreprise</summary>
        <div className="calls-fb-section__body">
          <PicklistMultiSelect
            label="Secteurs d'activité"
            options={asOptions(SECTEUR_VALUES)}
            value={filters.entreprise.secteurs}
            onChange={(secteurs) => setEntreprise({ secteurs })}
            searchPlaceholder="Filtrer les secteurs…"
          />
          <ChipGroup
            label="Effectifs"
            options={asOptions(EFFECTIF_TRANCHES)}
            value={filters.entreprise.effectifs}
            onChange={(effectifs) => setEntreprise({ effectifs })}
          />
          <ChipGroup
            label="Type de client"
            options={asOptions(TYPE_CLIENT_VALUES)}
            value={filters.entreprise.type_client}
            onChange={(type_client) => setEntreprise({ type_client })}
          />
          <ChipGroup
            label="Tier"
            options={asOptions(TIER_VALUES)}
            value={filters.entreprise.tiers}
            onChange={(tiers) => setEntreprise({ tiers })}
          />
          <div className="calls-fb-row">
            <TriState
              label="Opportunité ouverte"
              value={filters.entreprise.opp_ouverte}
              onChange={(opp_ouverte) => setEntreprise({ opp_ouverte })}
            />
            <TriState
              label="Opportunité perdue"
              value={filters.entreprise.opp_perdue}
              onChange={(opp_perdue) => setEntreprise({ opp_perdue })}
            />
          </div>
          <label className="calls-field">
            <span>Compte principal (ID CRM, cible le groupe)</span>
            <input
              type="text"
              className="calls-input"
              value={filters.entreprise.compte_principal ?? ""}
              onChange={(e) =>
                setEntreprise({ compte_principal: e.target.value.trim() || null })
              }
              placeholder="001…"
            />
          </label>
        </div>
      </details>

      <details className="calls-fb-section" open>
        <summary>Contact</summary>
        <div className="calls-fb-section__body">
          <label className="calls-checkbox">
            <input
              type="checkbox"
              checked={filters.contact.a_telephone}
              onChange={(e) => setContact({ a_telephone: e.target.checked })}
            />
            A un numéro de téléphone
          </label>
          <ChipGroup
            label="Niveau de décision"
            options={NIVEAU_DECISION_OPTIONS}
            value={filters.contact.niveau_decision}
            onChange={(niveau_decision) => setContact({ niveau_decision })}
          />
          <ChipGroup
            label="Fonction"
            hint="Presets sur le poste (OR entre les cases cochées)"
            options={FONCTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
            value={filters.contact.fonctions}
            onChange={(fonctions) => setContact({ fonctions })}
          />
          <label className="calls-checkbox">
            <input
              type="checkbox"
              checked={filters.contact.exclure_npa}
              onChange={(e) => setContact({ exclure_npa: e.target.checked })}
            />
            Exclure les « ne pas appeler »
          </label>
        </div>
      </details>

      <details className="calls-fb-section">
        <summary>Relance</summary>
        <div className="calls-fb-section__body">
          <label className="calls-checkbox">
            <input
              type="checkbox"
              checked={!!filters.relance.jamais_appele}
              onChange={(e) => setRelance({ jamais_appele: e.target.checked ? true : null })}
            />
            Jamais appelé
          </label>
          <div className="calls-fb-row">
            <label className="calls-field">
              <span>Dernier appel il y a plus de (jours)</span>
              <input
                type="number"
                min={0}
                className="calls-input"
                value={filters.relance.dernier_appel_avant_jours ?? ""}
                onChange={(e) =>
                  setRelance({
                    dernier_appel_avant_jours: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label className="calls-field">
              <span>Appelé dans les (jours)</span>
              <input
                type="number"
                min={0}
                className="calls-input"
                value={filters.relance.dernier_appel_dans_jours ?? ""}
                onChange={(e) =>
                  setRelance({
                    dernier_appel_dans_jours: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
          </div>
          <ChipGroup
            label="Dernier résultat"
            options={asOptions(RESULTAT_CALL_VALUES)}
            value={filters.relance.dernier_resultat}
            onChange={(dernier_resultat) => setRelance({ dernier_resultat })}
          />
          <div className="calls-fb-row">
            <label className="calls-field">
              <span>Exclure si plus de X appels…</span>
              <input
                type="number"
                min={0}
                className="calls-input"
                value={filters.relance.exclure_si_plus_de?.appels ?? ""}
                onChange={(e) => {
                  const appels = e.target.value ? Number(e.target.value) : null;
                  setRelance({
                    exclure_si_plus_de: appels
                      ? { appels, sur_jours: filters.relance.exclure_si_plus_de?.sur_jours ?? 30 }
                      : null,
                  });
                }}
              />
            </label>
            <label className="calls-field">
              <span>…sur X jours</span>
              <input
                type="number"
                min={0}
                className="calls-input"
                disabled={!filters.relance.exclure_si_plus_de}
                value={filters.relance.exclure_si_plus_de?.sur_jours ?? ""}
                onChange={(e) =>
                  setRelance({
                    exclure_si_plus_de: filters.relance.exclure_si_plus_de
                      ? {
                          ...filters.relance.exclure_si_plus_de,
                          sur_jours: Number(e.target.value) || 0,
                        }
                      : null,
                  })
                }
              />
            </label>
          </div>
        </div>
      </details>

      <footer className="calls-fb-footer">
        <label className="calls-field calls-field--inline">
          <span>Contacts max</span>
          <select
            className="calls-select"
            value={contactLimit}
            onChange={(e) => onContactLimitChange(Number(e.target.value) as ContactLimit)}
          >
            {CONTACT_LIMIT_OPTIONS.map((limit) => (
              <option key={limit} value={limit}>
                {limitLabel(limit)}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={onPreview} disabled={previewLoading}>
          {previewLoading ? "Recherche…" : "Aperçu de la liste"}
        </Button>
        {previewCount !== null && !previewLoading && (
          <Tag variant="accent">
            {previewCount} contact{previewCount > 1 ? "s" : ""}
          </Tag>
        )}
      </footer>
    </GlassCard>
  );
}
