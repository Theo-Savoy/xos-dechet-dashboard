import { Suspense, useEffect, useMemo, useState } from 'react';
import type { AppRole } from '../../../os/registry';
import { CleanerCockpit, type CleanerCockpitState } from '../CleanerCockpit';
import { CleanerTabs } from '../CleanerTabs';
import { getModuleDefinition, getVisibleModules } from './moduleRegistry';
import {
  closeModule,
  openModule,
  readTabState,
  writeTabState,
  type CleanerModuleId,
  type CleanerTabState,
} from './shellState';

export type CleanerShellProps = {
  accessToken?: string;
  role?: AppRole;
  params?: Record<string, string>;
  cockpit?: CleanerCockpitState;
  initialState?: CleanerTabState;
  visibleModuleIds?: readonly CleanerModuleId[];
};

const emptyCockpit: CleanerCockpitState = { status: 'empty', summaries: [] };

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function CleanerShell({
  accessToken,
  role = 'commercial',
  params,
  cockpit = emptyCockpit,
  initialState,
  visibleModuleIds,
}: CleanerShellProps) {
  const visibleModules = useMemo(() => {
    const modules = getVisibleModules(role);
    return visibleModuleIds
      ? modules.filter((module) => visibleModuleIds.includes(module.id))
      : modules;
  }, [role, visibleModuleIds]);
  const visibleIds = useMemo(
    () => new Set(visibleModules.map((module) => module.id)),
    [visibleModules],
  );
  const [state, setState] = useState<CleanerTabState>(() => {
    const stored = initialState || readTabState(getStorage());
    const open = stored.open.filter((moduleId) => visibleIds.has(moduleId));
    const nextState = {
      open,
      active:
        stored.active !== 'home' && !visibleIds.has(stored.active)
          ? 'home'
          : stored.active,
    };
    if (params?.q && visibleIds.has('recettes')) {
      return openModule(nextState, 'recettes');
    }
    return nextState;
  });
  const [renderedModules, setRenderedModules] = useState<CleanerModuleId[]>(
    () => state.open,
  );
  const [activeRecipeId, setActiveRecipeId] = useState<string | undefined>(
    () => (params?.q ? 'opportunities' : undefined),
  );

  useEffect(() => {
    setState((current) => {
      const open = current.open.filter((moduleId) => visibleIds.has(moduleId));
      return {
        open,
        active:
          current.active !== 'home' && !visibleIds.has(current.active)
            ? 'home'
            : current.active,
      };
    });
  }, [visibleIds]);

  useEffect(() => {
    writeTabState(getStorage(), state);
  }, [state]);

  const activate = (active: CleanerTabState['active']) => {
    if (active !== 'home' && !visibleIds.has(active)) return;
    setState((current) => ({ ...current, active }));
  };

  const open = (moduleId: CleanerModuleId, recipeId?: string) => {
    if (!visibleIds.has(moduleId)) return;
    setActiveRecipeId(recipeId);
    setRenderedModules((current) =>
      current.includes(moduleId) ? current : [...current, moduleId],
    );
    setState((current) => openModule(current, moduleId));
  };

  const close = (moduleId: CleanerModuleId) => {
    setState((current) => closeModule(current, moduleId));
  };

  return (
    <div className="cleaner-app" data-testid="cleaner-shell">
      <header className="cleaner-shell__header">
        <div>
          <p className="cleaner-eyebrow">X OS / Labo</p>
          <h1>Labo</h1>
        </div>
        <span className="cleaner-shell__role">{role}</span>
      </header>
      <CleanerTabs
        role={role}
        state={state}
        onActivate={activate}
        onClose={close}
        visibleModules={visibleModules}
      />
      <main className="cleaner-shell__body" data-active-module={state.active}>
        {state.active === 'home' && (
          <CleanerCockpit state={cockpit} onOpenModule={open} />
        )}
        <div className="cleaner-shell__modules" aria-live="polite">
          {renderedModules.map((moduleId) => {
            const module = getModuleDefinition(moduleId);
            const Module = module.component;
            const isActive =
              state.active === moduleId && visibleIds.has(moduleId);
            return (
              <div
                className="cleaner-shell__module"
                data-active={isActive}
                hidden={!isActive}
                key={moduleId}
              >
                <Suspense
                  fallback={
                    <div className="cleaner-module-loading" role="status">
                      Ouverture du module…
                    </div>
                  }
                >
                  <Module
                    accessToken={accessToken}
                    params={params}
                    recipeId={activeRecipeId}
                    onRecipeChange={setActiveRecipeId}
                  />
                </Suspense>
              </div>
            );
          })}
        </div>
      </main>
      <span
        data-testid="cleaner-session-state"
        data-access-token={accessToken ?? ''}
      />
    </div>
  );
}

export default CleanerShell;
