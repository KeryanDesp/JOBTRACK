import type { ApplicationWeeklyPointDto } from '@jobtrack/shared';

interface WeeklyChartProps {
  weeks: ApplicationWeeklyPointDto[];
}

// Instance partagée : `Intl.DateTimeFormat` est coûteux à construire. `timeZone: 'UTC'` parce
// qu'un `weekStart` est un jour calendaire — l'interpréter dans le fuseau du navigateur ferait
// reculer d'un jour à l'ouest de Greenwich (même précaution que `features/applications/lib/format.ts`).
const WEEK_LABEL_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** « 15 sept. » — le lundi de la semaine, tel qu'affiché sous chaque barre. */
function weekLabel(weekStart: string): string {
  return WEEK_LABEL_FORMAT.format(new Date(`${weekStart}T00:00:00Z`));
}

/**
 * Candidatures envoyées par semaine, en barres verticales.
 *
 * Le graphique est `aria-hidden` et doublé d'un tableau réservé aux lecteurs d'écran : une
 * suite de hauteurs n'a aucun sens à l'oral, alors qu'un tableau « semaine / candidatures »
 * se lit exactement. Les deux sont construits à partir de la même liste, donc ils ne peuvent
 * pas diverger.
 *
 * L'échelle part toujours de zéro et se cale sur le maximum de la fenêtre : une semaine à 3
 * candidatures sur un maximum de 12 occupe le quart de la hauteur, jamais la barre entière.
 */
export function WeeklyChart({ weeks }: WeeklyChartProps) {
  const max = Math.max(...weeks.map((week) => week.applied));

  // Toutes les semaines à zéro : une division par `max` donnerait `NaN`, et un graphique de
  // barres vides n'apprend rien. La phrase le dit mieux.
  if (max === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Aucune candidature envoyée sur les {weeks.length} dernières semaines.
      </p>
    );
  }

  return (
    <div>
      <div className="flex h-40 items-end gap-1 sm:gap-2" aria-hidden>
        {weeks.map((week) => (
          <div key={week.weekStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-muted-foreground text-[10px] tabular-nums">{week.applied > 0 ? week.applied : ''}</span>
            {/* `flex-1` pousse la barre vers le bas : les barres s'alignent sur une ligne de
                base commune quelle que soit la hauteur du chiffre au-dessus. */}
            <div className="flex w-full flex-1 items-end">
              <div
                className="bg-primary w-full rounded-t-sm transition-[height]"
                // Minimum de 2 % : une semaine à 1 candidature sur un maximum de 40 donnerait
                // sinon une barre invisible, impossible à distinguer d'une semaine vide.
                style={{ height: `${Math.max(2, (week.applied / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-1 sm:gap-2" aria-hidden>
        {weeks.map((week, index) => (
          <div key={week.weekStart} className="text-muted-foreground min-w-0 flex-1 text-center text-[10px]">
            {/* Une semaine sur deux seulement : douze dates côte à côte se chevauchent sur mobile. */}
            {index % 2 === 0 ? weekLabel(week.weekStart) : ''}
          </div>
        ))}
      </div>

      <table className="sr-only">
        <caption>Candidatures envoyées par semaine</caption>
        <thead>
          <tr>
            <th scope="col">Semaine du</th>
            <th scope="col">Candidatures envoyées</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStart}>
              <th scope="row">{weekLabel(week.weekStart)}</th>
              <td>{week.applied}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
