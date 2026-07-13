// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  afterEach(cleanup);

  it('renders a clickable label and reports the next checked value', () => {
    const onChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        onChange={onChange}
        label="Partager à l'équipe"
        aria-label="Partager à l'équipe"
      />,
    );

    const input = screen.getByRole('checkbox', {
      name: "Partager à l'équipe",
    });
    expect(input.classList.contains('xos-checkbox__input')).toBe(true);

    fireEvent.click(screen.getByText("Partager à l'équipe"));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects an indeterminate state in the DOM and accessibility tree', () => {
    render(
      <Checkbox
        checked={false}
        indeterminate
        onChange={vi.fn()}
        aria-label="Sélectionner la page"
      />,
    );

    const input = screen.getByRole('checkbox', {
      name: 'Sélectionner la page',
    }) as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('mixed');
  });
});
