import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { useComboOverlay } from './useComboOverlay';
import './ui.css';

type ModalAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type ModalProps = {
  open: boolean;
  title: string;
  children?: ReactNode;
  onClose: () => void;
  primaryAction?: ModalAction;
  secondaryAction?: ModalAction;
  /** 'glass' : plein écran, fond glass appuyé (remplace les modales maison type calls-modal). */
  variant?: 'default' | 'glass';
};

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  children,
  onClose,
  primaryAction,
  secondaryAction,
  variant = 'default',
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const isGlass = variant === 'glass';

  // Variante glass : plein écran, réutilise le comportement (focus trap + Esc + scroll lock)
  // déjà validé par les overlays Combo plutôt qu'une seconde implémentation.
  useComboOverlay(isGlass && open, panelRef, onClose);

  useEffect(() => {
    if (!open || isGlass) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [isGlass, onClose, open]);

  if (!open) return null;
  const stopPropagation = (event: ReactKeyboardEvent | React.MouseEvent) =>
    event.stopPropagation();
  return createPortal(
    <div
      className={isGlass ? 'xos-modal-backdrop xos-modal-backdrop--glass' : 'xos-modal-backdrop'}
      data-testid="modal-backdrop"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={isGlass ? 'xos-modal xos-modal--glass' : 'xos-modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={stopPropagation}
      >
        <header className="xos-modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="xos-modal__close" aria-label="Fermer" onClick={onClose}>×</button>
        </header>
        {children ? <div className="xos-modal__body">{children}</div> : null}
        {primaryAction || secondaryAction ? (
          <footer className="xos-modal__actions">
            {secondaryAction ? (
              <Button type="button" variant="secondary" disabled={secondaryAction.disabled} onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            ) : null}
            {primaryAction ? (
              <Button type="button" disabled={primaryAction.disabled} onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
