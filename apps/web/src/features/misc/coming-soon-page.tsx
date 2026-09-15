import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';

interface ComingSoonPageProps {
  /** Libellé de la section, fourni par la route — pas déduit de l'URL. */
  label: string;
}

export function ComingSoonPage({ label }: ComingSoonPageProps) {
  return (
    <EmptyState
      icon={Construction}
      title={`${label} arrive bientôt`}
      description="Cette section n'est pas encore disponible. Elle sera activée dans une prochaine version de JobTrack."
    />
  );
}
