import { describe, expect, it } from 'vitest';
import {
  APPLICATION_EVENT_TYPES,
  APPLICATION_SORT_LABELS,
  APPLICATION_SORT_VALUES,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  APPLICATION_TAB_LABELS,
  APPLICATION_TAB_VALUES,
  APPLICATION_EVENT_LABELS,
  APPLICATION_SOURCE_LABELS,
  APPLICATION_STATUS_LABELS,
  applicationListQuerySchema,
  applicationTabToStatus,
  createApplicationSchema,
  createFromJobSchema,
  createManualSchema,
  httpUrlSchema,
  isCreateFromJob,
  isoDateSchema,
  moveApplicationSchema,
  sanitizeText,
  updateApplicationSchema,
} from './applications';

// ---------------------------------------------------------------------------
// createApplicationSchema (dispatcher)
// ---------------------------------------------------------------------------

describe('createApplicationSchema', () => {
  it('accepte la branche depuis une offre (jobId seul suffit)', () => {
    const result = createApplicationSchema.parse({ jobId: 'job-1' });
    expect(result).toMatchObject({ jobId: 'job-1', status: 'TO_APPLY', usedBaseResume: false });
    expect(isCreateFromJob(result)).toBe(true);
  });

  it('accepte la branche manuelle (jobTitle + source)', () => {
    const result = createApplicationSchema.parse({ jobTitle: 'Analyste', source: 'LINKEDIN' });
    expect(result).toMatchObject({ jobTitle: 'Analyste', source: 'LINKEDIN', status: 'TO_APPLY' });
    expect(isCreateFromJob(result)).toBe(false);
  });

  it('rejette une entree qui ne correspond a aucune des deux branches', () => {
    expect(createApplicationSchema.safeParse({}).success).toBe(false);
  });

  it('rejette la branche manuelle sans jobTitle', () => {
    expect(createManualSchema.safeParse({ source: 'OTHER' }).success).toBe(false);
  });

  it('rejette un jobTitle vide avec le message obligatoire', () => {
    const result = createManualSchema.safeParse({ jobTitle: '', source: 'OTHER' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'Ce champ est obligatoire.')).toBe(true);
    }
  });

  it('applique le defaut OTHER pour la source manuelle', () => {
    const result = createManualSchema.parse({ jobTitle: 'Analyste' });
    expect(result.source).toBe('OTHER');
  });

  it('rejette une cle inconnue (.strict())', () => {
    expect(createFromJobSchema.safeParse({ jobId: 'job-1', extra: true }).success).toBe(false);
    expect(createManualSchema.safeParse({ jobTitle: 'Analyste', extra: true }).success).toBe(false);
  });

  it('accepte appliedAt sur la creation manuelle', () => {
    const result = createManualSchema.safeParse({ jobTitle: 'Analyste', appliedAt: '2026-01-15' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.appliedAt).toBe('2026-01-15');
  });

  it('sans jobId, rapporte l_erreur de la branche manuelle sur le bon champ (dispatcher)', () => {
    const result = createApplicationSchema.safeParse({ source: 'LINKEDIN' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const jobTitleIssue = result.error.issues.find((issue) => issue.path.join('.') === 'jobTitle');
      expect(jobTitleIssue?.message).toBe('Ce champ est obligatoire.');
    }
  });
});

// ---------------------------------------------------------------------------
// httpUrlSchema
// ---------------------------------------------------------------------------

describe('httpUrlSchema', () => {
  it('rejette une URL javascript:', () => {
    expect(httpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('accepte une URL http://', () => {
    expect(httpUrlSchema.parse('http://example.com/offre')).toBe('http://example.com/offre');
  });

  it('accepte une URL https:// et la borne a 500 caracteres', () => {
    expect(httpUrlSchema.safeParse(`https://example.com/${'a'.repeat(600)}`).success).toBe(false);
  });

  it('rejette une URL data: sans lever d_exception (safeParse)', () => {
    const result = httpUrlSchema.safeParse('data:text/plain,hello');
    expect(result.success).toBe(false);
  });

  it('rejette HTTP:// (sans hote, non analysable par new URL()) sans lever d_exception', () => {
    expect(() => httpUrlSchema.safeParse('HTTP://')).not.toThrow();
    expect(httpUrlSchema.safeParse('HTTP://').success).toBe(false);
  });

  it('rejette une chaine non analysable par new URL() sans lever d_exception', () => {
    expect(() => httpUrlSchema.safeParse('not a url at all')).not.toThrow();
    expect(httpUrlSchema.safeParse('not a url at all').success).toBe(false);
  });

  it('rejette une URL avec identifiants embarques (user:pass@host)', () => {
    expect(httpUrlSchema.safeParse('https://user:pass@example.com').success).toBe(false);
  });

  it('rejette www.exemple.fr (sans protocole, non analysable par new URL())', () => {
    const result = httpUrlSchema.safeParse('www.exemple.fr');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Nettoyage des caracteres de controle / bidi
// ---------------------------------------------------------------------------

// `String.fromCodePoint` plutôt qu'un echappement `\u...` litteral dans la
// chaine : un tel echappement peut se retrouver reinterprete en un caractere
// brut une fois ecrit sur disque (y compris l'octet nul lui-même), ce qui
// rendrait le test aussi peu lisible que les entrees qu'il verifie.
const BELL_CHAR = String.fromCodePoint(7);
const LRM_CHAR = String.fromCodePoint(0x200e);
const ZERO_WIDTH_SPACE_CHAR = String.fromCodePoint(0x200b);

describe('sanitizeText', () => {
  it('retire les caracteres de controle et les marques bidi', () => {
    expect(sanitizeText(`Developpeur${BELL_CHAR}${LRM_CHAR} Backend`)).toBe('Developpeur Backend');
  });

  it('retire les caracteres de largeur nulle (zero-width)', () => {
    expect(sanitizeText(`Backend${ZERO_WIDTH_SPACE_CHAR}Developer`)).toBe('BackendDeveloper');
  });

  it('remplace une tabulation par un espace', () => {
    expect(sanitizeText('Backend\tDeveloper')).toBe('Backend Developer');
  });

  it('retire le saut de ligne par defaut (mode non multiligne)', () => {
    expect(sanitizeText('Ligne 1\nLigne 2')).toBe('Ligne 1Ligne 2');
  });

  it('conserve les sauts de ligne en mode multiligne', () => {
    expect(sanitizeText('Ligne 1\nLigne 2', { multiline: true })).toBe('Ligne 1\nLigne 2');
  });

  it('normalise CRLF/CR en LF en mode multiligne', () => {
    expect(sanitizeText('Ligne 1\r\nLigne 2\rLigne 3', { multiline: true })).toBe('Ligne 1\nLigne 2\nLigne 3');
  });
});

describe('createManualSchema — nettoyage du texte', () => {
  it('retire les caracteres de controle du jobTitle et coupe les espaces', () => {
    const result = createManualSchema.parse({ jobTitle: `  Developpeur${BELL_CHAR} Backend  ` });
    expect(result.jobTitle).toBe('Developpeur Backend');
  });

  it('conserve les sauts de ligne des notes (champ multiligne)', () => {
    const result = createManualSchema.parse({ jobTitle: 'Analyste', notes: 'Premier paragraphe\n\nDeuxieme' });
    expect(result.notes).toBe('Premier paragraphe\n\nDeuxieme');
  });

  it('retire les caracteres de largeur nulle des notes', () => {
    const result = createManualSchema.parse({
      jobTitle: 'Analyste',
      notes: `Bonne offre${ZERO_WIDTH_SPACE_CHAR}!`,
    });
    expect(result.notes).toBe('Bonne offre!');
  });

  it('transforme company en null quand vide apres nettoyage', () => {
    const result = createManualSchema.parse({ jobTitle: 'Analyste', company: '   ' });
    expect(result.company).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Exclusivite du CV utilise
// ---------------------------------------------------------------------------

describe('exclusivite du CV utilise', () => {
  it('rejette resumeId + usedBaseResume ensemble (creation depuis une offre)', () => {
    const result = createFromJobSchema.safeParse({ jobId: 'job-1', resumeId: 'cv-1', usedBaseResume: true });
    expect(result.success).toBe(false);
  });

  it('rejette resumeId + usedBaseResume ensemble (creation manuelle)', () => {
    const result = createManualSchema.safeParse({
      jobTitle: 'Analyste',
      resumeId: 'cv-1',
      usedBaseResume: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejette resumeId + usedBaseResume ensemble (mise a jour)', () => {
    const result = updateApplicationSchema.safeParse({ resumeId: 'cv-1', usedBaseResume: true });
    expect(result.success).toBe(false);
  });

  it('accepte usedBaseResume seul (sans resumeId)', () => {
    const result = createFromJobSchema.safeParse({ jobId: 'job-1', usedBaseResume: true });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isoDateSchema
// ---------------------------------------------------------------------------

describe('isoDateSchema', () => {
  it('rejette une date calendaire invalide (2026-02-30)', () => {
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('accepte une date calendaire valide', () => {
    expect(isoDateSchema.parse('2026-02-28')).toBe('2026-02-28');
  });

  it('rejette un format qui n_est pas AAAA-MM-JJ', () => {
    expect(isoDateSchema.safeParse('30/02/2026').success).toBe(false);
  });

  it('rejette un mois invalide (2026-13-01)', () => {
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false);
  });

  it('rejette un format non zero-pad (2026-9-1)', () => {
    expect(isoDateSchema.safeParse('2026-9-1').success).toBe(false);
  });

  it('rejette le 29 fevrier d_une annee non bissextile (2023-02-29)', () => {
    expect(isoDateSchema.safeParse('2023-02-29').success).toBe(false);
  });

  it('accepte le 29 fevrier d_une annee bissextile (2024-02-29)', () => {
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true);
  });

  it('accepte une date future', () => {
    expect(isoDateSchema.safeParse('2099-12-31').success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applicationTabToStatus
// ---------------------------------------------------------------------------

describe('applicationTabToStatus', () => {
  it('retourne null pour l_onglet all', () => {
    expect(applicationTabToStatus('all')).toBeNull();
  });

  it('retourne le statut correspondant a chaque autre onglet', () => {
    expect(applicationTabToStatus('to_apply')).toBe('TO_APPLY');
    expect(applicationTabToStatus('applied')).toBe('APPLIED');
    expect(applicationTabToStatus('interview')).toBe('INTERVIEW');
    expect(applicationTabToStatus('offer')).toBe('OFFER');
    expect(applicationTabToStatus('rejected')).toBe('REJECTED');
  });
});

// ---------------------------------------------------------------------------
// updateApplicationSchema
// ---------------------------------------------------------------------------

describe('updateApplicationSchema', () => {
  it('rejette un objet vide (aucune modification)', () => {
    const result = updateApplicationSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'Aucune modification.')).toBe(true);
    }
  });

  it('accepte un seul champ modifie', () => {
    expect(updateApplicationSchema.safeParse({ status: 'INTERVIEW' }).success).toBe(true);
  });

  it('accepte resumeId null (retour au CV adapte retire)', () => {
    expect(updateApplicationSchema.safeParse({ resumeId: null }).success).toBe(true);
  });

  it('accepte usedBaseResume: true seul comme une modification valide', () => {
    expect(updateApplicationSchema.safeParse({ usedBaseResume: true }).success).toBe(true);
  });

  it('rejette { status: undefined } comme une absence de modification', () => {
    const result = updateApplicationSchema.safeParse({ status: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'Aucune modification.')).toBe(true);
    }
  });

  it('transforme company en null quand vide apres nettoyage', () => {
    const result = updateApplicationSchema.safeParse({ company: '  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.company).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// moveApplicationSchema
// ---------------------------------------------------------------------------

describe('moveApplicationSchema', () => {
  it('rejette une position negative', () => {
    expect(moveApplicationSchema.safeParse({ status: 'OFFER', position: -1 }).success).toBe(false);
  });

  it('rejette une position au-dela de la borne haute (500)', () => {
    expect(moveApplicationSchema.safeParse({ status: 'OFFER', position: 501 }).success).toBe(false);
  });

  it('accepte les bornes 0 et 500', () => {
    expect(moveApplicationSchema.safeParse({ status: 'OFFER', position: 0 }).success).toBe(true);
    expect(moveApplicationSchema.safeParse({ status: 'OFFER', position: 500 }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applicationListQuerySchema
// ---------------------------------------------------------------------------

describe('applicationListQuerySchema', () => {
  it('applique tous les defauts sur un objet vide', () => {
    expect(applicationListQuerySchema.parse({})).toEqual({
      tab: 'all',
      q: undefined,
      page: 1,
      limit: 20,
      sort: 'updated_desc',
    });
  });

  it('coerce page et limit depuis des chaines (querystring)', () => {
    const result = applicationListQuerySchema.parse({ page: '3', limit: '5' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(5);
  });

  it('traite une recherche vide comme absente', () => {
    expect(applicationListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('rejette une limite superieure a 50', () => {
    expect(applicationListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it('rejette une page superieure a 500', () => {
    expect(applicationListQuerySchema.safeParse({ page: 501 }).success).toBe(false);
  });

  it('rejette page: true (booleen, jamais coerce en nombre)', () => {
    expect(applicationListQuerySchema.safeParse({ page: true }).success).toBe(false);
  });

  it('rejette page: [] (tableau, jamais coerce en nombre)', () => {
    expect(applicationListQuerySchema.safeParse({ page: [] }).success).toBe(false);
  });

  it('rejette un onglet inconnu', () => {
    expect(applicationListQuerySchema.safeParse({ tab: 'archived' }).success).toBe(false);
  });

  it('accepte chaque valeur de tri', () => {
    for (const sort of APPLICATION_SORT_VALUES) {
      expect(applicationListQuerySchema.safeParse({ sort }).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Libelles complets pour chaque valeur d_enumeration
// ---------------------------------------------------------------------------

describe('libelles francais', () => {
  it('APPLICATION_STATUS_LABELS couvre tous les statuts', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(APPLICATION_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('APPLICATION_SOURCE_LABELS couvre toutes les sources', () => {
    for (const source of APPLICATION_SOURCES) {
      expect(APPLICATION_SOURCE_LABELS[source]).toBeTruthy();
    }
  });

  it('APPLICATION_EVENT_LABELS couvre tous les types d_evenement', () => {
    for (const type of APPLICATION_EVENT_TYPES) {
      expect(APPLICATION_EVENT_LABELS[type]).toBeTruthy();
    }
  });

  it('APPLICATION_TAB_LABELS couvre tous les onglets', () => {
    for (const tab of APPLICATION_TAB_VALUES) {
      expect(APPLICATION_TAB_LABELS[tab]).toBeTruthy();
    }
  });

  it('APPLICATION_SORT_LABELS couvre toutes les valeurs de tri', () => {
    for (const sort of APPLICATION_SORT_VALUES) {
      expect(APPLICATION_SORT_LABELS[sort]).toBeTruthy();
    }
  });
});
