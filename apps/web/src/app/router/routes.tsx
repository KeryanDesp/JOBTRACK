import { createBrowserRouter } from 'react-router-dom';
import { NAV_ITEMS } from '@/constants/navigation';
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page';
import { ImportCvPage } from '@/features/cv-import/pages/import-cv-page';
import { LandingPage } from '@/features/landing/landing-page';
import { JobsPage } from '@/features/jobs/pages/jobs-page';
import { ComingSoonPage } from '@/features/misc/coming-soon-page';
import { NotFoundPage } from '@/features/misc/not-found-page';
import { OnboardingPage } from '@/features/onboarding/pages/onboarding-page';
import { ProfilePage } from '@/features/profile/pages/profile-page';
import { SettingsPage } from '@/features/settings/pages/settings-page';
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
      // Hors `AppLayout` (pas de sidebar/navigation pendant l'accueil) mais toujours
      // sous `ProtectedRoute` : un visiteur non connecté ne doit pas y accéder.
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/onboarding/:step', element: <OnboardingPage /> },
      {
        element: <AppLayout />,
        // Les autres écrans n'ont pas encore leur implémentation : ils restent sur
        // « Bientôt disponible ». Profil (tâche 15) et Paramètres (tâche 16) sont
        // livrés et remplacent le leur.
        children: [
          // Sous `AppLayout` comme `/profile`, mais absente de `NAV_ITEMS` (pas d'entrée de
          // navigation propre : on y accède depuis le bouton « Importer un CV » du profil).
          { path: '/profile/import', element: <ImportCvPage /> },
          ...NAV_ITEMS.map((item) => {
            if (item.to === '/profile') return { path: item.to, element: <ProfilePage /> };
            if (item.to === '/settings') return { path: item.to, element: <SettingsPage /> };
            if (item.to === '/jobs') return { path: item.to, element: <JobsPage /> };
            return { path: item.to, element: <ComingSoonPage label={item.label} /> };
          }),
        ],
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
