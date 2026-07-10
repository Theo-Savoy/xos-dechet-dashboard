import logoXos from "../../assets/logo-xos.png";
import "../../os/theme.css";
import { Button } from "./Button";
import { GlassCard } from "./GlassCard";
import { Tag } from "./Tag";

/** Page de démo des composants UI X OS, enregistrée comme app en dev. */
export function UiDemo() {
  return (
    <div style={{ minHeight: "100%", padding: "3rem" }}>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "2.5rem",
        }}
      >
        <span className="xos-logo">
          <img
            src={logoXos}
            alt="XOS"
            className="xos-logo__img"
            width={880}
            height={334}
          />
        </span>
        <span className="xos-numeric" style={{ color: "var(--xos-text-muted)" }}>
          1 234,56 €
        </span>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "1.5rem",
        }}
      >
        <GlassCard>
          <h2 style={{ fontFamily: "var(--xos-font-display)", margin: "0 0 1rem" }}>
            Boutons
          </h2>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Button variant="primary">Action primaire</Button>
            <Button variant="secondary">Action secondaire</Button>
            <Button variant="primary" disabled>
              Désactivé
            </Button>
          </div>
        </GlassCard>

        <GlassCard>
          <h2 style={{ fontFamily: "var(--xos-font-display)", margin: "0 0 1rem" }}>
            Tags
          </h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Tag>Défaut</Tag>
            <Tag variant="accent">Accent</Tag>
            <Tag variant="alert">Alerte</Tag>
          </div>
        </GlassCard>

        <GlassCard>
          <h2 style={{ fontFamily: "var(--xos-font-display)", margin: "0 0 0.5rem" }}>
            Typographie
          </h2>
          <p style={{ fontFamily: "var(--xos-font-display)", margin: "0 0 0.5rem" }}>
            Brockmann — titres et texte (Regular / Medium / SemiBold / Bold)
          </p>
          <p className="xos-numeric" style={{ fontSize: "1.5rem", margin: 0 }}>
            0123456789 — Neue Montreal
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

export default UiDemo;
