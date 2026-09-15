import { createBrowserRouter } from 'react-router-dom';
import { NAV_ITEMS } from '@/constants/navigation';
import { LandingPage } from '@/features/landing/landing-page';
import { ComingSoonPage } from '@/features/misc/coming-soon-page';
import { NotFoundPage } from '@/features/misc/not-found-page';
import { AppLayout } from '../layouts/app-layout';

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  {
    element: <AppLayout />,
    // En tranche 0 toutes les entrées mènent à « Bientôt disponible ».
    // Chaque tranche suivante remplace sa route par le véritable écran.
    children: NAV_ITEMS.map((item) => ({ path: item.to, element: <ComingSoonPage /> })),
  },
  { path: '*', element: <NotFoundPage /> },
]);
