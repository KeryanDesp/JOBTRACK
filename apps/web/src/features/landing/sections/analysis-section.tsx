import { Section } from '../components/section';

const FIGURES = [
  { value: '120', label: 'offres trouvées' },
  { value: '68', label: 'pertinentes' },
  { value: '24', label: 'fortes priorités' },
  { value: '12', label: 'nouvelles aujourd’hui' },
];

export function AnalysisSection() {
  return (
    <Section
      eyebrow="Analyse"
      title="L'IA analyse les offres pour vous"
      description="Chaque offre est comparée à votre profil : compétences, expérience, localisation, salaire, contrat. Vous obtenez un score de correspondance expliqué, pas une probabilité inventée."
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {FIGURES.map((figure) => (
          <div key={figure.label} className="border-border rounded-xl border p-6">
            <p className="text-3xl font-semibold tracking-tight">{figure.value}</p>
            <p className="text-muted-foreground mt-1 text-sm">{figure.label}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-xs">Exemple illustratif</p>
    </Section>
  );
}
