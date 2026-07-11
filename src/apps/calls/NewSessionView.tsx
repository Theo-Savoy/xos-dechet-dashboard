import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  type CallTargetPreset,
  type ContactLimit,
  type DedupEntry,
  type FilterTree,
  type MaxPerCompany,
} from "../../crm";
import { DedupBanner, type DedupMode } from "./DedupBanner";
import { FilterBuilder } from "./FilterBuilder";
import { DatePicker, SessionTypePicker, todayParisIso } from "./formControls";
import { canSelectContact, selectIdsWithCompanyCap } from "./selection";
import type { ContactPreview, SessionType } from "./types";

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
  onCreate: (
    name: string,
    contacts: ContactPreview[],
    scheduledFor: string,
    sessionType: SessionType,
  ) => void;
};

function Cell({
  children,
  title,
  className,
}: {
  children: ReactNode;
  title?: string | null;
  className?: string;
}) {
  const tip = title ?? (typeof children === "string" ? children : undefined);
  return (
    <span className={["calls-preview__cell", className].filter(Boolean).join(" ")} title={tip || undefined}>
      {children}
    </span>
  );
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
  const [scheduledFor, setScheduledFor] = useState(todayParisIso);
  const [sessionType, setSessionType] = useState<SessionType>("prospection");
  const [dedupMode, setDedupMode] = useState<DedupMode>("avertir");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [maxPerCompany, setMaxPerCompany] = useState<MaxPerCompany | null>(null);
  const [capHint, setCapHint] = useState<string | null>(null);

  const inSessionOf = useMemo(
    () => new Map(dedup.map((d) => [d.sf_contact_id, d.in_session_of])),
    [dedup],
  );

  const eligibleIds = useMemo(() => {
    const dedupSet = new Set(dedup.map((entry) => entry.sf_contact_id));
    return new Set(
      preview
        .map((contact) => contact.sf_contact_id)
        .filter((id) => dedupMode !== "exclure" || !dedupSet.has(id)),
    );
  }, [preview, dedup, dedupMode]);

  useEffect(() => {
    setSelectedIds(selectIdsWithCompanyCap(preview, maxPerCompany, eligibleIds));
    setCapHint(
      maxPerCompany
        ? `Max ${maxPerCompany}/entreprise — priorité aux directeurs / responsables.`
        : null,
    );
  }, [preview, eligibleIds, maxPerCompany]);

  const selectedContacts = useMemo(
    () => preview.filter((contact) => selectedIds.has(contact.sf_contact_id)),
    [preview, selectedIds],
  );

  const toggleContact = (contactId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) {
        next.delete(contactId);
        setCapHint(null);
        return next;
      }
      if (!canSelectContact(preview, current, contactId, maxPerCompany)) {
        setCapHint(
          maxPerCompany
            ? `Maximum ${maxPerCompany} contact${maxPerCompany > 1 ? "s" : ""} par entreprise.`
            : null,
        );
        return current;
      }
      next.add(contactId);
      setCapHint(null);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(selectIdsWithCompanyCap(preview, maxPerCompany, eligibleIds));
    setCapHint(
      maxPerCompany
        ? `Sélection limitée à ${maxPerCompany}/entreprise (directeurs / responsables prioritaires).`
        : null,
    );
  };
  const deselectAll = () => {
    setSelectedIds(new Set());
    setCapHint(null);
  };

  const handleCreate = () => {
    const name = sessionName.trim();
    if (!name || selectedContacts.length === 0) return;
    onCreate(name, selectedContacts, scheduledFor, sessionType);
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
        maxPerCompany={maxPerCompany}
        onMaxPerCompanyChange={setMaxPerCompany}
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
          <GlassCard className="calls-name-form calls-name-form--sticky">
            <div className="calls-name-form__meta">
              <Tag>
                {selectedContacts.length} sélectionné{selectedContacts.length > 1 ? "s" : ""}
              </Tag>
            </div>
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
            <DatePicker label="Date de séance" value={scheduledFor} onChange={setScheduledFor} />
            <SessionTypePicker value={sessionType} onChange={setSessionType} />
            <Button
              onClick={handleCreate}
              disabled={loading || !sessionName.trim() || selectedContacts.length === 0}
            >
              {loading ? "Création…" : "Lancer la séance"}
            </Button>
          </GlassCard>

          <GlassCard className="calls-preview">
            <div className="calls-preview__header">
              <div className="calls-preview__heading">
                <h3>Aperçu</h3>
                <Tag>
                  {selectedContacts.length} sélectionné{selectedContacts.length > 1 ? "s" : ""} /{" "}
                  {preview.length}
                </Tag>
              </div>
              <div className="calls-preview__actions">
                <Button variant="secondary" onClick={selectAll}>
                  Tout sélectionner
                </Button>
                <Button variant="secondary" onClick={deselectAll}>
                  Tout désélectionner
                </Button>
              </div>
            </div>
            {capHint && (
              <p className="calls-preview__cap-hint" role="status" aria-live="polite">
                {capHint}
              </p>
            )}
            <div className="calls-preview__table-wrap">
              <ul className="calls-preview__list">
                <li className="calls-preview__list-header" aria-hidden="true">
                  <span className="calls-preview__select" />
                  <span>Contact</span>
                  <span>Poste</span>
                  <span>Entreprise</span>
                  <span>Téléphone</span>
                  <span>LinkedIn</span>
                  <span>Statut</span>
                </li>
                {preview.map((contact) => {
                  const dup = inSessionOf.get(contact.sf_contact_id);
                  const checked = selectedIds.has(contact.sf_contact_id);
                  const blocked =
                    !checked && !canSelectContact(preview, selectedIds, contact.sf_contact_id, maxPerCompany);
                  const phone = contact.phone ?? contact.mobile_phone ?? null;
                  return (
                    <li
                      key={contact.sf_contact_id}
                      className={!checked ? "calls-preview__row--excluded" : undefined}
                    >
                      <label className="calls-preview__select calls-checkbox calls-checkbox--tight">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blocked}
                          title={blocked ? (capHint ?? "Plafond entreprise atteint") : undefined}
                          onChange={() => toggleContact(contact.sf_contact_id)}
                          aria-label={`Sélectionner ${contact.contact_name}`}
                        />
                      </label>
                      <Cell className="calls-preview__name" title={contact.contact_name}>
                        <strong>{contact.contact_name}</strong>
                      </Cell>
                      <Cell title={contact.title}>{contact.title ?? "—"}</Cell>
                      <Cell title={contact.account_name}>{contact.account_name ?? "—"}</Cell>
                      <Cell className="xos-numeric" title={phone}>
                        {phone ?? "—"}
                      </Cell>
                      {contact.linkedin_url ? (
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="calls-preview__linkedin"
                        >
                          LinkedIn
                        </a>
                      ) : (
                        <Cell>—</Cell>
                      )}
                      {dup ? (
                        <Tag variant="alert" className="calls-preview__dup" title={`Déjà en séance — ${dup}`}>
                          Déjà en séance — {dup}
                        </Tag>
                      ) : (
                        <Cell>—</Cell>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </GlassCard>
        </>
      )}

      {!previewLoading && preview.length === 0 && !error && (
        <GlassCard className="calls-empty calls-empty--hero">
          <Tag variant="accent">Ciblage</Tag>
          <h3>Prévisualisez votre liste</h3>
          <p>Réglez les filtres, puis lancez une prévisualisation pour sélectionner les contacts.</p>
          <Button onClick={onPreview} disabled={previewLoading}>
            Prévisualiser
          </Button>
        </GlassCard>
      )}
    </div>
  );
}
