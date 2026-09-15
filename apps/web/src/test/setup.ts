import '@testing-library/jest-dom/vitest';

/**
 * L'environnement jsdom de vitest ne recopie pas `localStorage` /
 * `sessionStorage` sur les globals (limitation connue : ces clés sont
 * absentes de la liste qu'il propage depuis la fenêtre jsdom interne), alors
 * que jsdom les expose bien sur `dom.window`. Sans ce pont, `localStorage`
 * global vaudrait `undefined` dans les tests. On relie donc les deux ici,
 * une fois pour toute la suite.
 */
interface GlobalWithJsdom {
  jsdom?: { window: Window };
}

const jsdomWindow = (globalThis as unknown as GlobalWithJsdom).jsdom?.window;
if (jsdomWindow) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: jsdomWindow.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: jsdomWindow.sessionStorage,
    configurable: true,
  });
}

/**
 * jsdom n'implémente pas `ResizeObserver`, `PointerEvent`, ni les méthodes de
 * capture de pointeur sur `Element` — trois API que Radix UI (utilisé par
 * `DropdownMenu`) consulte pour positionner son contenu et réagir aux
 * interactions pointeur. Sans ces stubs, un clic simulé par
 * `@testing-library/user-event` sur un déclencheur Radix reste bloqué
 * indéfiniment. Ce sont des remplacements minimaux, uniquement pour les tests.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    pointerId?: number;
    pointerType?: string;
    width?: number;
    height?: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId;
      this.pointerType = params.pointerType;
      this.width = params.width;
      this.height = params.height;
    }
  }
  globalThis.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

/**
 * Le moteur de sélecteurs CSS de jsdom (nwsapi) résout `:fullscreen` et
 * `:modal` via une chaîne d'appels récursifs (`isModal` rappelle
 * `isFullscreen`, qui retente une correspondance native) sans mémoïsation.
 * Une interaction clavier/pointeur sur un `DropdownMenu` Radix — qui
 * `.focus()` de nombreux nœuds lors de l'ouverture — déclenche cette chaîne
 * pour chaque nœud, et son coût explose avec la taille du sous-arbre porté
 * par le Portal (mesuré : plusieurs dizaines de millions d'appels à
 * `matches()`, plus de 8 secondes, pour un seul clic). Aucun élément de
 * l'application n'utilise l'API Fullscreen ni `<dialog>` en mode modal, donc
 * ces deux pseudo-classes peuvent être court-circuitées à `false` sans
 * changer le comportement observable des tests.
 */
const originalMatches = Object.getOwnPropertyDescriptor(Element.prototype, 'matches')?.value as (
  this: Element,
  selector: string,
) => boolean;

Element.prototype.matches = function (this: Element, selector: string): boolean {
  if (selector === ':fullscreen' || selector === ':modal') return false;
  return originalMatches.call(this, selector);
};
