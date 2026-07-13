import { CleanerError } from './errors.js';

export const MAX_CLEANER_LIMIT = 200;
const ALLOWED_KEYS = new Set([
  'module',
  'resource',
  'action',
  'jobId',
  'limit',
  'cursor',
  'period',
  'start',
  'end',
]);
const SAFE_VALUE = /^[A-Za-z0-9._:-]+$/;
const SAFE_CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

function entriesOf(input) {
  if (input instanceof URLSearchParams) return [...input.entries()];
  if (input && typeof input === 'object')
    return Object.entries(input).map(([key, value]) => [key, value]);
  return [];
}

function invalid(code, message, field) {
  return { ok: false, error: { code, message, field } };
}

export function validateCleanerQuery(input) {
  const entries = entriesOf(input);
  const values = {};
  for (const [key, rawValue] of entries) {
    if (!ALLOWED_KEYS.has(key))
      return invalid('invalid_query', `Unknown query parameter: ${key}.`, key);
    if (Object.hasOwn(values, key))
      return invalid(
        'invalid_query',
        `Duplicate query parameter: ${key}.`,
        key,
      );
    if (Array.isArray(rawValue))
      return invalid(
        'invalid_query',
        `Query parameter ${key} must be scalar.`,
        key,
      );
    values[key] = rawValue == null ? '' : String(rawValue);
  }

  const validOpportunityResource =
    values.module === 'opportunities' &&
    ['workspace', 'analytics', 'history'].includes(values.resource);
  const validRecipeResource =
    values.module === 'recettes' && values.resource === 'sectors';
  if (!validOpportunityResource && !validRecipeResource) {
    return invalid(
      'invalid_resource',
      'Cleaner module or resource is invalid.',
      'resource',
    );
  }
  if (
    validOpportunityResource &&
    (values.action !== undefined || values.jobId !== undefined)
  )
    return invalid(
      'invalid_query',
      'Recipe job parameters are not valid for opportunities.',
      values.action !== undefined ? 'action' : 'jobId',
    );
  if (
    validRecipeResource &&
    values.action !== undefined &&
    values.action !== 'status' &&
    values.action !== 'journal'
  )
    return invalid('invalid_query', 'Sector recipe action is invalid.', 'action');
  if (
    validRecipeResource &&
    ((values.action === 'status' && values.jobId === undefined) ||
      (values.action !== 'status' && values.jobId !== undefined))
  )
    return invalid(
      'invalid_query',
      'jobId is required only for the status action.',
      'jobId',
    );

  let limit = 100;
  if (values.limit !== undefined) {
    if (!/^\d+$/.test(values.limit))
      return invalid(
        'invalid_query',
        'limit must be a positive integer.',
        'limit',
      );
    limit = Number(values.limit);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_CLEANER_LIMIT
    ) {
      return invalid(
        'invalid_query',
        `limit must be between 1 and ${MAX_CLEANER_LIMIT}.`,
        'limit',
      );
    }
  }

  let cursor = null;
  if (values.cursor !== undefined) {
    if (!SAFE_CURSOR.test(values.cursor))
      return invalid('invalid_query', 'cursor is malformed.', 'cursor');
    cursor = values.cursor;
  }

  const safeFields = {};
  for (const key of ['period', 'start', 'end', 'action', 'jobId']) {
    if (values[key] === undefined) continue;
    if (
      values[key] === '' ||
      values[key].length > 40 ||
      !SAFE_VALUE.test(values[key])
    ) {
      return invalid('invalid_query', `${key} is malformed.`, key);
    }
    safeFields[key] = values[key];
  }

  return {
    ok: true,
    value: {
      module: values.module,
      resource: values.resource,
      limit,
      cursor,
      ...safeFields,
    },
  };
}

export function assertValidCleanerQuery(input) {
  const result = validateCleanerQuery(input);
  if (!result.ok)
    throw new CleanerError(result.error.code, result.error.message, 400, {
      field: result.error.field,
    });
  return result.value;
}

export function encodeCursor(offset) {
  const value = typeof offset === 'number' ? { offset } : offset;
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return 0;
  if (!SAFE_CURSOR.test(String(cursor)))
    throw new CleanerError('invalid_query', 'cursor is malformed.', 400, {
      field: 'cursor',
    });
  if (/^\d+$/.test(String(cursor))) return Number(cursor);
  try {
    const parsed = JSON.parse(
      Buffer.from(String(cursor), 'base64url').toString('utf8'),
    );
    if (!Number.isSafeInteger(parsed.offset) || parsed.offset < 0)
      throw new Error('invalid offset');
    return parsed.offset;
  } catch (error) {
    throw new CleanerError(
      'invalid_query',
      'cursor is malformed.',
      400,
      { field: 'cursor' },
      { cause: error },
    );
  }
}
