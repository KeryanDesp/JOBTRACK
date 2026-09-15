import { Check } from 'lucide-react';
import { Section } from '../components/section';

const SOURCES = [
  { name: 'France Travail', mode: 'API officielle' },
  { name: 'Adzuna', mode: 'API officielle' },
  { name: 'Jooble', mode: 'API officielle' },
  { name: 'Remotive', mode: 'API officielle' },
  { name: 'LinkedIn', mode: 'Candidature assistée' },
  { name: 'Indeed', mode: 'Candidature assistée' },
];

export function SourcesSection() {
  return (
    <Section
      id="comment-ca-marche"
      eyebrow="Sources"
      title="Recherchez partout"
      description="JobTrack agrège les offres des plateformes qui autorisent l'accès automatisé, et prépare vos candidatures sur les autres. Aucune protection n'est contournée."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.map((source) => (
          <div
            key={source.name}
            className="border-border flex items-center gap-3 rounded-lg border p-4"
          >
            <Check className="text-primary size-4 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{source.name}</p>
              <p className="text-muted-foreground text-xs">{source.mode}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
