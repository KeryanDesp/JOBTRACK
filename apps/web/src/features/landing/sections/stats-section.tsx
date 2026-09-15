import { Section } from '../components/section';

const METRICS = [
  { value: '25%', label: 'taux de réponse moyen', detail: 'mesuré sur vos propres candidatures' },
  { value: '4×', label: 'moins de saisie manuelle', detail: 'plus de tableur à maintenir' },
  { value: '1', label: 'CV par offre', detail: 'généré à partir de votre profil réel' },
];

export function StatsSection() {
  return (
    <Section
      eyebrow="Statistiques"
      title="Sachez ce qui fonctionne vraiment"
      description="Quels CV obtiennent des réponses, quelles sources convertissent, quelles catégories vous répondent. Vos chiffres, pas des moyennes du marché."
    >
      <div className="grid gap-6 sm:grid-cols-3">
        {METRICS.map((metric) => (
          <div key={metric.label}>
            <p className="text-primary text-3xl font-semibold tracking-tight">{metric.value}</p>
            <p className="mt-1 text-sm font-medium">{metric.label}</p>
            <p className="text-muted-foreground mt-1 text-sm">{metric.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-6 text-xs">
        Exemple illustratif. JobTrack n'affiche que des statistiques calculées sur vos propres
        candidatures.
      </p>
    </Section>
  );
}
