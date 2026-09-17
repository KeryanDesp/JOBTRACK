const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

interface ExperienceInterval {
  start: number;
  end: number;
}

/** Arrondit `value` au dixième le plus proche (spec §5 : « arrondi au dixième »). */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Années d'expérience totales d'un profil, à partir de ses expériences
 * professionnelles : les intervalles qui se chevauchent (deux postes tenus en
 * même temps, ou un poste qui en recouvre un autre) sont fusionnés pour ne
 * compter le temps qu'une seule fois, `isCurrent` (ou `endDate` absente)
 * prolonge l'intervalle jusqu'à `now`, le résultat est arrondi au dixième
 * d'année (spec §5, « Entrées profil »).
 */
export function computeExperienceYears(
  experiences: readonly { startDate: Date; endDate: Date | null; isCurrent: boolean }[],
  now: Date,
): number {
  if (experiences.length === 0) return 0;

  const nowMs = now.getTime();
  const intervals: ExperienceInterval[] = experiences
    .map((experience) => {
      const rawEnd = experience.isCurrent || experience.endDate === null ? now : experience.endDate;
      // Bornée à `now` : une date de fin future (saisie erronée, horloge
      // décalée) ne doit jamais gonfler l'expérience au-delà d'aujourd'hui.
      const end = Math.min(rawEnd.getTime(), nowMs);
      return { start: experience.startDate.getTime(), end };
    })
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  const merged: ExperienceInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  const totalMs = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
  return roundToTenth(totalMs / MS_PER_YEAR);
}
