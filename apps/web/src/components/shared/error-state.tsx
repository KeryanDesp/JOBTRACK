import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  /** Message lisible par un humain, en français. Jamais un code HTTP brut. */
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="bg-destructive/10 mb-4 flex size-12 items-center justify-center rounded-full">
        <AlertCircle className="text-destructive size-5" />
      </div>
      <p className="text-base font-medium">{message}</p>
      <Button variant="outline" className="mt-6" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
