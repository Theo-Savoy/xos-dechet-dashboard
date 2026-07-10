import logoXos from "../assets/logo-xos.png";
import "./boot.css";

type BootScreenProps = {
  phase?: "loading" | "ready" | "exit";
};

export function BootScreen({ phase = "loading" }: BootScreenProps) {
  return (
    <div
      className={`xos-boot ${phase === "exit" ? "xos-boot--exit" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={phase !== "exit"}
      aria-label="Démarrage de XOS"
    >
      <div className="xos-boot__backdrop" aria-hidden="true" />
      <div className="xos-boot__glow xos-boot__glow--a" aria-hidden="true" />
      <div className="xos-boot__glow xos-boot__glow--b" aria-hidden="true" />
      <div className="xos-boot__ring" aria-hidden="true" />

      <div className="xos-boot__content">
        <div className="xos-boot__logo-wrap">
          <img
            src={logoXos}
            alt="XOS"
            className="xos-boot__logo"
            width={880}
            height={334}
            decoding="async"
          />
        </div>

        <div className="xos-boot__progress" aria-hidden="true">
          <div className="xos-boot__progress-track">
            <div className="xos-boot__progress-fill" />
          </div>
        </div>

        <p className="xos-boot__status">
          {phase === "loading" ? "Initialisation…" : "Ouverture du bureau…"}
        </p>
      </div>
    </div>
  );
}
