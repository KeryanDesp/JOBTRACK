import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppToaster } from './app/providers/app-toaster';
import { ThemeProvider } from './app/providers/theme-provider';
import { router } from './app/router/routes';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
      <AppToaster />
    </ThemeProvider>
  </StrictMode>,
);
