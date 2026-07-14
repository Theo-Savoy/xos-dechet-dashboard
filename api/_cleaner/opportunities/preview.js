import { createHash, randomUUID } from 'node:crypto';

import mapping from '../../_crm/mapping.js';
import { CleanerError } from '../core/errors.js';
import {
  authorizeContext,
  scopeOpportunityItems,
} from '../core/authorization.js';
import { DEFAULT_CLEANER_SETTINGS } from '../core/settings.js';
import { loadOpportunityWorkspace } from './read.js';

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const DATE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PREVIEW_IDS = 5000;
const MAX_PREVIEW_TTL_MS = 10 * 60_000;
const MIN_PREVIEW_TTL_MS = 30_000;
const COMMAND_VERSION = 'labo-opportunities-command-v1';
const CHANGE_KEYS = [
  'owner_id',
  'close_date',
  'stage',
  'type_vente',
  'loss_reason',
];

function invalid(code, message, status = 422, details) {
  throw new CleanerError(code, message, status, details);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function valueOf(item, key, aliases = []) {
  for (const candidate of [key, ...aliases]) {
    if (item && Object.hasOwn(item, candidate)) return item[candidate];
  }
  return null;
}

function canonicalRecord(item) {
  return {
    owner_id: valueOf(item, 'owner_id', ['ownerId', 'OwnerId']),
    close_date: valueOf(item, 'close_date', ['closeDate', 'CloseDate']),
    stage: valueOf(item, 'stage', ['stage_name', 'stageName', 'StageName']),
    type_vente: valueOf(item, 'type_vente', [
      'sale_type',
      mapping.objects.opportunity.saleTypeField,
    ]),
    loss_reason: valueOf(item, 'loss_reason', [
      mapping.objects.opportunity.lossReasonField,
    ]),
    account_owner_id: valueOf(item, 'account_owner_id', [
      'accountOwnerId',
      mapping.objects.opportunity.fields.accountOwnerId,
    ]),
    is_closed: valueOf(item, 'is_closed', [
      'isClosed',
      mapping.objects.opportunity.fields.isClosed,
    ]),
  };
}

function normalizeIds(input) {
  const values = input?.ids ?? input?.opportunityIds;
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAX_PREVIEW_IDS
  ) {
    invalid(
      'invalid_selection',
      `ids doit contenir entre 1 et ${MAX_PREVIEW_IDS} identifiants.`,
    );
  }
  const ids = values.map((id) => {
    if (typeof id !== 'string' || !SF_ID.test(id))
      invalid(
        'invalid_selection',
        'Chaque identifiant Salesforce doit contenir 15 à 18 caractères alphanumériques.',
      );
    return id;
  });
  if (new Set(ids).size !== ids.length)
    invalid(
      'invalid_selection',
      'La sélection ne doit pas contenir de doublon.',
    );
  return ids;
}

function saleTypeValues() {
  return new Set(
    Object.values(mapping.objects.opportunity.saleTypes || {})
      .flat()
      .filter((value) => typeof value === 'string'),
  );
}

function stageValues() {
  return new Set(
    Object.keys(mapping.objects.opportunityHistory.stageOrder || {}),
  );
}

function normalizeChanges(input) {
  if (!plainObject(input))
    invalid('invalid_change', 'changes doit être un objet.');
  const changes = {};
  for (const key of Object.keys(input)) {
    if (!CHANGE_KEYS.includes(key))
      invalid(
        'invalid_change',
        `La correction ${key} n'est pas supportée.`,
        422,
        { field: key },
      );
    const value = input[key];
    if (value === '' || value === null || value === undefined) continue;
    if (typeof value !== 'string')
      invalid('invalid_change', `${key} doit être une chaîne.`, 422, {
        field: key,
      });
    changes[key] = value.trim();
  }
  if (!Object.keys(changes).length)
    invalid('invalid_change', 'changes doit contenir au moins une correction.');
  if (
    changes.owner_id &&
    changes.owner_id !== 'ACCOUNT_OWNER' &&
    !SF_ID.test(changes.owner_id)
  ) {
    invalid(
      'invalid_change',
      'owner_id doit être un identifiant Salesforce valide ou ACCOUNT_OWNER.',
      422,
      { field: 'owner_id' },
    );
  }
  if (changes.close_date && !DATE_YMD.test(changes.close_date))
    invalid(
      'invalid_change',
      'close_date doit être au format YYYY-MM-DD.',
      422,
      { field: 'close_date' },
    );
  if (changes.stage && !stageValues().has(changes.stage))
    invalid(
      'invalid_change',
      "stage n'est pas une valeur de picklist connue.",
      422,
      { field: 'stage' },
    );
  if (changes.type_vente && !saleTypeValues().has(changes.type_vente))
    invalid(
      'invalid_change',
      "type_vente n'est pas une valeur de picklist connue.",
      422,
      { field: 'type_vente' },
    );
  if (
    changes.loss_reason &&
    changes.stage !== mapping.objects.opportunity.closedLostStage
  ) {
    invalid(
      'invalid_change',
      'loss_reason exige la fermeture en perdue.',
      422,
      { field: 'loss_reason' },
    );
  }
  if (
    changes.stage === mapping.objects.opportunity.closedLostStage &&
    !changes.loss_reason
  ) {
    invalid(
      'invalid_change',
      'Une fermeture en perdue exige une raison de perte.',
      422,
      { field: 'loss_reason' },
    );
  }
  return changes;
}

function lossReasonsFor(context, record, changes) {
  const metadata =
    context.opportunityMetadata || context.metadata || context.meta;
  if (!plainObject(metadata)) return [];
  const byType =
    metadata.lossReasonsBySaleType ||
    metadata.loss_valid_for ||
    metadata.lossValidFor;
  if (!plainObject(byType)) return [];
  const type = changes.type_vente || record.type_vente;
  const direct = byType[type];
  if (Array.isArray(direct))
    return direct.filter((value) => typeof value === 'string');
  const matching = Object.entries(byType).find(
    ([key]) => key === type || key.startsWith(`${type} `),
  );
  return Array.isArray(matching?.[1])
    ? matching[1].filter((value) => typeof value === 'string')
    : [];
}

function snapshotFor(input, id) {
  const source = input.snapshots || input.before || input.beforeById;
  return plainObject(source) && plainObject(source[id]) ? source[id] : null;
}

function snapshotMatches(item, snapshot) {
  if (!snapshot) return true;
  const current = canonicalRecord(item);
  for (const [key, value] of Object.entries(snapshot)) {
    const canonicalKey =
      {
        ownerId: 'owner_id',
        OwnerId: 'owner_id',
        closeDate: 'close_date',
        CloseDate: 'close_date',
        stageName: 'stage',
        StageName: 'stage',
        sale_type: 'type_vente',
        Type_de_vente__c: 'type_vente',
        lossReason: 'loss_reason',
        Raison_de_perte_V2__c: 'loss_reason',
      }[key] || key;
    if (Object.hasOwn(current, canonicalKey) && current[canonicalKey] !== value)
      return false;
  }
  return true;
}

function makeAfter(item, changes) {
  const before = canonicalRecord(item);
  const after = { ...before };
  for (const [key, value] of Object.entries(changes)) {
    after[key] =
      key === 'owner_id' && value === 'ACCOUNT_OWNER'
        ? before.account_owner_id
        : value;
  }
  if (changes.stage === mapping.objects.opportunity.closedLostStage)
    after.is_closed = true;
  return { before, after };
}

function fingerprintsFor(eligible, context) {
  const settings = context.settings?.settings || DEFAULT_CLEANER_SETTINGS;
  const body = {
    version: COMMAND_VERSION,
    settings,
    records: eligible
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => ({
        id: record.id,
        before: record.before,
        after: record.after,
      })),
  };
  return createHash('sha256').update(stable(body)).digest('hex');
}

function assertActionAllowed(context, changes) {
  const authorization = authorizeContext(context);
  if (!authorization.ok)
    throw new CleanerError(
      authorization.error,
      authorization.error,
      authorization.status,
    );

  const capabilities = authorization.capabilities;
  if (Object.hasOwn(changes, 'owner_id') && !capabilities.canReassign)
    throw new CleanerError(
      'forbidden',
      'Cette action nécessite la capacité de réassignation.',
      403,
    );

  const isClose =
    changes.stage === mapping.objects.opportunity.closedLostStage ||
    Object.hasOwn(changes, 'loss_reason');
  if (isClose && !capabilities.canBulkClose)
    throw new CleanerError(
      'forbidden',
      'Cette action nécessite la capacité de clôture en masse.',
      403,
    );

  const isEdit = ['close_date', 'stage', 'type_vente'].some((key) =>
    Object.hasOwn(changes, key),
  );
  if (isEdit && !isClose && !capabilities.canBulkEdit)
    throw new CleanerError(
      'forbidden',
      'Cette action nécessite la capacité de modification en masse.',
      403,
    );
}

async function readAllWorkspace(context) {
  const loader = context.loadOpportunityWorkspace || loadOpportunityWorkspace;
  const records = [];
  let cursor = null;
  const seenCursors = new Set();
  for (;;) {
    const workspace = await loader({
      ...context,
      includeUnscopedForCommand: true,
      limit: 200,
      cursor,
      query: { ...(context.query || {}), limit: 200, cursor },
    });
    records.push(...(Array.isArray(workspace?.items) ? workspace.items : []));
    const next = workspace?.nextCursor || null;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return records;
}

function assertContext(context) {
  const authorization = authorizeContext(context);
  if (!authorization.ok)
    throw new CleanerError(
      authorization.error,
      authorization.error,
      authorization.status,
    );
  if (!context.supabase?.from)
    throw new CleanerError(
      'service_unavailable',
      'Cleaner service is unavailable.',
      503,
    );
}

async function buildOpportunityPreview(context = {}, input = {}) {
  assertContext(context);
  const ids = normalizeIds(input);
  const changes = normalizeChanges(input.changes);
  assertActionAllowed(context, changes);
  const evaluated = await evaluateOpportunitySelection(context, {
    ...input,
    ids,
    changes,
  });
  const { eligible, excluded } = evaluated;
  const now = context.now ? new Date(context.now).getTime() : Date.now();
  const requestedTtl = Number(context.previewTtlMs);
  const ttl = Number.isFinite(requestedTtl)
    ? Math.min(Math.max(requestedTtl, MIN_PREVIEW_TTL_MS), MAX_PREVIEW_TTL_MS)
    : 5 * 60_000;
  const expiresAt = new Date(now + ttl).toISOString();
  const fingerprint = fingerprintsFor(eligible, context);
  const storedPreview = { fingerprint, expiresAt, changes, eligible, excluded };
  const inserted = await context.supabase
    .from('cleaner_commands')
    .insert({
      actor: context.user.id,
      module_id: 'opportunities',
      idempotency_key: `preview:${randomUUID()}`,
      fingerprint,
      status: 'reserved',
      preview: storedPreview,
      expires_at: expiresAt,
      result: {},
    })
    .select('*')
    .single();
  if (inserted?.error || !inserted?.data)
    throw new CleanerError(
      'supabase_error',
      'Cleaner preview could not be stored.',
      500,
      inserted?.error,
    );
  return {
    previewId: String(inserted.data.id),
    fingerprint,
    expiresAt,
    changes,
    eligible,
    excluded,
  };
}

export async function evaluateOpportunitySelection(context = {}, input = {}) {
  assertContext(context);
  const ids = normalizeIds(input);
  const changes = normalizeChanges(input.changes);
  assertActionAllowed(context, changes);
  const current = await readAllWorkspace(context);
  const scoped = scopeOpportunityItems(current, context, input.query);
  const byId = new Map(scoped.map((item) => [item.id, item]));
  const scopedIds = new Set(scoped.map((item) => item.id));
  const outOfScope = ids.some(
    (id) => current.some((item) => item.id === id) && !scopedIds.has(id),
  );
  if (outOfScope)
    throw new CleanerError(
      'out_of_scope',
      'La sélection contient une opportunité hors périmètre.',
      403,
    );
  const eligible = [];
  const excluded = [];

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      excluded.push({ id, reason: 'not_eligible' });
      continue;
    }
    if (!snapshotMatches(item, snapshotFor(input, id))) {
      excluded.push({ id, reason: 'stale_record' });
      continue;
    }
    if (!Array.isArray(item.anomalies) || item.anomalies.length === 0) {
      excluded.push({ id, reason: 'not_eligible' });
      continue;
    }
    const { before, after } = makeAfter(item, changes);
    if (changes.owner_id === 'ACCOUNT_OWNER' && !before.account_owner_id) {
      excluded.push({ id, reason: 'account_owner_unavailable' });
      continue;
    }
    if (changes.stage === mapping.objects.opportunity.closedLostStage) {
      const validReasons = lossReasonsFor(context, before, changes);
      if (!validReasons.length || !validReasons.includes(changes.loss_reason)) {
        excluded.push({ id, reason: 'loss_reason_not_compatible' });
        continue;
      }
    }
    const changed = Object.keys(changes).some(
      (key) => after[key] !== before[key],
    );
    if (!changed) {
      excluded.push({ id, reason: 'no_change' });
      continue;
    }
    eligible.push({ id, reason: 'eligible', before, after });
  }
  return { ids, changes, eligible, excluded };
}

export async function previewOpportunityCommand(context = {}, input = {}) {
  return buildOpportunityPreview(context, input);
}

export {
  COMMAND_VERSION,
  canonicalRecord,
  fingerprintsFor,
  normalizeChanges,
  readAllWorkspace,
};
