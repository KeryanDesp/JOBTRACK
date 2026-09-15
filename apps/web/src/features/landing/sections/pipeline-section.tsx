import { Section } from '../components/section';

const COLUMNS = [
  { title: 'À postuler', count: 12 },
  { title: 'Candidature envoyée', count: 24 },
  { title: 'Entretien', count: 9 },
  { title: 'Offre', count: 2 },
  { title: 'Refusée', count: 7 },
];

export function PipelineSection() {
  return (
    <Section
      eyebrow="Suivi"
      title="Suivez vos candidatures"
      description="Chaque candidature, son statut, sa source et le CV exact que vous avez envoyé. Plus de tableur à tenir à jour."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((column) => (
          <div key={column.title} className="bg-muted/60 rounded-lg p-4">
            <p className="text-muted-foreground text-xs font-medium">{column.title}</p>
            <p className="mt-2 text-2xl font-semibold">{column.count}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-xs">Exemple illustratif</p>
    </Section>
  );
}
