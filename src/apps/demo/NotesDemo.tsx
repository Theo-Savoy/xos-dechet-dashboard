import { Button, GlassCard, Tag } from "../../lib/ui";
import "./demo.css";

const notes = [
  { title: "Relancer Acme", meta: "Aujourd’hui · 14:30", variant: "alert" as const },
  { title: "Préparer le weekly", meta: "Demain · 09:00", variant: "accent" as const },
  { title: "Qualifier les comptes entrants", meta: "Vendredi", variant: "default" as const },
];

export default function NotesDemo() {
  return (
    <div className="demo-app demo-notes">
      <div className="demo-app__heading">
        <div>
          <Tag>Données factices</Tag>
          <h2>Notes d’équipe</h2>
        </div>
        <Button variant="secondary" type="button">
          Nouvelle note
        </Button>
      </div>

      <div className="demo-note-list">
        {notes.map((note, index) => (
          <GlassCard className="demo-note" key={note.title}>
            <span className="demo-note__index xos-numeric">0{index + 1}</span>
            <div>
              <strong>{note.title}</strong>
              <small>{note.meta}</small>
            </div>
            <Tag variant={note.variant}>{index === 0 ? "Prioritaire" : "À faire"}</Tag>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
