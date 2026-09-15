import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Section } from '../components/section';

const PLANS = [
  {
    name: 'Gratuit',
    price: '0 €',
    period: '',
    description: 'Pour commencer votre recherche.',
    features: [
      'Recherche multi-sources',
      'Profil et CV principal',
      'Suivi de 20 candidatures',
      'Score de correspondance',
    ],
    cta: 'Commencer gratuitement',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '12 €',
    period: '/ mois',
    description: 'Pour une recherche active.',
    features: [
      'Candidatures illimitées',
      'CV adapté à chaque offre',
      'Lettres de motivation',
      'Alertes instantanées',
      'Statistiques avancées',
    ],
    cta: 'Essayer Pro',
    highlighted: true,
  },
];

export function PricingSection() {
  return (
    <Section eyebrow="Tarifs" title="Simple et sans engagement">
      <div className="grid gap-5 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <Card
            key={plan.name}
            className={cn('p-6', plan.highlighted && 'border-primary/40 shadow-md')}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{plan.name}</p>
              {plan.highlighted && <Badge>Recommandé</Badge>}
            </div>
            <p className="mt-3">
              <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
              <span className="text-muted-foreground text-sm">{plan.period}</span>
            </p>
            <p className="text-muted-foreground mt-2 text-sm">{plan.description}</p>

            <ul className="mt-6 space-y-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              className="mt-8 w-full"
              variant={plan.highlighted ? 'default' : 'outline'}
              asChild
            >
              <Link to="/register">{plan.cta}</Link>
            </Button>
          </Card>
        ))}
      </div>
    </Section>
  );
}
