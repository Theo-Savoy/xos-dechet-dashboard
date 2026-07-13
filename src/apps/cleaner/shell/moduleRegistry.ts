import type { FC, LazyExoticComponent } from 'react';
import type { AppRole } from '../../../os/registry';
import { opportunitiesManifest } from '../modules/opportunities/manifest';
import { recettesManifest } from '../modules/recettes/manifest';
import { moduleAllowedForRole, type CleanerModuleId } from './shellState';

export type CleanerModuleProps = {
  accessToken?: string;
  params?: Record<string, string>;
};

export type CleanerModuleDefinition = {
  id: CleanerModuleId;
  label: string;
  criticality: 'critical' | 'warning' | 'healthy';
  roles?: readonly AppRole[];
  component: LazyExoticComponent<FC<CleanerModuleProps>>;
};

export const moduleRegistry = [
  {
    ...opportunitiesManifest,
    // The shell tab keeps the module name; Nettoyage is the active internal view.
    label: 'Opportunités',
  },
  recettesManifest,
] satisfies readonly CleanerModuleDefinition[];

export function getModuleDefinition(
  moduleId: CleanerModuleId,
): CleanerModuleDefinition {
  return moduleRegistry.find(
    (module) => module.id === moduleId,
  ) as CleanerModuleDefinition;
}

export function getVisibleModules(role: AppRole): CleanerModuleDefinition[] {
  return moduleRegistry.filter((module) =>
    moduleAllowedForRole(module.roles, role),
  );
}
