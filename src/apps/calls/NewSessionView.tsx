import { useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import type { CallTargetPreset, DedupEntry, FilterTree } from "../../crm";
import { DedupBanner, type DedupMode } from "./DedupBanner";
import { FilterBuilder } from "./FilterBuilder";
import type { ContactPreview } from "./types";

type NewSessionViewProps = {
  filters: FilterTree;
  onFiltersChange: (next: FilterTree) => void;
  loading: boolean;
  previewLoading: boolean;
  error: string | null;
  preview: ContactPreview[];
  dedup: DedupEntry[];
  presets: CallTargetPreset[];
  presetsLoading: boolean;
  savingPreset: boolean;
  currentUserId: string;
  onBack: () => void;
  onPreview: () => void;
  onLoadPreset: (preset: CallTargetPreset) => void;
  onSavePreset: (name: string, shared: boolean) => void;
  onDeletePreset: (id: number) => void;
  onCreate: (name: string, contacts: ContactPreview[]) => void;
};

export function NewSessionView({
  filters,
  onFiltersChange,
  loading,
  previewLoading,
  error,
  preview,
  dedup,
  presets,
  presetsLoading,
  savingPreset,
  currentUserId,
  onBack,
  onPreview,
  onLoadPreset,
  onSavePreset,
  onDeletePreset,
  onCreate,
}: NewSessionViewProps) {
  const [sessionName, setSessionName] = useState("");
  const [dedupMode, setDedupMode] = useState<DedupMode>("avertir");

  const dedupIds = useMemo(() => new Set(dedup.map((d) => d.sf_contact_id)), [dedup]);
  const inSessionOf = useMemo(
    () => new Map(dedup.map((d) => [d.sf_contact_id, d.in_session_of])),
    [dedup],
  );

  const eligibleContacts = useMemo(
    () =>
      dedupMode === "exclure"
        ? preview.filter((c) => !dedupIds.has(c.sf_contact_id))
        : preview,
    [preview, dedupMode, dedupIds],
  );

  const handleCreate = () => {
    const name = sessionName.trim();
    if (!name || eligibleContacts.length === 0) return;
    onCreate(name, eligibleContacts);
  };

  return (
    <div className="calls-view">
      <header className="calls-view__header">
        <div>
          <Tag variant="accent">Nouvelle séance</Tag>
          <h2>Composer une liste</h2>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Retour
        </Button>
      </header>

      <FilterBuilder
        filters={filters}
        onChange={onFiltersChange}
        previewCount={preview.length > 0 ? preview.length : null}
        previewLoading={previewLoading}
        onPreview={onPreview}
        presets={presets}
        presetsLoading={presetsLoading}
        savingPreset={savingPreset}
        currentUserId={currentUserId}
        onLoadPreset={onLoadPreset}
        onSavePreset={onSavePreset}
        onDeletePreset={onDeletePreset}
      />

      {error && (
        <GlassCard className="calls-error">
          <p role="alert" aria-live="assertive">{error}</p>
        </GlassCard>
      )}

      {dedup.length > 0 && (
        <DedupBanner dedup={dedup} mode={dedupMode} onModeChange={setDedupMode} />
      )}

      {preview.length > 0 && (
        <>
          <GlassCard className="calls-preview">
            <div className="calls-preview__header">
              <h3>Aperçu</h3>
              <Tag>
                {eligibleContacts.length} contact{eligibleContacts.length > 1 ? "s" : ""}
              </Tag>
            </div>
            <ul className="calls-preview__list">
              {preview.slice(0, 8).map((contact) => {
                const dup = inSessionOf.get(contact.sf_contact_id);
                const excluded = dup && dedupMode === "exclure";
                return (
                  <li
                    key={contact.sf_contact_id}
                    className={excluded ? "calls-preview__row--excluded" : undefined}
                  >
                    <strong>{contact.contact_name}</strong>
                    <span>{contact.account_name ?? "—"}</span>
                    <span className="xos-numeric">{contact.phone ?? "—"}</span>
                    {dup && !excluded && (
                      <Tag variant="alert">Déjà en séance — {dup}</Tag>
                    )}
                  </li>
                );
              })}
            </ul>
            {preview.length > 8 && (
              <p className="calls-preview__more">
                + {preview.length - 8} autre{preview.length - 8 > 1 ? "s" : ""}
              </p>
            )}
          </GlassCard>

          <GlassCard className="calls-name-form">
            <label className="calls-field">
              <span>Nom de la séance</span>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Prospection Lyon"
                className="calls-input"
              />
            </label>
            <Button
              onClick={handleCreate}
              disabled={loading || !sessionName.trim() || eligibleContacts.length === 0}
            >
              {loading ? "Création…" : "Lancer la séance"}
            </Button>
          </GlassCard>
        </>
      )}

      {!previewLoading && preview.length === 0 && !error && (
        <GlassCard className="calls-empty">
          <p>Réglez les filtres puis prévisualisez la liste de contacts.</p>
        </GlassCard>
      )}
    </div>
  );
}
