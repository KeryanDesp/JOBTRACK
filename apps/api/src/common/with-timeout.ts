/**
 * Fait courir une promesse contre un délai. Au-delà, rejette avec une erreur
 * explicite. Le minuteur est toujours nettoyé : une promesse résolue ne doit
 * pas laisser un timer maintenir la boucle d'événements en vie.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai de ${ms} ms dépassé`)), ms);
  });

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
