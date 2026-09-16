import { PageHeader } from '@/components/shared/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ComingSoonPage } from '@/features/misc/coming-soon-page';
import { AccountCard } from '../components/account-card';
import { AppearanceCard } from '../components/appearance-card';
import { SecurityCard } from '../components/security-card';
import { SessionsCard } from '../components/sessions-card';

// Sections pas encore implémentées : même écran « Bientôt disponible » que le
// reste du produit (voir routes.tsx), mais comme onglet plutôt que comme page.
const COMING_SOON_TABS = [
  { value: 'notifications', label: 'Notifications' },
  { value: 'integrations', label: 'Intégrations' },
  { value: 'privacy', label: 'Confidentialité' },
  { value: 'subscription', label: 'Abonnement' },
] as const;

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Paramètres" description="Gérez votre compte, votre sécurité et vos préférences." />
      <Tabs defaultValue="account">
        {/* overflow-x-auto : la liste ne doit jamais forcer la page entière à défiler horizontalement sur mobile. */}
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="account">Compte</TabsTrigger>
          <TabsTrigger value="security">Sécurité</TabsTrigger>
          <TabsTrigger value="appearance">Apparence</TabsTrigger>
          {COMING_SOON_TABS.map(({ value, label }) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="account">
          <AccountCard />
        </TabsContent>
        <TabsContent value="security" className="space-y-6">
          <SecurityCard />
          <SessionsCard />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceCard />
        </TabsContent>
        {COMING_SOON_TABS.map(({ value, label }) => (
          <TabsContent key={value} value={value}>
            <ComingSoonPage label={label} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
