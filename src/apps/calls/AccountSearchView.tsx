import { useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  EFFECTIF_TRANCHES,
  SECTEUR_FAMILIES,
  SECTEUR_VALUES,
  TIER_VALUES,
  TYPE_CLIENT_VALUES,
  type EffectifTranche,
  type Secteur,
  type Tier,
  type TypeClient,
} from "../../crm";
import { fetchAccountsSearch, CallsApiError } from "./api";
import { asOptions, ChipGroup, PicklistMultiSelect } from "./filterControls";
import type { AccountSearchHit } from "./types";

type AbmFilters = {
  secteurs: Secteur[];
  effectifs: EffectifTranche[];
  type_client: TypeClient[];
  tiers: Tier[];
};

function emptyAbmFilters(): AbmFilters {
  return { secteurs: [], effectifs: [], type_client: [], tiers: [] };
}

function errorMessage(err: unknown): string {
  if (err instanceof CallsApiError) {
    if (err.code === "invalid_query") return "Saisissez au moins 2 caractères.";
    if (err.code === "sf_auth_error") return "Salesforce a refusé l'authentification — reconnectez-vous.";
    return `Erreur API (${err.code})`;
  }
  return "Une erreur est survenue.";
}

type AccountSearchViewProps = {
  token: string;
  onBack: () => void;
  onCreateAbmSession: (accountIds: string[]) => void;
};

export function AccountSearchView({ token, onBack, onCreateAbmSession }: AccountSearchViewProps) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<AbmFilters>(emptyAbmFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const setFilter = (patch: Partial<AbmFilters>) => setFilters((current) => ({ ...current, ...patch }));

  const handleSearch = async () => {
    const q = query.trim();
    if (q.length < 2 || !token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccountsSearch(token, { q, filters });
      setAccounts(data.accounts);
      setTruncated(data.truncated);
      setSelectedIds(new Set());
      setSearched(true);
      if (data.accounts.length === 0) setError("Aucun compte ne correspond à cette recherche.");
    } catch (err) {
      setError(errorMessage(err));
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleAccount = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedContactsCount = useMemo(
    () =>
      accounts
        .filter((account) => selectedIds.has(account.id))
        .reduce((total, account) => total + account.contacts.length, 0),
    [accounts, selectedIds],
  );

  return (
    <div className="calls-view">
      <header className="calls-view__header calls-view__header--runner">
        <div className="calls-view__nav">
          <Button variant="secondary" className="calls-view__back" onClick={onBack}>
            Retour
          </Button>
          <div className="calls-view__titleblock">
            <Tag variant="accent">Mode ABM</Tag>
            <h2>Rechercher des comptes</h2>
          </div>
        </div>
      </header>

      <GlassCard className="calls-filterbuilder">
        <div className="calls-fb-row">
          <label className="calls-field" style={{ flex: 1 }}>
            <span>Nom du compte</span>
            <input
              type="text"
              className="calls-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
              placeholder="ACME"
            />
          </label>
          <Button onClick={() => void handleSearch()} disabled={loading || query.trim().length < 2}>
            {loading ? "Recherche…" : "Rechercher"}
          </Button>
        </div>

        <details className="calls-fb-section">
          <summary>
            <span className="calls-fb-section__title">Filtres entreprise</span>
          </summary>
          <div className="calls-fb-section__body">
            <PicklistMultiSelect
              label="Secteurs d'activité"
              options={asOptions(SECTEUR_VALUES)}
              groups={SECTEUR_FAMILIES.map((family) => ({
                id: family.id,
                label: family.label,
                values: family.secteurs,
              }))}
              value={filters.secteurs}
              onChange={(secteurs) => setFilter({ secteurs })}
              searchPlaceholder="Filtrer les secteurs…"
            />
            <ChipGroup
              label="Effectifs"
              options={asOptions(EFFECTIF_TRANCHES)}
              value={filters.effectifs}
              onChange={(effectifs) => setFilter({ effectifs })}
            />
            <ChipGroup
              label="Type de client"
              options={asOptions(TYPE_CLIENT_VALUES)}
              value={filters.type_client}
              onChange={(type_client) => setFilter({ type_client })}
            />
            <ChipGroup
              label="Tier"
              options={asOptions(TIER_VALUES)}
              value={filters.tiers}
              onChange={(tiers) => setFilter({ tiers })}
            />
          </div>
        </details>
      </GlassCard>

      {error && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">{error}</p>
        </GlassCard>
      )}

      {truncated && (
        <GlassCard className="calls-truncated-banner" role="status">
          <p>Résultats partiels : affinez votre recherche.</p>
        </GlassCard>
      )}

      {accounts.length > 0 && (
        <>
          <GlassCard className="calls-name-form calls-name-form--sticky">
            <div className="calls-name-form__meta">
              <Tag>
                {selectedContactsCount} contact{selectedContactsCount > 1 ? "s" : ""} dans{" "}
                {selectedIds.size} compte{selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}
              </Tag>
            </div>
            <Button
              onClick={() => onCreateAbmSession([...selectedIds])}
              disabled={selectedIds.size === 0}
            >
              Créer séance ABM
            </Button>
          </GlassCard>

          <div className="calls-preview__table-wrap" role="list" aria-label="Comptes trouvés">
            {accounts.map((account) => {
              const checked = selectedIds.has(account.id);
              return (
                <GlassCard key={account.id} className="calls-preview" role="listitem">
                  <div className="calls-preview__header">
                    <label className="calls-checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAccount(account.id)}
                        aria-label={`Sélectionner ${account.name}`}
                      />
                      <strong>{account.name}</strong>
                    </label>
                    <div className="calls-preview__actions">
                      {account.tier && <Tag>Tier {account.tier}</Tag>}
                      {account.type_client && <Tag>{account.type_client}</Tag>}
                      {account.effectif && <Tag>{account.effectif}</Tag>}
                      <Tag variant="accent">
                        {account.contacts.length} contact{account.contacts.length > 1 ? "s" : ""}
                      </Tag>
                    </div>
                  </div>
                  <p className="calls-muted calls-fb-hint">
                    {[account.industry, account.owner_name].filter(Boolean).join(" · ") || "—"}
                  </p>
                </GlassCard>
              );
            })}
          </div>
        </>
      )}

      {!loading && searched && accounts.length === 0 && !error && (
        <GlassCard className="calls-empty calls-empty--hero">
          <Tag variant="accent">ABM</Tag>
          <h3>Aucun compte trouvé</h3>
          <p>Essayez un autre nom ou ajustez les filtres.</p>
        </GlassCard>
      )}
    </div>
  );
}
