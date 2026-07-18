import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpportunityAnalytics, fetchOpportunityHistory } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Task 9 opportunities GET clients', () => {
  it('fetches analytics with same-origin Bearer and period', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ analytics: { totals: {} }, workspace: { items: [] } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await fetchOpportunityAnalytics('access-token', {
      period: '2026-07',
      timeoutMs: 2000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cleaner?module=opportunities&resource=analytics&period=2026-07',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('fetches history with cursor and exposes structured errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ error: 'timeout', message: 'Délai dépassé' }, 504),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchOpportunityHistory('access-token', { cursor: 'next-1', limit: 25 }),
    ).rejects.toMatchObject({
      code: 'http_error',
      status: 504,
      details: { error: 'timeout' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cleaner?module=opportunities&resource=history&limit=25&cursor=next-1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });
});
