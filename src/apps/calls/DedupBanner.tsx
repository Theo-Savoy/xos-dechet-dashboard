import { GlassCard, Tag } from "../../components/ui";
import type { DedupEntry } from "../../crm";

export type DedupMode = "avertir" | "exclure";

type DedupBannerProps = {
  dedup: DedupEntry[];
  mode: DedupMode;
  onModeChange: (mode: DedupMode) => void;
};

export function DedupBanner({ dedup, mode, onModeChange }: DedupBannerProps) {
  if (dedup.length === 0) return null;

  return (
    <GlassCard className="calls-dedup">
      <div className="calls-dedup__text">
        <Tag variant="alert">Doublons</Tag>
        <p>
          <strong>{dedup.length}</strong> contact{dedup.length > 1 ? "s sont" : " est"} déjà dans
          une séance (dont celles de collègues).
        </p>
      </div>
      <div className="calls-tristate calls-dedup__toggle">
        <button
          type="button"
          className={`calls-tristate__opt${mode === "avertir" ? " calls-tristate__opt--active" : ""}`}
          onClick={() => onModeChange("avertir")}
          aria-pressed={mode === "avertir"}
        >
          Avertir
        </button>
        <button
          type="button"
          className={`calls-tristate__opt${mode === "exclure" ? " calls-tristate__opt--active" : ""}`}
          onClick={() => onModeChange("exclure")}
          aria-pressed={mode === "exclure"}
        >
          Exclure
        </button>
      </div>
    </GlassCard>
  );
}
