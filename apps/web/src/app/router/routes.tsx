import { createBrowserRouter } from 'react-router-dom';
import { NAV_ITEMS } from '@/constants/navigation';
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page';
import { LandingPage } from '@/features/landing/landing-page';
import { ComingSoonPage } from '@/features/misc/coming-soon-page';
import { NotFoundPage } from '@/features/misc/not-found-page';
import { AppLayout } from '../layouts/app-layout';
import { ProtectedRoute } from './protected-route';

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        // Le profil et les paramètres n'ont pas encore leur écran (tâches 15-16) :
        // ils restent sur « Bientôt disponible » comme le reste de NAV_ITEMS.
        children: NAV_ITEMS.map((item) => ({
          path: item.to,
          element: <ComingSoonPage label={item.label} />,
        })),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
], {
  // Comportements de React Router v7 adoptés dès maintenant : aucun effet
  // observable aujourd'hui (pas de <Form>, ni de fetcher, ni de splat), et
  // cela évite de les basculer plus tard sur des écrans qui en dépendront.
  future: {
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_relativeSplatPath: true,
    v7_skipActionErrorRevalidation: true,
  },
});
