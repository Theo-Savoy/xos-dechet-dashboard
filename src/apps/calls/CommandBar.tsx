import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, GlassCard } from "../../components/ui";
import {
  type ComboActionDef,
  type ComboActionId,
  filterComboActions,
} from "./comboKeyboard";
import { useComboOverlay } from "./comboOverlay";

type CommandBarProps = {
  open: boolean;
  onClose: () => void;
  onRun: (id: ComboActionId) => void;
  soundsEnabled: boolean;
};

export function CommandBar({ open, onClose, onRun, soundsEnabled }: CommandBarProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo(() => filterComboActions(query), [query]);

  const handleEscape = useCallback(() => {
    onClose();
  }, [onClose]);

  useComboOverlay(open, rootRef, handleEscape, { initialFocusRef: inputRef });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(actions.length - 1, 0)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const action = actions[activeIndex];
        if (action) {
          onRun(action.id);
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, actions, activeIndex, onClose, onRun]);

  if (!open) return null;

  const grouped = actions.reduce<Record<string, ComboActionDef[]>>((acc, action) => {
    (acc[action.section] ??= []).push(action);
    return acc;
  }, {});

  let flatIndex = -1;

  return (
    <div ref={rootRef} className="calls-cmdk" role="dialog" aria-modal="true" aria-label="Command bar Combo">
      <button
        type="button"
        className="calls-cmdk__backdrop"
        tabIndex={-1}
        aria-label="Fermer"
        onClick={onClose}
      />
      <GlassCard className="calls-cmdk__panel">
        <div className="calls-cmdk__head">
          <input
            ref={inputRef}
            className="calls-cmdk__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une action, un raccourci…"
            aria-label="Rechercher une action"
          />
          <kbd className="calls-kbd">esc</kbd>
        </div>
        <div className="calls-cmdk__list" role="listbox" aria-label="Actions">
          {actions.length === 0 && <p className="calls-muted calls-cmdk__empty">Aucune action.</p>}
          {Object.entries(grouped).map(([section, items]) => (
            <div key={section} className="calls-cmdk__group">
              <p className="calls-cmdk__group-label">{section}</p>
              <ul>
                {items.map((action) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const label =
                    action.id === "toggle-sounds"
                      ? soundsEnabled
                        ? "Couper les sons"
                        : "Activer les sons"
                      : action.label;
                  return (
                    <li key={action.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === activeIndex}
                        aria-label={label}
                        className={`calls-cmdk__item${index === activeIndex ? " calls-cmdk__item--active" : ""}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          onRun(action.id);
                          onClose();
                        }}
                      >
                        <span>{label}</span>
                        {action.shortcutLabel && (
                          <kbd className="calls-kbd" aria-hidden="true">
                            {action.shortcutLabel}
                          </kbd>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="calls-cmdk__hint">
          Astuce : <kbd className="calls-kbd">1</kbd> puis <kbd className="calls-kbd">⌘↵</kbd> = combo non décroché
        </p>
      </GlassCard>
    </div>
  );
}

type ShortcutHelpProps = {
  open: boolean;
  onClose: () => void;
  onOpenCommandBar: () => void;
};

export function ShortcutHelp({ open, onClose, onOpenCommandBar }: ShortcutHelpProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const handleEscape = useCallback(() => onClose(), [onClose]);
  useComboOverlay(open, rootRef, handleEscape);

  if (!open) return null;

  const left = [
    ["1–5", "Résultats d'appel"],
    ["R", "Toggle rappel"],
    ["⇧1–⇧5", "Délai de rappel"],
    ["N", "NPA"],
    ["⌘↵", "Logguer & suivant"],
  ] as const;
  const right = [
    ["J / K", "Suivant / précédent"],
    ["L / F", "Liste / Fiche"],
    ["⌘K", "Command bar"],
    ["?", "Cette aide"],
    ["Esc", "Fermer"],
  ] as const;

  return (
    <div ref={rootRef} className="calls-help" role="dialog" aria-modal="true" aria-label="Aide raccourcis Combo">
      <button
        type="button"
        className="calls-help__backdrop"
        tabIndex={-1}
        aria-label="Fermer"
        onClick={onClose}
      />
      <GlassCard className="calls-help__panel">
        <div className="calls-help__head">
          <div>
            <span className="calls-help__eyebrow">Combo</span>
            <h3>Raccourcis clavier</h3>
            <p className="calls-muted">Prospection au rythme du clavier.</p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
        <div className="calls-help__grid">
          <ul className="calls-help__cols">
            {left.map(([keys, label]) => (
              <li key={keys}>
                <kbd className="calls-kbd">{keys}</kbd>
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <ul className="calls-help__cols">
            {right.map(([keys, label]) => (
              <li key={keys}>
                <kbd className="calls-kbd">{keys}</kbd>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="calls-help__foot">
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              onOpenCommandBar();
            }}
          >
            Ouvrir la command bar
          </Button>
          <span className="calls-muted">Toutes les actions + revoir la démo</span>
        </div>
      </GlassCard>
    </div>
  );
}
