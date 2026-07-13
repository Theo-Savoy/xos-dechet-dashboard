// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CleanerShell } from './shell/CleanerShell';

const cleanerCss = readFileSync('src/apps/cleaner/cleaner.css', 'utf8');

afterEach(cleanup);

describe.each([500, 800, 1200])('Labo at %ipx', (width) => {
  it('keeps the shell bounded and exposes responsive CSS', () => {
    const { container } = render(
      <div style={{ width, maxWidth: '100%', overflow: 'auto' }}>
        <CleanerShell
          cockpit={{ status: 'empty', summaries: [] }}
          visibleModuleIds={[]}
        />
      </div>,
    );

    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.style.width).toBe(`${width}px`);
    expect(viewport.querySelector('.cleaner-app')).toBeTruthy();
    expect(cleanerCss).toContain('container-type: inline-size');
    expect(cleanerCss).toContain('@container cleaner-app');
    expect(cleanerCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect({
      width,
      surface: viewport.querySelector('.cleaner-app')?.className,
      layout:
        width < 560 ? 'compact' : width < 900 ? 'intermediate' : 'desktop',
    }).toMatchSnapshot();
  });
});
