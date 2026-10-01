/**
 * Suggestions des champs « Postes recherchés » et « Catégories recherchées ».
 *
 * Catalogue local et volontairement court : il sert à amorcer la saisie (« informatique »
 * → « Développeur mobile », « Data analyst »…), pas à la contraindre — tout texte libre
 * reste accepté. Pas d'appel réseau : une suggestion doit apparaître à la frappe, même
 * hors connexion.
 */
interface JobCategory {
  /** Libellé proposé dans « Catégories recherchées ». */
  name: string;
  /** Autres façons de désigner la catégorie (comparées sans casse ni accents). */
  aliases: readonly string[];
  titles: readonly string[];
}

export const JOB_CATEGORIES: readonly JobCategory[] = [
  {
    name: 'Informatique',
    aliases: ['it', 'tech', 'numerique', 'digital', 'developpement', 'dev', 'logiciel', 'web'],
    titles: [
      'Développeur web',
      'Développeur front-end',
      'Développeur back-end',
      'Développeur full-stack',
      'Développeur mobile',
      'Développeur iOS',
      'Développeur Android',
      'Ingénieur DevOps',
      'Architecte cloud',
      'Data analyst',
      'Data scientist',
      'Data engineer',
      'Ingénieur cybersécurité',
      'Administrateur systèmes et réseaux',
      'Technicien support informatique',
      'Testeur QA',
      'Chef de projet informatique',
      'Product owner',
    ],
  },
  {
    name: 'Design',
    aliases: ['graphisme', 'ux', 'ui', 'creation'],
    titles: ['UX designer', 'UI designer', 'Product designer', 'Graphiste', 'Directeur artistique', 'Motion designer'],
  },
  {
    name: 'Marketing et communication',
    aliases: ['marketing', 'communication', 'com', 'seo', 'reseaux sociaux'],
    titles: [
      'Chargé de marketing digital',
      'Community manager',
      'Chargé de communication',
      'Responsable marketing',
      'Traffic manager',
      'Content manager',
      'Chargé de référencement SEO',
      'Chef de produit marketing',
    ],
  },
  {
    name: 'Commerce et vente',
    aliases: ['commerce', 'vente', 'commercial', 'business'],
    titles: [
      'Commercial',
      'Business developer',
      'Ingénieur commercial',
      'Account manager',
      'Chargé de clientèle',
      'Responsable des ventes',
      'Conseiller de vente',
    ],
  },
  {
    name: 'Finance et comptabilité',
    aliases: ['finance', 'comptabilite', 'compta', 'banque', 'audit', 'gestion'],
    titles: [
      'Comptable',
      'Assistant comptable',
      'Contrôleur de gestion',
      'Analyste financier',
      'Auditeur',
      'Trésorier',
      'Directeur administratif et financier',
    ],
  },
  {
    name: 'Ressources humaines',
    aliases: ['rh', 'recrutement', 'paie'],
    titles: [
      'Chargé de recrutement',
      'Talent acquisition specialist',
      'Gestionnaire de paie',
      'Chargé de formation',
      'Responsable ressources humaines',
    ],
  },
  {
    name: 'Administration',
    aliases: ['administratif', 'secretariat', 'assistanat', 'accueil'],
    titles: ['Assistant administratif', 'Assistant de direction', 'Office manager', 'Secrétaire', "Chargé d'accueil"],
  },
  {
    name: 'Juridique',
    aliases: ['droit', 'juriste', 'legal'],
    titles: ['Juriste', "Juriste d'affaires", 'Avocat', 'Assistant juridique', 'Paralegal'],
  },
  {
    name: 'Santé',
    aliases: ['sante', 'medical', 'soin', 'paramedical'],
    titles: ['Infirmier', 'Aide-soignant', 'Pharmacien', 'Médecin', 'Kinésithérapeute', 'Secrétaire médical'],
  },
  {
    name: 'Industrie et ingénierie',
    aliases: ['industrie', 'ingenierie', 'production', 'maintenance', 'mecanique'],
    titles: [
      'Ingénieur mécanique',
      'Ingénieur qualité',
      'Ingénieur méthodes',
      'Technicien de maintenance',
      'Responsable de production',
      'Électricien',
    ],
  },
  {
    name: 'BTP',
    aliases: ['batiment', 'construction', 'travaux', 'chantier'],
    titles: ['Conducteur de travaux', 'Chef de chantier', 'Ingénieur travaux', 'Dessinateur projeteur', 'Économiste de la construction'],
  },
  {
    name: 'Logistique et transport',
    aliases: ['logistique', 'transport', 'supply chain', 'entrepot'],
    titles: [
      'Responsable logistique',
      'Supply chain manager',
      'Gestionnaire des approvisionnements',
      'Préparateur de commandes',
      'Chauffeur livreur',
    ],
  },
  {
    name: 'Hôtellerie et restauration',
    aliases: ['hotellerie', 'restauration', 'cuisine', 'tourisme'],
    titles: ['Serveur', 'Chef de rang', 'Cuisinier', 'Commis de cuisine', 'Réceptionniste'],
  },
  {
    name: 'Enseignement et formation',
    aliases: ['enseignement', 'formation', 'education', 'professeur'],
    titles: ['Professeur', 'Formateur', 'Animateur', 'Conseiller pédagogique'],
  },
];

/** Nombre maximal de suggestions affichées sous un champ. */
export const MAX_SUGGESTIONS = 8;

/** Minuscules et sans accents : « Développeur » se trouve en tapant « develop ». */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Le champ est une liste séparée par des virgules : on suggère pour le dernier élément. */
export function splitEntries(raw: string): { done: string[]; current: string } {
  const parts = raw.split(',');
  const current = (parts.pop() ?? '').trim();
  return { done: parts.map((part) => part.trim()).filter((part) => part.length > 0), current };
}

/**
 * Remplace l'élément en cours de saisie par `value`, puis ajoute `, ` pour enchaîner
 * sur l'élément suivant sans retaper de virgule.
 */
export function applySuggestion(raw: string, value: string): string {
  const { done } = splitEntries(raw);
  return `${[...done, value].join(', ')}, `;
}

function matchesCategory(category: JobCategory, query: string): boolean {
  return [category.name, ...category.aliases].some((label) => fold(label).startsWith(query));
}

/** Un mot du libellé commence par la saisie : « mobile » trouve « Développeur mobile ». */
function matchesTitle(title: string, query: string): boolean {
  const folded = fold(title);
  return folded.startsWith(query) || folded.split(/[\s'-]+/).some((word) => word.startsWith(query));
}

function categoriesOf(entries: readonly string[]): JobCategory[] {
  const folded = entries.map(fold);
  return JOB_CATEGORIES.filter(
    (category) =>
      folded.some((entry) => [category.name, ...category.aliases].some((label) => fold(label) === entry)) ||
      category.titles.some((title) => folded.includes(fold(title))),
  );
}

function uniqueExcluding(candidates: readonly string[], taken: readonly string[]): string[] {
  const seen = new Set(taken.map(fold));
  const result: string[] = [];
  for (const candidate of candidates) {
    const key = fold(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length === MAX_SUGGESTIONS) break;
  }
  return result;
}

/**
 * Postes à suggérer pour la saisie `raw` du champ « Postes recherchés ».
 *
 * - Élément en cours non vide : les métiers d'une catégorie qu'il désigne (« informatique »,
 *   « tech »…), puis ceux dont un mot commence par lui (« mobile », « data »).
 * - Élément en cours vide : la suite des catégories déjà en jeu — celles du champ
 *   « Catégories recherchées » et celles des postes déjà choisis —, pour enchaîner les choix.
 */
export function suggestRoles(raw: string, selectedCategories: readonly string[] = []): string[] {
  const { done, current } = splitEntries(raw);
  const query = fold(current);

  if (query.length === 0) {
    const context = categoriesOf([...selectedCategories, ...done]);
    return uniqueExcluding(
      context.flatMap((category) => category.titles),
      done,
    );
  }

  const byCategory = JOB_CATEGORIES.filter((category) => matchesCategory(category, query)).flatMap(
    (category) => category.titles,
  );
  const byTitle = JOB_CATEGORIES.flatMap((category) => category.titles).filter((title) => matchesTitle(title, query));
  // L'élément en cours est exclu aussi : un poste déjà tapé en entier ne se suggère pas lui-même.
  return uniqueExcluding([...byCategory, ...byTitle], [...done, current]);
}

/** Catégories à suggérer pour la saisie `raw` du champ « Catégories recherchées ». */
export function suggestCategories(raw: string): string[] {
  const { done, current } = splitEntries(raw);
  const query = fold(current);
  if (query.length === 0) return [];
  return uniqueExcluding(
    JOB_CATEGORIES.filter((category) => matchesCategory(category, query)).map((category) => category.name),
    [...done, current],
  );
}
