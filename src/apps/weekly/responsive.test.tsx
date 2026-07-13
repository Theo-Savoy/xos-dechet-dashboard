// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const weeklyCss = readFileSync('src/apps/weekly/weekly.css', 'utf8');

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(() => new Promise(() => undefined)) },
  },
}));

vi.mock('recharts', () => ({
  Bar: () => null,
  BarChart: () => null,
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  Line: () => null,
  LineChart: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Scatter: () => null,
  ScatterChart: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ZAxis: () => null,
}));

import WeeklyApp from './WeeklyApp';

afterEach(cleanup);

describe.each([500, 800, 1200])('Lundi at %ipx', (width) => {
  it('keeps the app surface bounded and exposes responsive CSS', () => {
    const { container } = render(
      <div style={{ width, maxWidth: '100%', overflow: 'auto' }}>
        <WeeklyApp />
      </div>,
    );

    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.style.width).toBe(`${width}px`);
    expect(viewport.querySelector('.weekly-app')).toBeTruthy();
    expect(weeklyCss).toContain('container-type: inline-size');
    expect(weeklyCss).toContain('@container weekly-app');
    expect(weeklyCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect({
      width,
      surface: viewport.querySelector('.weekly-app')?.className,
      layout:
        width < 600 ? 'compact' : width < 900 ? 'intermediate' : 'desktop',
    }).toMatchSnapshot();
  });
});
