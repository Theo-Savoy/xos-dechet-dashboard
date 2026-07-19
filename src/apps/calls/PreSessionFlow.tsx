import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, GlassCard, Tag } from '../../components/ui';
import { useComboOverlay } from './comboOverlay';
import type { SessionContact, SessionDetail } from './types';

type PreSessionFlowProps = {
  session: SessionDetail;
  contacts: SessionContact[];
  loading?: boolean;
  recallQueueCount?: number;
  daysSinceLastSession?: number | null;
  onOpenRecalls?: () => void;
  onLaunch: (goal: number) => Promise<void>;
  onCancel: () => void;
};

type Phase = 'review' | 'objective' | 'warmup';
type HandoffState = 'idle' | 'launching' | 'error';

const OBJECTIVE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const PHASES: { id: Phase; label: string }[] = [
  { id: 'review', label: 'Matière' },
  { id: 'objective', label: 'Cap' },
  { id: 'warmup', label: 'Départ' },
];
const PHASE_ORDER = PHASES.map((item) => item.id);

function accountGroups(contacts: SessionContact[]) {
  const groups = new Map<
    string,
    { name: string; contacts: SessionContact[] }
  >();
  for (const contact of contacts) {
    const key =
      contact.sf_account_id || contact.account_name || `contact-${contact.id}`;
    const current = groups.get(key) || {
      name: contact.account_name || 'Compte non renseigné',
      contacts: [],
    };
    current.contacts.push(contact);
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function PreSessionFlow({
  session,
  contacts,
  loading = false,
  recallQueueCount = 0,
  daysSinceLastSession = null,
  onOpenRecalls,
  onLaunch,
  onCancel,
}: PreSessionFlowProps) {
  const [phase, setPhase] = useState<Phase>('review');
  const [goal, setGoal] = useState<number | undefined>(session.rdv_goal ?? 5);
  const [countdown, setCountdown] = useState(3);
  const [handoffState, setHandoffState] = useState<HandoffState>('idle');
  const [launchError, setLaunchError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const launchStartedRef = useRef(false);
  const groups = useMemo(() => accountGroups(contacts), [contacts]);
  const remaining = contacts.filter(
    (contact) => contact.status === 'pending',
  ).length;
  const validGoal =
    typeof goal === 'number' && Number.isInteger(goal) && goal >= 1 && goal <= 8
      ? goal
      : null;
  const phaseIndex = PHASE_ORDER.indexOf(phase);
  const showRecallNudge = recallQueueCount > 0;
  const showInactivityNudge =
    !showRecallNudge
    && daysSinceLastSession != null
    && daysSinceLastSession > 7;

  useComboOverlay(true, panelRef, onCancel);

  const changePhase = (nextPhase: Phase) => {
    setPhase(nextPhase);
    window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLHeadingElement>('[data-phase-title]')
        ?.focus();
    }, 0);
  };

  useEffect(() => {
    if (phase !== 'warmup') return undefined;
    setCountdown(3);
    setHandoffState('idle');
    setLaunchError(null);
    launchStartedRef.current = false;
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

  const launch = useCallback(
    async (goalToLaunch: number) => {
      if (launchStartedRef.current) return;
      launchStartedRef.current = true;
      setLaunchError(null);
      setHandoffState('launching');
      try {
        await onLaunch(goalToLaunch);
      } catch {
        launchStartedRef.current = false;
        setHandoffState('error');
        setLaunchError(
          'Le départ n’a pas abouti. Vérifie la connexion puis relance.',
        );
      }
    },
    [onLaunch],
  );

  useEffect(() => {
    if (
      phase !== 'warmup' ||
      countdown !== 0 ||
      validGoal === null ||
      handoffState === 'error'
    )
      return;
    void launch(validGoal);
  }, [countdown, handoffState, launch, phase, validGoal]);

  return (
    <div
      ref={panelRef}
      className="calls-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calls-pre-session-title"
    >
      <GlassCard
        className={`calls-modal__panel calls-pre-session${handoffState === 'launching' ? ' calls-pre-session--handoff' : ''}`}
      >
        <div className="calls-pre-session__eyebrow">Launch gate</div>
        <h2 id="calls-pre-session-title">{session.name}</h2>
        <div className="calls-pre-session__rail">
          <ol
            className="calls-pre-session__phases"
            aria-label="Étapes de préparation"
          >
            {PHASES.map((item, index) => {
              const state =
                index === phaseIndex
                  ? 'active'
                  : index < phaseIndex
                    ? 'done'
                    : 'pending';
              return (
                <li
                  key={item.id}
                  aria-label={`${item.label}${phase === item.id ? ' — en cours' : ''}`}
                  aria-current={phase === item.id ? 'step' : undefined}
                  className={`calls-pre-session__phase calls-pre-session__phase--${state}`}
                >
                  <span>{state === 'done' ? '✓' : index + 1}</span>
                  {item.label}
                </li>
              );
            })}
          </ol>
        </div>

        <div
          key={phase}
          className={`calls-pre-session__content calls-pre-session__content--${phase}`}
        >
          {phase === 'review' && (
            <>
              {(showRecallNudge || showInactivityNudge) && (
                <GlassCard
                  variant="subdued"
                  className="calls-pre-session__nudge"
                  role="note"
                  aria-label="Suggestion de départ"
                >
                  {showRecallNudge && (
                    <p>
                      Commence par les rappels :{' '}
                      <strong className="xos-numeric">{recallQueueCount}</strong> dû
                      {recallQueueCount > 1 ? 's' : ''} aujourd&apos;hui
                      {onOpenRecalls && (
                        <>
                          {' '}
                          —{' '}
                          <button
                            type="button"
                            className="calls-pre-session__nudge-link"
                            onClick={onOpenRecalls}
                          >
                            Voir les rappels
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  {showInactivityNudge && daysSinceLastSession != null && (
                    <p>
                      Ça fait{' '}
                      <strong className="xos-numeric">{daysSinceLastSession}</strong> jour
                      {daysSinceLastSession > 1 ? 's' : ''} — on reprend avec tes presets ?
                    </p>
                  )}
                </GlassCard>
              )}
              <div className="calls-pre-session__stage-copy">
                <span className="calls-pre-session__stage-kicker">
                  Matière prête
                </span>
                <h3 data-phase-title tabIndex={-1}>
                  Tout ce qui est actionnable est en ligne.
                </h3>
                <p className="calls-muted">
                  {remaining} contact{remaining > 1 ? 's' : ''} à appeler
                  maintenant. Une seule décision : choisir le cap.
                </p>
              </div>
              <div
                className="calls-pre-session__stats"
                aria-label="État de la matière"
              >
                <Tag variant="accent">
                  {groups.length} compte{groups.length > 1 ? 's' : ''}
                </Tag>
                <Tag>
                  {remaining} contact{remaining > 1 ? 's' : ''} actionnable
                  {remaining > 1 ? 's' : ''}
                </Tag>
                <Tag>
                  {contacts.length} contact{contacts.length > 1 ? 's' : ''} au
                  total
                </Tag>
              </div>
              <ul className="calls-context-list calls-pre-session__accounts">
                {groups.map((group) => {
                  const latest = [...group.contacts].sort((a, b) =>
                    String(b.called_at || '').localeCompare(
                      String(a.called_at || ''),
                    ),
                  )[0];
                  return (
                    <li key={group.name}>
                      <strong>{group.name}</strong>
                      <span>
                        {group.contacts.length} contact
                        {group.contacts.length > 1 ? 's' : ''}
                      </span>
                      <small>
                        {latest?.outcome
                          ? `Dernier résultat : ${latest.outcome}`
                          : 'Prêt à appeler'}
                      </small>
                    </li>
                  );
                })}
              </ul>
              <div className="calls-runner-actions">
                <Button onClick={() => changePhase('objective')}>
                  Choisir le cap
                </Button>
                <Button variant="secondary" onClick={onCancel}>
                  Annuler
                </Button>
              </div>
            </>
          )}

          {phase === 'objective' && (
            <>
              <div className="calls-pre-session__objective-intro">
                <span className="calls-pre-session__stage-kicker">
                  Cap de la séance
                </span>
                <h3 data-phase-title tabIndex={-1}>
                  Le cap guide chaque appel.
                </h3>
                <p className="calls-muted">Objectif verrouillé au départ.</p>
              </div>
              <div
                className="calls-pre-session__objective-hero"
                aria-live="polite"
              >
                <strong>{validGoal ?? '—'}</strong>
                <span>RDV visés</span>
              </div>
              <div
                className="calls-pre-session__objective-picker"
                role="group"
                aria-label="Nombre de rendez-vous à viser"
              >
                <span className="calls-pre-session__objective-label">
                  Choisis le nombre de rendez-vous à viser
                </span>
                <div className="calls-pre-session__objective-options">
                  {OBJECTIVE_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`calls-pre-session__objective-chip${goal === option ? ' calls-pre-session__objective-chip--active' : ''}`}
                      aria-label={`${option} RDV`}
                      aria-pressed={goal === option}
                      onClick={() => setGoal(option)}
                    >
                      {goal === option && (
                        <span
                          className="calls-pre-session__objective-glow"
                          aria-hidden="true"
                        />
                      )}
                      <strong>{option}</strong>
                      <span>RDV</span>
                    </button>
                  ))}
                </div>
                <span id="calls-pre-session-goal-hint" className="calls-muted">
                  {validGoal === null
                    ? 'Choisis un nombre entier entre 1 et 8 RDV.'
                    : `Cap choisi : ${validGoal} RDV.`}
                </span>
              </div>
              <div className="calls-runner-actions">
                <Button
                  onClick={() => changePhase('warmup')}
                  disabled={validGoal === null}
                >
                  Lancer le départ
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => changePhase('review')}
                >
                  Retour
                </Button>
              </div>
            </>
          )}

          {phase === 'warmup' && (
            <div
              className={`calls-pre-session__warmup${handoffState === 'launching' ? ' calls-pre-session__warmup--handoff' : ''}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-busy={handoffState === 'launching' || loading}
            >
              <div className="calls-pre-session__warmup-head">
                <span className="calls-pre-session__stage-kicker">Départ</span>
                <h3
                  data-phase-title
                  tabIndex={-1}
                  className="calls-pre-session__warmup-title"
                >
                  {countdown === 0
                    ? 'Cap verrouillé. Ligne ouverte.'
                    : 'Prépare le premier appel.'}
                </h3>
              </div>
              <div
                className={
                  countdown === 0
                    ? 'calls-pre-session__stage calls-pre-session__stage--go'
                    : 'calls-pre-session__stage'
                }
              >
                {countdown > 0 ? (
                  <div className="calls-pre-session__countdown calls-pre-session__countdown--pulse">
                    {countdown}
                  </div>
                ) : (
                  <div className="calls-pre-session__countdown calls-pre-session__countdown--go">
                    GO
                  </div>
                )}
              </div>
              {countdown > 0 && (
                <p>
                  Départ dans {countdown}. {remaining} contact
                  {remaining > 1 ? 's' : ''} prêt{remaining > 1 ? 's' : ''} à
                  appeler.
                </p>
              )}
              {countdown === 0 && handoffState === 'launching' && (
                <p>Ouverture de la séance…</p>
              )}
              {countdown === 0 && handoffState === 'error' && (
                <div
                  className="calls-pre-session__launch-error"
                  role="alert"
                  aria-label="Échec du départ"
                >
                  <p>{launchError}</p>
                  <Button
                    className="calls-pre-session__ignition"
                    onClick={() => validGoal !== null && void launch(validGoal)}
                    disabled={loading}
                  >
                    Relancer le départ
                  </Button>
                </div>
              )}
              <div
                className="calls-pre-session__warmup-track"
                aria-hidden="true"
              >
                <span
                  className={
                    countdown === 0
                      ? 'calls-pre-session__warmup-progress calls-pre-session__warmup-progress--done'
                      : 'calls-pre-session__warmup-progress'
                  }
                />
              </div>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
