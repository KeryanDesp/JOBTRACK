import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { NAV_ITEMS } from '@/constants/navigation';

export function ComingSoonPage() {
  const { pathname } = useLocation();
  const label = NAV_ITEMS.find((item) => item.to === pathname)?.label ?? 'Cette section';

  return (
    <EmptyState
      icon={Construction}
      title={`${label} arrive bientôt`}
      description="Cette section n'est pas encore disponible. Elle sera activée dans une prochaine version de JobTrack."
    />
  );
}
