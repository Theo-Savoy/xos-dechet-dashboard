import { Suspense, useState } from 'react';
import type { CleanerModuleProps } from '../../shell/moduleRegistry';
import { recipeRegistry } from './manifest';

export function RecettesModule(props: CleanerModuleProps) {
  const [activeRecipeId, setActiveRecipeId] = useState(recipeRegistry[0]?.id);
  const activeRecipe =
    recipeRegistry.find((recipe) => recipe.id === activeRecipeId) ||
    recipeRegistry[0];

  if (!activeRecipe) return <div role="status">Aucune recette disponible.</div>;
  const Recipe = activeRecipe.component;

  return (
    <section className="cleaner-recipes" data-testid="cleaner-module-recettes">
      <nav className="cleaner-recipes__tabs" aria-label="Recettes du Labo">
        {recipeRegistry.map((recipe) => (
          <button
            key={recipe.id}
            type="button"
            aria-pressed={recipe.id === activeRecipe.id}
            className={recipe.id === activeRecipe.id ? 'is-active' : ''}
            onClick={() => setActiveRecipeId(recipe.id)}
          >
            {recipe.label}
          </button>
        ))}
      </nav>
      <Suspense fallback={<div role="status">Ouverture de la recette…</div>}>
        <Recipe {...props} />
      </Suspense>
    </section>
  );
}

export default RecettesModule;
