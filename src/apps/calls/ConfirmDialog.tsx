import type { MouseEvent, ReactNode } from "react";
import { Button, GlassCard } from "../../components/ui";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  titleId?: string;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
  loading = false,
  titleId = "calls-confirm-title",
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="calls-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={() => !loading && onCancel()}
    >
      <GlassCard className="calls-modal__panel" onClick={(e: MouseEvent) => e.stopPropagation()}>
        <h3 id={titleId}>{title}</h3>
        <div className="calls-muted">{description}</div>
        <div className="calls-runner-actions">
          <Button onClick={onConfirm} disabled={loading}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
