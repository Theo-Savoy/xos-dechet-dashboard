import type { CleanerCapabilities } from '../../contracts';
import type { CommandAction } from './CommandPreviewPanel.types';

type BulkActionBarProps = {
  selectedCount: number;
  filteredCount: number;
  currentPageCount: number;
  currentPageSelectedCount?: number;
  allFilteredSelected: boolean;
  capabilities: CleanerCapabilities;
  onSelectAll: () => void;
  onClear: () => void;
  onStartAction: (action: CommandAction) => void;
};

export function BulkActionBar({
  selectedCount,
  filteredCount,
  currentPageCount,
  currentPageSelectedCount = 0,
  allFilteredSelected,
  capabilities,
  onSelectAll,
  onClear,
  onStartAction,
}: BulkActionBarProps) {
  if (selectedCount < 1) return null;

  return (
    <aside
      className="cleaner-opportunities__bulk-bar"
      aria-label="Actions groupées"
    >
      <div className="cleaner-opportunities__bulk-summary">
        <strong>
          {selectedCount} sélectionnée{selectedCount > 1 ? 's' : ''}
        </strong>
        <span>
          Page courante : {currentPageSelectedCount}/{currentPageCount}
        </span>
        <span>
          {allFilteredSelected
            ? `Tous les ${filteredCount} résultats filtrés sont sélectionnés`
            : `${filteredCount} résultats filtrés disponibles`}
        </span>
      </div>
      <div className="cleaner-opportunities__bulk-selection">
        {!allFilteredSelected && selectedCount < filteredCount ? (
          <button
            className="xos-btn xos-btn--secondary"
            type="button"
            onClick={onSelectAll}
          >
            Sélectionner les {filteredCount} résultats filtrés
          </button>
        ) : null}
        <button
          className="xos-btn xos-btn--secondary"
          type="button"
          onClick={onClear}
        >
          Désélectionner
        </button>
      </div>
      <div
        className="cleaner-opportunities__bulk-actions"
        aria-label="Commandes disponibles"
      >
        {capabilities.canReassign ? (
          <button
            className="xos-btn xos-btn--secondary"
            type="button"
            onClick={() => onStartAction('reassign-owner')}
          >
            Réassigner le propriétaire
          </button>
        ) : null}
        {capabilities.canBulkEdit ? (
          <>
            <button
              className="xos-btn xos-btn--secondary"
              type="button"
              onClick={() => onStartAction('close-date')}
            >
              Modifier la date de clôture
            </button>
            <button
              className="xos-btn xos-btn--secondary"
              type="button"
              onClick={() => onStartAction('sale-type')}
            >
              Modifier le type de vente
            </button>
          </>
        ) : null}
        {capabilities.canBulkClose ? (
          <button
            className="xos-btn xos-btn--primary"
            type="button"
            onClick={() => onStartAction('close-lost')}
          >
            Clore en perdue
          </button>
        ) : null}
      </div>
    </aside>
  );
}
