import { useEffect, useMemo, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import type { SessionContact, SessionDetail } from "./types";

type PreSessionFlowProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  loading?: boolean;
  onLaunch: (goal: number) => Promise<void>;
  onCancel: () => void;
};

type Phase = "review" | "objective" | "warmup";

function accountGroups(contacts: SessionContact[]) {
  const groups = new Map<string, { name: string; contacts: SessionContact[] }>();
  for (const contact of contacts) {
    const key = contact.sf_account_id || contact.account_name || `contact-${contact.id}`;
    const current = groups.get(key) || { name: contact.account_name || "Compte non renseigné", contacts: [] };
    current.contacts.push(contact);
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function PreSessionFlow({ session, contacts, loading = false, onLaunch, onCancel }: PreSessionFlowProps) {
  const [phase, setPhase] = useState<Phase>("review");
  const [goal, setGoal] = useState(session.rdv_goal ?? 5);
  const [countdown, setCountdown] = useState(3);
  const groups = useMemo(() => accountGroups(contacts), [contacts]);
  const remaining = contacts.filter((contact) => contact.status === "pending").length;

  useEffect(() => {
    if (phase !== "warmup") return undefined;
    setCountdown(3);
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [phase]);

  const launch = async () => {
    if (countdown !== 0 || goal < 1 || goal > 8) return;
    await onLaunch(goal);
  };

  return (
    <div className="calls-modal" role="dialog" aria-modal="true" aria-labelledby="calls-pre-session-title">
      <GlassCard className="calls-modal__panel calls-pre-session">
        <div className="calls-pre-session__eyebrow">Préparation de séance</div>
        <h2 id="calls-pre-session-title">{session.name}</h2>
        {phase === "review" && (
          <>
            <p className="calls-muted">Regarde la matière avant de te lancer. Cette séance contient {remaining} contact{remaining > 1 ? "s" : ""} à traiter.</p>
            <div className="calls-pre-session__stats">
              <Tag variant="accent">{groups.length} compte{groups.length > 1 ? "s" : ""}</Tag>
              <Tag>{remaining} contact{remaining > 1 ? "s" : ""} restant{remaining > 1 ? "s" : ""}</Tag>
              <Tag>{contacts.length} contact{contacts.length > 1 ? "s" : ""} au total</Tag>
            </div>
            <ul className="calls-context-list calls-pre-session__accounts">
              {groups.map((group) => {
                const latest = [...group.contacts].sort((a, b) => String(b.called_at || "").localeCompare(String(a.called_at || "")))[0];
                return (
                  <li key={group.name}>
                    <strong>{group.name}</strong>
                    <span>{group.contacts.length} contact{group.contacts.length > 1 ? "s" : ""}</span>
                    <small>{latest?.outcome ? `Dernier résultat : ${latest.outcome}` : "Jamais appelé dans cette séance"}</small>
                  </li>
                );
              })}
            </ul>
            <div className="calls-runner-actions">
              <Button onClick={() => setPhase("objective")}>Définir mon objectif</Button>
              <Button variant="secondary" onClick={onCancel}>Retour</Button>
            </div>
          </>
        )}
        {phase === "objective" && (
          <>
            <p className="calls-muted">Combien de rendez-vous veux-tu obtenir dans cette séance ? L’objectif sera verrouillé au lancement.</p>
            <label className="calls-field" htmlFor="calls-pre-session-goal">
              <span>Objectif de RDV</span>
              <input
                id="calls-pre-session-goal"
                className="calls-input"
                type="number"
                min={1}
                max={8}
                step={1}
                value={goal}
                onChange={(event) => setGoal(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
              />
            </label>
            <p className="calls-muted">Entre 1 et 8 RDV. Une fois lancé, tu pourras augmenter cet objectif, jamais le réduire.</p>
            <div className="calls-runner-actions">
              <Button onClick={() => setPhase("warmup")} disabled={!Number.isInteger(goal) || goal < 1 || goal > 8}>Lancer le warmup</Button>
              <Button variant="secondary" onClick={() => setPhase("review")}>Retour</Button>
            </div>
          </>
        )}
        {phase === "warmup" && (
          <div className="calls-pre-session__warmup" aria-live="polite">
            {countdown > 0 ? (
              <>
                <div className="calls-pre-session__countdown">{countdown}</div>
                <p>Respire. Une conversation à la fois.</p>
              </>
            ) : (
              <>
                <div className="calls-pre-session__countdown">GO</div>
                <p>Objectif verrouillé : {goal} RDV.</p>
                <Button onClick={() => void launch()} disabled={loading}>Entrer dans la séance</Button>
              </>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
