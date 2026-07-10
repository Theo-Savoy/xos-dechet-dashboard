import { useEffect, useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import type { CallTargetPreset, ContactLimit, DedupEntry, FilterTree } from "../../crm";
import { DedupBanner, type DedupMode } from "./DedupBanner";
import { FilterBuilder } from "./FilterBuilder";
import type { ContactPreview } from "./types";

type NewSessionViewProps = {
  filters: FilterTree;
  onFiltersChange: (next: FilterTree) => void;
  contactLimit: ContactLimit;
  onContactLimitChange: (limit: ContactLimit) => void;
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
  onCreate: (name: string, contacts: ContactPreview[], scheduledFor: string) => void;
};

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function NewSessionView({
  filters,
  onFiltersChange,
  contactLimit,
  onContactLimitChange,
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
  const [scheduledFor, setScheduledFor] = useState(todayLocalDate);
  const [dedupMode, setDedupMode] = useState<DedupMode>("avertir");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const inSessionOf = useMemo(
    () => new Map(dedup.map((d) => [d.sf_contact_id, d.in_session_of])),
    [dedup],
  );

  useEffect(() => {
    setSelectedIds(new Set(preview.map((contact) => contact.sf_contact_id)));
  }, [preview]);

  const selectedContacts = useMemo(
    () => preview.filter((contact) => selectedIds.has(contact.sf_contact_id)),
    [preview, selectedIds],
  );

  const toggleContact = (contactId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(preview.map((contact) => contact.sf_contact_id)));
  const deselectAll = () => setSelectedIds(new Set());

  const handleCreate = () => {
    const name = sessionName.trim();
    if (!name || selectedContacts.length === 0) return;
    onCreate(name, selectedContacts, scheduledFor);
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
        contactLimit={contactLimit}
        onContactLimitChange={onContactLimitChange}
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
                {selectedContacts.length} sélectionné{selectedContacts.length > 1 ? "s" : ""} / {preview.length}
              </Tag>
              <div className="calls-preview__actions">
                <Button variant="secondary" onClick={selectAll}>
                  Tout sélectionner
                </Button>
                <Button variant="secondary" onClick={deselectAll}>
                  Tout désélectionner
                </Button>
              </div>
            </div>
            <ul className="calls-preview__list">
              {preview.map((contact) => {
                const dup = inSessionOf.get(contact.sf_contact_id);
                const checked = selectedIds.has(contact.sf_contact_id);
                return (
                  <li key={contact.sf_contact_id} className={!checked ? "calls-preview__row--excluded" : undefined}>
                    <label className="calls-preview__select">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleContact(contact.sf_contact_id)}
                      />
                    </label>
                    <strong>{contact.contact_name}</strong>
                    <span>{contact.title ?? "—"}</span>
                    <span>{contact.account_name ?? "—"}</span>
                    <span className="xos-numeric">{contact.phone ?? contact.mobile_phone ?? "—"}</span>
                    {contact.linkedin_url ? (
                      <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer">
                        LinkedIn
                      </a>
                    ) : (
                      <span>—</span>
                    )}
                    {dup && dedupMode === "avertir" && (
                      <Tag variant="alert">Déjà en séance — {dup}</Tag>
                    )}
                  </li>
                );
              })}
            </ul>
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
            <label className="calls-field">
              <span>Date de séance</span>
              <input
                type="date"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="calls-input"
              />
            </label>
            <Button
              onClick={handleCreate}
              disabled={loading || !sessionName.trim() || selectedContacts.length === 0}
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
