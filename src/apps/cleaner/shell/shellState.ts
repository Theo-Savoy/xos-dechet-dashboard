import type { AppRole } from '../../../os/registry';

export type CleanerModuleId = 'opportunities' | 'recettes';

export function isCleanerModuleId(value: unknown): value is CleanerModuleId {
  return value === 'opportunities' || value === 'recettes';
}

export type CleanerTabState = {
  open: CleanerModuleId[];
  active: 'home' | CleanerModuleId;
};

export const CLEANER_SHELL_STORAGE_KEY = 'xos.cleaner-shell.v1';

export function createInitialTabState(): CleanerTabState {
  return { open: [], active: 'home' };
}

export function normalizeTabState(value: unknown): CleanerTabState {
  if (!value || typeof value !== 'object') return createInitialTabState();
  const candidate = value as { open?: unknown; active?: unknown };
  const open = Array.isArray(candidate.open)
    ? candidate.open.filter((module): module is CleanerModuleId =>
        isCleanerModuleId(module),
      )
    : [];
  const uniqueOpen = [...new Set(open)];
  const active =
    isCleanerModuleId(candidate.active) && uniqueOpen.includes(candidate.active)
      ? candidate.active
      : 'home';
  return { open: uniqueOpen, active };
}

export function readTabState(storage: Storage | null): CleanerTabState {
  if (!storage) return createInitialTabState();
  try {
    const raw = storage.getItem(CLEANER_SHELL_STORAGE_KEY);
    return raw ? normalizeTabState(JSON.parse(raw)) : createInitialTabState();
  } catch {
    return createInitialTabState();
  }
}

export function writeTabState(
  storage: Storage | null,
  state: CleanerTabState,
): void {
  if (!storage) return;
  try {
    storage.setItem(CLEANER_SHELL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A blocked or full browser storage must not prevent the shell from booting.
  }
}

export function openModule(
  state: CleanerTabState,
  moduleId: CleanerModuleId,
): CleanerTabState {
  return {
    open: state.open.includes(moduleId)
      ? state.open
      : [...state.open, moduleId],
    active: moduleId,
  };
}

export function closeModule(
  state: CleanerTabState,
  moduleId: CleanerModuleId,
): CleanerTabState {
  const open = state.open.filter((current) => current !== moduleId);
  return {
    open,
    active: state.active === moduleId ? 'home' : state.active,
  };
}

export function moduleAllowedForRole(
  roles: readonly AppRole[] | undefined,
  role: AppRole,
): boolean {
  return !roles || roles.includes(role);
}
