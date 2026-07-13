// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecetteJobProvider, useRecetteJob } from './recetteJobStore';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrapper = ({ children }: PropsWithChildren) => (
  <RecetteJobProvider pollInterval={20}>{children}</RecetteJobProvider>
);

describe('RecetteJobProvider', () => {
  it('polls a started job through running to done and exposes progress', async () => {
    vi.useFakeTimers();
    const poll = vi.fn()
      .mockResolvedValueOnce({ status: 'running', total: 3, processed: 1, errors: [] })
      .mockResolvedValueOnce({ status: 'done', total: 3, processed: 3, errors: [] });
    const { result } = renderHook(() => useRecetteJob(), { wrapper });

    await act(async () => { await result.current.start('job-1', poll); });
    expect(result.current).toMatchObject({ jobId: 'job-1', status: 'running', progress: { total: 3, processed: 1 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.status).toBe('done');
    expect(result.current.progress.processed).toBe(3);
  });

  it('exposes polling errors and can reset to idle', async () => {
    const { result } = renderHook(() => useRecetteJob(), { wrapper });
    await act(async () => result.current.start('job-2', vi.fn().mockRejectedValue(new Error('boom'))));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('boom');
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ jobId: null, status: 'idle', error: null });
  });
});
