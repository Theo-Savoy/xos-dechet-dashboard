import mapping from '../../_crm/mapping.js';
import {
  escapeSOQL,
  fetchSFToken,
  searchContacts,
  updateSObjects,
} from '../../_crm/salesforce.js';
import { journalCleanerAction } from '../core/audit.js';
import { authorizeContext } from '../core/authorization.js';
import { CleanerError } from '../core/errors.js';

// Canonical values are centralized in the CRM mapping today. Follow-up: move
// this mission-specific list to a settings table without changing the recipe contract.
export const ACTIVE_SECTORS = Object.freeze([
  ...mapping.objects.account.industries,
]);

const MAX_WRITE_BATCH = 200;
const sectorJobs = new Map();

export function sectorId(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizedLabel(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(left, right) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function suggestedTarget(label) {
  const source = normalizedLabel(label);
  if (!source) return null;
  const ranked = ACTIVE_SECTORS.map((candidate) => {
    const normalized = normalizedLabel(candidate);
    const contains = normalized.includes(source) || source.includes(normalized);
    return {
      candidate,
      distance: contains ? -1 : levenshtein(source, normalized),
    };
  }).sort((left, right) => left.distance - right.distance);
  const best = ranked[0];
  const threshold = Math.max(3, Math.ceil(source.length * 0.4));
  return best && best.distance <= threshold ? sectorId(best.candidate) : null;
}

function accountQuery() {
  const account = mapping.objects.account;
  const fields = account.fields;
  // Filter at the SOQL level: only return accounts whose Industry is NOT in
  // the canonical ACTIVE_SECTORS list. This is cap-safe (we only see the
  // accounts we care about) and avoids the previous behaviour of pulling
  // all 50k+ accounts then filtering in JS (which clipped at SOQL_FETCH_CAP).
  const inactiveClause = ACTIVE_SECTORS.length
    ? `AND ${fields.industry} NOT IN (${ACTIVE_SECTORS.map((s) => `'${escapeSOQL(s)}'`).join(', ')})`
    : '';
  return [
    `SELECT ${fields.id}, ${fields.name}, ${fields.industry}, ${fields.ownerId}`,
    `FROM ${account.name}`,
    `WHERE ${fields.industry} != null ${inactiveClause}`,
    `ORDER BY ${fields.industry} ASC, ${fields.id} ASC`,
    `LIMIT 2000`,
  ].join(' ');
}

async function tokenFor(context) {
  if (context.token?.accessToken) return context.token.accessToken;
  if (typeof context.token === 'string' && context.token) return context.token;
  const loader = context.fetchSFToken || fetchSFToken;
  const result = await loader({
    client: context.supabase,
    userId: context.user?.id,
  });
  if (result?.error || !result?.accessToken)
    throw new CleanerError(
      'salesforce_error',
      result?.error || 'Salesforce token unavailable.',
      502,
    );
  return result.accessToken;
}

function normalizeAccount(record) {
  const fields = mapping.objects.account.fields;
  return {
    id: record?.[fields.id] ?? record?.id ?? null,
    name: record?.[fields.name] ?? record?.name ?? null,
    sector: record?.[fields.industry] ?? record?.industry ?? null,
    ownerId: record?.[fields.ownerId] ?? record?.owner_id ?? null,
  };
}

function authorizeRecipeContext(context) {
  const authorization = authorizeContext(context);
  if (!authorization.ok)
    throw new CleanerError(
      authorization.error,
      authorization.error,
      authorization.status,
    );
  if (!authorization.capabilities.canApplyRecipes)
    throw new CleanerError(
      'forbidden',
      'Cette recette nécessite un accès manager ou admin. Veuillez contacter votre administrateur.',
      403,
    );
  return authorization;
}

function authorizeReadContext(context) {
  const authorization = authorizeContext(context);
  if (!authorization.ok)
    throw new CleanerError(
      authorization.error,
      authorization.error,
      authorization.status,
    );
  return authorization;
}

async function loadScopedAccounts(context, { requireApply = true } = {}) {
  const authorization = requireApply
    ? authorizeRecipeContext(context)
    : authorizeReadContext(context);
  const token = await tokenFor(context);
  const search = context.searchContacts || searchContacts;
  const query = accountQuery();
  const result = await search(token, query);
  if (result?.error || !Array.isArray(result?.records)) {
    throw new CleanerError(
      'salesforce_error',
      result?.message || result?.error || 'Salesforce Account query failed.',
      502,
    );
  }
  const rawAccounts = result.records.map(normalizeAccount);
  const accounts = rawAccounts.filter(
    (account) =>
      typeof account.id === 'string' &&
      typeof account.sector === 'string',
  );
  return { accounts, token, capabilities: authorization.capabilities };
}

function groupAccounts(accounts) {
  const groups = new Map();
  for (const account of accounts) {
    const id = sectorId(account.sector);
    const current = groups.get(id) || {
      id,
      label: account.sector,
      accounts: [],
    };
    current.accounts.push(account);
    groups.set(id, current);
  }
  return groups;
}

function publicCapabilities(capabilities) {
  return { canApplyMerge: capabilities.canApplyRecipes === true };
}

export async function loadSectorRecipe(context = {}, query = {}) {
  authorizeRecipeContext(context);
  const { accounts, capabilities } = await loadScopedAccounts(context);
  const groups = groupAccounts(accounts);
  const activeLabels = new Set(ACTIVE_SECTORS);
  const activeLimit = Math.min(Math.max(Number(query.limit) || 50, 1), 50);
  const activeSectors = ACTIVE_SECTORS.map((label) => ({
    id: sectorId(label),
    label,
    accountCount: groups.get(sectorId(label))?.accounts.length || 0,
  }))
    .sort(
      (left, right) =>
        right.accountCount - left.accountCount ||
        left.label.localeCompare(right.label, 'fr'),
    )
    .slice(0, activeLimit);
  const obsoleteSectors = [...groups.values()]
    .filter((group) => !activeLabels.has(group.label))
    .map((group) => ({
      id: group.id,
      label: group.label,
      accountCount: group.accounts.length,
    }))
    .sort(
      (left, right) =>
        right.accountCount - left.accountCount ||
        left.label.localeCompare(right.label, 'fr'),
    );
  const suggestedMappings = Object.fromEntries(
    obsoleteSectors
      .map((sector) => [sector.id, suggestedTarget(sector.label)])
      .filter((entry) => entry[1]),
  );
  return {
    obsoleteSectors,
    activeSectors,
    suggestedMappings,
    accountsPerSector: Object.fromEntries(
      obsoleteSectors.map((sector) => [
        sector.id,
        groups.get(sector.id).accounts.map((account) => account.id),
      ]),
    ),
    capabilities: publicCapabilities(capabilities),
  };
}

function validateMergeInput(input) {
  if (
    typeof input?.obsoleteId !== 'string' ||
    !input.obsoleteId ||
    typeof input?.activeId !== 'string' ||
    !input.activeId
  )
    throw new CleanerError(
      'invalid_command',
      'obsoleteId et activeId sont requis.',
      400,
    );
  if (input.obsoleteId === input.activeId)
    throw new CleanerError(
      'invalid_command',
      'Les secteurs source et cible doivent être différents.',
      422,
    );
}

async function resolveMerge(context, input, options) {
  validateMergeInput(input);
  const loaded = await loadScopedAccounts(context, options);
  const groups = groupAccounts(loaded.accounts);
  const obsolete = groups.get(input.obsoleteId);
  const activeLabel = ACTIVE_SECTORS.find(
    (label) => sectorId(label) === input.activeId,
  );
  if (!obsolete || ACTIVE_SECTORS.includes(obsolete.label) || !activeLabel)
    throw new CleanerError(
      'invalid_command',
      'Le mapping de secteurs est introuvable ou obsolète.',
      409,
    );
  return { ...loaded, obsolete, activeLabel };
}

export async function previewSectorMerge(context = {}, input = {}) {
  const { obsolete, activeLabel } = await resolveMerge(context, input, {
    requireApply: false,
  });
  return {
    obsoleteId: obsolete.id,
    activeId: sectorId(activeLabel),
    obsoleteLabel: obsolete.label,
    activeLabel,
    accountIds: obsolete.accounts.map((account) => account.id),
    accounts: obsolete.accounts.map(({ id, name, ownerId }) => ({
      id,
      name,
      ownerId,
    })),
    accountCount: obsolete.accounts.length,
  };
}

function writeResults(accounts, batchResponses) {
  const responses = batchResponses.flatMap((response) =>
    Array.isArray(response?.records) ? response.records : [],
  );
  const byId = new Map(
    responses.map((record) => [record?.id || record?.Id, record]),
  );
  return accounts.map((account) => {
    const response = byId.get(account.id);
    const success = response?.success === true;
    const errors = Array.isArray(response?.errors) ? response.errors : [];
    return {
      id: account.id,
      success,
      error: success
        ? null
        : errors.map((error) => error?.message || String(error)).join(' ; ') ||
          'Salesforce write failed.',
    };
  });
}

async function recordSectorJournal(context, entry) {
  if (typeof context.recordSectorJournal === 'function')
    return context.recordSectorJournal(entry);
  const table = context.supabase?.from?.('recette_journal');
  // Some unit-test contexts intentionally expose only the legacy audit mock.
  if (!table || typeof table.insert !== 'function') return { data: null, error: null };
  const result = await table.insert({
    kind: entry.kind,
    payload: entry.payload,
    actor_id: context.user.id,
  });
  if (result?.error)
    throw new CleanerError(
      'audit_error',
      result.error.message || 'Le journal de la recette est indisponible.',
      502,
    );
  return result;
}

export async function applySectorMerge(context = {}, input = {}) {
  const authorization = authorizeContext(context);
  if (!authorization.ok)
    throw new CleanerError(
      authorization.error,
      authorization.error,
      authorization.status,
    );
  if (!authorization.capabilities.canApplyRecipes)
    throw new CleanerError(
      'forbidden',
      'Cette action nécessite un rôle manager ou admin.',
      403,
    );
  if (
    !Array.isArray(input.expectedAccountIds) ||
    input.expectedAccountIds.some((id) => typeof id !== 'string' || !id)
  )
    throw new CleanerError(
      'invalid_command',
      'Un preview confirmé est requis avant la fusion.',
      400,
    );
  const resolved = await resolveMerge(context, input);
  const expectedIds = [...new Set(input.expectedAccountIds)].sort();
  const actualIds = resolved.obsolete.accounts
    .map((account) => account.id)
    .sort();
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  )
    throw new CleanerError(
      'stale_preview',
      'Les comptes du secteur ont changé depuis le preview.',
      409,
    );
  const fields = mapping.objects.account.fields;
  const records = resolved.obsolete.accounts.map((account) => ({
    id: account.id,
    [fields.industry]: resolved.activeLabel,
  }));
  const updater = context.updateSObjects || updateSObjects;
  const batches = [];
  for (let index = 0; index < records.length; index += MAX_WRITE_BATCH)
    batches.push(records.slice(index, index + MAX_WRITE_BATCH));
  const batchResponses = [];
  for (const batch of batches) {
    batchResponses.push(
      await updater(resolved.token, mapping.objects.account.name, batch),
    );
  }
  const results = writeResults(resolved.obsolete.accounts, batchResponses);
  const updated = results.filter((result) => result.success).length;
  const payload = {
    obsolete_id: resolved.obsolete.id,
    active_id: sectorId(resolved.activeLabel),
    account_count: resolved.obsolete.accounts.length,
  };
  const audit = context.journalCleanerAction || journalCleanerAction;
  const auditResult = await audit(context.supabase, {
    actorId: context.user.id,
    actorLabel: context.profile?.fullName || context.user.email || null,
    source: 'recette_sectors',
    moduleId: 'recettes',
    actionType: 'recette_sectors_apply_merge',
    changes: payload,
    targets: resolved.obsolete.accounts.map((account) => {
      const result = results.find((candidate) => candidate.id === account.id);
      return {
        objectType: mapping.objects.account.name,
        sfRecordId: account.id,
        sfOwnerId: account.ownerId,
        before: { sector: resolved.obsolete.label },
        after: { sector: resolved.activeLabel },
        success: result?.success === true,
        error: result?.error || null,
      };
    }),
    result: { ...payload, updated, failed: results.length - updated },
  });
  if (auditResult?.error || !auditResult?.data)
    throw new CleanerError(
      'audit_error',
      auditResult?.error?.message ||
        'Le journal de la recette est indisponible.',
      502,
    );
  await recordSectorJournal(context, {
    kind: 'recette_sectors_apply_merge',
    payload: {
      obsoleteId: resolved.obsolete.id,
      activeId: sectorId(resolved.activeLabel),
      obsoleteLabel: resolved.obsolete.label,
      activeLabel: resolved.activeLabel,
      accountCount: resolved.obsolete.accounts.length,
      updated,
      failed: results.length - updated,
    },
  });
  return {
    ...payload,
    updated,
    failed: results.length - updated,
    accountIds: results
      .filter((result) => result.success)
      .map((result) => result.id),
    results,
  };
}

function validateBulkInput(input) {
  if (
    !Array.isArray(input?.obsoleteIds) ||
    input.obsoleteIds.length === 0 ||
    input.obsoleteIds.some((id) => typeof id !== 'string' || !id) ||
    !input.mapping ||
    typeof input.mapping !== 'object' ||
    Array.isArray(input.mapping) ||
    input.obsoleteIds.some(
      (id) => typeof input.mapping[id] !== 'string' || !input.mapping[id],
    )
  )
    throw new CleanerError(
      'invalid_command',
      'obsoleteIds et mapping sont requis.',
      400,
    );
}

function newJobId() {
  return globalThis.crypto?.randomUUID?.() ||
    `sector-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function runBulkSectorJob(context, input, job) {
  job.status = 'running';
  try {
    for (const obsoleteId of input.obsoleteIds) {
      try {
        const activeId = input.mapping[obsoleteId];
        const preview = await previewSectorMerge(context, {
          obsoleteId,
          activeId,
        });
        const result = input.action === 'bulk_apply'
          ? await applySectorMerge(context, {
              obsoleteId,
              activeId,
              expectedAccountIds: preview.accountIds,
            })
          : preview;
        job.results.push(result);
      } catch (error) {
        job.errors.push({
          obsoleteId,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        job.processed += 1;
      }
    }
    job.status = 'done';
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : String(error);
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

export function startBulkSectorJob(context = {}, input = {}) {
  validateBulkInput(input);
  const authorization = authorizeReadContext(context);
  if (
    input.action !== 'bulk_preview' &&
    input.action !== 'bulk_apply'
  )
    throw new CleanerError('invalid_action', 'Cleaner action is invalid.', 400);
  if (
    input.action === 'bulk_apply' &&
    !authorization.capabilities.canApplyRecipes
  )
    throw new CleanerError(
      'forbidden',
      'Cette action nécessite un rôle manager ou admin.',
      403,
    );
  const jobId = newJobId();
  const job = {
    jobId,
    actorId: context.user.id,
    kind: input.action,
    status: 'pending',
    total: input.obsoleteIds.length,
    processed: 0,
    errors: [],
    results: [],
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  sectorJobs.set(jobId, job);
  void Promise.resolve().then(() => runBulkSectorJob(context, input, job));
  return { jobId };
}

export function getSectorJobStatus(context = {}, jobId) {
  authorizeReadContext(context);
  const job = sectorJobs.get(jobId);
  if (!job || job.actorId !== context.user.id)
    throw new CleanerError('job_not_found', 'Job introuvable.', 404);
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    total: job.total,
    processed: job.processed,
    errors: job.errors,
    results: job.results,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export async function fetchSectorJournal(context = {}, limit = 50) {
  authorizeReadContext(context);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
  const result = await context.supabase
    .from('recette_journal')
    .select(
      'id, kind, payload, actor_id, created_at, actor:profiles!recette_journal_actor_id_fkey(full_name, email)',
    )
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (result?.error)
    throw new CleanerError(
      'supabase_error',
      result.error.message || 'Le journal de la recette est indisponible.',
      502,
    );
  return (result?.data || []).map((row) => ({
    id: row.id,
    kind: row.kind,
    obsoleteId: row.payload?.obsoleteId ?? row.payload?.obsolete_id ?? null,
    activeId: row.payload?.activeId ?? row.payload?.active_id ?? null,
    obsoleteLabel: row.payload?.obsoleteLabel ?? row.payload?.obsolete_label ?? null,
    activeLabel: row.payload?.activeLabel ?? row.payload?.active_label ?? null,
    accountCount: row.payload?.accountCount ?? row.payload?.account_count ?? 0,
    actorId: row.actor_id,
    actorLabel: row.actor?.full_name || row.actor?.email || 'Utilisateur',
    createdAt: row.created_at,
  }));
}
