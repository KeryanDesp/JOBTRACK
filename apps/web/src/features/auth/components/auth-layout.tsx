import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';

interface AuthLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Colonne centrée commune aux écrans d'authentification : logo (lien vers
 * l'accueil), titre, description, contenu (le formulaire), pied de page
 * optionnel (liens de bascule login/register). `MotionConfig
 * reducedMotion="user"` est posé une fois pour toute l'app dans `main.tsx` :
 * cette entrée respecte donc `prefers-reduced-motion` sans code supplémentaire ici.
 */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <Link to="/" aria-label="JobTrack, accueil">
            <Logo />
          </Link>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
        </div>

        <div className="space-y-6">{children}</div>

        {footer && <div className="text-center text-sm">{footer}</div>}
      </motion.div>
    </div>
  );
}
