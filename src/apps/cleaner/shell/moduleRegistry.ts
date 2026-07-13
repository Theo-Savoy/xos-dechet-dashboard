import type { FC, LazyExoticComponent } from 'react';
import type { AppRole } from '../../../os/registry';
import { recettesManifest } from '../modules/recettes/manifest';
import { moduleAllowedForRole, type CleanerModuleId } from './shellState';

export type CleanerModuleProps = {
  accessToken?: string;
  params?: Record<string, string>;
  recipeId?: string;
  onRecipeChange?: (recipeId?: string) => void;
};

export type CleanerModuleDefinition = {
  id: CleanerModuleId;
  label: string;
  criticality: 'critical' | 'warning' | 'healthy';
  roles?: readonly AppRole[];
  component: LazyExoticComponent<FC<CleanerModuleProps>>;
};

export const moduleRegistry = [
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
