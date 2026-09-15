import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <p className="text-primary p-8 text-2xl font-semibold">JobTrack</p>
  </StrictMode>,
);
