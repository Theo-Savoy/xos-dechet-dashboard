import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { apiFetch } from "../../lib/apiClient";
import "./targets.css";

type MonthlyIndicative = { month: string; label: string; weight: number; raw: number; indicative: number };
type MonthTemplate = { month: string; weight: number };

type TargetRow = {
  sf_user_id: string;
  name: string;
  email: string | null;
  role: string | null;
  quarterly_target: number | null;
  monthly_indicative: MonthlyIndicative[];
};

type TargetsPayload = {
  quarter: { label: string; from: string; to: string };
  seasonality: { as_of: string; sample_years: number[] } | null;
  month_template: MonthTemplate[];
  rows: TargetRow[];
};

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const MONTH_LABELS: Record<string, string> = {
  "01": "Janv.", "02": "Fév.", "03": "Mars", "04": "Avr.", "05": "Mai", "06": "Juin",
  "07": "Juil.", "08": "Août", "09": "Sept.", "10": "Oct.", "11": "Nov.", "12": "Déc.",
};

async function fetchTargets(token: string) {
  return apiFetch<TargetsPayload>(token, "/api/weekly-targets").catch(() => {
    throw new Error("targets_unavailable");
  });
}

async function saveTargets(token: string, quarter: string, values: Record<string, number | null>) {
  await apiFetch(token, "/api/weekly-targets", {
    method: "POST",
    body: JSON.stringify({ quarter, values }),
  }).catch(() => {
    throw new Error("targets_save_failed");
  });
}

function parseInput(value: string) {
  const trimmed = value.replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

const INDICATIVE_STEP = 1000;

// Répartit l'objectif trimestriel sur les mois au millier le plus proche, puis
// répartit le résidu par la méthode du plus grand reste pour que la somme des
// indicatifs colle à l'objectif (arrondi au millier). L'ancien arrondi à
// l'ordre de grandeur (1/2,5/5 × 10^n) produisait des pas de 5k et une somme
// qui dérivait — ex. 80k → 25k + 10k + 50k = 75k.
function monthlyFromTemplate(quarterly: number, template: MonthTemplate[]) {
  if (!quarterly || !template.length) return [];
  const step = INDICATIVE_STEP;
  const raws = template.map((entry) => quarterly * entry.weight);
  const target = Math.round(quarterly / step) * step;
  const floors = raws.map((raw) => Math.floor(raw / step) * step);
  let residual = target - floors.reduce((sum, value) => sum + value, 0);
  const order = raws
    .map((raw, index) => ({ remainder: raw - floors[index], index }))
    .sort((a, b) => b.remainder - a.remainder);
  const indicatives = [...floors];
  let cursor = 0;
  while (residual !== 0 && order.length) {
    const delta = residual > 0 ? step : -step;
    indicatives[order[cursor % order.length].index] += delta;
    residual -= delta;
    cursor += 1;
  }
  return template.map((entry, index) => ({
    month: entry.month,
    label: MONTH_LABELS[entry.month] || entry.month,
    weight: entry.weight,
    raw: raws[index],
    indicative: indicatives[index],
  }));
}

export default function TargetsEditor({ token }: { token: string }) {
  const [payload, setPayload] = useState<TargetsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const next = await fetchTargets(token);
      setPayload(next);
      setDraft(Object.fromEntries(next.rows.map((row) => [
        row.sf_user_id,
        row.quarterly_target === null ? "" : String(row.quarterly_target),
      ])));
      setSaved(false);
    } catch {
      setError(true);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const preview = useMemo(() => {
    if (!payload) return [];
    return payload.rows.map((row) => {
      const parsed = parseInput(draft[row.sf_user_id] ?? "");
      const quarterly = parsed === null || Number.isNaN(parsed) ? null : parsed;
      return {
        ...row,
        quarterly_target: quarterly,
        monthly_indicative: quarterly ? monthlyFromTemplate(quarterly, payload.month_template) : [],
      };
    });
  }, [draft, payload]);

  if (error) return <p className="hub-targets-error">Impossible de charger les objectifs.</p>;
  if (!payload) return <p className="hub-targets-loading">Chargement des objectifs…</p>;

  const dirty = payload.rows.some((row) => {
    const parsed = parseInput(draft[row.sf_user_id] ?? "");
    const current = row.quarterly_target;
    if (parsed === null && current === null) return false;
    if (parsed === null || current === null) return true;
    return parsed !== current;
  });

  return (
    <div className="hub-targets">
      <div className="hub-targets-intro">
        <p>
          <strong>{payload.quarter.label}</strong>
          {payload.seasonality
            ? ` · pondération sur ${payload.seasonality.sample_years.length || "—"} ans`
            : " · mois répartis à parts égales"}
        </p>
        <p className="hub-targets-hint">Objectif trimestre en €. Les mois sont indicatifs, arrondis au millier (somme = objectif).</p>
      </div>
      <div className="hub-targets-table" role="table" aria-label="Objectifs trimestre">
        <div className="hub-targets-head" role="row">
          <span role="columnheader">Commercial</span>
          <span role="columnheader">Objectif TQ</span>
          <span role="columnheader">Mois indicatifs</span>
        </div>
        {preview.map((row) => (
          <div className="hub-targets-row" role="row" key={row.sf_user_id}>
            <div className="hub-targets-person" role="cell">
              <strong>{row.name}</strong>
              <small>{row.email}</small>
            </div>
            <div className="hub-targets-input" role="cell">
              <input
                type="text"
                inputMode="numeric"
                aria-label={`Objectif trimestre de ${row.name}`}
                value={draft[row.sf_user_id] ?? ""}
                placeholder="—"
                onChange={(event) => {
                  setDraft((current) => ({ ...current, [row.sf_user_id]: event.target.value }));
                  setSaved(false);
                }}
              />
              <span>€</span>
            </div>
            <div className="hub-targets-months" role="cell">
              {row.monthly_indicative.length
                ? row.monthly_indicative.map((month) => (
                  <span className="hub-targets-month" key={month.month} title={`${Math.round(month.weight * 100)} % · ${money.format(month.raw)} brut`}>
                    {month.label} ~{money.format(month.indicative)}
                  </span>
                ))
                : <span className="hub-targets-month hub-targets-month--empty">—</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="hub-targets-actions">
        <Button disabled={saving || !dirty} onClick={() => {
          void (async () => {
            setSaving(true);
            try {
              const values: Record<string, number | null> = {};
              for (const row of payload.rows) {
                const parsed = parseInput(draft[row.sf_user_id] ?? "");
                if (Number.isNaN(parsed)) return;
                values[row.sf_user_id] = parsed;
              }
              await saveTargets(token, payload.quarter.label, values);
              await load();
              setSaved(true);
            } catch {
              setError(true);
            } finally {
              setSaving(false);
            }
          })();
        }}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {saved && !dirty && <span className="hub-targets-saved">Enregistré</span>}
      </div>
    </div>
  );
}
