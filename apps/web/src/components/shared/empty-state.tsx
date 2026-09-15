import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
        <Icon className="text-muted-foreground size-5" />
      </div>
      {/* Un <p> et non un titre : ce bloc n'est pas un repère de navigation, et un h3 sous le h1 de page casserait l'ordre des titres. */}
      <p className="text-base font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      {action && (
        <Button className="mt-6" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
