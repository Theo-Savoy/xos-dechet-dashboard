// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsView } from './SessionsView';

// jsdom's loader rejects `node:fs`; instead we expose the CSS through a
// hoisted helper that vitest evaluates before jsdom wraps the module graph.
const callsCss = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync('src/apps/calls/calls.css', 'utf8');
});

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

describe('calls-name-form--sticky', () => {
  it('sticks to the bottom of the scroll area, not the top', () => {
    const match = callsCss.match(/\.calls-name-form--sticky\s*\{[^}]*\}/);
    expect(match).toBeTruthy();
    const rule = match![0];
    expect(rule).toMatch(/bottom:\s*0\.75rem/);
    expect(rule).not.toMatch(/\btop:/);
  });
});
