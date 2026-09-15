import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <main className="flex flex-col gap-4 p-8">
      <p className="text-primary text-2xl font-semibold">JobTrack</p>
      <div className="flex gap-3">
        <Button>Postuler</Button>
        <Button variant="outline">Sauvegarder</Button>
        <Button variant="ghost">Ignorer</Button>
        <Button variant="destructive">Supprimer</Button>
      </div>
    </main>
  </StrictMode>,
);
