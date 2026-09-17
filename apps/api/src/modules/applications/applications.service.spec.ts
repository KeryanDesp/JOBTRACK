import { randomUUID } from 'node:crypto';
import type {
  ApplicationStatus,
  CreateFromJobInput,
  CreateManualInput,
  UpdateApplicationInput,
} from '@jobtrack/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { ProfileInputsService } from '../matching/profile-inputs.service';
import { ApplicationsBoardService } from './applications-board.service';
import { ApplicationsService } from './applications.service';

const prisma = new PrismaService();
const profileInputs = new ProfileInputsService(prisma);
const board = new ApplicationsBoardService(prisma, profileInputs);
const applications = new ApplicationsService(prisma, profileInputs, board);

// Préfixes propres à CETTE spec, distingués par pid : deux workers vitest ne partagent jamais
// les mêmes lignes, et le nettoyage par préfixe n'atteint jamais celles d'une autre suite
// (`applications.e2e.spec.ts` utilise `E2E-APP-` sans `UNIT`, dans une autre exécution).
const PREFIX = `E2E-APP-UNIT-${process.pid}-`;
const EMAIL_PREFIX = `e2e-app-unit-${process.pid}-`;

/** Jeudi 17/09/2026, 10 h UTC — la semaine courante commence le lundi 14/09/2026. */
const NOW = new Date('2026-09-17T10:00:00.000Z');

/**
 * Jour courant **a Paris** au format `AAAA-MM-JJ` : exactement la valeur que le service pose sur
 * `appliedAt`. Jamais `todayInParis()` — entre minuit et 2 h a Paris,
 * l'UTC est encore la veille, et cette suite echouerait une nuit sur douze.
 */
function todayInParis(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function cleanup(): Promise<void> {
  await prisma.application.deleteMany({ where: { jobTitle: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await prisma.job.deleteMany({ where: { fingerprint: { startsWith: PREFIX } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${EMAIL_PREFIX}${randomUUID()}@jobtrack.local` },
  });
  return user.id;
}

async function createJob(
  overrides: {
    title?: string;
    company?: string | null;
    locationLabel?: string | null;
    salaryLabel?: string | null;
    salaryMinAnnual?: number | null;
    salaryMaxAnnual?: number | null;
    contractLabel?: string | null;
    applyUrl?: string | null;
    url?: string;
  } = {},
): Promise<string> {
  const externalId = `${PREFIX}${randomUUID()}`;
  const publishedAt = new Date('2026-09-01T00:00:00.000Z');
  const job = await prisma.job.create({
    data: {
      fingerprint: `${PREFIX}${randomUUID()}`,
      title: overrides.title ?? `${PREFIX}Ingenieure logicielle`,
      company: overrides.company === undefined ? 'Solaris Ingénierie' : overrides.company,
      description: 'Description de test.',
      locationLabel: overrides.locationLabel === undefined ? 'Metz (57)' : overrides.locationLabel,
      salaryLabel: overrides.salaryLabel === undefined ? null : overrides.salaryLabel,
      salaryMinAnnual: overrides.salaryMinAnnual === undefined ? null : overrides.salaryMinAnnual,
      salaryMaxAnnual: overrides.salaryMaxAnnual === undefined ? null : overrides.salaryMaxAnnual,
      contractLabel: overrides.contractLabel === undefined ? 'CDI' : overrides.contractLabel,
      publishedAt,
      sources: {
        create: {
          source: 'FRANCE_TRAVAIL',
          externalId,
          url: overrides.url ?? `https://candidat.francetravail.fr/offres/${externalId}`,
          applyUrl: overrides.applyUrl === undefined ? null : overrides.applyUrl,
          publishedAt,
        },
      },
    },
  });
  return job.id;
}

function fromJob(jobId: string, overrides: Partial<CreateFromJobInput> = {}): CreateFromJobInput {
  return { jobId, status: 'TO_APPLY', usedBaseResume: false, ...overrides };
}

function manual(overrides: Partial<CreateManualInput> = {}): CreateManualInput {
  return {
    jobTitle: `${PREFIX}Analyste`,
    source: 'LINKEDIN',
    status: 'TO_APPLY',
    usedBaseResume: false,
    ...overrides,
  };
}

async function createIn(userId: string, status: ApplicationStatus, label: string): Promise<string> {
  const created = await applications.create(userId, manual({ jobTitle: `${PREFIX}${label}`, status }));
  return created.id;
}

/** Positions de la colonne, lues dans l'ordre d'affichage du Kanban. */
async function positionsOf(userId: string, status: ApplicationStatus): Promise<Array<{ id: string; position: number }>> {
  const rows = await prisma.application.findMany({
    where: { userId, status },
    orderBy: { position: 'asc' },
    select: { id: true, position: true },
  });
  return rows;
}

function errorCode(error: unknown): string {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return (response as { code?: string } | undefined)?.code ?? 'AUCUN_CODE';
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'AUCUNE_ERREUR';
  } catch (error) {
    return errorCode(error);
  }
}

describe('ApplicationsService.create — depuis une offre', () => {
  it('fige un instantane complet de l_offre et ecrit l_evenement CREATED', async () => {
    const userId = await createUser();
    const jobId = await createJob({ salaryLabel: 'Selon profil', applyUrl: 'https://exemple.test/postuler' });

    const created = await applications.create(userId, fromJob(jobId));

    expect(created.jobId).toBe(jobId);
    expect(created.jobTitle).toBe(`${PREFIX}Ingenieure logicielle`);
    expect(created.company).toBe('Solaris Ingénierie');
    expect(created.locationLabel).toBe('Metz (57)');
    expect(created.salaryLabel).toBe('Selon profil');
    expect(created.contractLabel).toBe('CDI');
    expect(created.source).toBe('FRANCE_TRAVAIL');
    expect(created.sourceUrl).toBe('https://exemple.test/postuler');
    expect(created.status).toBe('TO_APPLY');
    expect(created.appliedAt).toBeNull();
    expect(created.events).toHaveLength(1);
    expect(created.events[0]?.type).toBe('CREATED');
    expect(created.events[0]?.toStatus).toBe('TO_APPLY');
  });

  it('reconstruit la fourchette de salaire comme les ecrans d_offres quand l_offre n_a pas de libelle', async () => {
    const userId = await createUser();
    const jobId = await createJob({ salaryLabel: null, salaryMinAnnual: 45000, salaryMaxAnnual: 55000 });

    const created = await applications.create(userId, fromJob(jobId));

    expect(created.salaryLabel).toBe('45–55 k€');
  });

  it('garde une borne unique de salaire plutot que de l_effacer', async () => {
    const userId = await createUser();
    const jobId = await createJob({ salaryLabel: null, salaryMinAnnual: 45000, salaryMaxAnnual: null });

    const created = await applications.create(userId, fromJob(jobId));

    expect(created.salaryLabel).toBe('à partir de 45 k€');
  });

  it('laisse le salaire vide quand aucune borne n_est connue', async () => {
    const userId = await createUser();
    const jobId = await createJob({ salaryLabel: null, salaryMinAnnual: null, salaryMaxAnnual: null });

    const created = await applications.create(userId, fromJob(jobId));

    expect(created.salaryLabel).toBeNull();
  });

  it('ignore un lien de candidature non http et retombe sur l_url de la source', async () => {
    const userId = await createUser();
    const jobId = await createJob({ applyUrl: 'javascript:alert(1)', url: 'https://exemple.test/offre-42' });

    const created = await applications.create(userId, fromJob(jobId));

    expect(created.sourceUrl).toBe('https://exemple.test/offre-42');
  });

  it('ignore un lien de candidature a identifiants embarques et retombe sur l_url de la source', async () => {
    const userId = await createUser();
    // « http://banque.example@piege.example/ » : le navigateur visite `piege.example`, mais un
    // lecteur presse ne lit que ce qui precede l_arobase — refuse comme a la saisie (contrat
    // partage `httpUrlSchema`), et non seulement parce qu_il n_est pas en http(s).
    const jobId = await createJob({
      applyUrl: 'http://banque.example@piege.example/',
      url: 'https://exemple.test/offre-77',
    });

    const created = await applications.create(userId, fromJob(jobId));

    expect(created.sourceUrl).toBe('https://exemple.test/offre-77');
  });

  it('retire d_un instantane les caracteres invisibles que seul le contrat partage connait', async () => {
    const userId = await createUser();
    // Controle C1, espace de largeur nulle et BOM : invisibles a l_affichage, absents de
    // l_ancien nettoyage de l_API (qui ne couvrait que la plage C0 et les remplacements bidi).
    const c1 = String.fromCharCode(0x9b);
    const zeroWidth = String.fromCharCode(0x200b);
    const bom = String.fromCharCode(0xfeff);
    const jobId = await createJob({ title: `${PREFIX}Data${c1} Analyst${zeroWidth}`, company: `${bom}Orion` });

    const created = await applications.create(userId, fromJob(jobId));

    expect(created.jobTitle).toBe(`${PREFIX}Data Analyst`);
    expect(created.company).toBe('Orion');
  });

  it('refuse une offre inconnue avec JOB_NOT_FOUND', async () => {
    const userId = await createUser();

    expect(await codeOf(applications.create(userId, fromJob('offre-inexistante')))).toBe('JOB_NOT_FOUND');
  });

  it('refuse une seconde candidature sur la meme offre et designe l_existante', async () => {
    const userId = await createUser();
    const jobId = await createJob();
    const first = await applications.create(userId, fromJob(jobId));

    let details: Record<string, string> | undefined;
    try {
      await applications.create(userId, fromJob(jobId));
    } catch (error) {
      const response = (error as { getResponse: () => { code: string; details?: Record<string, string> } }).getResponse();
      expect(response.code).toBe('APPLICATION_EXISTS');
      details = response.details;
    }
    expect(details?.applicationId).toBe(first.id);
  });
});

describe('ApplicationsService.create — manuelle', () => {
  it('nettoie les caracteres de controle et bidi et coupe les espaces', async () => {
    const nul = String.fromCharCode(0);
    const rlo = String.fromCharCode(0x202e);
    const userId = await createUser();

    const created = await applications.create(
      userId,
      manual({
        jobTitle: `  ${PREFIX}Chef${nul} de projet${rlo}  `,
        company: `Societe${nul} Generale `,
        notes: `Entretien${rlo} prevu`,
      }),
    );

    expect(created.jobTitle).toBe(`${PREFIX}Chef de projet`);
    expect(created.company).toBe('Societe Generale');
    expect(created.notes).toBe('Entretien prevu');
  });

  it('date la candidature du jour des que le statut initial n_est plus « a postuler »', async () => {
    const userId = await createUser();

    const applied = await applications.create(userId, manual({ status: 'APPLIED' }));
    const toApply = await applications.create(userId, manual({ status: 'TO_APPLY' }));

    expect(applied.appliedAt).toBe(todayInParis());
    expect(toApply.appliedAt).toBeNull();
  });

  it('conserve la date fournie plutot que celle du jour', async () => {
    const userId = await createUser();

    const created = await applications.create(userId, manual({ status: 'APPLIED', appliedAt: '2026-09-15' }));

    expect(created.appliedAt).toBe('2026-09-15');
  });

  it('refuse le CV principal et un CV adapte ensemble', async () => {
    const userId = await createUser();

    expect(await codeOf(applications.create(userId, manual({ usedBaseResume: true, resumeId: 'cv-1' })))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('refuse un CV qui n_appartient pas a l_utilisateur', async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const resume = await prisma.resume.create({ data: { userId: otherId, title: `${PREFIX}CV` } });

    expect(await codeOf(applications.create(userId, manual({ resumeId: resume.id })))).toBe('RESUME_NOT_FOUND');
  });

  it('empile les nouvelles cartes en fin de colonne', async () => {
    const userId = await createUser();

    const first = await applications.create(userId, manual({ status: 'APPLIED' }));
    const second = await applications.create(userId, manual({ status: 'APPLIED' }));
    const other = await applications.create(userId, manual({ status: 'INTERVIEW' }));

    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(other.position).toBe(0);
  });
});

describe('ApplicationsService.update', () => {
  it('journalise le changement de statut, date la candidature et l_ajoute en fin de colonne', async () => {
    const userId = await createUser();
    await createIn(userId, 'INTERVIEW', 'deja-en-entretien');
    const id = await createIn(userId, 'TO_APPLY', 'a-postuler');

    const updated = await applications.update(userId, id, { status: 'INTERVIEW' });

    expect(updated.status).toBe('INTERVIEW');
    expect(updated.position).toBe(1);
    expect(updated.appliedAt).toBe(todayInParis());
    const statusEvent = updated.events.find((event) => event.type === 'STATUS_CHANGED');
    expect(statusEvent?.fromStatus).toBe('TO_APPLY');
    expect(statusEvent?.toStatus).toBe('INTERVIEW');
  });

  it('journalise les notes sans jamais en stocker le contenu dans l_historique', async () => {
    const userId = await createUser();
    const id = await createIn(userId, 'APPLIED', 'notes');

    const updated = await applications.update(userId, id, { notes: 'Relancer le recruteur mardi.' });

    expect(updated.notes).toBe('Relancer le recruteur mardi.');
    const noteEvent = updated.events.find((event) => event.type === 'NOTE_UPDATED');
    expect(noteEvent).toBeDefined();
    expect(noteEvent?.note).toBeNull();
  });

  it('bascule sur le CV principal en liberant le CV adapte, avec un evenement RESUME_CHANGED', async () => {
    const userId = await createUser();
    const resume = await prisma.resume.create({ data: { userId, title: `${PREFIX}CV adapte` } });
    const created = await applications.create(userId, manual({ resumeId: resume.id }));

    const updated = await applications.update(userId, created.id, { usedBaseResume: true });

    expect(updated.usedBaseResume).toBe(true);
    expect(updated.resumeId).toBeNull();
    expect(updated.resume).toBeNull();
    expect(updated.events.some((event) => event.type === 'RESUME_CHANGED')).toBe(true);
  });

  it('associe une lettre de motivation et refuse celle d_un autre utilisateur', async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const mine = await prisma.coverLetter.create({ data: { userId, tone: 'PROFESSIONAL', content: {} } });
    const theirs = await prisma.coverLetter.create({ data: { userId: otherId, tone: 'SHORT', content: {} } });
    const id = await createIn(userId, 'APPLIED', 'lettre');

    const updated = await applications.update(userId, id, { coverLetterId: mine.id });
    expect(updated.coverLetterId).toBe(mine.id);
    expect(updated.coverLetter).toEqual({ id: mine.id, tone: 'PROFESSIONAL' });

    expect(await codeOf(applications.update(userId, id, { coverLetterId: theirs.id }))).toBe('LETTER_NOT_FOUND');
  });

  it('renvoie 404 sur la candidature d_un autre utilisateur', async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const id = await createIn(otherId, 'APPLIED', 'autrui');

    const input: UpdateApplicationInput = { status: 'REJECTED' };
    expect(await codeOf(applications.update(userId, id, input))).toBe('APPLICATION_NOT_FOUND');
  });
});

describe('ApplicationsService — positions de colonne', () => {
  it('referme la colonne d_origine quand un changement de statut retire une carte', async () => {
    const userId = await createUser();
    const first = await createIn(userId, 'TO_APPLY', 'a');
    const second = await createIn(userId, 'TO_APPLY', 'b');
    const third = await createIn(userId, 'TO_APPLY', 'c');

    await applications.update(userId, first, { status: 'APPLIED' });

    expect(await positionsOf(userId, 'TO_APPLY')).toEqual([
      { id: second, position: 0 },
      { id: third, position: 1 },
    ]);
  });

  it('referme la colonne quand une carte est supprimee', async () => {
    const userId = await createUser();
    const first = await createIn(userId, 'APPLIED', 'a');
    const second = await createIn(userId, 'APPLIED', 'b');
    const third = await createIn(userId, 'APPLIED', 'c');

    await applications.remove(userId, second);

    expect(await positionsOf(userId, 'APPLIED')).toEqual([
      { id: first, position: 0 },
      { id: third, position: 1 },
    ]);
  });

  it('repare une colonne dont les positions ont des trous et des doublons', async () => {
    const userId = await createUser();
    const first = await createIn(userId, 'OFFER', 'a');
    const second = await createIn(userId, 'OFFER', 'b');
    const third = await createIn(userId, 'OFFER', 'c');
    // Positions incoherentes ecrites directement en base (etat herite d_avant la reindexation
    // ensembliste) : un trou, puis deux cartes a la meme position.
    await prisma.application.update({ where: { id: first }, data: { position: 7 } });
    await prisma.application.update({ where: { id: second }, data: { position: 7 } });
    await prisma.application.update({ where: { id: third }, data: { position: 3 } });

    const changed = await board.reindexColumn(userId, 'OFFER');

    expect(changed).toBe(3);
    expect((await positionsOf(userId, 'OFFER')).map((row) => row.position)).toEqual([0, 1, 2]);
    // L_ordre d_affichage est conserve : a position egale, la plus ancienne reste devant.
    expect(await positionsOf(userId, 'OFFER')).toEqual([
      { id: third, position: 0 },
      { id: first, position: 1 },
      { id: second, position: 2 },
    ]);
  });
});

describe('ApplicationsService.move', () => {
  it('reindexe la colonne 0..n-1 lors d_un deplacement interne', async () => {
    const userId = await createUser();
    const first = await createIn(userId, 'TO_APPLY', 'a');
    const second = await createIn(userId, 'TO_APPLY', 'b');
    const third = await createIn(userId, 'TO_APPLY', 'c');

    await applications.move(userId, third, { status: 'TO_APPLY', position: 0 });

    expect(await positionsOf(userId, 'TO_APPLY')).toEqual([
      { id: third, position: 0 },
      { id: first, position: 1 },
      { id: second, position: 2 },
    ]);
  });

  it('reindexe les deux colonnes lors d_un deplacement entre colonnes et journalise le statut', async () => {
    const userId = await createUser();
    const first = await createIn(userId, 'TO_APPLY', 'a');
    const second = await createIn(userId, 'TO_APPLY', 'b');
    const third = await createIn(userId, 'TO_APPLY', 'c');
    const target = await createIn(userId, 'INTERVIEW', 'cible');

    const moved = await applications.move(userId, second, { status: 'INTERVIEW', position: 0 });

    expect(await positionsOf(userId, 'TO_APPLY')).toEqual([
      { id: first, position: 0 },
      { id: third, position: 1 },
    ]);
    expect(await positionsOf(userId, 'INTERVIEW')).toEqual([
      { id: second, position: 0 },
      { id: target, position: 1 },
    ]);
    expect(moved.appliedAt).toBe(todayInParis());
    const statusEvent = moved.events.find((event) => event.type === 'STATUS_CHANGED');
    expect(statusEvent?.fromStatus).toBe('TO_APPLY');
    expect(statusEvent?.toStatus).toBe('INTERVIEW');
  });

  it('borne une position trop grande a la fin de la colonne cible', async () => {
    const userId = await createUser();
    const first = await createIn(userId, 'OFFER', 'a');
    const second = await createIn(userId, 'TO_APPLY', 'b');

    const moved = await applications.move(userId, second, { status: 'OFFER', position: 42 });

    expect(moved.position).toBe(1);
    expect(await positionsOf(userId, 'OFFER')).toEqual([
      { id: first, position: 0 },
      { id: second, position: 1 },
    ]);
  });

  it('renvoie 404 sur la candidature d_un autre utilisateur', async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const id = await createIn(otherId, 'TO_APPLY', 'autrui');

    expect(await codeOf(applications.move(userId, id, { status: 'OFFER', position: 0 }))).toBe(
      'APPLICATION_NOT_FOUND',
    );
  });
});

describe('ApplicationsService.stats', () => {
  it('compte par statut, la semaine en cours depuis lundi, et le taux d_entretien arrondi', async () => {
    const userId = await createUser();
    await applications.create(userId, manual({ status: 'TO_APPLY' }));
    await applications.create(userId, manual({ status: 'APPLIED', appliedAt: '2026-09-14' }));
    await applications.create(userId, manual({ status: 'APPLIED', appliedAt: '2026-09-13' }));
    await applications.create(userId, manual({ status: 'INTERVIEW', appliedAt: '2026-09-16' }));
    await applications.create(userId, manual({ status: 'REJECTED', appliedAt: '2026-09-01' }));

    const stats = await applications.stats(userId, NOW);

    expect(stats.total).toBe(5);
    expect(stats.byStatus).toEqual({ TO_APPLY: 1, APPLIED: 2, INTERVIEW: 1, OFFER: 0, REJECTED: 1 });
    expect(stats.appliedThisWeek).toBe(2);
    // 1 entretien / 4 candidatures envoyees ou traitees = 0,25.
    expect(stats.interviewRate).toBe(0.25);
  });

  it('renvoie un taux nul quand aucune candidature n_a ete envoyee', async () => {
    const userId = await createUser();
    await applications.create(userId, manual({ status: 'TO_APPLY' }));

    const stats = await applications.stats(userId, NOW);

    expect(stats.interviewRate).toBeNull();
    expect(stats.appliedThisWeek).toBe(0);
  });

  it('arrondit le taux d_entretien a deux decimales', async () => {
    const userId = await createUser();
    await applications.create(userId, manual({ status: 'INTERVIEW' }));
    await applications.create(userId, manual({ status: 'APPLIED' }));
    await applications.create(userId, manual({ status: 'APPLIED' }));

    const stats = await applications.stats(userId, NOW);

    expect(stats.interviewRate).toBe(0.33);
  });
});

describe('ApplicationsService.list et board', () => {
  it('filtre par onglet, cherche sans tenir compte de la casse et pagine', async () => {
    const userId = await createUser();
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Developpeuse Java`, status: 'APPLIED' }));
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Developpeur Python`, status: 'APPLIED' }));
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Product Owner`, status: 'TO_APPLY' }));

    const applied = await applications.list(userId, { tab: 'applied', page: 1, limit: 20, sort: 'updated_desc' });
    expect(applied.total).toBe(2);

    const searched = await applications.list(userId, {
      tab: 'all',
      q: 'DEVELOPPEUSE java',
      page: 1,
      limit: 20,
      sort: 'updated_desc',
    });
    expect(searched.total).toBe(1);
    expect(searched.items[0]?.jobTitle).toBe(`${PREFIX}Developpeuse Java`);

    const paged = await applications.list(userId, { tab: 'all', page: 2, limit: 2, sort: 'updated_desc' });
    expect(paged.total).toBe(3);
    expect(paged.items).toHaveLength(1);
  });

  it('trie par date de candidature en releguant les candidatures sans date', async () => {
    const userId = await createUser();
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Sans date`, status: 'TO_APPLY' }));
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Ancienne`, status: 'APPLIED', appliedAt: '2026-08-01' }));
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Recente`, status: 'APPLIED', appliedAt: '2026-09-10' }));

    const list = await applications.list(userId, { tab: 'all', page: 1, limit: 20, sort: 'applied_desc' });

    expect(list.items.map((item) => item.jobTitle)).toEqual([
      `${PREFIX}Recente`,
      `${PREFIX}Ancienne`,
      `${PREFIX}Sans date`,
    ]);
  });

  it('trie par entreprise de A a Z en releguant les candidatures sans entreprise', async () => {
    const userId = await createUser();
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Sans entreprise`, company: null }));
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Zephyr`, company: 'Zephyr SAS' }));
    await applications.create(userId, manual({ jobTitle: `${PREFIX}Alpha`, company: 'Alpha SARL' }));

    const list = await applications.list(userId, { tab: 'all', page: 1, limit: 20, sort: 'company_asc' });

    expect(list.items.map((item) => item.company)).toEqual(['Alpha SARL', 'Zephyr SAS', null]);
  });

  it('renvoie les cinq colonnes du kanban, triees par position', async () => {
    const userId = await createUser();
    const first = await createIn(userId, 'TO_APPLY', 'a');
    const second = await createIn(userId, 'TO_APPLY', 'b');
    await applications.move(userId, second, { status: 'TO_APPLY', position: 0 });

    const board = await applications.board(userId);

    expect(Object.keys(board.columns)).toEqual(['TO_APPLY', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED']);
    expect(board.columns.TO_APPLY.map((card) => card.id)).toEqual([second, first]);
    expect(board.columns.APPLIED).toEqual([]);
  });
});

describe('ApplicationsService.get et remove', () => {
  it('renvoie la fiche avec ses evenements du plus recent au plus ancien', async () => {
    const userId = await createUser();
    const id = await createIn(userId, 'TO_APPLY', 'historique');
    await applications.update(userId, id, { status: 'APPLIED' });

    const detail = await applications.get(userId, id);

    expect(detail.events.map((event) => event.type)).toEqual(['STATUS_CHANGED', 'CREATED']);
  });

  it('supprime la candidature puis renvoie 404 a la seconde tentative', async () => {
    const userId = await createUser();
    const id = await createIn(userId, 'TO_APPLY', 'suppression');

    await applications.remove(userId, id);

    expect(await codeOf(applications.remove(userId, id))).toBe('APPLICATION_NOT_FOUND');
    expect(await prisma.applicationEvent.count({ where: { applicationId: id } })).toBe(0);
  });
});
