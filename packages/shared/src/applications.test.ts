import { describe, expect, it } from 'vitest';
import {
  APPLICATION_EVENT_TYPES,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
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
  stripControlChars,
  updateApplicationSchema,
} from './applications';

// ---------------------------------------------------------------------------
// createApplicationSchema (union)
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
});

// ---------------------------------------------------------------------------
// Nettoyage des caracteres de controle / bidi
// ---------------------------------------------------------------------------

// `String.fromCodePoint` plutôt qu'un echappement `\u...` litteral dans la
// chaine : un tel echappement peut se retrouver reinterprete en un caractere
// brut une fois ecrit sur disque (y compris l'octet nul lui-meme), ce qui
// rendrait le test aussi peu lisible que les entrees qu'il verifie.
const BELL_CHAR = String.fromCodePoint(7);
const LRM_CHAR = String.fromCodePoint(0x200e);

describe('stripControlChars', () => {
  it('retire les caracteres de controle et les marques bidi', () => {
    expect(stripControlChars(`Developpeur${BELL_CHAR}${LRM_CHAR} Backend`)).toBe('Developpeur Backend');
  });
});

describe('createManualSchema — nettoyage du texte', () => {
  it('retire les caracteres de controle du jobTitle et coupe les espaces', () => {
    const result = createManualSchema.parse({ jobTitle: `  Developpeur${BELL_CHAR} Backend  ` });
    expect(result.jobTitle).toBe('Developpeur Backend');
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
});
