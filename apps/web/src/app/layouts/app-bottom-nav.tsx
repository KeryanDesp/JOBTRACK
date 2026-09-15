import { MoreHorizontal } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NAV_ITEMS } from '@/constants/navigation';
import { cn } from '@/lib/utils';

const PRIMARY = NAV_ITEMS.filter((item) => item.primary);
const SECONDARY = NAV_ITEMS.filter((item) => !item.primary);

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex flex-1 flex-col items-center gap-1 py-2 text-[11px]',
    isActive ? 'text-primary' : 'text-muted-foreground',
  );

export function AppBottomNav() {
  return (
    <nav
      className="bg-background border-border fixed inset-x-0 bottom-0 z-40 flex border-t lg:hidden"
      aria-label="Navigation principale"
    >
      {PRIMARY.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={linkClass}>
          <Icon className="size-5" />
          <span className="truncate px-1">{label}</span>
        </NavLink>
      ))}

      <Sheet>
        <SheetTrigger className="text-muted-foreground flex flex-1 flex-col items-center gap-1 py-2 text-[11px]">
          <MoreHorizontal className="size-5" />
          Plus
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetTitle className="mb-4">Navigation</SheetTitle>
          {/* Radix Dialog attend une description pour lier aria-describedby ; masquée visuellement. */}
          <SheetDescription className="sr-only">Accès aux autres sections</SheetDescription>
          <div className="flex flex-col">
            {SECONDARY.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-3 text-sm"
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
