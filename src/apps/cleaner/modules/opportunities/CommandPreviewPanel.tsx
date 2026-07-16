import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  OpportunityCommandChanges,
  OpportunityCommandPreview,
  OpportunityCommandResult,
} from './api';
import type { CommandAction } from './CommandPreviewPanel.types';

type SelectedCommandItem = { id: string; name?: string | null };
type Option = { id: string; label: string };

type CommandPreviewPanelProps = {
  action: CommandAction;
  selectedCount: number;
  selectedItems: SelectedCommandItem[];
  ownerOptions?: Option[];
  saleTypeOptions?: string[];
  preview?: OpportunityCommandPreview | null;
  result?: OpportunityCommandResult | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onPreview: (changes: OpportunityCommandChanges) => void;
  onExecute: (preview: OpportunityCommandPreview) => void;
};

const labels: Record<CommandAction, string> = {
  'reassign-owner': 'Réassigner le propriétaire',
  'close-date': 'Modifier la date de clôture',
  'sale-type': 'Modifier le type de vente',
  'close-lost': 'Clore en perdue',
};

function text(value: unknown): string {
  return value == null || value === '' ? '—' : String(value);
}

function fieldsFor(
  action: CommandAction,
  values: {
    ownerId: string;
    closeDate: string;
    saleType: string;
    lossReason: string;
  },
): OpportunityCommandChanges {
  if (action === 'reassign-owner') return { owner_id: values.ownerId.trim() };
  if (action === 'close-date') return { close_date: values.closeDate };
  if (action === 'sale-type') return { type_vente: values.saleType.trim() };
  return { stage: 'Fermée / Perdue', loss_reason: values.lossReason.trim() };
}

function validationFor(
  action: CommandAction,
  changes: OpportunityCommandChanges,
): string | null {
  if (action === 'reassign-owner' && !changes.owner_id)
    return 'Indiquez un propriétaire ou ACCOUNT_OWNER.';
  if (action === 'close-date' && !changes.close_date)
    return 'Indiquez une date de clôture.';
  if (action === 'sale-type' && !changes.type_vente)
    return 'Indiquez un type de vente.';
  if (action === 'close-lost' && !changes.loss_reason)
    return 'Une raison de perte est obligatoire pour clore en perdue.';
  return null;
}

export function CommandPreviewPanel({
  action,
  selectedCount,
  selectedItems,
  ownerOptions = [],
  saleTypeOptions = [],
  preview = null,
  result = null,
  loading = false,
  error = null,
  onClose,
  onPreview,
  onExecute,
}: CommandPreviewPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [ownerId, setOwnerId] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [saleType, setSaleType] = useState('');
  const [lossReason, setLossReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const changes = useMemo(
    () => fieldsFor(action, { ownerId, closeDate, saleType, lossReason }),
    [action, closeDate, lossReason, ownerId, saleType],
  );
  const previewMatchesDraft =
    preview && JSON.stringify(preview.changes) === JSON.stringify(changes);

  useEffect(() => {
    const previousFocusElement = previousFocus.current;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusElement?.focus();
    };
  }, [loading, onClose]);

  const submitPreview = () => {
    const issue = validationFor(action, changes);
    setValidationError(issue);
    if (!issue) onPreview(changes);
  };

  return (
    <div
      className="cleaner-opportunities__command-backdrop"
      role="presentation"
    >
      <div
        className="cleaner-opportunities__command-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleaner-command-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="cleaner-opportunities__command-header">
          <div>
            <p className="cleaner-eyebrow">Commande Labo</p>
            <h2 id="cleaner-command-title">{labels[action]}</h2>
          </div>
          <button
            className="cleaner-opportunities__row-link"
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Fermer la commande"
          >
            Fermer
          </button>
        </header>
        <p className="cleaner-opportunities__command-lead">
          {selectedCount} enregistrement{selectedCount > 1 ? 's' : ''}{' '}
          sélectionné{selectedCount > 1 ? 's' : ''}. Le serveur relira les
          valeurs avant toute exécution.
        </p>
        {result ? (
          <section
            className="cleaner-opportunities__command-result"
            aria-live="polite"
          >
            <div role="status">
              <strong>
                Résultat{' '}
                {result.status === 'partial'
                  ? 'partiel'
                  : result.status === 'succeeded'
                    ? 'réussi'
                    : 'en échec'}
              </strong>
              <span>
                {result.updated} réussi{result.updated > 1 ? 's' : ''} ·{' '}
                {result.failed} échec{result.failed > 1 ? 's' : ''}
              </span>
            </div>
            <p>
              Commande {String(result.commandId)} · clé d’idempotence{' '}
              {result.idempotencyKey}
              {result.replayed ? ' · replay idempotent' : ''}
            </p>
            {result.results.map((item) => (
              <div
                className={item.success ? 'is-success' : 'is-failed'}
                key={item.id}
              >
                <span>{item.id}</span>
                <span>
                  {item.success ? 'Réussi' : item.error || 'Échec sans détail'}
                </span>
              </div>
            ))}
            {result.auditError ? (
              <p role="alert">Erreur d’audit : {result.auditError}</p>
            ) : null}
            <button
              className="xos-btn xos-btn--secondary"
              type="button"
              onClick={onClose}
            >
              Fermer
            </button>
          </section>
        ) : (
          <>
            <fieldset
              className="cleaner-opportunities__command-fields"
              disabled={loading}
            >
              <legend>Paramètres</legend>
              {action === 'reassign-owner' ? (
                <>
                  <label htmlFor="cleaner-owner-target">
                    Propriétaire cible
                  </label>
                  <input
                    id="cleaner-owner-target"
                    list="cleaner-owner-options"
                    placeholder="005… ou ACCOUNT_OWNER"
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                  />
                  <datalist id="cleaner-owner-options">
                    <option value="ACCOUNT_OWNER">
                      Propriétaire du compte
                    </option>
                    {ownerOptions.map((option) => (
                      <option value={option.id} key={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </>
              ) : null}
              {action === 'close-date' ? (
                <>
                  <label htmlFor="cleaner-close-date">Date de clôture</label>
                  <input
                    id="cleaner-close-date"
                    type="date"
                    value={closeDate}
                    onChange={(event) => setCloseDate(event.target.value)}
                  />
                </>
              ) : null}
              {action === 'sale-type' ? (
                <>
                  <label htmlFor="cleaner-sale-type">Type de vente</label>
                  <input
                    id="cleaner-sale-type"
                    list="cleaner-sale-types"
                    value={saleType}
                    onChange={(event) => setSaleType(event.target.value)}
                  />
                  <datalist id="cleaner-sale-types">
                    {saleTypeOptions.map((option) => (
                      <option value={option} key={option} />
                    ))}
                  </datalist>
                </>
              ) : null}
              {action === 'close-lost' ? (
                <>
                  <label htmlFor="cleaner-loss-reason">Raison de perte</label>
                  <input
                    id="cleaner-loss-reason"
                    value={lossReason}
                    onChange={(event) => setLossReason(event.target.value)}
                    required
                  />
                </>
              ) : null}
            </fieldset>
            {validationError ? (
              <p className="cleaner-opportunities__command-error" role="alert">
                {validationError}
              </p>
            ) : null}
            {error ? (
              <p className="cleaner-opportunities__command-error" role="alert">
                {error}
              </p>
            ) : null}
            {previewMatchesDraft ? (
              <section
                className="cleaner-opportunities__command-preview"
                aria-live="polite"
              >
                <h3>Preview serveur</h3>
                <p>
                  {preview!.eligible.length} éligible
                  {preview!.eligible.length > 1 ? 's' : ''} ·{' '}
                  {preview!.excluded.length} exclu
                  {preview!.excluded.length > 1 ? 's' : ''}
                </p>
                {preview!.eligible.map((item) => (
                  <div key={item.id}>
                    <strong>{item.id}</strong>
                    <span>
                      {Object.keys(preview!.changes)
                        .map(
                          (key) =>
                            `${key} — avant : ${text(item.before[key])} · après : ${text(item.after[key])}`,
                        )
                        .join(' · ')}
                    </span>
                  </div>
                ))}
                {preview!.excluded.map((item) => (
                  <div className="is-excluded" key={item.id}>
                    <strong>{item.id}</strong>
                    <span>Exclu : {item.reason}</span>
                  </div>
                ))}
                {preview!.eligible.length ? (
                  <button
                    className="xos-btn xos-btn--primary"
                    type="button"
                    disabled={loading}
                    onClick={() => onExecute(preview!)}
                  >
                    Confirmer et exécuter
                  </button>
                ) : null}
              </section>
            ) : null}
            <footer className="cleaner-opportunities__command-footer">
              <button
                className="xos-btn xos-btn--secondary"
                type="button"
                onClick={onClose}
                disabled={loading}
              >
                Annuler
              </button>
              {!previewMatchesDraft ? (
                <button
                  className="xos-btn xos-btn--primary"
                  type="button"
                  onClick={submitPreview}
                  disabled={loading}
                >
                  {loading ? 'Préparation…' : 'Prévisualiser les changements'}
                </button>
              ) : null}
            </footer>
          </>
        )}
        {selectedItems.length ? (
          <p className="cleaner-opportunities__command-targets">
            Cibles :{' '}
            {selectedItems.map((item) => item.name || item.id).join(' · ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
