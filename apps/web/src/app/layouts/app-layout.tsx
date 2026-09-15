import { Outlet } from 'react-router-dom';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { AppBottomNav } from './app-bottom-nav';
import { AppSidebar } from './app-sidebar';

export function AppLayout() {
  return (
    <div className="bg-background flex min-h-screen">
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex h-14 items-center justify-end gap-2 border-b px-4 lg:px-8">
          <ThemeToggle />
        </header>

        {/* pb-20 laisse la place à la bottom navigation sur mobile. */}
        <main className="flex-1 px-4 py-6 pb-20 lg:px-8 lg:pb-6">
          <Outlet />
        </main>
      </div>

      <AppBottomNav />
    </div>
  );
}
