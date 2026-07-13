import { lazy, type FC, type LazyExoticComponent, type ReactNode } from 'react';
import type { AppRole } from '../../../../os/registry';
import type { CleanerModuleProps } from '../../shell/moduleRegistry';

export type RecipeAction = 'preview_merge' | 'apply_merge';

export type RecipeFilter = {
  id: 'sector_source' | 'sector_target' | 'account_owner';
  label: string;
};

export type RecipeManifest = {
  id: string;
  label: string;
  objectType: 'Account' | 'Opportunity' | 'Contact';
  description: string;
  icon?: ReactNode;
  filters: readonly RecipeFilter[];
  actions: readonly RecipeAction[];
  component: LazyExoticComponent<FC<CleanerModuleProps>>;
};

const lazySectorsRecipe = lazy(() =>
  import('./sectors/SectorsRecipeView').then(({ SectorsRecipeView }) => ({
    default: SectorsRecipeView,
  })),
);

export const sectorsRecipe = {
  id: 'sectors',
  label: 'Secteurs obsolètes',
  objectType: 'Account',
  description:
    'Identifier les secteurs inactifs sur les comptes et les fusionner vers les secteurs actifs.',
  icon: '⌁',
  filters: [
    { id: 'sector_source', label: 'Secteur source' },
    { id: 'sector_target', label: 'Secteur cible' },
    { id: 'account_owner', label: 'Propriétaire du compte' },
  ],
  actions: ['preview_merge', 'apply_merge'],
  component: lazySectorsRecipe,
} satisfies RecipeManifest;

// Adding a recipe only extends this registry; the module shell stays unchanged.
export const recipeRegistry = [
  sectorsRecipe,
] satisfies readonly RecipeManifest[];

const lazyRecettesModule = lazy(() =>
  import('./RecettesModule').then(({ RecettesModule }) => ({
    default: RecettesModule,
  })),
);

export const recettesManifest = {
  id: 'recettes' as const,
  label: 'Recettes',
  criticality: 'warning' as const,
  roles: ['commercial', 'manager', 'admin'] as readonly AppRole[],
  component: lazyRecettesModule,
};
