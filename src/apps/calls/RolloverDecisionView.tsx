import { useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePicker } from "./formControls";
import { formatIsoDateFr, todayParisIso } from "./formControls.helpers";
import { sessionDayKey } from "./sessionLifecycle";
import type { SessionContact, SessionDetail } from "./types";

export type RolloverDecision = {
  contactId: number;
  action: "contact" | "remove";
  scheduledFor: string | null;
};

type RolloverDecisionViewProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  loading?: boolean;
  error?: string | null;
  onApply: (decisions: RolloverDecision[]) => Promise<void>;
  onCancel: () => void;
};

export function RolloverDecisionView({
  session,
  contacts,
  loading = false,
  error = null,
  onApply,
  onCancel,
}: RolloverDecisionViewProps) {
  const pending = useMemo(() => contacts.filter((contact) => contact.status === "pending"), [contacts]);
  const [globalAction, setGlobalAction] = useState<RolloverDecision["action"]>("contact");
  const [overrides, setOverrides] = useState<Record<number, RolloverDecision["action"]>>({});
  const [dates, setDates] = useState<Record<number, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const decisions = pending.map((contact) => ({
    contactId: contact.id,
    action: overrides[contact.id] ?? globalAction,
    scheduledFor: (overrides[contact.id] ?? globalAction) === "contact"
      ? dates[contact.id] ?? todayParisIso()
      : null,
  }));
  const removeCount = decisions.filter((decision) => decision.action === "remove").length;

  const apply = () => {
    if (removeCount > 0) {
      setConfirmOpen(true);
      return;
    }
    void onApply(decisions);
  };

  return (
    <div className="calls-view calls-rollover" aria-labelledby="calls-rollover-title">
      <header className="calls-view__header">
        <div>
          <Tag variant="warning">Séance à clôturer</Tag>
          <h2 id="calls-rollover-title">Décider du devenir des contacts</h2>
          <p className="calls-muted">
            Depuis « {session.name} » ({formatIsoDateFr(sessionDayKey(session))}), les contacts non contactés restent disponibles.
          </p>
          <div className="calls-rollover__summary" aria-label="Résumé de la séance">
            <Tag variant="accent">{pending.length} non contacté{pending.length > 1 ? "s" : ""}</Tag>
            <Tag>{contacts.length} contact{contacts.length > 1 ? "s" : ""} dans la séance</Tag>
          </div>
        </div>
      </header>

      {error && <p className="calls-state" role="alert">{error}</p>}

      <GlassCard className="calls-rollover__panel">
        <div className="calls-rollover__global" role="group" aria-label="Décision globale">
          <span>Pour tous les contacts</span>
          <Button
            variant={globalAction === "contact" ? "primary" : "secondary"}
            aria-pressed={globalAction === "contact"}
            onClick={() => setGlobalAction("contact")}
          >
            Contacter
          </Button>
          <Button
            variant={globalAction === "remove" ? "primary" : "secondary"}
            aria-pressed={globalAction === "remove"}
            onClick={() => setGlobalAction("remove")}
          >
            Retirer
          </Button>
        </div>

        <ul className="calls-rollover__contacts">
          {pending.map((contact) => {
            const action = overrides[contact.id] ?? globalAction;
            const date = dates[contact.id] ?? todayParisIso();
            return (
              <li key={contact.id} className="calls-rollover__contact">
                <div>
                  <strong>{contact.contact_name}</strong>
                  {contact.account_name && <small>{contact.account_name}</small>}
                </div>
                <div className="calls-rollover__actions" role="group" aria-label={`Décision pour ${contact.contact_name}`}>
                  <Button
                    variant={action === "contact" ? "primary" : "secondary"}
                    aria-pressed={action === "contact"}
                    onClick={() => setOverrides((current) => ({ ...current, [contact.id]: "contact" }))}
                  >
                    Contacter {contact.contact_name}
                  </Button>
                  <Button
                    variant={action === "remove" ? "primary" : "secondary"}
                    aria-pressed={action === "remove"}
                    onClick={() => setOverrides((current) => ({ ...current, [contact.id]: "remove" }))}
                  >
                    Retirer {contact.contact_name}
                  </Button>
                </div>
                {action === "contact" && (
                  <DatePicker
                    label={"Date pour " + contact.contact_name}
                    value={date}
                    onChange={(next) => setDates((current) => ({ ...current, [contact.id]: next }))}
                  />
                )}
              </li>
            );
          })}
        </ul>

        <div className="calls-runner-actions calls-rollover__footer">
          <Button onClick={apply} disabled={loading || pending.length === 0}>
            {loading ? "Enregistrement…" : "Appliquer les décisions"}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Retour à Combo
          </Button>
        </div>
      </GlassCard>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmer le retrait"
        description={"Retirer " + removeCount + " contact" + (removeCount > 1 ? "s" : "") + " de la séance ? L'historique d'appel est conservé."}
        confirmLabel={removeCount === 1 ? "Retirer le contact" : "Retirer les " + removeCount + " contacts"}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void onApply(decisions);
        }}
        loading={loading}
      />
    </div>
  );
}
