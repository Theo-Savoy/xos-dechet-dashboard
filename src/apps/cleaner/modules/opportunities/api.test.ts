import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpportunityWorkspace } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('opportunities API client', () => {
  it('uses same-origin GET with the access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ items: [], total: 0, nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchOpportunityWorkspace('access-token');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cleaner?module=opportunities&resource=workspace&limit=200',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('surfaces unauthorized responses explicitly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ error: 'unauthorized' }, 401)),
    );

    await expect(
      fetchOpportunityWorkspace('expired-token'),
    ).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
  });

  it('surfaces timeout explicitly and aborts the request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchOpportunityWorkspace('access-token', {
      timeoutMs: 20,
    });
    vi.advanceTimersByTime(21);

    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
  });
});
