// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

describe('Modal', () => {
  it('closes on Escape and backdrop click while keeping panel clicks inside', () => {
    const onClose = vi.fn();
    render(<Modal open title="Confirmer" onClose={onClose}>Corps</Modal>);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps Tab focus between modal controls', () => {
    render(
      <Modal open title="Confirmer" onClose={() => undefined}
        primaryAction={{ label: 'Appliquer', onClick: () => undefined }}
        secondaryAction={{ label: 'Annuler', onClick: () => undefined }} />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.at(-1)?.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons.at(-1));
  });
});
