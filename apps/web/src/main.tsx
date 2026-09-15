import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppToaster } from './app/providers/app-toaster';
import { QueryProvider } from './app/providers/query-provider';
import { ThemeProvider } from './app/providers/theme-provider';
import { router } from './app/router/routes';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryProvider>
        {/* reducedMotion="user" : Framer Motion respecte prefers-reduced-motion, que le CSS seul ne couvre pas. */}
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} />
          <AppToaster />
        </MotionConfig>
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>,
);
