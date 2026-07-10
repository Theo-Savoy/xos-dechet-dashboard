import { useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import type { ContactPreview } from "./types";

type NewSessionViewProps = {
  loading: boolean;
  previewLoading: boolean;
  error: string | null;
  preview: ContactPreview[];
  onBack: () => void;
  onPreview: (filters: {
    ownerOnly: boolean;
    hasPhone: boolean;
    accountId: string;
  }) => void;
  onCreate: (name: string, contacts: ContactPreview[]) => void;
};

export function NewSessionView({
  loading,
  previewLoading,
  error,
  preview,
  onBack,
  onPreview,
  onCreate,
}: NewSessionViewProps) {
  const [ownerOnly, setOwnerOnly] = useState(true);
  const [hasPhone, setHasPhone] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [sessionName, setSessionName] = useState("");

  const handlePreview = () => {
    onPreview({ ownerOnly, hasPhone, accountId: accountId.trim() });
  };

  const handleCreate = () => {
    const name = sessionName.trim();
    if (!name || preview.length === 0) return;
    onCreate(name, preview);
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

      <GlassCard className="calls-filters">
        <h3>Filtres</h3>
        <label className="calls-checkbox">
          <input
            type="checkbox"
            checked={ownerOnly}
            onChange={(e) => setOwnerOnly(e.target.checked)}
          />
          Mes contacts uniquement
        </label>
        <label className="calls-checkbox">
          <input
            type="checkbox"
            checked={hasPhone}
            onChange={(e) => setHasPhone(e.target.checked)}
          />
          Avec numéro de téléphone
        </label>
        <label className="calls-field">
          <span>Compte Salesforce (optionnel)</span>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="001..."
            className="calls-input"
          />
        </label>
        <Button onClick={handlePreview} disabled={previewLoading}>
          {previewLoading ? "Recherche…" : "Aperçu de la liste"}
        </Button>
      </GlassCard>

      {error && (
        <GlassCard className="calls-error">
          <p>{error}</p>
        </GlassCard>
      )}

      {preview.length > 0 && (
        <>
          <GlassCard className="calls-preview">
            <div className="calls-preview__header">
              <h3>Aperçu</h3>
              <Tag>{preview.length} contact{preview.length > 1 ? "s" : ""}</Tag>
            </div>
            <ul className="calls-preview__list">
              {preview.slice(0, 8).map((contact) => (
                <li key={contact.sf_contact_id}>
                  <strong>{contact.contact_name}</strong>
                  <span>{contact.account_name ?? "—"}</span>
                  <span className="xos-numeric">{contact.phone ?? "—"}</span>
                </li>
              ))}
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
              disabled={loading || !sessionName.trim()}
            >
              {loading ? "Création…" : "Lancer la séance"}
            </Button>
          </GlassCard>
        </>
      )}

      {!previewLoading && preview.length === 0 && !error && (
        <GlassCard className="calls-empty">
          <p>Appliquez des filtres puis prévisualisez la liste de contacts.</p>
        </GlassCard>
      )}
    </div>
  );
}
