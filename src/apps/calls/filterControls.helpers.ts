/** Transforme une liste de valeurs simples en options {value, label}. */
export function asOptions<T extends string>(values: readonly T[]): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

/** Liste searchable à cases à cocher pour picklists volumineuses. */
export type PicklistGroup<T extends string> = {
  id: string;
  label: string;
  values: readonly T[];
};
