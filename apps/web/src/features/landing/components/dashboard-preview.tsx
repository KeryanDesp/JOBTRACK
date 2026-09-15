import { Card } from '@/components/ui/card';

const STATS = [
  { value: '120', label: 'Offres trouvées' },
  { value: '36', label: 'Candidatures' },
  { value: '9', label: 'Entretiens' },
  { value: '72%', label: 'Match moyen' },
];

const JOBS = [
  { score: '92%', role: 'Développeur Full Stack', company: 'LuxProvide — Luxembourg' },
  { score: '88%', role: 'Business Analyst', company: 'Société Générale — Metz' },
  { score: '81%', role: 'Data Analyst', company: 'ArcelorMittal — Nancy' },
];

export function DashboardPreview() {
  return (
    <Card className="shadow-lg overflow-hidden p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="bg-muted/60 rounded-lg p-3">
            <p className="text-xl font-semibold">{stat.value}</p>
            <p className="text-muted-foreground text-xs">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {JOBS.map((job) => (
          <div
            key={job.role}
            className="border-border flex items-center gap-3 rounded-lg border p-3"
          >
            <span className="text-primary bg-accent rounded-md px-2 py-1 text-xs font-semibold">
              {job.score}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{job.role}</p>
              <p className="text-muted-foreground truncate text-xs">{job.company}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground mt-4 text-center text-[11px]">Exemple illustratif</p>
    </Card>
  );
}
