import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function Section({ id, eyebrow, title, description, children, className }: SectionProps) {
  return (
    <section id={id} className={cn('border-border/60 border-t px-6 py-20 lg:py-28', className)}>
      <div className="mx-auto max-w-5xl">
        {eyebrow && <p className="text-primary mb-3 text-sm font-medium">{eyebrow}</p>}
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground mt-4 max-w-2xl text-base">{description}</p>
        )}
        {children && <div className="mt-12">{children}</div>}
      </div>
    </section>
  );
}
