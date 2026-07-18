import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest("[aria-hidden='true']")) return false;
    return el.offsetParent !== null || el === document.activeElement;
  });
}

/** Focus trap + Esc + body scroll lock for full-screen overlays (glass Modal, Combo). */
export function useComboOverlay(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  options?: { initialFocusRef?: RefObject<HTMLElement | null> },
): void {
  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusInitial = () => {
      const preferred = options?.initialFocusRef?.current;
      if (preferred) {
        preferred.focus();
        return;
      }
      const root = rootRef.current;
      if (!root) return;
      getFocusableElements(root)[0]?.focus();
    };
    const focusTimer = window.setTimeout(focusInitial, 10);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const items = getFocusableElements(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
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

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [open, onEscape, options?.initialFocusRef, rootRef]);
}
