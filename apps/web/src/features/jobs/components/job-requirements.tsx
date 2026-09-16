import type { JobRequirementDto } from '@jobtrack/shared';
import { JOB_REQUIREMENT_KIND_LABELS, JOB_REQUIREMENT_KINDS } from '@jobtrack/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface JobRequirementsProps {
  requirements: JobRequirementDto[];
}

/**
 * Formations et langues demandées (spec §2/§7), groupées par nature
 * (`JOB_REQUIREMENT_KINDS` — ordre stable du contrat partagé) avec un
 * marqueur pour celles exigées. Masqué faute de la moindre exigence connue.
 */
export function JobRequirements({ requirements }: JobRequirementsProps) {
  if (requirements.length === 0) return null;

  const groups = JOB_REQUIREMENT_KINDS.map((kind) => ({
    kind,
    label: JOB_REQUIREMENT_KIND_LABELS[kind],
    items: requirements.filter((requirement) => requirement.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Formations et langues demandées</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => (
          <div key={group.kind}>
            <p className="text-sm font-medium">{group.label}</p>
            <ul className="mt-1 space-y-1">
              {group.items.map((item, index) => (
                <li key={`${group.kind}-${index}`} className="text-sm text-muted-foreground">
                  {item.label}
                  {item.required ? ' (exigé)' : ' (souhaité)'}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
