import { describe, expect, it } from 'vitest';

import { moduleRegistry } from './moduleRegistry';

describe('Labo module registry', () => {
  it('exposes Recettes as the only top-level module', () => {
    expect(moduleRegistry.map((module) => module.id)).toEqual(['recettes']);
    expect(
      moduleRegistry.some((module) => module.label === 'Opportunités'),
    ).toBe(false);
  });
});
