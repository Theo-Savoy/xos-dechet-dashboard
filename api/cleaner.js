import { verifyJWT } from './_auth.js';
import { getServiceClient } from './_calls/http.js';
import { getProfile } from './_calls/profileCache.js';
import { listCleanerHistory } from './_cleaner/core/audit.js';
import { authorizeContext } from './_cleaner/core/authorization.js';
import {
  errorBody,
  CleanerError,
  toCleanerError,
} from './_cleaner/core/errors.js';
import { assertValidCleanerQuery } from './_cleaner/core/validation.js';
import { computeOpportunityAnalytics } from './_cleaner/opportunities/analytics.js';
import { executeOpportunityCommand } from './_cleaner/opportunities/execute.js';
import { previewOpportunityCommand } from './_cleaner/opportunities/preview.js';
import { loadOpportunityWorkspace } from './_cleaner/opportunities/read.js';
import {
  applySectorMerge,
  loadSectorRecipe,
  previewSectorMerge,
} from './_cleaner/recettes/sectors.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function publicCapabilities(capabilities) {
  return {
    canViewTeam: capabilities.canViewTeam,
    canReassign: capabilities.canReassign,
    canBulkEdit: capabilities.canBulkEdit,
    canBulkClose: capabilities.canBulkClose,
    canManageRules: capabilities.canManageRules,
    canApplyRecipes: capabilities.canApplyRecipes,
  };
}

async function teamSfUserIds(client, role, profile) {
  if (role === 'commercial') return profile.sfUserId ? [profile.sfUserId] : [];
  const result = await client.from('profiles').select('sf_user_id');
  if (result?.error)
    throw new CleanerError(
      'supabase_error',
      'Team profile lookup failed.',
      500,
    );
  const ids = (result?.data || [])
    .map((row) => row.sf_user_id)
    .filter((id) => typeof id === 'string' && id);
  return ids.length
    ? [...new Set(ids)]
    : profile.sfUserId
      ? [profile.sfUserId]
      : [];
}

async function buildContext(request, user, client, profile, query) {
  const authorization = authorizeContext({ user, role: profile.role });
  if (!authorization.ok)
    throw new CleanerError(
      authorization.error,
      authorization.error,
      authorization.status,
    );
  return {
    user,
    profile,
    role: profile.role,
    sfUserId: profile.sfUserId,
    teamSfUserIds: await teamSfUserIds(client, profile.role, profile),
    supabase: client,
    token: null,
    query,
    request,
    capabilities: authorization.capabilities,
  };
}

async function historyFor(client, context, query) {
  const result = await listCleanerHistory(client, {
    moduleId: 'opportunities',
    actorId: context.user.id,
    role: context.role,
    sfOwnerId: context.sfUserId,
    teamSfOwnerIds: context.teamSfUserIds,
    limit: query.limit,
    cursor: query.cursor,
  });
  if (result?.error)
    throw new CleanerError(
      result.error.code || 'supabase_error',
      result.error.message || 'Cleaner history lookup failed.',
      result.error.code === 'forbidden' ? 403 : 500,
    );
  return result || { data: [], nextCursor: null };
}

export async function GET(request) {
  let user;
  try {
    user = await verifyJWT(request);
  } catch {
    return response(401, { error: 'unauthorized' });
  }
  if (!user) return response(401, { error: 'unauthorized' });

  try {
    const query = assertValidCleanerQuery(new URL(request.url).searchParams);
    const client = getServiceClient();
    if (!client)
      throw new CleanerError(
        'service_unavailable',
        'Cleaner service is unavailable.',
        503,
      );
    const profile = await getProfile(client, user.id);
    if (profile?.error)
      throw new CleanerError(
        'profile_lookup_failed',
        'Cleaner profile lookup failed.',
        500,
      );
    const context = await buildContext(request, user, client, profile, query);

    if (query.module === 'recettes' && query.resource === 'sectors') {
      return response(200, await loadSectorRecipe(context, query));
    }

    if (query.resource === 'history') {
      const history = await historyFor(client, context, query);
      const items = history.data || [];
      return response(200, {
        items,
        history: items,
        nextCursor: history.nextCursor || null,
      });
    }

    const workspace = await loadOpportunityWorkspace(context);
    const workspaceWithCapabilities = {
      ...workspace,
      capabilities: publicCapabilities(context.capabilities),
    };
    if (query.resource === 'workspace')
      return response(200, workspaceWithCapabilities);

    const history = await historyFor(client, context, {
      ...query,
      limit: 200,
      cursor: null,
    });
    const analytics = computeOpportunityAnalytics(
      workspaceWithCapabilities.items,
      history.data || [],
      query,
    );
    return response(200, { analytics, workspace: workspaceWithCapabilities });
  } catch (error) {
    const normalized = toCleanerError(error);
    return response(normalized.status, errorBody(normalized));
  }
}

export async function POST(request) {
  let user;
  try {
    user = await verifyJWT(request);
  } catch {
    return response(401, { error: 'unauthorized' });
  }
  if (!user) return response(401, { error: 'unauthorized' });

  let body;
  try {
    body = await request.json();
  } catch {
    return response(400, {
      error: 'invalid_payload',
      message: 'Le corps JSON est invalide.',
    });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    JSON.stringify(body).length > 1_000_000
  ) {
    return response(400, {
      error: 'invalid_payload',
      message: 'Le corps JSON est invalide ou trop volumineux.',
    });
  }
  if (
    body.module !== undefined &&
    body.module !== 'opportunities' &&
    body.module !== 'recettes'
  )
    return response(400, {
      error: 'invalid_resource',
      message: 'Cleaner module is invalid.',
    });
  const opportunityAction =
    (body.module === undefined || body.module === 'opportunities') &&
    (body.action === 'preview' || body.action === 'execute');
  const recipeAction =
    body.module === 'recettes' &&
    body.resource === 'sectors' &&
    (body.action === 'preview_merge' || body.action === 'apply_merge');
  if (!opportunityAction && !recipeAction)
    return response(400, {
      error: 'invalid_action',
      message: 'Cleaner action is invalid.',
    });

  try {
    const client = getServiceClient();
    if (!client)
      throw new CleanerError(
        'service_unavailable',
        'Cleaner service is unavailable.',
        503,
      );
    const profile = await getProfile(client, user.id);
    if (profile?.error)
      throw new CleanerError(
        'profile_lookup_failed',
        'Cleaner profile lookup failed.',
        500,
      );
    const context = await buildContext(request, user, client, profile, {});
    const result = recipeAction
      ? body.action === 'preview_merge'
        ? await previewSectorMerge(context, body)
        : await applySectorMerge(context, body)
      : body.action === 'preview'
        ? await previewOpportunityCommand(context, body)
        : await executeOpportunityCommand(context, body);
    return response(200, result);
  } catch (error) {
    const normalized = toCleanerError(error);
    return response(normalized.status, errorBody(normalized));
  }
}
