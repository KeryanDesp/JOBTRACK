import { ArrowDown } from 'lucide-react';
import { Section } from '../components/section';

const STEPS = ['CV Full Stack', 'Analyse de l’offre', 'CV Business Analyst'];

export function ResumeSection() {
  return (
    <Section
      eyebrow="CV adapté"
      title="Un CV adapté à chaque offre"
      description="JobTrack réorganise et reformule vos expériences réelles pour coller à l'offre visée. Rien n'est inventé : ni diplôme, ni entreprise, ni compétence que vous n'avez pas."
    >
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
        {STEPS.map((step, index) => (
          <div key={step} className="flex w-full flex-col items-center gap-3">
            <div
              className={
                index === 1
                  ? 'border-primary/40 bg-accent text-accent-foreground w-full rounded-lg border p-4 text-center text-sm font-medium'
                  : 'border-border w-full rounded-lg border p-4 text-center text-sm font-medium'
              }
            >
              {step}
            </div>
            {index < STEPS.length - 1 && <ArrowDown className="text-muted-foreground size-4" />}
          </div>
        ))}
      </div>
    </Section>
  );
}
