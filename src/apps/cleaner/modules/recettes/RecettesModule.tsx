import { Suspense, useEffect, useState } from 'react';
import type { CleanerModuleProps } from '../../shell/moduleRegistry';
import { recipeRegistry } from './manifest';

export function RecettesModule(props: CleanerModuleProps) {
  const [activeRecipeId, setActiveRecipeId] = useState<string | undefined>(
    props.recipeId,
  );
  const activeRecipe = recipeRegistry.find(
    (recipe) => recipe.id === activeRecipeId,
  );

  useEffect(() => {
    setActiveRecipeId(props.recipeId);
  }, [props.recipeId]);

  if (!activeRecipe) {
    return (
      <section
        className="cleaner-recipes"
        data-testid="cleaner-module-recettes"
      >
        <div className="cleaner-recipes__intro">
          <p className="cleaner-eyebrow">Labo</p>
          <h2>Recettes du Labo</h2>
          <p>
            Choisissez un rapport métier pour diagnostiquer puis traiter les
            données CRM concernées.
          </p>
        </div>
        <div className="cleaner-recipes__grid" aria-label="Toutes les recettes">
          {recipeRegistry.map((recipe) => (
            <button
              className="cleaner-recipe-tile"
              key={recipe.id}
              type="button"
              onClick={() => {
                setActiveRecipeId(recipe.id);
                props.onRecipeChange?.(recipe.id);
              }}
            >
              <span className="cleaner-recipe-tile__icon" aria-hidden="true">
                {recipe.icon}
              </span>
              <span>
                <strong>{recipe.label}</strong>
                <small>{recipe.objectType}</small>
              </span>
              <span>{recipe.description}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  const Recipe = activeRecipe.component;

  return (
    <section className="cleaner-recipes" data-testid="cleaner-module-recettes">
      <div className="cleaner-recipes__header">
        <button
          className="xos-btn xos-btn--secondary"
          type="button"
          onClick={() => {
            setActiveRecipeId(undefined);
            props.onRecipeChange?.(undefined);
          }}
        >
          ← Toutes les recettes
        </button>
        <strong>{activeRecipe.label}</strong>
      </div>
      <Suspense fallback={<div role="status">Ouverture de la recette…</div>}>
        <Recipe {...props} />
      </Suspense>
    </section>
  );
}

export default RecettesModule;
