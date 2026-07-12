import { useMemo, useState } from "react";
import { Button, GlassCard } from "../../components/ui";
import type { TeamMember } from "./types";

type ShareSessionPanelProps = {
  members: TeamMember[];
  team: TeamMember[];
  currentUserId: string;
  saving: boolean;
  onSave: (memberUserIds: string[]) => Promise<void>;
  onClose: () => void;
};

export function ShareSessionPanel({
  members,
  team,
  currentUserId,
  saving,
  onSave,
  onClose,
}: ShareSessionPanelProps) {
  const shareable = useMemo(
    () =>
      team.filter(
        (member) =>
          member.user_id
          && member.user_id !== currentUserId
          && !String(member.user_id).startsWith("map:"),
      ),
    [team, currentUserId],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(members.map((m) => m.user_id).filter(Boolean)),
  );

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <div className="calls-share-overlay" role="dialog" aria-modal="true" aria-label="Partager la séance">
      <button type="button" className="calls-share-overlay__backdrop" aria-label="Fermer" onClick={onClose} />
      <GlassCard className="calls-share-panel">
        <header className="calls-share-panel__head">
          <div>
            <h3>Partager la séance</h3>
            <p className="calls-muted">
              Les collègues voient la même liste. Chaque appel compte pour celui qui le loggue.
              Un contact pending se réserve ~4&nbsp;min pour éviter les doublons.
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
        </header>

        {shareable.length === 0 ? (
          <p className="calls-muted">Aucun collègue avec un compte Combo à inviter.</p>
        ) : (
          <ul className="calls-share-panel__list">
            {shareable.map((member) => {
              const checked = selected.has(member.user_id);
              return (
                <li key={member.user_id}>
                  <label className="calls-checkbox">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(member.user_id)}
                    />
                    <span>{member.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="calls-share-panel__actions">
          <Button
            disabled={saving}
            onClick={() => {
              void onSave([...selected]);
            }}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
