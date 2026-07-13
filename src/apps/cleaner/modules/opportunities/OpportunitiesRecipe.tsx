import { useEffect, useState } from 'react';
import type { CleanerCapabilities } from '../../contracts';
import {
  fetchOpportunityWorkspace,
  type OpportunityWorkspaceItem,
} from './api';
import { OpportunitiesCleaningView } from './OpportunitiesCleaningView';
import { OpportunitiesAnalyticsView } from './OpportunitiesAnalyticsView';
import { OpportunitiesHistoryView } from './OpportunitiesHistoryView';
import {
  createInitialOpportunityFilters,
  type OpportunityWorkspaceState,
} from './filterState';

export type OpportunitiesRecipeProps = {
  accessToken?: string;
  params?: Record<string, string>;
};

const READ_ONLY_CAPABILITIES: CleanerCapabilities = {
  canViewTeam: false,
  canReassign: false,
  canBulkEdit: false,
  canBulkClose: false,
  canManageRules: false,
};

function initialState(
  params?: Record<string, string>,
): OpportunityWorkspaceState {
  return {
    filters: { ...createInitialOpportunityFilters(), search: params?.q || '' },
    sort: { key: 'score', direction: 'desc' },
    page: 1,
    selectedIds: new Set<string>(),
    activeView: 'cleaning',
  };
}

export function OpportunitiesRecipe({
  accessToken,
  params,
}: OpportunitiesRecipeProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>(
    'loading',
  );
  const [items, setItems] = useState<OpportunityWorkspaceItem[]>([]);
  const [capabilities, setCapabilities] = useState<CleanerCapabilities>(
    READ_ONLY_CAPABILITIES,
  );
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState(() => initialState(params));
  const [detail, setDetail] = useState<OpportunityWorkspaceItem | null>(null);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setError(null);
    fetchOpportunityWorkspace(accessToken)
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setCapabilities({
          ...READ_ONLY_CAPABILITIES,
          ...(response.capabilities || {}),
        });
        setStatus(response.items.length ? 'ready' : 'empty');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : 'Les opportunités sont indisponibles.',
        );
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [accessToken]);

  return (
    <section
      className="cleaner-opportunities"
      data-testid="cleaner-recipe-opportunities"
    >
      <nav
        className="cleaner-opportunities__views"
        aria-label="Vues de la recette Opportunités"
      >
        {[
          ['cleaning', 'Nettoyage'],
          ['analytics', 'Synthèse'],
          ['history', 'Historique'],
        ].map(([view, label]) => (
          <button
            key={view}
            type="button"
            aria-pressed={state.activeView === view}
            className={state.activeView === view ? 'is-active' : ''}
            onClick={() =>
              setState((current) => ({
                ...current,
                activeView: view as OpportunityWorkspaceState['activeView'],
              }))
            }
          >
            {label}
          </button>
        ))}
      </nav>
      {status === 'loading' ? (
        <div role="status" aria-busy="true">
          Chargement des opportunités…
        </div>
      ) : null}
      {status === 'error' ? (
        <div role="alert">
          {error || 'Les opportunités sont indisponibles.'}
        </div>
      ) : null}
      {state.activeView === 'cleaning' && status === 'empty' ? (
        <div role="status">Aucune opportunité à nettoyer.</div>
      ) : null}
      {state.activeView === 'cleaning' && status === 'ready' ? (
        <OpportunitiesCleaningView
          accessToken={accessToken}
          capabilities={capabilities}
          items={items}
          state={state}
          onStateChange={setState}
          detail={detail}
          onOpenDetail={setDetail}
          onCloseDetail={() => setDetail(null)}
        />
      ) : null}
      {state.activeView === 'analytics' ? (
        <OpportunitiesAnalyticsView
          accessToken={accessToken}
          onNavigateToCleaning={(filters) =>
            setState((current) => ({
              ...current,
              activeView: 'cleaning',
              page: 1,
              filters: { ...current.filters, ...filters },
            }))
          }
        />
      ) : null}
      {state.activeView === 'history' ? (
        <OpportunitiesHistoryView
          accessToken={accessToken}
          selectedOpportunityCount={state.selectedIds.size}
        />
      ) : null}
    </section>
  );
}

export default OpportunitiesRecipe;
