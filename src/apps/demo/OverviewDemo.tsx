import { GlassCard, Tag } from "../../components/ui";
import "./demo.css";

const metrics = [
  { label: "Pipeline actif", value: "428 k€", change: "+12 %" },
  { label: "Rendez-vous", value: "34", change: "+6" },
  { label: "Taux de closing", value: "28 %", change: "+3 pts" },
];

export default function OverviewDemo() {
  return (
    <div className="demo-app demo-overview">
      <div className="demo-app__heading">
        <div>
          <Tag variant="accent">Données factices</Tag>
          <h2>Aperçu commercial</h2>
        </div>
        <span className="demo-app__period">Semaine 28</span>
      </div>

      <div className="demo-metrics">
        {metrics.map((metric) => (
          <GlassCard className="demo-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong className="xos-numeric">{metric.value}</strong>
            <small>{metric.change}</small>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="demo-chart">
        <div className="demo-chart__label">
          <span>Rythme du pipeline</span>
          <span className="xos-numeric">8 semaines</span>
        </div>
        <div className="demo-bars" aria-label="Graphique factice du pipeline">
          {[38, 52, 46, 68, 59, 78, 71, 92].map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
