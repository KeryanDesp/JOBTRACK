# Tranche 1 — Authentification et Profil — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un utilisateur de créer un compte, de se connecter par mot de passe ou par Google, et de renseigner les sept sections de son profil professionnel, avec une isolation stricte des données entre utilisateurs.

**Architecture:** Sessions opaques en Redis adossées à un cookie `httpOnly`, mots de passe en Argon2id, validation Zod partagée entre le frontend et le backend. Le CRUD des six collections de profil repose sur un service générique unique, instancié par six contrôleurs courts et typés — pas de duplication de logique.

**Tech Stack:** NestJS · Fastify · Prisma · Postgres · Redis · Argon2id · Zod · React · TanStack Query · React Hook Form · Vitest · supertest · Playwright

**Prérequis:** la tranche 0 (`docs/superpowers/plans/2026-09-15-tranche-0-socle.md`) est terminée et sa recette passe.

**Spec de référence:** `docs/superpowers/specs/2026-09-15-socle-auth-profil-design.md`

---

## Cartographie des fichiers

### Backend

| Fichier | Responsabilité |
|---------|----------------|
| `apps/api/prisma/schema.prisma` | Les dix modèles de la tranche |
| `apps/api/prisma/seed.ts` | Compte de démonstration, profil explicitement fictif |
| `apps/api/src/common/zod-validation.pipe.ts` | Validation des payloads par schéma Zod |
| `apps/api/src/common/http-exception.filter.ts` | Format d'erreur unique, message lisible en français |
| `apps/api/src/common/rate-limit.guard.ts` | Limitation de débit adossée à Redis |
| `apps/api/src/common/csrf.guard.ts` | Double-submit sur les mutations authentifiées |
| `apps/api/src/modules/auth/session.service.ts` | Cycle de vie des sessions Redis |
| `apps/api/src/modules/auth/password.service.ts` | Hachage et vérification Argon2id |
| `apps/api/src/modules/auth/auth.service.ts` | Inscription, connexion, réinitialisation |
| `apps/api/src/modules/auth/google.service.ts` | Authorization code flow Google |
| `apps/api/src/modules/auth/auth.guard.ts` | Exige une session valide, injecte l'utilisateur |
| `apps/api/src/modules/profile/profile.service.ts` | Profil et préférences |
| `apps/api/src/modules/profile/collection.service.ts` | **CRUD générique** des six collections |
| `apps/api/src/modules/profile/collections/*.controller.ts` | Six contrôleurs courts, un par collection |

### Frontend

| Fichier | Responsabilité |
|---------|----------------|
| `apps/web/src/services/api/auth.ts`, `profile.ts` | Appels typés |
| `apps/web/src/features/auth/hooks/use-session.ts` | Session courante via TanStack Query |
| `apps/web/src/app/router/protected-route.tsx` | Garde de route |
| `apps/web/src/features/auth/pages/*` | Connexion, inscription, mot de passe oublié, réinitialisation |
| `apps/web/src/features/profile/pages/profile-page.tsx` | Assemble les sept sections |
| `apps/web/src/features/profile/components/collection-section.tsx` | **Section CRUD générique** |
| `apps/web/src/features/settings/pages/settings-page.tsx` | Compte, Sécurité, Apparence |

---

## Task 1: Modèle de données

> **Amendement après exécution.** (1) La CLI Prisma ne lit `.env` que dans `apps/api/` : les scripts racine `db:migrate`, `db:seed`, `db:studio` passent par `dotenv -e .env --` (`dotenv-cli` en devDependency racine). (2) `@types/node` est déclaré dans `apps/api` — sans lui, `prisma/seed.ts` (hors `src/`) perdait les types de `console`/`process` sous ESLint ; le script `lint` de l'API couvre `src prisma`. (3) `argon2` est natif : `pnpm approve-builds argon2` l'ajoute à `allowBuilds` (binaire précompilé disponible pour Node 26, pas de compilation). (4) Vérifier le seed par `psql` plutôt que par `prisma studio` (interactif). Migrations : `20260915182235_auth_and_profile`, puis `20260915183811_date_columns_and_email_lower_index` (revue qualité : `@db.Date` sur les six dates calendaires ; index unique manuel `User_email_lower_key` sur `lower(email)` — Prisma ne l'exprime pas mais ne le supprime pas non plus, vérifié). **Ne jamais ajouter `@@unique([profileId, sortOrder])`** : le réordonnancement par `$transaction` d'`updateMany` collisionnerait à la première permutation.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/seed.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Écrire le schéma**

`apps/api/prisma/schema.prisma` :

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String?
  emailVerifiedAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  profile       Profile?
  oauthAccounts OAuthAccount[]
}

enum OAuthProvider {
  GOOGLE
}

model OAuthAccount {
  id                String        @id @default(cuid())
  userId            String
  provider          OAuthProvider
  providerAccountId String
  createdAt         DateTime      @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Profile {
  id              String   @id @default(cuid())
  userId          String   @unique
  firstName       String
  lastName        String
  phone           String?
  city            String?
  country         String?
  title           String?
  summary         String?
  yearsExperience Int?
  avatarUrl       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  preferences    JobPreferences?
  experiences    Experience[]
  educations     Education[]
  skills         Skill[]
  languages      Language[]
  certifications Certification[]
  projects       Project[]
}

model Experience {
  id          String    @id @default(cuid())
  profileId   String
  company     String
  role        String
  location    String?
  startDate   DateTime  @db.Date
  endDate     DateTime? @db.Date
  isCurrent   Boolean   @default(false)
  description String?
  sortOrder   Int       @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

model Education {
  id          String    @id @default(cuid())
  profileId   String
  school      String
  degree      String
  field       String?
  startDate   DateTime  @db.Date
  endDate     DateTime? @db.Date
  description String?
  sortOrder   Int       @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

enum SkillCategory {
  TECHNICAL
  SOFT
  TOOL
  OTHER
}

enum SkillLevel {
  BEGINNER
  INTERMEDIATE
  ADVANCED
  EXPERT
}

model Skill {
  id        String        @id @default(cuid())
  profileId String
  name      String
  category  SkillCategory @default(TECHNICAL)
  level     SkillLevel    @default(INTERMEDIATE)
  sortOrder Int           @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

enum LanguageLevel {
  A1
  A2
  B1
  B2
  C1
  C2
  NATIVE
}

model Language {
  id        String        @id @default(cuid())
  profileId String
  name      String
  level     LanguageLevel
  sortOrder Int           @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

model Certification {
  id            String    @id @default(cuid())
  profileId     String
  name          String
  issuer        String
  issuedAt      DateTime  @db.Date
  expiresAt     DateTime? @db.Date
  credentialUrl String?
  sortOrder     Int       @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

model Project {
  id           String   @id @default(cuid())
  profileId    String
  name         String
  description  String?
  url          String?
  technologies String[]
  sortOrder    Int      @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

enum RemoteMode {
  ONSITE
  HYBRID
  REMOTE
}

enum ContractType {
  CDI
  CDD
  INTERNSHIP
  APPRENTICESHIP
  FREELANCE
  PART_TIME
}

enum ExperienceLevel {
  STUDENT
  JUNIOR
  MID
  SENIOR
  LEAD
}

model JobPreferences {
  id                String            @id @default(cuid())
  profileId         String            @unique
  desiredRoles      String[]
  desiredCategories String[]
  salaryMin         Int?
  salaryMax         Int?
  currency          String            @default("EUR")
  locations         String[]
  searchRadiusKm    Int               @default(25)
  remoteModes       RemoteMode[]
  contractTypes     ContractType[]
  availability      String?
  experienceLevel   ExperienceLevel?

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Générer la migration**

Run: `pnpm --filter @jobtrack/api exec prisma migrate dev --name auth_and_profile`
Expected: une migration est créée et appliquée ; `Your database is now in sync with your schema`.

- [ ] **Step 3: Écrire le seed**

`apps/api/prisma/seed.ts` — le profil est **explicitement fictif** (spec §55). Aucun document personnel dans le dépôt.

```ts
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('DemoJobTrack2026!', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.user.deleteMany({ where: { email: 'demo@jobtrack.local' } });

  await prisma.user.create({
    data: {
      email: 'demo@jobtrack.local',
      passwordHash,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          firstName: 'Camille',
          lastName: 'Démo',
          title: 'Développeuse Full Stack (profil de démonstration)',
          summary:
            'Profil fictif servant au développement local de JobTrack. Aucune de ces données ne décrit une personne réelle.',
          city: 'Metz',
          country: 'France',
          yearsExperience: 3,
          preferences: {
            create: {
              desiredRoles: ['Développeur Full Stack', 'Business Analyst'],
              desiredCategories: ['Développement', 'Data'],
              salaryMin: 45000,
              salaryMax: 60000,
              locations: ['Metz', 'Nancy', 'Luxembourg'],
              searchRadiusKm: 50,
              remoteModes: ['HYBRID', 'REMOTE'],
              contractTypes: ['CDI'],
              experienceLevel: 'MID',
            },
          },
          experiences: {
            create: [
              {
                company: 'Entreprise Exemple',
                role: 'Développeuse Full Stack',
                location: 'Metz',
                startDate: new Date('2023-09-01'),
                isCurrent: true,
                description: 'Expérience fictive de démonstration.',
                sortOrder: 0,
              },
            ],
          },
          educations: {
            create: [
              {
                school: 'École Exemple',
                degree: 'Master Informatique',
                field: 'Génie logiciel',
                startDate: new Date('2021-09-01'),
                endDate: new Date('2023-06-30'),
                sortOrder: 0,
              },
            ],
          },
          skills: {
            create: [
              { name: 'React', category: 'TECHNICAL', level: 'ADVANCED', sortOrder: 0 },
              { name: 'TypeScript', category: 'TECHNICAL', level: 'ADVANCED', sortOrder: 1 },
              { name: 'PostgreSQL', category: 'TECHNICAL', level: 'INTERMEDIATE', sortOrder: 2 },
            ],
          },
          languages: {
            create: [
              { name: 'Français', level: 'NATIVE', sortOrder: 0 },
              { name: 'Anglais', level: 'C1', sortOrder: 1 },
            ],
          },
        },
      },
    },
  });

  console.log('Seed terminé — compte de démonstration : demo@jobtrack.local');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
```

Ajouter dans `apps/api/package.json` :

```json
{
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "dependencies": { "argon2": "^0.41.0" },
  "devDependencies": { "tsx": "^4.19.0" }
}
```

- [ ] **Step 4: Exécuter et vérifier**

Run: `pnpm install && pnpm db:seed`
Expected: `Seed terminé — compte de démonstration : demo@jobtrack.local`.

Run: `PGPASSWORD=jobtrack psql -h 127.0.0.1 -p 5434 -U jobtrack -d jobtrack -tAc 'select u.email, p."firstName" from "User" u join "Profile" p on p."userId"=u.id'`
Expected: `demo@jobtrack.local|Camille`. Relancer `pnpm db:seed` : idempotent, toujours une seule ligne.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): modele de donnees utilisateur et profil"
```

---

## Task 2: Contrat Zod partagé

> **Amendement après revue (code livré : `fd2605a` + correctif).** Le code ci-dessous est la version initiale ; la revue a imposé, tous reproduits avec zod 3.25 : (1) `optionalNumber(max)` — union `'' | coerce.number` puis `'' → undefined` : sinon un `<input type="number">` vide devenait **0** (`Number('') === 0`). (2) `optionalText(max)` — `'' | blanc → null` (effacer), clé absente **inchangée** (ne jamais mapper `undefined → null`, sinon une clé omise effacerait le champ) ; idem `url`/`credentialUrl`. (3) `experienceSchema` : `startDate ≤ endDate`, et `endDate` forcé à `null` si `isCurrent`. (4) `jobPreferencesSchema` : `salaryMin ≤ salaryMax` ; `searchRadiusKm` vaut 25 même pour `''`. (5) `loginSchema.password.max(128)` — sans borne, argon2 vérifierait une chaîne de 10 Mo. Aucun `z.preprocess` : `z.input` reste typé pour React Hook Form. 26 tests dans `packages/shared`. **Conséquence pour la tâche 11** : `PATCH /profile` doit passer l'objet validé tel quel à Prisma — `null` efface, clé absente n'écrit rien.

> **Amendement.** `packages/shared` compte déjà 8 tests (`env.test.ts`) et exporte `./health` ; les helpers d'environnement utilisent `z.preprocess`, réservé aux schémas d'environnement — les schémas de formulaires ci-dessous n'en utilisent pas, pour préserver `z.input<>` côté React Hook Form.

Ces schémas sont la source de vérité : le backend les utilise pour valider, le frontend pour valider les formulaires. Aucune règle de validation n'est écrite deux fois.

**Files:**
- Create: `packages/shared/src/auth.ts`, `packages/shared/src/profile.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/auth.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/shared/src/auth.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth';

describe('registerSchema', () => {
  const valid = {
    email: 'Keryan@Example.COM',
    password: 'motdepasse-solide-2026',
    firstName: 'Keryan',
    lastName: 'Desplan',
  };

  it('accepte une inscription valide et normalise l_email en minuscules', () => {
    expect(registerSchema.parse(valid).email).toBe('keryan@example.com');
  });

  it('refuse un mot de passe de moins de 12 caracteres', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'court123' }).success).toBe(false);
  });

  it('refuse un email malforme', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'pas-un-email' }).success).toBe(false);
  });

  it('refuse un prenom vide', () => {
    expect(registerSchema.safeParse({ ...valid, firstName: '   ' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('n_impose pas la longueur minimale au mot de passe', () => {
    // Les règles de robustesse s'appliquent à la création, pas à la connexion :
    // un ancien compte doit pouvoir se connecter.
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'x' });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/shared test`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Implémenter les schémas d'authentification**

`packages/shared/src/auth.ts` :

```ts
import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Adresse email invalide.');

const strongPassword = z
  .string()
  .min(12, 'Le mot de passe doit contenir au moins 12 caractères.')
  .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères.');

const name = z
  .string()
  .trim()
  .min(1, 'Ce champ est obligatoire.')
  .max(80, 'Ce champ ne peut pas dépasser 80 caractères.');

export const registerSchema = z.object({
  email,
  password: strongPassword,
  firstName: name,
  lastName: name,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Le mot de passe est obligatoire.'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: strongPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Le mot de passe actuel est obligatoire.'),
  newPassword: strongPassword,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface ActiveSession {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}
```

- [ ] **Step 4: Implémenter les schémas de profil**

`packages/shared/src/profile.ts` :

```ts
import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
// Date calendaire au format AAAA-MM-JJ uniquement : les colonnes sont en @db.Date,
// et accepter un datetime avec fuseau réintroduirait l'ambiguïté « quel minuit ».
const isoDate = z.string().date('Date invalide (AAAA-MM-JJ attendu).');

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
  lastName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
  phone: optionalText(30),
  city: optionalText(80),
  country: optionalText(80),
  title: optionalText(120),
  summary: optionalText(2000),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
});

export const jobPreferencesSchema = z.object({
  desiredRoles: z.array(z.string().trim().min(1)).max(10),
  desiredCategories: z.array(z.string().trim().min(1)).max(10),
  salaryMin: z.coerce.number().int().min(0).max(1_000_000).optional(),
  salaryMax: z.coerce.number().int().min(0).max(1_000_000).optional(),
  currency: z.string().length(3).default('EUR'),
  locations: z.array(z.string().trim().min(1)).max(10),
  searchRadiusKm: z.coerce.number().int().min(0).max(500).default(25),
  remoteModes: z.array(z.enum(['ONSITE', 'HYBRID', 'REMOTE'])),
  contractTypes: z.array(
    z.enum(['CDI', 'CDD', 'INTERNSHIP', 'APPRENTICESHIP', 'FREELANCE', 'PART_TIME']),
  ),
  availability: optionalText(80),
  experienceLevel: z.enum(['STUDENT', 'JUNIOR', 'MID', 'SENIOR', 'LEAD']).optional(),
});

export const experienceSchema = z
  .object({
    company: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    role: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    location: optionalText(120),
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    isCurrent: z.boolean().default(false),
    description: optionalText(2000),
  })
  .refine((value) => value.isCurrent || value.endDate, {
    message: 'Indiquez une date de fin ou cochez « poste actuel ».',
    path: ['endDate'],
  });

export const educationSchema = z.object({
  school: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  degree: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  field: optionalText(120),
  startDate: isoDate,
  endDate: isoDate.optional().nullable(),
  description: optionalText(2000),
});

export const skillSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
  category: z.enum(['TECHNICAL', 'SOFT', 'TOOL', 'OTHER']).default('TECHNICAL'),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).default('INTERMEDIATE'),
});

export const languageSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE']),
});

export const certificationSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  issuer: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  issuedAt: isoDate,
  expiresAt: isoDate.optional().nullable(),
  credentialUrl: z.string().url('URL invalide.').optional().or(z.literal('')),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  description: optionalText(2000),
  url: z.string().url('URL invalide.').optional().or(z.literal('')),
  technologies: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const reorderSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type JobPreferencesInput = z.infer<typeof jobPreferencesSchema>;
export type ExperienceInput = z.infer<typeof experienceSchema>;
export type EducationInput = z.infer<typeof educationSchema>;
export type SkillInput = z.infer<typeof skillSchema>;
export type LanguageInput = z.infer<typeof languageSchema>;
export type CertificationInput = z.infer<typeof certificationSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
```

`packages/shared/src/index.ts` — `./health` existe depuis la tranche 0 :

```ts
export * from './auth';
export * from './env';
export * from './health';
export * from './profile';
```

- [ ] **Step 5: Lancer les tests et construire**

Run: `pnpm --filter @jobtrack/shared test && pnpm --filter @jobtrack/shared build`
Expected: PASS — 13 tests (8 env + 5 auth), et `dist/` régénéré (`index.js`, `index.cjs`, `index.d.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): schemas zod d authentification et de profil"
```

---

## Task 3: Validation et format d'erreur unifié

> **Amendement après revue (code livré : `5485cd7` + correctif).** Le code ci-dessous est la version initiale ; la revue a imposé, tous reproduits : (1) **`ZodValidationPipe<T extends ZodTypeAny>` renvoyant `z.output<T>`** — la signature `ZodSchema<T>` ne compile pas avec les schémas à transformation de la tâche 2 (entrée ≠ sortie) ; les contrôleurs écrivent `new ZodValidationPipe(profileSchema)` et reçoivent la sortie typée. (2) Une erreur levée par **Fastify** (413 corps trop volumineux, 415 type refusé) n'est pas une `HttpException` : le filtre honore son `statusCode` 4xx numérique au lieu d'en faire un 500 journalisé — vérifié avec un corps de 2 Mo. (3) `logger.error(message, stack)` à deux arguments, sinon Nest n'imprime jamais la pile ; 401/403/429 tracés en `warn`. (4) La clé des erreurs globales de formulaire est `form`, pas `_`. 17 tests API. Un JSON malformé donne bien 400 : Nest promeut le `SyntaxError` natif en `BadRequestException`.

> **Amendement.** Le filtre se branche dans `configureApp` (`app.setup.ts`), pas dans `main.ts`. Point d'attention pour l'implémentation : les exceptions **intégrées** de Nest (route inconnue → `NotFoundException` avec `message: "Cannot GET /x"`, corps JSON malformé → `BadRequestException`) n'ont pas de `code` et portent un message en anglais ; le filtre doit leur substituer un message français par statut (404 → « Ressource introuvable. », 400 → « Requête invalide. », 405, 413, 415…) plutôt que d'exposer `exception.message`.

Le cahier des charges interdit d'afficher un code HTTP nu à l'utilisateur. Le filtre écrit ici garantit que toute erreur sortant de l'API porte un message français lisible.

**Files:**
- Create: `apps/api/src/common/zod-validation.pipe.ts`, `apps/api/src/common/http-exception.filter.ts`
- Test: `apps/api/src/common/zod-validation.pipe.spec.ts`
- Modify: `apps/api/src/app.setup.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/common/zod-validation.pipe.spec.ts` :

```ts
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({ email: z.string().email(), age: z.coerce.number().int() });

describe('ZodValidationPipe', () => {
  it('renvoie la valeur transformee quand elle est valide', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ email: 'a@b.com', age: '30' })).toEqual({ email: 'a@b.com', age: 30 });
  });

  it('leve une BadRequest portant un message francais et le detail par champ', () => {
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ email: 'invalide', age: 'x' });
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: Record<string, string>;
      };
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(response.message).toBe('Certains champs sont invalides.');
      expect(response.details.email).toBeDefined();
      expect(response.details.age).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test zod-validation`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le pipe et le filtre**

`apps/api/src/common/zod-validation.pipe.ts` :

```ts
import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const details: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.') || '_';
        details[path] ??= issue.message;
      }

      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Certains champs sont invalides.',
        details,
      });
    }

    return result.data;
  }
}
```

`apps/api/src/common/http-exception.filter.ts` :

```ts
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

interface ErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, string>;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const payload = this.toPayload(exception);

    if (payload.statusCode >= 500) {
      // Le détail technique reste dans les logs ; l'utilisateur reçoit un message neutre.
      this.logger.error(exception);
    }

    void reply.status(payload.statusCode).send(payload);
  }

  private toPayload(exception: unknown): ErrorPayload {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'object' && response !== null && 'code' in response) {
        const body = response as { code: string; message: string; details?: Record<string, string> };
        return { statusCode: status, ...body };
      }

      return {
        statusCode: status,
        code: 'HTTP_ERROR',
        message: typeof response === 'string' ? response : exception.message,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Une erreur est survenue. Veuillez réessayer.',
    };
  }
}
```

- [ ] **Step 4: Brancher le filtre**

Dans `apps/api/src/app.setup.ts`, à la fin de `configureApp`, après `app.setGlobalPrefix('api/v1')` :

```ts
  app.useGlobalFilters(new HttpExceptionFilter());
```

en ajoutant l'import `import { HttpExceptionFilter } from './common/http-exception.filter';`. Le filtre est ainsi actif dans le bootstrap **et** dans les tests e2e, qui appellent la même fonction.

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test`
Expected: PASS — 10 tests au total (8 existants + 2).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): validation zod et format d erreur unifie"
```

---

## Task 4: Service de sessions

> **Amendement.** Redis tourne via Homebrew sur 6379 (pas de `docker compose`). `RedisService` est paresseux depuis la tranche 0 (`lazyConnect: true`, connexion dans `onModuleInit`) : le test instancie le service directement sans appeler `onModuleInit`, ce qui fonctionne car ioredis se connecte à la première commande. Chaque test utilise un `USER_ID` propre pour ne pas entrer en collision avec des sessions réelles. 18 tests API attendus après cette tâche (13 + 5).

Les sessions vivent dans Redis, pas en base : la révocation est alors immédiate et ne coûte pas une écriture Postgres à chaque requête. Ces tests s'exécutent contre le Redis local (Homebrew, 6379).

**Files:**
- Create: `apps/api/src/modules/auth/session.service.ts`
- Test: `apps/api/src/modules/auth/session.service.spec.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/modules/auth/session.service.spec.ts` :

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../../common/redis.service';
import { SessionService } from './session.service';

const redis = new RedisService();
const sessions = new SessionService(redis);
const USER_ID = 'user-de-test';

beforeEach(async () => {
  await sessions.destroyAllForUser(USER_ID);
});

afterAll(async () => {
  await sessions.destroyAllForUser(USER_ID);
  await redis.onModuleDestroy();
});

describe('SessionService', () => {
  it('cree une session lisible et opaque', async () => {
    const id = await sessions.create(USER_ID, { userAgent: 'vitest', ip: '127.0.0.1' });

    expect(id).toHaveLength(43); // 32 octets en base64url
    const data = await sessions.touch(id);
    expect(data?.userId).toBe(USER_ID);
    expect(data?.userAgent).toBe('vitest');
  });

  it('renvoie null pour une session inconnue', async () => {
    expect(await sessions.touch('session-inexistante')).toBeNull();
  });

  it('revoque une session precise', async () => {
    const id = await sessions.create(USER_ID, { userAgent: null, ip: null });
    await sessions.destroy(id, USER_ID);
    expect(await sessions.touch(id)).toBeNull();
  });

  it('liste les sessions actives de l_utilisateur', async () => {
    await sessions.create(USER_ID, { userAgent: 'appareil-a', ip: null });
    await sessions.create(USER_ID, { userAgent: 'appareil-b', ip: null });

    const list = await sessions.list(USER_ID);
    expect(list).toHaveLength(2);
    expect(list.map((item) => item.userAgent).sort()).toEqual(['appareil-a', 'appareil-b']);
  });

  it('revoque toutes les sessions sauf celle indiquee', async () => {
    const kept = await sessions.create(USER_ID, { userAgent: 'gardee', ip: null });
    await sessions.create(USER_ID, { userAgent: 'revoquee', ip: null });

    await sessions.destroyAllForUser(USER_ID, kept);

    const list = await sessions.list(USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(kept);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test session.service`
Expected: FAIL — `Cannot find module './session.service'`.

- [ ] **Step 3: Implémenter le service**

`apps/api/src/modules/auth/session.service.ts` :

```ts
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';

export interface SessionData {
  userId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export type StoredSession = SessionData & { id: string };

/** 30 jours glissants, conformément à la spec. */
const TTL_SECONDS = 60 * 60 * 24 * 30;

@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  private key(id: string): string {
    return `session:${id}`;
  }

  private indexKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  async create(
    userId: string,
    meta: { userAgent: string | null; ip: string | null },
  ): Promise<string> {
    // 32 octets aléatoires : identifiant opaque, aucune donnée utilisateur n'y transite.
    const id = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const data: SessionData = { userId, ...meta, createdAt: now, lastSeenAt: now };

    await this.redis.client
      .multi()
      .set(this.key(id), JSON.stringify(data), 'EX', TTL_SECONDS)
      .sadd(this.indexKey(userId), id)
      .expire(this.indexKey(userId), TTL_SECONDS)
      .exec();

    return id;
  }

  /** Lit la session et prolonge sa durée de vie (session glissante). */
  async touch(id: string): Promise<SessionData | null> {
    const raw = await this.redis.client.get(this.key(id));
    if (!raw) return null;

    const data = JSON.parse(raw) as SessionData;
    const refreshed: SessionData = { ...data, lastSeenAt: new Date().toISOString() };

    await this.redis.client.set(this.key(id), JSON.stringify(refreshed), 'EX', TTL_SECONDS);
    return refreshed;
  }

  async destroy(id: string, userId: string): Promise<void> {
    await this.redis.client.multi().del(this.key(id)).srem(this.indexKey(userId), id).exec();
  }

  async list(userId: string): Promise<StoredSession[]> {
    const ids = await this.redis.client.smembers(this.indexKey(userId));
    if (ids.length === 0) return [];

    const values = await this.redis.client.mget(ids.map((id) => this.key(id)));
    const sessions: StoredSession[] = [];
    const expired: string[] = [];

    ids.forEach((id, index) => {
      const raw = values[index];
      if (raw) {
        sessions.push({ id, ...(JSON.parse(raw) as SessionData) });
      } else {
        expired.push(id);
      }
    });

    // L'index survit au TTL des sessions : on le nettoie au passage.
    if (expired.length > 0) await this.redis.client.srem(this.indexKey(userId), ...expired);

    return sessions;
  }

  async destroyAllForUser(userId: string, exceptId?: string): Promise<void> {
    const ids = await this.redis.client.smembers(this.indexKey(userId));
    const toDelete = ids.filter((id) => id !== exceptId);

    const pipeline = this.redis.client.multi();
    for (const id of toDelete) {
      pipeline.del(this.key(id));
      pipeline.srem(this.indexKey(userId), id);
    }
    await pipeline.exec();
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test session.service`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth
git commit -m "feat(api): service de sessions redis revocables"
```

---

## Task 5: Service de mots de passe

> **Amendement.** Le `DUMMY_HASH` inventé de la version initiale aurait été rejeté par argon2 avant tout calcul : `verify` lève, le `catch` renvoie `false` immédiatement, et `burnTime()` ne brûle aucun temps — l'énumération de comptes par chronométrage restait possible. Le hachage factice est désormais réel, calculé une fois à la première demande. Les options argon2 vivent dans `argon2.options.ts`, importées par le service **et** par le seed. Ajouter un cinquième test : `burnTime()` doit durer au moins autant qu'un `verify` réel (mesurer les deux, tolérance large — l'ordre de grandeur est ~20-60 ms, jamais < 5 ms).

**Files:**
- Create: `apps/api/src/modules/auth/argon2.options.ts`, `apps/api/src/modules/auth/password.service.ts`
- Modify: `apps/api/prisma/seed.ts`
- Test: `apps/api/src/modules/auth/password.service.spec.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/modules/auth/password.service.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

const service = new PasswordService();

describe('PasswordService', () => {
  it('produit un hachage argon2id verifiable', async () => {
    const hash = await service.hash('motdepasse-solide-2026');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await service.verify(hash, 'motdepasse-solide-2026')).toBe(true);
  });

  it('rejette un mauvais mot de passe', async () => {
    const hash = await service.hash('motdepasse-solide-2026');
    expect(await service.verify(hash, 'mauvais-mot-de-passe')).toBe(false);
  });

  it('produit des hachages differents pour un meme mot de passe', async () => {
    const [a, b] = await Promise.all([service.hash('identique-2026'), service.hash('identique-2026')]);
    expect(a).not.toBe(b); // le sel est aléatoire
  });

  it('renvoie false plutot que de lever sur un hachage corrompu', async () => {
    expect(await service.verify('pas-un-hachage', 'peu-importe')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test password.service`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le service**

`apps/api/src/modules/auth/argon2.options.ts` — constante pure, sans décorateur, partagée avec le seed :

```ts
import argon2 from 'argon2';

/** Paramètres recommandés par l'OWASP pour Argon2id. Source unique : le seed les importe aussi. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;
```

`apps/api/src/modules/auth/password.service.ts` :

```ts
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from './argon2.options';

@Injectable()
export class PasswordService {
  /**
   * Hachage factice réel, calculé une seule fois à la première demande.
   * Une chaîne inventée serait rejetée par argon2 avant tout calcul, et
   * burnTime() ne brûlerait alors aucun temps.
   */
  private dummyHash: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Hachage illisible : on refuse plutôt que de propager une erreur 500.
      return false;
    }
  }

  /**
   * Consomme le même temps qu'une vérification réelle.
   * Sans cela, un attaquant distingue « compte inexistant » de « mot de passe faux »
   * en mesurant le temps de réponse.
   */
  async burnTime(): Promise<void> {
    this.dummyHash ??= argon2.hash('mot-de-passe-factice', ARGON2_OPTIONS);
    await argon2.verify(await this.dummyHash, 'autre-mot-de-passe');
  }
}
```

Dans `apps/api/prisma/seed.ts`, remplacer l'objet d'options inliné par `import { ARGON2_OPTIONS } from '../src/modules/auth/argon2.options';` et `argon2.hash('DemoJobTrack2026!', ARGON2_OPTIONS)`.

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test password.service`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth apps/api/prisma/seed.ts
git commit -m "feat(api): hachage argon2id des mots de passe"
```

---

## Task 6: Service d'authentification et garde de session

**Files:**
- Create: `apps/api/src/modules/auth/auth.service.ts`, `auth.guard.ts`
- Create: `apps/api/src/common/decorators/public.decorator.ts`, `current-user.decorator.ts`
- Test: `apps/api/src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/modules/auth/auth.service.spec.ts` :

```ts
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

const prisma = new PrismaService();
const service = new AuthService(prisma, new PasswordService());

const INPUT = {
  email: 'essai@jobtrack.local',
  password: 'motdepasse-solide-2026',
  firstName: 'Essai',
  lastName: 'Utilisateur',
};

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
  await prisma.$disconnect();
});

describe('AuthService', () => {
  it('cree l_utilisateur avec un profil et des preferences vides', async () => {
    const user = await service.register(INPUT);

    expect(user.email).toBe(INPUT.email);
    expect(user.firstName).toBe('Essai');

    const stored = await prisma.user.findUnique({
      where: { email: INPUT.email },
      include: { profile: { include: { preferences: true } } },
    });
    expect(stored?.profile).not.toBeNull();
    expect(stored?.profile?.preferences).not.toBeNull();
    expect(stored?.passwordHash).not.toBe(INPUT.password); // jamais en clair
  });

  it('refuse une inscription sur un email deja pris', async () => {
    await service.register(INPUT);
    await expect(service.register(INPUT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('authentifie avec les bons identifiants', async () => {
    await service.register(INPUT);
    const user = await service.validateCredentials(INPUT.email, INPUT.password);
    expect(user.email).toBe(INPUT.email);
  });

  it('refuse un mauvais mot de passe', async () => {
    await service.register(INPUT);
    await expect(service.validateCredentials(INPUT.email, 'mauvais')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('renvoie la meme erreur pour un compte inexistant', async () => {
    // Le message ne doit jamais révéler si l'email est enregistré.
    await expect(
      service.validateCredentials('inconnu@jobtrack.local', 'peu-importe'),
    ).rejects.toThrowError('Identifiants invalides.');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test auth.service`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le service**

`apps/api/src/modules/auth/auth.service.ts` :

```ts
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { RegisterInput, SessionUser } from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async register(input: RegisterInput): Promise<SessionUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Un compte existe déjà avec cette adresse email.',
      });
    }

    const passwordHash = await this.passwords.hash(input.password);

    // Profil et préférences sont créés vides : l'application ne manipule
    // jamais un utilisateur sans profil.
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        profile: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
            preferences: { create: {} },
          },
        },
      },
      include: { profile: true },
    });

    return this.toSessionUser(user.id, user.email, user.profile?.firstName, user.profile?.lastName);
  }

  async validateCredentials(email: string, password: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!user?.passwordHash) {
      // Compte inexistant, ou compte Google sans mot de passe :
      // même message et même temps de réponse dans les deux cas.
      await this.passwords.burnTime();
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiants invalides.',
      });
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiants invalides.',
      });
    }

    return this.toSessionUser(user.id, user.email, user.profile?.firstName, user.profile?.lastName);
  }

  async findSessionUser(userId: string): Promise<SessionUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) return null;

    return this.toSessionUser(user.id, user.email, user.profile?.firstName, user.profile?.lastName);
  }

  private toSessionUser(
    id: string,
    email: string,
    firstName: string | undefined,
    lastName: string | undefined,
  ): SessionUser {
    return { id, email, firstName: firstName ?? '', lastName: lastName ?? '' };
  }
}
```

- [ ] **Step 4: Écrire les décorateurs et la garde**

`apps/api/src/common/decorators/public.decorator.ts` :

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marque une route accessible sans session (landing, auth, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`apps/api/src/common/decorators/current-user.decorator.ts` :

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '@jobtrack/shared';
import type { AuthenticatedRequest } from '../../modules/auth/auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
```

`apps/api/src/modules/auth/auth.guard.ts` :

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionUser } from '@jobtrack/shared';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

export const SESSION_COOKIE = 'jt_session';

export type AuthenticatedRequest = FastifyRequest & { user: SessionUser; sessionId: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) throw this.unauthorized();

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) throw this.unauthorized();

    const session = await this.sessions.touch(unsigned.value);
    if (!session) throw this.unauthorized();

    const user = await this.auth.findSessionUser(session.userId);
    if (!user) {
      // L'utilisateur a été supprimé : la session ne doit pas survivre.
      await this.sessions.destroy(unsigned.value, session.userId);
      throw this.unauthorized();
    }

    request.user = user;
    request.sessionId = unsigned.value;
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'NOT_AUTHENTICATED',
      message: 'Votre session a expiré. Veuillez vous reconnecter.',
    });
  }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test`
Expected: PASS — 14 tests au total.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): service d authentification et garde de session"
```

---

## Task 7: Protections transverses — débit et CSRF

**Files:**
- Create: `apps/api/src/common/rate-limit.guard.ts`, `apps/api/src/common/csrf.guard.ts`
- Test: `apps/api/src/common/rate-limit.guard.spec.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/common/rate-limit.guard.spec.ts` :

```ts
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service';
import { RATE_LIMIT_KEY, RateLimitGuard, type RateLimitOptions } from './rate-limit.guard';

const redis = new RedisService();

function contextFor(ip: string, body: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, body, routerPath: '/auth/login' }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as Parameters<RateLimitGuard['canActivate']>[0];
}

function guardWith(options: RateLimitOptions): RateLimitGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options);
  return new RateLimitGuard(reflector, redis);
}

beforeEach(async () => {
  const keys = await redis.client.keys('ratelimit:*');
  if (keys.length > 0) await redis.client.del(...keys);
});

afterAll(async () => {
  await redis.onModuleDestroy();
});

describe('RateLimitGuard', () => {
  it('laisse passer sans configuration', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new RateLimitGuard(reflector, redis);

    expect(await guard.canActivate(contextFor('1.1.1.1', {}))).toBe(true);
  });

  it('bloque au-dela de la limite et renvoie un message francais', async () => {
    const guard = guardWith({ limit: 2, windowSeconds: 60, by: 'ip+email' });
    const context = contextFor('2.2.2.2', { email: 'a@b.com' });

    expect(await guard.canActivate(context)).toBe(true);
    expect(await guard.canActivate(context)).toBe(true);

    await expect(guard.canActivate(context)).rejects.toThrowError(HttpException);
    await expect(guard.canActivate(context)).rejects.toThrowError(
      'Trop de tentatives. Réessayez dans quelques minutes.',
    );
  });

  it('compte separement deux adresses ip', async () => {
    const guard = guardWith({ limit: 1, windowSeconds: 60, by: 'ip' });

    expect(await guard.canActivate(contextFor('3.3.3.3', {}))).toBe(true);
    expect(await guard.canActivate(contextFor('4.4.4.4', {}))).toBe(true);
  });

  it('expose la cle de metadonnee attendue par le decorateur', () => {
    expect(RATE_LIMIT_KEY).toBe('rateLimit');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test rate-limit`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter les gardes**

`apps/api/src/common/rate-limit.guard.ts` :

```ts
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { RedisService } from './redis.service';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** `ip+email` protège un compte précis du bourrage d'identifiants. */
  by: 'ip' | 'ip+email';
}

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<
      FastifyRequest & { body?: unknown; routerPath?: string }
    >();

    const key = `ratelimit:${request.routerPath ?? 'inconnu'}:${this.identity(request, options)}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, options.windowSeconds);

    if (count > options.limit) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Trop de tentatives. Réessayez dans quelques minutes.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private identity(
    request: FastifyRequest & { body?: unknown },
    options: RateLimitOptions,
  ): string {
    if (options.by === 'ip') return request.ip;

    const body = request.body;
    const email =
      typeof body === 'object' && body !== null && 'email' in body
        ? String((body as { email: unknown }).email)
        : 'anonyme';

    return `${request.ip}:${email.toLowerCase()}`;
  }
}
```

`apps/api/src/common/csrf.guard.ts` :

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

export const CSRF_COOKIE = 'jt_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Double-submit : le cookie CSRF est lisible en JavaScript, le cookie de session ne l'est pas.
 * Un site tiers peut forcer l'envoi du cookie de session, mais pas lire le cookie CSRF
 * pour en recopier la valeur dans l'en-tête.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!MUTATING.has(request.method)) return true;

    const cookie = request.cookies[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];

    if (!cookie || typeof header !== 'string' || header !== cookie) {
      throw new ForbiddenException({
        code: 'CSRF_MISMATCH',
        message: 'Requête refusée. Rechargez la page et réessayez.',
      });
    }

    return true;
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test`
Expected: PASS — 18 tests au total.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common
git commit -m "feat(api): limitation de debit redis et protection csrf"
```

---

## Task 8: Contrôleur d'authentification et cookies

**Files:**
- Create: `apps/api/src/modules/auth/auth.controller.ts`, `auth.cookies.ts`, `auth.module.ts`
- Test: `apps/api/test/auth.e2e.spec.ts`, `apps/api/vitest.e2e.config.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/main.ts`

- [ ] **Step 1: Écrire l'aide aux cookies**

`apps/api/src/modules/auth/auth.cookies.ts` :

```ts
import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { env } from '../../config/env';
import { CSRF_COOKIE } from '../../common/csrf.guard';
import { SESSION_COOKIE } from './auth.guard';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function setAuthCookies(reply: FastifyReply, sessionId: string): void {
  const secure = env.NODE_ENV === 'production';

  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true, // inaccessible au JavaScript : immunise contre le vol par XSS
    secure,
    sameSite: 'lax',
    signed: true,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });

  // Volontairement lisible en JavaScript : le frontend doit le recopier en en-tête.
  reply.setCookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}
```

- [ ] **Step 2: Écrire le contrôleur**

`apps/api/src/modules/auth/auth.controller.ts` :

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  loginSchema,
  registerSchema,
  type ActiveSession,
  type LoginInput,
  type RegisterInput,
  type SessionUser,
} from '@jobtrack/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/rate-limit.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { clearAuthCookies, setAuthCookies } from './auth.cookies';
import type { AuthenticatedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('register')
  @RateLimit({ limit: 5, windowSeconds: 3600, by: 'ip' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const user = await this.auth.register(body);
    await this.openSession(user.id, request, reply);
    return user;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSeconds: 900, by: 'ip+email' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const user = await this.auth.validateCredentials(body.email, body.password);
    await this.openSession(user.id, request, reply);
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.destroy(request.sessionId, request.user.id);
    clearAuthCookies(reply);
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }

  @Get('sessions')
  async listSessions(@Req() request: AuthenticatedRequest): Promise<ActiveSession[]> {
    const sessions = await this.sessions.list(request.user.id);

    return sessions
      .map((session) => ({
        id: session.id,
        current: session.id === request.sessionId,
        userAgent: session.userAgent,
        ip: session.ip,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const owned = await this.sessions.list(request.user.id);
    if (!owned.some((session) => session.id === id)) {
      // 404 plutôt que 403 : ne pas révéler l'existence d'une session d'autrui.
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Cette session est introuvable.',
      });
    }

    await this.sessions.destroy(id, request.user.id);
  }

  private async openSession(
    userId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const sessionId = await this.sessions.create(userId, {
      userAgent: request.headers['user-agent'] ?? null,
      ip: request.ip,
    });
    setAuthCookies(reply, sessionId);
  }
}
```

`apps/api/src/modules/auth/auth.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService],
  exports: [AuthService, SessionService, PasswordService],
})
export class AuthModule {}
```

- [ ] **Step 3: Brancher les gardes globales**

`apps/api/src/app.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { CsrfGuard } from './common/csrf.guard';
import { RateLimitGuard } from './common/rate-limit.guard';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProfileModule } from './modules/profile/profile.module';

@Module({
  imports: [CommonModule, AuthModule, ProfileModule, HealthModule],
  providers: [
    // L'ordre compte : débit, puis session, puis CSRF.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
```

Marquer `@Public()` sur `HealthController`.

- [ ] **Step 4: Écrire les tests end-to-end**

`apps/api/vitest.e2e.config.ts` :

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
```

`apps/api/test/auth.e2e.spec.ts` :

```ts
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp, createAdapter } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma.service';

let app: NestFastifyApplication;
let prisma: PrismaService;

const USER = {
  email: 'e2e@jobtrack.local',
  password: 'motdepasse-solide-2026',
  firstName: 'E2E',
  lastName: 'Test',
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app); // helmet, cookies, CORS, préfixe, filtre : identique au bootstrap
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@jobtrack.local' } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@jobtrack.local' } } });
  await app.close();
});

function cookiesFrom(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw)];
  return list.map((entry) => entry.split(';')[0]).join('; ');
}

function csrfFrom(cookieHeader: string): string {
  return /jt_csrf=([^;]+)/.exec(cookieHeader)?.[1] ?? '';
}

async function registerUser(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { ...USER, email },
  });
  const cookieHeader = cookiesFrom(response.headers);
  return { response, cookieHeader, csrf: csrfFrom(cookieHeader) };
}

describe('Authentification', () => {
  it('inscrit un utilisateur et pose un cookie de session httpOnly', async () => {
    const { response, cookieHeader } = await registerUser(USER.email);

    expect(response.statusCode).toBe(201);
    expect(response.json<{ email: string }>().email).toBe(USER.email);

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('jt_session=');
    expect(cookieHeader).toContain('jt_csrf=');
  });

  it('ne renvoie jamais le hachage du mot de passe', async () => {
    const { response } = await registerUser(USER.email);
    expect(JSON.stringify(response.json())).not.toContain('argon2');
  });

  it('refuse un email deja pris avec un message lisible', async () => {
    await registerUser(USER.email);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...USER },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json<{ message: string }>().message).toBe(
      'Un compte existe déjà avec cette adresse email.',
    );
  });

  it('refuse un mot de passe trop court avec le detail par champ', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...USER, password: 'court' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details: Record<string, string> }>();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.password).toContain('12 caractères');
  });

  it('refuse l_acces a /auth/me sans session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ message: string }>().message).toBe(
      'Votre session a expiré. Veuillez vous reconnecter.',
    );
  });

  it('donne acces a /auth/me avec une session valide', async () => {
    const { cookieHeader } = await registerUser(USER.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ email: string }>().email).toBe(USER.email);
  });

  it('refuse une mutation authentifiee sans en-tete csrf', async () => {
    const { cookieHeader } = await registerUser(USER.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('CSRF_MISMATCH');
  });

  it('deconnecte et invalide la session', async () => {
    const { cookieHeader, csrf } = await registerUser(USER.email);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(after.statusCode).toBe(401);
  });

  it('bloque apres cinq tentatives de connexion echouees', async () => {
    await registerUser(USER.email);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: USER.email, password: 'mauvais-mot-de-passe' },
      });
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: USER.password },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ message: string }>().message).toBe(
      'Trop de tentatives. Réessayez dans quelques minutes.',
    );
  });
});
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test:e2e`
Expected: PASS — 9 tests.

> Si le test de limitation de débit échoue de façon intermittente, c'est que les clés Redis d'un run précédent subsistent. Ajouter dans `beforeEach` : `await app.get(RedisService).client.del(...await app.get(RedisService).client.keys('ratelimit:*'))`.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): endpoints d authentification, cookies de session et tests e2e"
```

---

## Task 9: Mot de passe oublié et réinitialisation

**Limite assumée de cette tranche :** aucun fournisseur d'email n'est branché. Le lien de réinitialisation est écrit dans les logs du serveur. L'envoi par email arrive avec les notifications (tranche 7). Le reste du flux — génération, expiration, usage unique — est complet et testé.

**Files:**
- Create: `apps/api/src/modules/auth/password-reset.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`, `auth.module.ts`
- Test: `apps/api/src/modules/auth/password-reset.service.spec.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/modules/auth/password-reset.service.spec.ts` :

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { RedisService } from '../../common/redis.service';
import { PasswordResetService } from './password-reset.service';

const redis = new RedisService();
const service = new PasswordResetService(redis);

afterAll(async () => {
  await redis.onModuleDestroy();
});

describe('PasswordResetService', () => {
  it('emet un jeton consommable une seule fois', async () => {
    const token = await service.issue('utilisateur-1');

    expect(await service.consume(token)).toBe('utilisateur-1');
    expect(await service.consume(token)).toBeNull();
  });

  it('renvoie null pour un jeton inconnu', async () => {
    expect(await service.consume('jeton-invente')).toBeNull();
  });

  it('ne stocke jamais le jeton en clair dans redis', async () => {
    const token = await service.issue('utilisateur-2');
    const keys = await redis.client.keys('pwreset:*');

    expect(keys.some((key) => key.includes(token))).toBe(false);
    await service.consume(token);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test password-reset`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le service**

`apps/api/src/modules/auth/password-reset.service.ts` :

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';

const TTL_SECONDS = 60 * 60; // une heure

@Injectable()
export class PasswordResetService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Seule l'empreinte du jeton est stockée : une fuite de Redis
   * ne permet pas de réinitialiser un mot de passe.
   */
  private key(token: string): string {
    return `pwreset:${createHash('sha256').update(token).digest('hex')}`;
  }

  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.client.set(this.key(token), userId, 'EX', TTL_SECONDS);
    return token;
  }

  /** Renvoie l'identifiant utilisateur et invalide le jeton (usage unique). */
  async consume(token: string): Promise<string | null> {
    const key = this.key(token);
    const userId = await this.redis.client.get(key);
    if (!userId) return null;

    await this.redis.client.del(key);
    return userId;
  }
}
```

- [ ] **Step 4: Ajouter les endpoints**

Dans `apps/api/src/modules/auth/auth.controller.ts`, ajouter les imports
`forgotPasswordSchema, resetPasswordSchema, type ForgotPasswordInput, type ResetPasswordInput`
depuis `@jobtrack/shared`, injecter `PasswordResetService`, `PrismaService`, `PasswordService`
et `Logger`, puis ajouter :

Imports à compléter dans ce fichier : `BadRequestException` et `Logger` depuis
`@nestjs/common`, `env` depuis `../../config/env`. Déclarer aussi
`private readonly logger = new Logger(AuthController.name);` dans la classe.

```ts
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ limit: 3, windowSeconds: 3600, by: 'ip+email' })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });

    if (user) {
      const token = await this.passwordReset.issue(user.id);
      // L'envoi par email arrive en tranche 7 ; le lien est journalisé en attendant.
      this.logger.log(`Lien de réinitialisation : ${env.WEB_ORIGIN}/reset-password?token=${token}`);
    }

    // Réponse identique que le compte existe ou non : pas d'énumération d'emails.
    return {
      message: 'Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 5, windowSeconds: 3600, by: 'ip' })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
  ): Promise<void> {
    const userId = await this.passwordReset.consume(body.token);
    if (!userId) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.',
      });
    }

    const passwordHash = await this.passwords.hash(body.password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Un changement de mot de passe invalide toutes les sessions ouvertes.
    await this.sessions.destroyAllForUser(userId);
  }
```

Déclarer `PasswordResetService` dans les `providers` de `auth.module.ts`.

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test && pnpm --filter @jobtrack/api test:e2e`
Expected: PASS — 21 tests unitaires et 9 e2e.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth
git commit -m "feat(api): reinitialisation de mot de passe a usage unique"
```

---

## Task 10: Connexion Google

Le flux est implémenté directement contre les endpoints Google plutôt que via Passport : trois appels HTTP suffisent, et l'intégration Passport avec l'adaptateur Fastify ajoute des frictions sans bénéfice ici.

**Files:**
- Create: `apps/api/src/modules/auth/google.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`, `auth.service.ts`, `auth.module.ts`
- Test: `apps/api/src/modules/auth/google.service.spec.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/modules/auth/google.service.spec.ts` :

```ts
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleService } from './google.service';

const service = new GoogleService();

afterEach(() => vi.unstubAllGlobals());

describe('GoogleService', () => {
  it('construit une url d_autorisation avec le state et les scopes attendus', () => {
    const url = new URL(service.buildAuthUrl('mon-state'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe('mon-state');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('email');
  });

  it('echange le code contre le profil google', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'jeton-acces' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: '1234567890',
            email: 'Personne@Gmail.com',
            given_name: 'Personne',
            family_name: 'Exemple',
          }),
        ),
    );

    const profile = await service.exchangeCode('code-autorisation');

    expect(profile).toEqual({
      providerAccountId: '1234567890',
      email: 'personne@gmail.com',
      firstName: 'Personne',
      lastName: 'Exemple',
    });
  });

  it('refuse un echange rejete par google', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 })),
    );

    await expect(service.exchangeCode('code-perime')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test google.service`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le service**

`apps/api/src/modules/auth/google.service.ts` :

```ts
import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { env } from '../../config/env';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export interface GoogleProfile {
  providerAccountId: string;
  email: string;
  firstName: string;
  lastName: string;
}

@Injectable()
export class GoogleService {
  private credentials(): { clientId: string; clientSecret: string; callbackUrl: string } {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
      throw new InternalServerErrorException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: "La connexion Google n'est pas disponible pour le moment.",
      });
    }

    return {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackUrl: GOOGLE_CALLBACK_URL,
    };
  }

  buildAuthUrl(state: string): string {
    const { clientId, callbackUrl } = this.credentials();
    const url = new URL(AUTH_URL);

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');

    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    const { clientId, clientSecret, callbackUrl } = this.credentials();

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) throw this.rejected();

    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
    if (!accessToken) throw this.rejected();

    const userResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) throw this.rejected();

    const profile = (await userResponse.json()) as {
      sub?: string;
      email?: string;
      given_name?: string;
      family_name?: string;
    };

    if (!profile.sub || !profile.email) throw this.rejected();

    return {
      providerAccountId: profile.sub,
      email: profile.email.toLowerCase(),
      firstName: profile.given_name ?? '',
      lastName: profile.family_name ?? '',
    };
  }

  private rejected(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'GOOGLE_AUTH_FAILED',
      message: 'La connexion Google a échoué. Veuillez réessayer.',
    });
  }
}
```

- [ ] **Step 4: Lier ou créer le compte**

Ajouter dans `apps/api/src/modules/auth/auth.service.ts` :

```ts
  /**
   * Relie le compte Google à un utilisateur existant portant le même email,
   * plutôt que de créer un doublon.
   */
  async findOrCreateFromGoogle(profile: GoogleProfile): Promise<SessionUser> {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: { include: { profile: true } } },
    });

    if (linked) {
      const { user } = linked;
      return this.toSessionUser(user.id, user.email, user.profile?.firstName, user.profile?.lastName);
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { profile: true },
    });

    if (existing) {
      await this.prisma.oAuthAccount.create({
        data: {
          userId: existing.id,
          provider: 'GOOGLE',
          providerAccountId: profile.providerAccountId,
        },
      });
      return this.toSessionUser(
        existing.id,
        existing.email,
        existing.profile?.firstName,
        existing.profile?.lastName,
      );
    }

    const created = await this.prisma.user.create({
      data: {
        email: profile.email,
        emailVerifiedAt: new Date(), // Google a déjà vérifié l'adresse
        oauthAccounts: {
          create: { provider: 'GOOGLE', providerAccountId: profile.providerAccountId },
        },
        profile: {
          create: {
            firstName: profile.firstName,
            lastName: profile.lastName,
            preferences: { create: {} },
          },
        },
      },
      include: { profile: true },
    });

    return this.toSessionUser(
      created.id,
      created.email,
      created.profile?.firstName,
      created.profile?.lastName,
    );
  }
```

en important `import type { GoogleProfile } from './google.service';`.

- [ ] **Step 5: Ajouter les endpoints**

Ajouter aux imports : `Query` depuis `@nestjs/common`, `randomBytes` depuis `node:crypto`, et `GoogleService` — puis injecter `GoogleService` dans le constructeur.

Dans `auth.controller.ts` :

```ts
  @Public()
  @Get('google')
  startGoogle(@Res({ passthrough: true }) reply: FastifyReply): { url: string } {
    // Le state est stocké dans un cookie signé : il garantit que le callback
    // répond bien à une demande partie de ce navigateur (protection CSRF OAuth).
    const state = randomBytes(24).toString('base64url');

    reply.setCookie('jt_oauth_state', state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      signed: true,
      path: '/',
      maxAge: 600,
    });

    return { url: this.google.buildAuthUrl(state) };
  }

  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const stored = request.cookies['jt_oauth_state'];
    const unsigned = stored ? request.unsignCookie(stored) : null;
    reply.clearCookie('jt_oauth_state', { path: '/' });

    if (!code || !state || !unsigned?.valid || unsigned.value !== state) {
      void reply.redirect(`${env.WEB_ORIGIN}/login?error=google`);
      return;
    }

    const profile = await this.google.exchangeCode(code);
    const user = await this.auth.findOrCreateFromGoogle(profile);
    await this.openSession(user.id, request, reply);

    void reply.redirect(`${env.WEB_ORIGIN}/profile`);
  }
```

Déclarer `GoogleService` dans les `providers` de `auth.module.ts`.

- [ ] **Step 6: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test`
Expected: PASS — 24 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth
git commit -m "feat(api): connexion google en authorization code flow"
```

---

## Task 11: Profil et préférences

**Files:**
- Create: `apps/api/src/modules/profile/profile.service.ts`, `profile.controller.ts`, `profile.module.ts`
- Test: `apps/api/test/profile.e2e.spec.ts`

- [ ] **Step 1: Implémenter le service**

`apps/api/src/modules/profile/profile.service.ts` :

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { JobPreferencesInput, ProfileInput } from '@jobtrack/shared';
import type { JobPreferences, Profile } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Résout le profil de l'utilisateur courant. Toute opération sur une
   * ressource de profil part d'ici : c'est ce qui garantit l'isolation.
   */
  async resolveProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: 'PROFILE_NOT_FOUND',
        message: 'Profil introuvable.',
      });
    }

    return profile.id;
  }

  async get(userId: string): Promise<Profile> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException({ code: 'PROFILE_NOT_FOUND', message: 'Profil introuvable.' });
    }
    return profile;
  }

  async update(userId: string, input: ProfileInput): Promise<Profile> {
    return this.prisma.profile.update({ where: { userId }, data: input });
  }

  async getPreferences(userId: string): Promise<JobPreferences> {
    const profileId = await this.resolveProfileId(userId);

    // Créées à l'inscription, mais on reste tolérant à un profil importé.
    return this.prisma.jobPreferences.upsert({
      where: { profileId },
      create: { profileId },
      update: {},
    });
  }

  async updatePreferences(userId: string, input: JobPreferencesInput): Promise<JobPreferences> {
    const profileId = await this.resolveProfileId(userId);

    return this.prisma.jobPreferences.upsert({
      where: { profileId },
      create: { profileId, ...input },
      update: input,
    });
  }
}
```

`apps/api/src/modules/profile/profile.controller.ts` :

```ts
import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  jobPreferencesSchema,
  profileSchema,
  type JobPreferencesInput,
  type ProfileInput,
  type SessionUser,
} from '@jobtrack/shared';
import type { JobPreferences, Profile } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentUser() user: SessionUser): Promise<Profile> {
    return this.profiles.get(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(profileSchema)) body: ProfileInput,
  ): Promise<Profile> {
    return this.profiles.update(user.id, body);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: SessionUser): Promise<JobPreferences> {
    return this.profiles.getPreferences(user.id);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(jobPreferencesSchema)) body: JobPreferencesInput,
  ): Promise<JobPreferences> {
    return this.profiles.updatePreferences(user.id, body);
  }
}
```

- [ ] **Step 2: Écrire le test d'isolation — bloquant**

C'est le test le plus important de la tranche. Sans lui, rien ne fusionne.

`apps/api/test/profile.e2e.spec.ts` :

```ts
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp, createAdapter } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma.service';

let app: NestFastifyApplication;
let prisma: PrismaService;

interface Actor {
  cookie: string;
  csrf: string;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app); // helmet, cookies, CORS, préfixe, filtre : identique au bootstrap
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@isolation.local' } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@isolation.local' } } });
  await app.close();
});

async function signUp(email: string): Promise<Actor> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse-solide-2026', firstName: 'A', lastName: 'B' },
  });

  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw)];
  const header = list.map((entry) => entry.split(';')[0]).join('; ');

  return { cookie: header, csrf: /jt_csrf=([^;]+)/.exec(header)?.[1] ?? '' };
}

describe('Isolation des donnees entre utilisateurs', () => {
  it('ne laisse jamais un utilisateur lire ou modifier l_experience d_un autre', async () => {
    const alice = await signUp('alice@isolation.local');
    const bob = await signUp('bob@isolation.local');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/experiences',
      headers: { cookie: alice.cookie, 'x-csrf-token': alice.csrf },
      payload: {
        company: 'Entreprise Alice',
        role: 'Développeuse',
        startDate: '2024-01-01',
        isCurrent: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const experienceId = created.json<{ id: string }>().id;

    // Bob ne voit pas l'expérience d'Alice.
    const bobList = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/experiences',
      headers: { cookie: bob.cookie },
    });
    expect(bobList.json<unknown[]>()).toHaveLength(0);

    // 404 et non 403 : ne pas révéler que la ressource existe.
    const bobUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/profile/experiences/${experienceId}`,
      headers: { cookie: bob.cookie, 'x-csrf-token': bob.csrf },
      payload: { company: 'Détourné', role: 'Détourné', startDate: '2024-01-01', isCurrent: true },
    });
    expect(bobUpdate.statusCode).toBe(404);

    const bobDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profile/experiences/${experienceId}`,
      headers: { cookie: bob.cookie, 'x-csrf-token': bob.csrf },
    });
    expect(bobDelete.statusCode).toBe(404);

    // L'expérience d'Alice est intacte.
    const aliceList = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/experiences',
      headers: { cookie: alice.cookie },
    });
    expect(aliceList.json<{ company: string }[]>()[0]?.company).toBe('Entreprise Alice');
  });

  it('ne laisse jamais un utilisateur revoquer la session d_un autre', async () => {
    const alice = await signUp('alice@isolation.local');
    const bob = await signUp('bob@isolation.local');

    const aliceSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: alice.cookie },
    });
    const aliceSessionId = aliceSessions.json<{ id: string }[]>()[0]?.id ?? '';

    const attempt = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${aliceSessionId}`,
      headers: { cookie: bob.cookie, 'x-csrf-token': bob.csrf },
    });
    expect(attempt.statusCode).toBe(404);

    // La session d'Alice fonctionne toujours.
    const stillValid = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: alice.cookie },
    });
    expect(stillValid.statusCode).toBe(200);
  });

  it('met a jour le profil de l_utilisateur courant uniquement', async () => {
    const alice = await signUp('alice@isolation.local');
    const bob = await signUp('bob@isolation.local');

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile',
      headers: { cookie: alice.cookie, 'x-csrf-token': alice.csrf },
      payload: { firstName: 'Alice', lastName: 'Modifiée', city: 'Metz' },
    });

    const bobProfile = await app.inject({
      method: 'GET',
      url: '/api/v1/profile',
      headers: { cookie: bob.cookie },
    });
    expect(bobProfile.json<{ firstName: string }>().firstName).toBe('A');
  });
});
```

- [ ] **Step 3: Lancer les tests**

Run: `pnpm --filter @jobtrack/api test:e2e`
Expected: les tests d'isolation échouent tant que la Task 12 n'est pas faite (les routes `/profile/experiences` n'existent pas). Les faire passer est l'objectif de la tâche suivante.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): profil et preferences professionnelles"
```

---

## Task 12: CRUD générique des six collections

Six collections partagent exactement la même logique. Elle est écrite **une seule fois** dans `ProfileCollectionService` ; chaque contrôleur ne fait que déclarer ses routes, son schéma Zod et son délégué Prisma.

Point de sécurité : les écritures passent par `updateMany` / `deleteMany` filtrés sur `profileId`. Le filtre d'appartenance et l'écriture sont alors une seule opération atomique — il n'existe pas de fenêtre entre « vérifier le propriétaire » et « écrire ».

**Files:**
- Create: `apps/api/src/modules/profile/collection.service.ts`
- Create: `apps/api/src/modules/profile/collections/experiences.controller.ts` (+ cinq jumeaux)
- Modify: `apps/api/src/modules/profile/profile.module.ts`

- [ ] **Step 1: Implémenter le service générique**

`apps/api/src/modules/profile/collection.service.ts` :

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ProfileService } from './profile.service';

export interface CollectionRow {
  id: string;
  sortOrder: number;
}

/**
 * Surface minimale commune aux six délégués Prisma concernés.
 * Les délégués générés sont bien plus riches ; on ne décrit que ce qu'on utilise.
 */
export interface CollectionDelegate {
  findMany(args: {
    where: { profileId: string };
    orderBy: { sortOrder: 'asc' };
  }): Promise<CollectionRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<CollectionRow>;
  updateMany(args: {
    where: { id: string; profileId: string };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  deleteMany(args: { where: { id: string; profileId: string } }): Promise<{ count: number }>;
  findFirst(args: { where: { id: string; profileId: string } }): Promise<CollectionRow | null>;
  count(args: { where: { profileId: string } }): Promise<number>;
}

@Injectable()
export class ProfileCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
  ) {}

  async list(delegate: CollectionDelegate, userId: string): Promise<CollectionRow[]> {
    const profileId = await this.profiles.resolveProfileId(userId);
    return delegate.findMany({ where: { profileId }, orderBy: { sortOrder: 'asc' } });
  }

  async create(
    delegate: CollectionDelegate,
    userId: string,
    data: Record<string, unknown>,
  ): Promise<CollectionRow> {
    const profileId = await this.profiles.resolveProfileId(userId);
    const sortOrder = await delegate.count({ where: { profileId } });

    return delegate.create({ data: { ...data, profileId, sortOrder } });
  }

  async update(
    delegate: CollectionDelegate,
    userId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<CollectionRow> {
    const profileId = await this.profiles.resolveProfileId(userId);

    // Le filtre d'appartenance fait partie de l'écriture : pas de fenêtre de course.
    const { count } = await delegate.updateMany({ where: { id, profileId }, data });
    if (count === 0) throw this.notFound();

    const updated = await delegate.findFirst({ where: { id, profileId } });
    if (!updated) throw this.notFound();
    return updated;
  }

  async remove(delegate: CollectionDelegate, userId: string, id: string): Promise<void> {
    const profileId = await this.profiles.resolveProfileId(userId);
    const { count } = await delegate.deleteMany({ where: { id, profileId } });
    if (count === 0) throw this.notFound();
  }

  async reorder(delegate: CollectionDelegate, userId: string, ids: string[]): Promise<void> {
    const profileId = await this.profiles.resolveProfileId(userId);

    await this.prisma.$transaction(
      ids.map((id, index) =>
        delegate.updateMany({ where: { id, profileId }, data: { sortOrder: index } }),
      ),
    );
  }

  /** 404 et jamais 403 : un 403 confirmerait que la ressource existe chez quelqu'un d'autre. */
  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Cet élément est introuvable.',
    });
  }
}
```

- [ ] **Step 2: Écrire le premier contrôleur**

`apps/api/src/modules/profile/collections/experiences.controller.ts` :

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  experienceSchema,
  reorderSchema,
  type ExperienceInput,
  type ReorderInput,
  type SessionUser,
} from '@jobtrack/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../common/prisma.service';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import {
  ProfileCollectionService,
  type CollectionDelegate,
  type CollectionRow,
} from '../collection.service';

@Controller('profile/experiences')
export class ExperiencesController {
  constructor(
    private readonly collections: ProfileCollectionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Le délégué Prisma est structurellement plus large que `CollectionDelegate`.
   * Cette conversion restreint la surface utilisée ; elle n'utilise pas `any`
   * et reste la seule entorse au typage du module.
   */
  private get delegate(): CollectionDelegate {
    return this.prisma.experience as unknown as CollectionDelegate;
  }

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<CollectionRow[]> {
    return this.collections.list(this.delegate, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(experienceSchema)) body: ExperienceInput,
  ): Promise<CollectionRow> {
    return this.collections.create(this.delegate, user.id, body);
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderInput,
  ): Promise<void> {
    return this.collections.reorder(this.delegate, user.id, body.ids);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(experienceSchema)) body: ExperienceInput,
  ): Promise<CollectionRow> {
    return this.collections.update(this.delegate, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<void> {
    return this.collections.remove(this.delegate, user.id, id);
  }
}
```

> **Attention à l'ordre des routes :** `@Patch('reorder')` doit être déclaré **avant** `@Patch(':id')`, sinon `reorder` est interprété comme un identifiant.

- [ ] **Step 3: Décliner les cinq autres contrôleurs**

Copier `experiences.controller.ts` cinq fois dans le même dossier en changeant uniquement les quatre valeurs du tableau. Tout le reste du fichier — méthodes, décorateurs, ordre des routes, accesseur `delegate` — est identique mot pour mot.

| Fichier | Classe | Chemin `@Controller` | Délégué Prisma | Schéma et type Zod |
|---|---|---|---|---|
| `educations.controller.ts` | `EducationsController` | `profile/educations` | `this.prisma.education` | `educationSchema` / `EducationInput` |
| `skills.controller.ts` | `SkillsController` | `profile/skills` | `this.prisma.skill` | `skillSchema` / `SkillInput` |
| `languages.controller.ts` | `LanguagesController` | `profile/languages` | `this.prisma.language` | `languageSchema` / `LanguageInput` |
| `certifications.controller.ts` | `CertificationsController` | `profile/certifications` | `this.prisma.certification` | `certificationSchema` / `CertificationInput` |
| `projects.controller.ts` | `ProjectsController` | `profile/projects` | `this.prisma.project` | `projectSchema` / `ProjectInput` |

- [ ] **Step 4: Déclarer le module**

`apps/api/src/modules/profile/profile.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { ProfileCollectionService } from './collection.service';
import { CertificationsController } from './collections/certifications.controller';
import { EducationsController } from './collections/educations.controller';
import { ExperiencesController } from './collections/experiences.controller';
import { LanguagesController } from './collections/languages.controller';
import { ProjectsController } from './collections/projects.controller';
import { SkillsController } from './collections/skills.controller';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  controllers: [
    ProfileController,
    ExperiencesController,
    EducationsController,
    SkillsController,
    LanguagesController,
    CertificationsController,
    ProjectsController,
  ],
  providers: [ProfileService, ProfileCollectionService],
  exports: [ProfileService],
})
export class ProfileModule {}
```

- [ ] **Step 5: Lancer les tests d'isolation**

Run: `pnpm --filter @jobtrack/api test:e2e`
Expected: PASS — 12 tests, dont les trois tests d'isolation de la Task 11.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/profile
git commit -m "feat(api): crud generique des six collections de profil"
```

---

## Task 13: Couche d'accès frontend et routes protégées

**Files:**
- Modify: `apps/web/src/services/api/client.ts` (en-tête CSRF)
- Create: `apps/web/src/services/api/auth.ts`, `profile.ts`
- Create: `apps/web/src/features/auth/hooks/use-session.ts`
- Create: `apps/web/src/app/router/protected-route.tsx`
- Test: `apps/web/src/services/api/client.test.ts` (cas ajouté)

- [ ] **Step 1: Ajouter le test CSRF au client**

Dans `apps/web/src/services/api/client.test.ts`, ajouter :

```ts
  it('recopie le cookie csrf dans l_en-tete sur une mutation', async () => {
    document.cookie = 'jt_csrf=jeton-csrf-de-test';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/profile', { method: 'PATCH', body: '{}' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('jeton-csrf-de-test');
  });

  it('n_envoie pas d_en-tete csrf sur une lecture', async () => {
    document.cookie = 'jt_csrf=jeton-csrf-de-test';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/profile');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('x-csrf-token')).toBeNull();
  });
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test client`
Expected: FAIL — l'en-tête `x-csrf-token` est absent.

- [ ] **Step 3: Ajouter l'en-tête CSRF au client**

Dans `apps/web/src/services/api/client.ts`, avant l'appel `fetch` :

```ts
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function readCsrfCookie(): string | null {
  return /(?:^|;\s*)jt_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? null;
}
```

puis, juste après la construction existante de `headers` (`new Headers(init.headers)` + `Content-Type` par défaut, en place depuis la tranche 0), ajouter :

```ts
  // Double-submit : le serveur compare cet en-tête au cookie jt_csrf.
  if (MUTATING.has((init.method ?? 'GET').toUpperCase())) {
    const csrf = readCsrfCookie();
    if (csrf) headers.set('x-csrf-token', csrf);
  }
```

- [ ] **Step 4: Écrire les appels typés**

`apps/web/src/services/api/auth.ts` :

```ts
import type {
  ActiveSession,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SessionUser,
} from '@jobtrack/shared';
import { apiRequest } from './client';

export const login = (body: LoginInput) =>
  apiRequest<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(body) });

export const register = (body: RegisterInput) =>
  apiRequest<SessionUser>('/auth/register', { method: 'POST', body: JSON.stringify(body) });

export const logout = () => apiRequest<void>('/auth/logout', { method: 'POST' });

export const fetchMe = () => apiRequest<SessionUser>('/auth/me');

export const forgotPassword = (body: ForgotPasswordInput) =>
  apiRequest<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const resetPassword = (body: ResetPasswordInput) =>
  apiRequest<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) });

export const fetchSessions = () => apiRequest<ActiveSession[]>('/auth/sessions');

export const revokeSession = (id: string) =>
  apiRequest<void>(`/auth/sessions/${id}`, { method: 'DELETE' });

export const startGoogleLogin = () => apiRequest<{ url: string }>('/auth/google');
```

`apps/web/src/services/api/profile.ts` :

```ts
import type { JobPreferencesInput, ProfileInput } from '@jobtrack/shared';
import { apiRequest } from './client';

export interface ProfileDto extends ProfileInput {
  id: string;
  avatarUrl: string | null;
}

export interface PreferencesDto extends JobPreferencesInput {
  id: string;
}

export const fetchProfile = () => apiRequest<ProfileDto>('/profile');

export const updateProfile = (body: ProfileInput) =>
  apiRequest<ProfileDto>('/profile', { method: 'PATCH', body: JSON.stringify(body) });

export const fetchPreferences = () => apiRequest<PreferencesDto>('/profile/preferences');

export const updatePreferences = (body: JobPreferencesInput) =>
  apiRequest<PreferencesDto>('/profile/preferences', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

/** Les six collections partagent la même forme d'API. */
export type CollectionName =
  | 'experiences'
  | 'educations'
  | 'skills'
  | 'languages'
  | 'certifications'
  | 'projects';

export interface CollectionItem {
  id: string;
  sortOrder: number;
  [key: string]: unknown;
}

export const fetchCollection = (name: CollectionName) =>
  apiRequest<CollectionItem[]>(`/profile/${name}`);

export const createItem = (name: CollectionName, body: unknown) =>
  apiRequest<CollectionItem>(`/profile/${name}`, { method: 'POST', body: JSON.stringify(body) });

export const updateItem = (name: CollectionName, id: string, body: unknown) =>
  apiRequest<CollectionItem>(`/profile/${name}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const deleteItem = (name: CollectionName, id: string) =>
  apiRequest<void>(`/profile/${name}/${id}`, { method: 'DELETE' });
```

- [ ] **Step 5: Écrire le hook de session et la garde de route**

`apps/web/src/features/auth/hooks/use-session.ts` :

```ts
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { SessionUser } from '@jobtrack/shared';
import { fetchMe } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';

export const SESSION_QUERY_KEY = ['session'] as const;

export function useSession(): UseQueryResult<SessionUser | null> {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await fetchMe();
      } catch (error) {
        // 401 n'est pas une erreur applicative : c'est « pas connecté ».
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useClearSession(): () => void {
  const queryClient = useQueryClient();
  return () => queryClient.setQueryData(SESSION_QUERY_KEY, null);
}
```

`apps/web/src/app/router/protected-route.tsx` :

```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/features/auth/hooks/use-session';
import { Skeleton } from '@/components/ui/skeleton';

export function ProtectedRoute() {
  const { data: user, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!user) {
    // `from` permet de revenir à la page demandée après connexion.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
```

- [ ] **Step 6: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 19 tests au total.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): couche d acces api, session courante et routes protegees"
```

---

## Task 14: Écrans d'authentification

**Files:**
- Create: `apps/web/src/features/auth/components/auth-layout.tsx`, `google-button.tsx`
- Create: `apps/web/src/features/auth/pages/login-page.tsx`, `register-page.tsx`, `forgot-password-page.tsx`, `reset-password-page.tsx`
- Modify: `apps/web/src/app/router/routes.tsx`
- Test: `apps/web/src/features/auth/pages/login-page.test.tsx`

- [ ] **Step 1: Écrire la coquille et le bouton Google**

`apps/web/src/features/auth/components/auth-layout.tsx` :

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';

interface AuthLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <Link to="/" className="mb-10" aria-label="JobTrack, accueil">
        <Logo />
      </Link>

      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        <div className="mt-8">{children}</div>
        {footer && <div className="text-muted-foreground mt-6 text-center text-sm">{footer}</div>}
      </div>
    </div>
  );
}
```

`apps/web/src/features/auth/components/google-button.tsx` :

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { startGoogleLogin } from '@/services/api/auth';

export function GoogleButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  async function onClick(): Promise<void> {
    setPending(true);
    try {
      const { url } = await startGoogleLogin();
      window.location.href = url;
    } catch {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" className="w-full" onClick={onClick} disabled={pending}>
      {pending ? 'Redirection…' : label}
    </Button>
  );
}
```

- [ ] **Step 2: Écrire le test de la page de connexion**

`apps/web/src/features/auth/pages/login-page.test.tsx` :

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './login-page';

const login = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', () => ({ login, startGoogleLogin: vi.fn() }));

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => login.mockReset());

describe('LoginPage', () => {
  it('refuse un email malforme sans appeler l_api', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'pas-un-email');
    await user.type(screen.getByLabelText('Mot de passe'), 'peu-importe');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Adresse email invalide.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('soumet les identifiants valides', async () => {
    login.mockResolvedValue({ id: '1', email: 'a@b.com', firstName: 'A', lastName: 'B' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'motdepasse-solide-2026');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(login).toHaveBeenCalledWith({ email: 'a@b.com', password: 'motdepasse-solide-2026' });
  });

  it('affiche le message d_erreur renvoye par le serveur', async () => {
    login.mockRejectedValue(new Error('Identifiants invalides.'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'mauvais');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides.');
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test login-page`
Expected: FAIL — module introuvable.

- [ ] **Step 4: Implémenter la page de connexion**

`apps/web/src/features/auth/pages/login-page.tsx` :

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginSchema, type LoginInput } from '@jobtrack/shared';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SESSION_QUERY_KEY } from '@/features/auth/hooks/use-session';
import { login } from '@/services/api/auth';
import { AuthLayout } from '../components/auth-layout';
import { GoogleButton } from '../components/google-button';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/profile', { replace: true });
    },
  });

  return (
    <AuthLayout
      title="Content de vous revoir"
      description="Connectez-vous pour reprendre votre recherche."
      footer={
        <>
          Pas encore de compte ?{' '}
          <Link to="/register" className="text-primary font-medium">
            Créer un compte
          </Link>
        </>
      }
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-4"
      >
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email && (
            <p className="text-destructive text-sm">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Mot de passe</Label>
            <Link to="/forgot-password" className="text-muted-foreground text-xs hover:underline">
              Mot de passe oublié ?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
          />
          {form.formState.errors.password && (
            <p className="text-destructive text-sm">{form.formState.errors.password.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-muted-foreground text-xs">ou</span>
        <Separator className="flex-1" />
      </div>

      <GoogleButton label="Continuer avec Google" />
    </AuthLayout>
  );
}
```

`@hookform/resolvers` (5.x, compatible zod 3.25) est déjà installé depuis la tranche 0 — rien à ajouter.

- [ ] **Step 5: Implémenter les trois autres pages**

`register-page.tsx` reprend exactement la structure de `login-page.tsx` avec ces différences :
`registerSchema` / `RegisterInput` en résolveur ; quatre champs (`firstName`, `lastName`, `email`, `password`) — les deux premiers côte à côte dans une `div` en `grid grid-cols-2 gap-3` ; `register` comme `mutationFn` ; titre « Créer votre compte », description « Quelques secondes suffisent pour commencer. » ; bouton « Créer mon compte » ; redirection vers `/profile` ; pied de page « Déjà un compte ? Se connecter » vers `/login` ; `autoComplete="new-password"` sur le mot de passe ; `GoogleButton` avec le libellé « Continuer avec Google ».

`forgot-password-page.tsx` : `forgotPasswordSchema`, un seul champ email, `mutationFn: forgotPassword`. En cas de succès, remplacer le formulaire par le message renvoyé par le serveur dans une `Alert` — jamais une confirmation qui révélerait l'existence du compte. Titre « Mot de passe oublié », description « Nous vous enverrons un lien de réinitialisation. », bouton « Envoyer le lien », pied de page « Retour à la connexion » vers `/login`.

`reset-password-page.tsx` : lit le jeton avec `useSearchParams().get('token')`. Si le jeton est absent, afficher directement l'`ErrorState` « Ce lien est invalide ou a expiré. » avec une action vers `/forgot-password`. Sinon, `resetPasswordSchema` avec un champ `password` et le jeton injecté à la soumission ; `mutationFn: resetPassword` ; en cas de succès, `navigate('/login', { replace: true })`. Titre « Nouveau mot de passe », bouton « Réinitialiser mon mot de passe ».

- [ ] **Step 6: Câbler les routes**

`apps/web/src/app/router/routes.tsx` :

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { NAV_ITEMS } from '@/constants/navigation';
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page';
import { LandingPage } from '@/features/landing/landing-page';
import { ComingSoonPage } from '@/features/misc/coming-soon-page';
import { NotFoundPage } from '@/features/misc/not-found-page';
import { ProfilePage } from '@/features/profile/pages/profile-page';
import { SettingsPage } from '@/features/settings/pages/settings-page';
import { AppLayout } from '../layouts/app-layout';
import { ProtectedRoute } from './protected-route';

const LIVE_ROUTES = new Set(['/settings']);

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/profile', element: <ProfilePage /> },
          { path: '/settings', element: <SettingsPage /> },
          ...NAV_ITEMS.filter((item) => !LIVE_ROUTES.has(item.to)).map((item) => ({
            path: item.to,
            element: <ComingSoonPage label={item.label} />,
          })),
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
```

Dans `apps/web/src/constants/navigation.ts`, passer l'entrée `/settings` à `available: true` et ajouter une entrée `Mon profil` (`/profile`, icône `User` — à importer depuis `lucide-react` — `available: true`, `primary: false`).

- [ ] **Step 7: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 22 tests au total. Le test des constantes `src/constants/navigation.test.ts` liste les libellés attendus : y ajouter « Mon profil » à la bonne position ; le test de la sidebar et celui des badges « Bientôt » suivent `NAV_ITEMS` automatiquement.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): ecrans de connexion, inscription et reinitialisation"
```

---

## Task 15: Écran de profil

Les six collections partagent un composant unique, `CollectionSection`, qui porte le chargement, l'état vide, l'erreur, le dialogue de création et d'édition et la suppression. Chaque section ne fournit que son schéma, ses champs de formulaire et son résumé de ligne.

**Files:**
- Create: `apps/web/src/features/profile/components/collection-section.tsx`
- Create: `apps/web/src/features/profile/components/personal-info-card.tsx`, `professional-card.tsx`, `preferences-card.tsx`
- Create: `apps/web/src/features/profile/sections/experiences-section.tsx` (+ cinq jumelles)
- Create: `apps/web/src/features/profile/pages/profile-page.tsx`
- Test: `apps/web/src/features/profile/components/collection-section.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/web/src/features/profile/components/collection-section.test.tsx` :

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CollectionSection } from './collection-section';

const fetchCollection = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/profile', () => ({
  fetchCollection,
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const schema = z.object({ name: z.string().min(1) });

function renderSection() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CollectionSection
        name="skills"
        title="Compétences"
        description="Vos compétences techniques."
        emptyLabel="Aucune compétence ajoutée."
        addLabel="Ajouter une compétence"
        schema={schema}
        defaultValues={{ name: '' }}
        renderSummary={(item) => <span>{String(item.name)}</span>}
        renderFields={() => null}
      />
    </QueryClientProvider>,
  );
}

describe('CollectionSection', () => {
  it('affiche l_etat vide quand la collection est vide', async () => {
    fetchCollection.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText('Aucune compétence ajoutée.')).toBeInTheDocument();
  });

  it('affiche les elements existants', async () => {
    fetchCollection.mockResolvedValue([{ id: '1', sortOrder: 0, name: 'React' }]);
    renderSection();

    expect(await screen.findByText('React')).toBeInTheDocument();
  });

  it('affiche un etat d_erreur avec un bouton reessayer', async () => {
    fetchCollection.mockRejectedValue(new Error('Impossible de charger vos compétences.'));
    renderSection();

    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test collection-section`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la section générique**

`apps/web/src/features/profile/components/collection-section.tsx` :

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from 'react-hook-form';
import type { ZodType } from 'zod';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createItem,
  deleteItem,
  fetchCollection,
  updateItem,
  type CollectionItem,
  type CollectionName,
} from '@/services/api/profile';

interface CollectionSectionProps<T extends FieldValues> {
  name: CollectionName;
  title: string;
  description: string;
  emptyLabel: string;
  addLabel: string;
  schema: ZodType<T>;
  defaultValues: DefaultValues<T>;
  renderSummary: (item: CollectionItem) => ReactNode;
  renderFields: (form: UseFormReturn<T>) => ReactNode;
}

export function CollectionSection<T extends FieldValues>({
  name,
  title,
  description,
  emptyLabel,
  addLabel,
  schema,
  defaultValues,
  renderSummary,
  renderFields,
}: CollectionSectionProps<T>) {
  const queryClient = useQueryClient();
  const queryKey = ['profile', name] as const;
  const [editing, setEditing] = useState<CollectionItem | null>(null);
  const [open, setOpen] = useState(false);

  const form = useForm<T>({ resolver: zodResolver(schema), defaultValues });

  const query = useQuery({ queryKey, queryFn: () => fetchCollection(name) });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey });

  const save = useMutation({
    mutationFn: (values: T) =>
      editing ? updateItem(name, editing.id, values) : createItem(name, values),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteItem(name, id),
    onSuccess: invalidate,
  });

  function openDialog(item: CollectionItem | null): void {
    setEditing(item);
    form.reset((item ?? defaultValues) as DefaultValues<T>);
    setOpen(true);
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => openDialog(null)}>
          <Plus className="mr-1.5 size-4" />
          Ajouter
        </Button>
      </div>

      <div className="mt-6">
        {query.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {query.isError && (
          <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        )}

        {query.isSuccess && query.data.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">{emptyLabel}</p>
        )}

        {query.isSuccess && query.data.length > 0 && (
          <ul className="divide-border divide-y">
            {query.data.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0 text-sm">{renderSummary(item)}</div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Modifier"
                    onClick={() => openDialog(item)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Supprimer"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(item.id)}
                  >
                    <Trash2 className="text-destructive size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier' : addLabel}</DialogTitle>
          </DialogHeader>

          <form
            noValidate
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
            className="space-y-4"
          >
            {renderFields(form)}

            {save.isError && <p className="text-destructive text-sm">{save.error.message}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 4: Instancier les six sections**

Chaque fichier de `apps/web/src/features/profile/sections/` exporte un composant sans props qui rend un `<CollectionSection>` avec les valeurs du tableau. `renderFields` compose des `<Label>` et `<Input>` (ou `<Select>` pour les énumérations) reliés par `form.register`, sur le modèle du formulaire de connexion de la Task 14.

| Fichier | `name` | `title` | Schéma | Champs de `renderFields` | `renderSummary` |
|---|---|---|---|---|---|
| `experiences-section.tsx` | `experiences` | Expériences | `experienceSchema` | company, role, location, startDate, endDate, isCurrent (Switch), description (Textarea) | `role` en gras, puis `company` et les dates en `text-muted-foreground` |
| `educations-section.tsx` | `educations` | Formation | `educationSchema` | school, degree, field, startDate, endDate, description | `degree` en gras, puis `school` |
| `skills-section.tsx` | `skills` | Compétences | `skillSchema` | name, category (Select), level (Select) | `name` puis `level` en `Badge` |
| `languages-section.tsx` | `languages` | Langues | `languageSchema` | name, level (Select CECRL) | `name` puis `level` en `Badge` |
| `certifications-section.tsx` | `certifications` | Certifications | `certificationSchema` | name, issuer, issuedAt, expiresAt, credentialUrl | `name` en gras, puis `issuer` |
| `projects-section.tsx` | `projects` | Projets | `projectSchema` | name, description, url, technologies | `name` en gras, puis `description` tronquée |

Les libellés d'état vide sont propres à chaque section : « Aucune expérience ajoutée. », « Aucune formation ajoutée. », « Aucune compétence ajoutée. », « Aucune langue ajoutée. », « Aucune certification ajoutée. », « Aucun projet ajouté. »

- [ ] **Step 5: Écrire les trois cartes de formulaire simple**

`personal-info-card.tsx`, `professional-card.tsx` et `preferences-card.tsx` suivent tous le même patron : `useQuery` sur `fetchProfile` (ou `fetchPreferences`), `useForm` avec `zodResolver(profileSchema)` (ou `jobPreferencesSchema`), `useMutation` sur `updateProfile` (ou `updatePreferences`) qui invalide `['profile']`, et un bouton « Enregistrer » désactivé tant que `!form.formState.isDirty`. Pendant le chargement, trois `<Skeleton>` ; en cas d'erreur, `<ErrorState>`.

- `personal-info-card.tsx` — champs : firstName, lastName, phone, city, country.
- `professional-card.tsx` — champs : title, summary (Textarea), yearsExperience (number).
- `preferences-card.tsx` — champs : desiredRoles et locations (saisie de tags), salaryMin, salaryMax, searchRadiusKm, remoteModes et contractTypes (cases à cocher multiples), experienceLevel (Select).

- [ ] **Step 6: Assembler la page**

`apps/web/src/features/profile/pages/profile-page.tsx` :

```tsx
import { PageHeader } from '@/components/shared/page-header';
import { PersonalInfoCard } from '../components/personal-info-card';
import { PreferencesCard } from '../components/preferences-card';
import { ProfessionalCard } from '../components/professional-card';
import { CertificationsSection } from '../sections/certifications-section';
import { EducationsSection } from '../sections/educations-section';
import { ExperiencesSection } from '../sections/experiences-section';
import { LanguagesSection } from '../sections/languages-section';
import { ProjectsSection } from '../sections/projects-section';
import { SkillsSection } from '../sections/skills-section';

export function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Mon profil"
        description="Ces informations alimentent votre CV et le calcul de correspondance des offres."
      />

      <div className="space-y-5">
        <PersonalInfoCard />
        <ProfessionalCard />
        <SkillsSection />
        <LanguagesSection />
        <PreferencesCard />
        <ExperiencesSection />
        <EducationsSection />
        <CertificationsSection />
        <ProjectsSection />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 25 tests au total.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/profile
git commit -m "feat(web): ecran de profil avec ses sept sections en crud reel"
```

---

## Task 16: Écran de paramètres

**Files:**
- Create: `apps/web/src/features/settings/pages/settings-page.tsx`
- Create: `apps/web/src/features/settings/components/appearance-card.tsx`, `security-card.tsx`, `account-card.tsx`, `sessions-card.tsx`
- Test: `apps/web/src/features/settings/components/sessions-card.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/web/src/features/settings/components/sessions-card.test.tsx` :

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionsCard } from './sessions-card';

const fetchSessions = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', () => ({ fetchSessions, revokeSession: vi.fn() }));

function renderCard() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionsCard />
    </QueryClientProvider>,
  );
}

describe('SessionsCard', () => {
  it('marque la session courante et ne permet pas de la revoquer', async () => {
    fetchSessions.mockResolvedValue([
      {
        id: 'a',
        current: true,
        userAgent: 'Chrome',
        ip: '127.0.0.1',
        createdAt: '2026-09-01T10:00:00.000Z',
        lastSeenAt: '2026-09-15T10:00:00.000Z',
      },
      {
        id: 'b',
        current: false,
        userAgent: 'Safari',
        ip: '10.0.0.1',
        createdAt: '2026-09-02T10:00:00.000Z',
        lastSeenAt: '2026-09-14T10:00:00.000Z',
      },
    ]);

    renderCard();

    expect(await screen.findByText('Session actuelle')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Déconnecter' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test sessions-card`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la carte des sessions**

`apps/web/src/features/settings/components/sessions-card.tsx` :

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchSessions, revokeSession } from '@/services/api/auth';

const formatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

export function SessionsCard() {
  const queryClient = useQueryClient();
  const queryKey = ['auth', 'sessions'] as const;

  const query = useQuery({ queryKey, queryFn: fetchSessions });

  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">Sessions actives</h2>
      <p className="text-muted-foreground mt-0.5 text-sm">
        Les appareils actuellement connectés à votre compte. Déconnectez ceux que vous ne
        reconnaissez pas.
      </p>

      <div className="mt-6">
        {query.isPending && <Skeleton className="h-20 w-full" />}

        {query.isError && (
          <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        )}

        {query.isSuccess && (
          <ul className="divide-border divide-y">
            {query.data.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{session.userAgent ?? 'Appareil inconnu'}</span>
                    {session.current && <Badge variant="secondary">Session actuelle</Badge>}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {session.ip ?? 'IP inconnue'} · vu le {formatter.format(new Date(session.lastSeenAt))}
                  </p>
                </div>

                {!session.current && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(session.id)}
                  >
                    Déconnecter
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Implémenter les trois autres cartes et la page**

`appearance-card.tsx` : trois boutons radio « Clair », « Sombre », « Système » liés à `useThemeStore`, avec `aria-checked` et `role="radio"` dans un conteneur `role="radiogroup"` libellé « Thème ».

`account-card.tsx` : affiche l'email en lecture seule (issu de `useSession`) et un bouton « Se déconnecter » qui appelle `logout()`, vide le cache TanStack Query puis `navigate('/login')`.

`security-card.tsx` : formulaire de changement de mot de passe utilisant `changePasswordSchema` (champs `currentPassword`, `newPassword`).

> **Dépendance :** cet endpoint n'existe pas encore. Ajouter dans `auth.controller.ts` un `@Patch('password')` qui vérifie le mot de passe actuel via `PasswordService.verify`, écrit le nouveau hachage, puis appelle `sessions.destroyAllForUser(user.id, request.sessionId)` — changer de mot de passe doit déconnecter les autres appareils, pas celui qu'on utilise. Message d'erreur en cas de mot de passe actuel faux : « Le mot de passe actuel est incorrect. » Ajouter l'appel `changePassword` dans `services/api/auth.ts`.

`settings-page.tsx` : un `PageHeader` « Paramètres » et des `Tabs` shadcn avec les onglets **Compte**, **Sécurité**, **Apparence** (contenu réel) puis **Notifications**, **Intégrations**, **Confidentialité**, **Abonnement** rendant `<ComingSoonPage />`.

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 26 tests au total.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/settings apps/api/src/modules/auth
git commit -m "feat(web): parametres compte, securite, apparence et sessions actives"
```

---

## Task 17: Parcours end-to-end et recette

**Files:**
- Create: `apps/web/e2e/auth.spec.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Écrire le parcours complet**

`apps/web/e2e/auth.spec.ts` :

```ts
import { expect, test } from '@playwright/test';

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@playwright.local`;
}

test('inscription, saisie du profil, deconnexion et reconnexion', async ({ page }) => {
  const email = uniqueEmail();
  const password = 'motdepasse-solide-2026';

  // Inscription
  await page.goto('/register');
  await page.getByLabel('Prénom').fill('Keryan');
  await page.getByLabel('Nom').fill('Desplan');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Mon profil' })).toBeVisible();

  // Saisie du profil
  await page.getByLabel('Ville').fill('Metz');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();

  // Ajout d'une compétence
  await page
    .getByRole('heading', { name: 'Compétences' })
    .locator('xpath=ancestor::*[1]')
    .getByRole('button', { name: 'Ajouter' })
    .click();
  await page.getByLabel('Nom').fill('TypeScript');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('TypeScript')).toBeVisible();

  // La donnée survit à un rechargement
  await page.reload();
  await expect(page.getByLabel('Ville')).toHaveValue('Metz');
  await expect(page.getByText('TypeScript')).toBeVisible();

  // Déconnexion
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Compte' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Une page protégée redirige vers la connexion
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login$/);

  // Reconnexion
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText('TypeScript')).toBeVisible();
});

test('refuse des identifiants invalides avec un message lisible', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('inconnu@playwright.local');
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe-2026');
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByRole('alert')).toContainText('Identifiants invalides.');
  await expect(page.getByRole('alert')).not.toContainText('401');
});
```

- [ ] **Step 2: Étendre l'intégration continue**

Dans `.github/workflows/ci.yml`, après `- run: pnpm test`, ajouter :

```yaml
      - run: pnpm --filter @jobtrack/api exec prisma migrate deploy
      - run: pnpm --filter @jobtrack/api test:e2e
```

- [ ] **Step 3: Lancer les tests**

Run: `docker compose up -d && pnpm --filter @jobtrack/web test:e2e`
Expected: PASS — les deux scénarios, sur desktop et mobile.

- [ ] **Step 4: Recette complète de la tranche**

Vérifier chacun des huit critères d'acceptation de la spec avant de déclarer la tranche terminée.

Run: `docker compose down -v && docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev`
Expected: démarrage sans intervention manuelle autre que la copie de `.env`.

- [ ] La landing reste accessible sur mobile et desktop, en clair et en sombre.
- [ ] Créer un compte, se déconnecter, se reconnecter fonctionne.
- [ ] Les neuf blocs de `/profile` s'enregistrent et survivent à un rechargement.
- [ ] Le thème fonctionne sur tous les écrans, sans flash au chargement.
- [ ] `/profile` non connecté redirige vers `/login`, puis revient sur `/profile` après connexion.
- [ ] Supprimer le cookie `jt_csrf` dans les outils de développement, puis tenter un enregistrement : l'interface affiche « Requête refusée. Rechargez la page et réessayez. » et non un code HTTP.
- [ ] Les sessions actives se listent et se révoquent ; révoquer depuis un autre navigateur déconnecte bien cet appareil.
- [ ] Six tentatives de connexion échouées affichent « Trop de tentatives. Réessayez dans quelques minutes. »

Run: `pnpm --filter @jobtrack/api test:e2e -t "Isolation"`
Expected: PASS — les trois tests d'isolation. **Ce point est bloquant.**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: les trois commandes passent sans erreur ni avertissement TypeScript.

Run: `grep -rn ": any\|<any>" apps packages --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: aucun résultat.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e .github
git commit -m "test: parcours end-to-end inscription, profil et reconnexion"
```

---

## Limites assumées de la tranche

| Limite | Tranche de résolution |
|--------|----------------------|
| Le lien de réinitialisation est journalisé, pas envoyé par email | 7 (notifications) |
| Pas de vérification d'adresse email à l'inscription | 7 |
| Pas de photo de profil téléversable (`avatarUrl` existe, sans téléversement) | 5 (rendu du CV) |
| Réordonnancement disponible côté API, pas encore d'interface glisser-déposer | 6 (Kanban, même brique) |

La tranche 2 enchaîne avec l'onboarding et l'import de CV, qui remplissent les mêmes tables que l'écran de profil construit ici.
