// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  afterEach(cleanup);

  it('defaults to primary variant and md size', () => {
    render(<Button>Valider</Button>);
    const btn = screen.getByRole('button', { name: 'Valider' });
    expect(btn.classList.contains('xos-btn--primary')).toBe(true);
    expect(btn.classList.contains('xos-btn--md')).toBe(true);
  });

  it.each(['primary', 'secondary', 'ghost', 'danger', 'icon'] as const)(
    'applies the %s variant class',
    (variant) => {
      render(<Button variant={variant}>Action</Button>);
      expect(screen.getByRole('button').classList.contains(`xos-btn--${variant}`)).toBe(true);
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('applies the %s size class', (size) => {
    render(<Button size={size}>Action</Button>);
    expect(screen.getByRole('button').classList.contains(`xos-btn--${size}`)).toBe(true);
  });

  it('merges a custom className with the variant/size classes', () => {
    render(<Button className="my-extra">Action</Button>);
    const btn = screen.getByRole('button');
    expect(btn.classList.contains('my-extra')).toBe(true);
    expect(btn.classList.contains('xos-btn')).toBe(true);
  });

  it('forwards native button props', () => {
    render(<Button disabled>Désactivé</Button>);
    expect((screen.getByRole('button', { name: 'Désactivé' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('forwards a native button ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Action</Button>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Action' }));
  });
});
