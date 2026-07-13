// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsView } from './SessionsView';

const callsCss = readFileSync('src/apps/calls/calls.css', 'utf8');

afterEach(cleanup);

describe.each([500, 800, 1200])('Combo at %ipx', (width) => {
  it('keeps the sessions surface bounded and exposes responsive CSS', () => {
    const { container } = render(
      <div style={{ width, maxWidth: '100%', overflow: 'auto' }}>
        <SessionsView
          sessions={[]}
          stats={null}
          recallCount={0}
          recallsLoading={false}
          loading={false}
          error={null}
          onRefresh={vi.fn()}
          onNewSession={vi.fn()}
          onOpenSession={vi.fn()}
          onOpenRecalls={vi.fn()}
          onUpdateSession={vi.fn().mockResolvedValue(undefined)}
          onDeleteSession={vi.fn().mockResolvedValue(undefined)}
        />
      </div>,
    );

    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.style.width).toBe(`${width}px`);
    expect(viewport.querySelector('.calls-hub')).toBeTruthy();
    expect(callsCss).toContain('container-type: inline-size');
    expect(callsCss).toContain('@container calls-app');
    expect(callsCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect({
      width,
      surface: viewport.querySelector('.calls-hub')?.className,
      layout:
        width < 720 ? 'compact' : width < 900 ? 'intermediate' : 'desktop',
    }).toMatchSnapshot();
  });
});
