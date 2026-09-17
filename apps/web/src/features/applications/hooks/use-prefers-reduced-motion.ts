import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// `MediaQueryList` unique pour toute l'application : le Kanban monte une carte
// par candidature, et chacune consultait auparavant sa propre requête média.
// `undefined` distingue « pas encore résolu » de « API absente » (`null`).
let mediaQuery: MediaQueryList | null | undefined;

function getMediaQuery(): MediaQueryList | null {
  if (mediaQuery === undefined) {
    // `matchMedia` est absent de jsdom : l'absence de l'API vaut « aucune
    // préférence exprimée » plutôt qu'une exception au premier rendu.
    mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(REDUCED_MOTION_QUERY)
        : null;
  }
  return mediaQuery;
}

function subscribe(onStoreChange: () => void): () => void {
  const query = getMediaQuery();
  if (query === null) return () => undefined;
  query.addEventListener('change', onStoreChange);
  return () => query.removeEventListener('change', onStoreChange);
}

function getSnapshot(): boolean {
  return getMediaQuery()?.matches ?? false;
}

/**
 * `prefers-reduced-motion` (spec §7).
 *
 * La règle globale de `styles/tokens.css` ramène déjà toute
 * `transition-duration`/`animation-duration` CSS à 0,01 ms sous cette
 * préférence, y compris la transition inline posée par `@dnd-kit` sur une
 * carte réordonnée. Elle ne peut en revanche rien contre l'animation de
 * retombée du `DragOverlay`, qui est une Web Animation pilotée en JavaScript :
 * c'est cette valeur qui la désactive (`dropAnimation={null}`), et qui évite
 * au passage de dépendre d'un `!important` global pour la transition de tri.
 */
export function usePrefersReducedMotion(): boolean {
  // Troisième argument (instantané serveur) : aucun rendu côté serveur ici,
  // mais `useSyncExternalStore` l'exige pour rester utilisable en SSR.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
