import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/app/providers/theme-provider';
import { AppToaster } from '@/app/providers/app-toaster';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <main className="flex flex-col gap-4 p-8">
        <div className="flex items-center justify-between">
          <p className="text-primary text-2xl font-semibold">JobTrack</p>
          <ThemeToggle />
        </div>
        <div className="flex gap-3">
          <Button>Postuler</Button>
          <Button variant="outline">Sauvegarder</Button>
          <Button variant="ghost">Ignorer</Button>
          <Button variant="destructive">Supprimer</Button>
        </div>
      </main>
      <AppToaster />
    </ThemeProvider>
  </StrictMode>,
);
