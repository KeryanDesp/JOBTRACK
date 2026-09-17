import {
  BarChart3,
  Bell,
  Briefcase,
  FileText,
  Heart,
  LayoutDashboard,
  Send,
  Settings,
  User,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** false tant que la tranche qui livre l'écran n'est pas terminée. */
  available: boolean;
  /** Affichée dans la bottom navigation mobile (5 entrées maximum). */
  primary: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, available: false, primary: true },
  { to: '/jobs', label: 'Offres', icon: Briefcase, available: true, primary: true },
  { to: '/applications', label: 'Mes candidatures', icon: Send, available: false, primary: true },
  { to: '/resume', label: 'Mon CV', icon: FileText, available: false, primary: true },
  { to: '/automation', label: 'Automatisation', icon: Zap, available: false, primary: false },
  { to: '/analytics', label: 'Statistiques', icon: BarChart3, available: false, primary: false },
  { to: '/favorites', label: 'Favoris', icon: Heart, available: true, primary: false },
  { to: '/alerts', label: 'Alertes', icon: Bell, available: false, primary: false },
  { to: '/profile', label: 'Mon profil', icon: User, available: true, primary: false },
  { to: '/settings', label: 'Paramètres', icon: Settings, available: true, primary: false },
];
