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
import { fetchAccountsSearch, CallsApiError, type AudienceSessionGroup } from "./api";
import { packAccountsIntoSessions } from "./audienceBinPacking";
import { ChipGroup, PicklistMultiSelect } from "./filterControls";
import { asOptions } from "./filterControls.helpers";
import type { AccountSearchHit, ContactPreview, TeamMember } from "./types";

type AbmFilters = {
  secteurs: Secteur[];
  effectifs: EffectifTranche[];
  type_client: TypeClient[];
  tiers: Tier[];
  proprietaires: string[];
};

function emptyAbmFilters(): AbmFilters {
  return { secteurs: [], effectifs: [], type_client: [], tiers: [], proprietaires: [] };
}

function hasAnyFilter(filters: AbmFilters): boolean {
  return (
    filters.secteurs.length > 0 ||
    filters.effectifs.length > 0 ||
    filters.type_client.length > 0 ||
    filters.tiers.length > 0 ||
    filters.proprietaires.length > 0
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof CallsApiError) {
    if (err.code === "invalid_query") return "Saisissez un nom de compte ou sélectionnez au moins un filtre.";
    if (err.code === "sf_auth_error") return "Salesforce a refusé l'authentification — reconnectez-vous.";
    return `Erreur API (${err.code})`;
  }
  return "Une erreur est survenue.";
}

function toContactPreview(account: AccountSearchHit, contact: AccountSearchHit["contacts"][number]): ContactPreview {
  return {
    sf_contact_id: contact.sf_contact_id,
    sf_account_id: account.id,
    contact_name: contact.contact_name,
    account_name: account.name,
    phone: contact.phone,
    mobile_phone: contact.mobile_phone,
    email: contact.email,
    title: contact.title,
  };
}

export type CreateAudiencePayload = {
  groups: AudienceSessionGroup[];
  targetSize: number;
  maxSessions: number;
  namePrefix?: string;
  excludedCount: number;
};

type AccountSearchViewProps = {
  token: string;
  team?: TeamMember[];
  onBack: () => void;
  onCreateAudience: (payload: CreateAudiencePayload) => void;
  creating: boolean;
  createError: string | null;
};

export function AccountSearchView({ token, team = [], onBack, onCreateAudience, creating, createError }: AccountSearchViewProps) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<AbmFilters>(emptyAbmFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [excludedCount, setExcludedCount] = useState(0);
  const [sessionName, setSessionName] = useState("");
  const [targetSize, setTargetSize] = useState(50);
  const [maxSessions, setMaxSessions] = useState(5);

  const setFilter = (patch: Partial<AbmFilters>) => setFilters((current) => ({ ...current, ...patch }));

  const ownerOptions = useMemo(
    () => [...new Map(team.filter((member) => member.sf_user_id).map((member) => [member.sf_user_id, {
      value: member.sf_user_id,
      label: member.label,
    }])).values()],
    [team],
  );

  const canSearch = query.trim().length >= 2 || hasAnyFilter(filters);

  const handleSearch = async () => {
    const q = query.trim();
    if (!canSearch || !token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccountsSearch(token, { q, filters });
      setAccounts(data.accounts);
      setTruncated(data.truncated);
      setExcludedCount(data.excluded_count ?? 0);
      setSelectedIds(new Set());
      setSearched(true);
      if (data.accounts.length === 0) setError("Aucun compte ne correspond à cette recherche.");
    } catch (err) {
      setError(errorMessage(err));
      setAccounts([]);
      setExcludedCount(0);
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

  const selectedAccounts = useMemo(() => accounts.filter((account) => selectedIds.has(account.id)), [accounts, selectedIds]);

  const selectedContactsCount = useMemo(
    () => selectedAccounts.reduce((total, account) => total + account.contacts.length, 0),
    [selectedAccounts],
  );

  const totalContactsCount = useMemo(
    () => accounts.reduce((total, account) => total + account.contacts.length, 0),
    [accounts],
  );

  const packableAccounts = useMemo(
    () =>
      selectedAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        contacts: account.contacts.map((contact) => toContactPreview(account, contact)),
      })),
    [selectedAccounts],
  );

  const groups = useMemo(
    () => packAccountsIntoSessions(packableAccounts, targetSize, maxSessions),
    [packableAccounts, targetSize, maxSessions],
  );

  const handleCreateClick = () => {
    if (groups.length === 0) return;
    onCreateAudience({
      groups: groups.map((group) => ({ account_ids: group.accountIds, contacts: group.contacts })),
      targetSize,
      maxSessions,
      namePrefix: sessionName.trim() || query.trim() || undefined,
      excludedCount,
    });
  };

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
              placeholder="ACME (optionnel si des filtres sont sélectionnés)"
            />
          </label>
          <Button onClick={() => void handleSearch()} disabled={loading || !canSearch}>
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
            <ChipGroup
              label="Propriétaires du compte"
              hint="Sélectionne par nom"
              options={ownerOptions}
              value={filters.proprietaires}
              onChange={(proprietaires) => setFilter({ proprietaires })}
            />
          </div>
        </details>
      </GlassCard>

      {(error || createError) && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">{error || createError}</p>
        </GlassCard>
      )}

      {truncated && (
        <GlassCard className="calls-truncated-banner" role="status">
          <p>Résultats partiels : affinez votre recherche.</p>
        </GlassCard>
      )}

      {excludedCount > 0 && (
        <div className="calls-builder-excluded-banner" role="status">
          <strong>{excludedCount}</strong> contact{excludedCount > 1 ? "s" : ""} exclu{excludedCount > 1 ? "s" : ""} car déjà dans une séance active.
        </div>
      )}

      {accounts.length > 0 && (
        <>
          <GlassCard className="calls-name-form calls-name-form--sticky">
            <div className="calls-name-form__meta">
              <Tag>
                {selectedIds.size > 0
                  ? `${selectedContactsCount} contact${selectedContactsCount > 1 ? "s" : ""} dans ${selectedIds.size} compte${selectedIds.size > 1 ? "s" : ""} sélectionné${selectedIds.size > 1 ? "s" : ""}`
                  : `${accounts.length} compte${accounts.length > 1 ? "s" : ""} trouvé${accounts.length > 1 ? "s" : ""} · ${totalContactsCount} contact${totalContactsCount > 1 ? "s" : ""} au total`}
              </Tag>
            </div>
          </GlassCard>

          {selectedIds.size > 0 && (
            <GlassCard className="calls-audience-pack">
              <h3>Découper en plusieurs séances</h3>
              <label className="calls-field">
                <span>Nom des séances (préfixe)</span>
                <input
                  type="text"
                  className="calls-input"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Ex: 'ACME décisionnaires' → ACME décisionnaires #1, #2, ..."
                />
              </label>
              <div className="calls-fb-row">
                <label className="calls-field">
                  <span>Taille cible par séance</span>
                  <input
                    type="number"
                    className="calls-input"
                    min={1}
                    value={targetSize}
                    onChange={(e) => setTargetSize(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <label className="calls-field">
                  <span>Nombre max de séances</span>
                  <input
                    type="number"
                    className="calls-input"
                    min={1}
                    value={maxSessions}
                    onChange={(e) => setMaxSessions(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
              </div>

              {groups.length > 0 ? (
                <>
                  <p className="calls-muted calls-fb-hint">Aperçu : {groups.length} séance{groups.length > 1 ? "s" : ""}</p>
                  <ul className="calls-audience-pack__preview">
                    {groups.map((group, index) => (
                      <li key={index}>
                        {group.accountNames.join(" + ")} : {group.totalContacts} contact{group.totalContacts > 1 ? "s" : ""}
                      </li>
                    ))}
                  </ul>
                  <Button onClick={handleCreateClick} disabled={creating}>
                    {creating ? "Création…" : `Créer ${groups.length} séance${groups.length > 1 ? "s" : ""} ABM`}
                  </Button>
                </>
              ) : (
                <p className="calls-muted calls-fb-hint">
                  Tous les contacts sélectionnés sont déjà en séance active. Aucune séance ne sera créée.
                </p>
              )}
            </GlassCard>
          )}

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
