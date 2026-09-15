import { NavLink } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { Badge } from '@/components/ui/badge';
import { NAV_ITEMS } from '@/constants/navigation';
import { cn } from '@/lib/utils';

export function AppSidebar() {
  return (
    <aside className="bg-sidebar border-sidebar-border hidden w-60 shrink-0 flex-col border-r lg:flex">
      <div className="px-5 py-5">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Navigation principale">
        {NAV_ITEMS.map(({ to, label, icon: Icon, available }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {!available && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                Bientôt
              </Badge>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
