const READ_ONLY = {
  canReassign: false,
  canBulkEdit: false,
  canBulkClose: false,
  canManageRules: false,
  canWrite: false,
  canApplyRecipes: false,
};

const ROLE_CAPABILITIES = {
  commercial: {
    ...READ_ONLY,
    canBulkEdit: true,
    canBulkClose: true,
    canViewTeam: false,
    canReadOwn: true,
    canReadWorkspace: true,
    canReadAnalytics: true,
    canReadHistory: true,
  },
  manager: {
    ...READ_ONLY,
    canReassign: true,
    canBulkEdit: true,
    canBulkClose: true,
    canViewTeam: true,
    canReadOwn: true,
    canReadWorkspace: true,
    canReadAnalytics: true,
    canReadHistory: true,
    canApplyRecipes: true,
  },
  admin: {
    ...READ_ONLY,
    canReassign: true,
    canBulkEdit: true,
    canBulkClose: true,
    canManageRules: true,
    canViewTeam: true,
    canReadOwn: true,
    canReadWorkspace: true,
    canReadAnalytics: true,
    canReadHistory: true,
    canApplyRecipes: true,
  },
};

export function capabilitiesForRole(role) {
  const capabilities = ROLE_CAPABILITIES[role];
  return capabilities ? { ...capabilities } : null;
}

export function authorizeContext(context = {}) {
  if (!context.user) return { ok: false, status: 401, error: 'unauthorized' };
  const capabilities = capabilitiesForRole(context.role);
  if (!capabilities) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, capabilities };
}

function ownerIdOf(item) {
  return item?.owner_id ?? item?.ownerId ?? item?.OwnerId ?? null;
}

export function allowedOwnerIds(context = {}) {
  if (context.role === 'commercial')
    return context.sfUserId ? [context.sfUserId] : [];
  if (context.role === 'manager' || context.role === 'admin') {
    return [
      ...new Set(
        (context.teamSfUserIds || []).filter(
          (value) => typeof value === 'string' && value,
        ),
      ),
    ];
  }
  return [];
}

export function scopeOpportunityItems(items, context = {}, _query = {}) {
  const allowed = new Set(allowedOwnerIds(context));
  return (Array.isArray(items) ? items : []).filter((item) =>
    allowed.has(ownerIdOf(item)),
  );
}

export function scopeDescription(context = {}) {
  return context.role === 'commercial'
    ? { type: 'owner', ownerIds: allowedOwnerIds(context) }
    : { type: 'team', ownerIds: allowedOwnerIds(context) };
}
