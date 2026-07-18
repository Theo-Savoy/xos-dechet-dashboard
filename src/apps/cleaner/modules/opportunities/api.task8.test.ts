import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeOpportunityCommand,
  generateIdempotencyKey,
  previewOpportunityCommand,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('opportunities command API', () => {
  it('sends the exact preview payload with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        previewId: '42',
        fingerprint: 'fingerprint',
        expiresAt: '2026-07-13T10:00:00.000Z',
        changes: { stage: 'Fermée / Perdue', loss_reason: 'Budget' },
        eligible: [],
        excluded: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await previewOpportunityCommand('access-token', {
      ids: ['006000000000001'],
      changes: { stage: 'Fermée / Perdue', loss_reason: 'Budget' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cleaner',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          module: 'opportunities',
          action: 'preview',
          ids: ['006000000000001'],
          changes: { stage: 'Fermée / Perdue', loss_reason: 'Budget' },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('sends preview identifiers and one generated idempotency key for execute', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        previewId: '42',
        fingerprint: 'fingerprint',
        idempotencyKey: 'idempotency-key',
        status: 'succeeded',
        results: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-from-crypto' });

    await executeOpportunityCommand('access-token', {
      previewId: '42',
      fingerprint: 'fingerprint',
      idempotencyKey: generateIdempotencyKey(),
    });

    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          module: 'opportunities',
          action: 'execute',
          previewId: '42',
          fingerprint: 'fingerprint',
          idempotencyKey: 'uuid-from-crypto',
        }),
      }),
    );
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [409, 'stale_preview'],
    [422, 'invalid_change'],
    [500, 'internal_error'],
  ])('surfaces HTTP %s and its JSON error', async (status, error) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response({ error, message: `detail-${error}` }, status),
        ),
    );

    await expect(
      previewOpportunityCommand('access-token', {
        ids: ['006000000000001'],
        changes: { close_date: '2026-08-01' },
      }),
    ).rejects.toMatchObject({
      code: status === 401 ? 'unauthorized' : 'http_error',
      status,
      message: `detail-${error}`,
    });
  });

  it('surfaces an aborted command as a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );

    const pending = previewOpportunityCommand(
      'access-token',
      { ids: ['006000000000001'], changes: { close_date: '2026-08-01' } },
      { timeoutMs: 20 },
    );
    vi.advanceTimersByTime(21);

    await expect(pending).rejects.toMatchObject({
      code: 'timeout',
      status: 504,
    });
  });
});
