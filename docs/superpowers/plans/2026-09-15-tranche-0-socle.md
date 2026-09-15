# Tranche 0 — Socle, Design System et Landing — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place le monorepo, la base de données, le design system violet clair/sombre, la coquille applicative et la landing page, de sorte que `docker compose up && pnpm dev` serve une application réelle avec son thème et sa navigation définitive.

**Architecture:** Monorepo pnpm + Turborepo avec trois espaces de travail — `apps/web` (React 19, Vite, Tailwind v4, shadcn/ui), `apps/api` (NestJS sur adaptateur Fastify, Prisma, Redis) et `packages/shared` (schémas Zod compilés par tsup, contrat d'API unique). Postgres 16 et Redis 7 tournent en Docker Compose.

**Tech Stack:** pnpm · Turborepo · TypeScript · React 19 · Vite · Tailwind CSS v4 · shadcn/ui · Radix · Lucide · TanStack Query · Zustand · Framer Motion · NestJS · Fastify · Prisma · Postgres 16 · Redis 7 · Zod · Vitest · Playwright

**Spec de référence:** `docs/superpowers/specs/2026-09-15-socle-auth-profil-design.md`

---

## Cartographie des fichiers

| Fichier | Responsabilité |
|---------|----------------|
| `pnpm-workspace.yaml`, `turbo.json`, `package.json` | Câblage du monorepo et scripts racine |
| `docker-compose.yml`, `.env.example` | Postgres 16 + Redis 7, contrat de configuration |
| `packages/config/` | tsconfig, eslint, prettier partagés — une seule source de règles |
| `packages/shared/src/env.ts` | Schéma Zod de l'environnement serveur |
| `packages/shared/src/index.ts` | Point d'entrée public du contrat partagé |
| `apps/api/src/main.ts` | Bootstrap Fastify, cookies, helmet, CORS |
| `apps/api/src/config/env.ts` | Validation de l'environnement au démarrage |
| `apps/api/src/common/prisma.service.ts` | Cycle de vie du client Prisma |
| `apps/api/src/common/redis.service.ts` | Cycle de vie du client Redis |
| `apps/api/src/modules/health/` | Sonde `/health` (API + Postgres + Redis) |
| `apps/api/prisma/schema.prisma` | Schéma de données (vide en tranche 0, rempli en tranche 1) |
| `apps/web/src/styles/tokens.css` | **Design system** : tous les tokens, clair et sombre |
| `apps/web/src/app/providers/theme-provider.tsx` | Thème clair / sombre / système |
| `apps/web/src/app/layouts/app-layout.tsx` | Coquille authentifiée : sidebar + bottom nav |
| `apps/web/src/app/router/routes.tsx` | Table de routage unique |
| `apps/web/src/components/shared/` | `Logo`, `PageHeader`, `EmptyState`, `ErrorState`, `ThemeToggle` |
| `apps/web/src/features/landing/` | Landing page et ses sections |
| `apps/web/src/services/api/client.ts` | Client HTTP unique, credentials inclus |

**Règle de découpage :** un fichier, une responsabilité, sous ~200 lignes. Une section de landing = un fichier. Un composant qui dépasse se découpe.

---

## Task 1: Squelette du monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.npmrc`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/eslint.config.js`, `packages/config/prettier.config.js`

- [ ] **Step 1: Initialiser la racine**

`package.json` :

```json
{
  "name": "jobtrack",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20.11" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "db:migrate": "pnpm --filter @jobtrack/api exec prisma migrate dev",
    "db:seed": "pnpm --filter @jobtrack/api exec prisma db seed",
    "db:studio": "pnpm --filter @jobtrack/api exec prisma studio"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "prettier": "^3.3.0"
  }
}
```

`pnpm-workspace.yaml` :

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.npmrc` :

```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 2: Configurer Turborepo**

`turbo.json` :

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": { "outputs": [] },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

- [ ] **Step 3: Écrire le .gitignore**

```
node_modules/
dist/
build/
.turbo/
coverage/
*.log

.env
.env.*
!.env.example

.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

playwright-report/
test-results/

# Documents personnels utilisés comme fixtures locales — jamais versionnés
fixtures/private/
```

- [ ] **Step 4: Créer le paquet de configuration partagée**

`packages/config/package.json` :

```json
{
  "name": "@jobtrack/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["tsconfig.base.json", "eslint.config.js", "prettier.config.js"],
  "exports": {
    "./tsconfig.base.json": "./tsconfig.base.json",
    "./eslint": "./eslint.config.js",
    "./prettier": "./prettier.config.js"
  }
}
```

`packages/config/tsconfig.base.json` :

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`packages/config/prettier.config.js` :

```js
/** @type {import("prettier").Config} */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  plugins: ['prettier-plugin-tailwindcss'],
};
```

`packages/config/eslint.config.js` :

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      // Le cahier des charges interdit `any` sauf exception commentée.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  { ignores: ['dist/**', 'build/**', '.turbo/**', 'coverage/**'] },
);
```

- [ ] **Step 5: Installer et vérifier**

Run: `pnpm install && pnpm turbo --version`
Expected: l'installation se termine sans erreur et la version de Turborepo s'affiche (≥ 2.1).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .gitignore .npmrc packages/config pnpm-lock.yaml
git commit -m "chore: initialiser le monorepo pnpm + turborepo"
```

---

## Task 2: Infrastructure locale et contrat de configuration

> **Amendement du 2026-09-15 — état réel de la machine.** Docker n'est pas installé, et deux PostgreSQL tournent déjà : un PostgreSQL 17 (installeur EDB, `/Library/PostgreSQL/17`) sur le port **5432**, et un PostgreSQL 14 Homebrew sur le port **5433**. Aucun des deux ne doit être arrêté ni déplacé.
>
> Décision : les services locaux passent par Homebrew, et le PostgreSQL 16 de JobTrack écoute sur le port **5434**, libre.
>
> **Ceci est déjà fait — ne pas le refaire :** `postgresql@16` et `redis` sont installés, `port = 5434` est écrit dans `/opt/homebrew/var/postgresql@16/postgresql.conf` (sauvegarde en `.bak-jobtrack`), les deux services sont démarrés via `brew services`, et le rôle `jobtrack` (mot de passe `jobtrack`) ainsi que la base `jobtrack` existent.
>
> `docker-compose.yml` reste néanmoins versionné et inchangé : il sert à l'intégration continue et à toute machine qui préférera Docker. C'est uniquement la procédure de démarrage **locale** qui diffère, via le fichier `.env` — non versionné — qui pointe sur 5434.

**Files:**
- Create: `docker-compose.yml`, `.env.example`

- [ ] **Step 1: Écrire docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: jobtrack-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: jobtrack
      POSTGRES_PASSWORD: jobtrack
      POSTGRES_DB: jobtrack
    ports:
      - '5432:5432'
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U jobtrack -d jobtrack']
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: jobtrack-redis
    restart: unless-stopped
    ports:
      - '6379:6379'
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres-data:
  redis-data:
```

- [ ] **Step 2: Écrire .env.example**

Ce fichier est le contrat de configuration : toute variable qu'il déclare est validée au démarrage de l'API (Task 5).

```bash
# --- Application ---
NODE_ENV=development
API_PORT=3001
WEB_ORIGIN=http://localhost:5173

# --- Base de données ---
DATABASE_URL=postgresql://jobtrack:jobtrack@localhost:5432/jobtrack?schema=public

# --- Redis (sessions) ---
REDIS_URL=redis://localhost:6379

# --- Sessions ---
# Générer avec : openssl rand -base64 48
SESSION_SECRET=remplacer-par-un-secret-de-32-caracteres-minimum

# --- Google OAuth (tranche 1) ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/api/v1/auth/google/callback

# --- Frontend ---
VITE_API_URL=http://localhost:3001/api/v1
```

- [ ] **Step 3: Vérifier l'infrastructure locale et écrire le .env**

Les services tournent déjà (voir l'amendement en tête de tâche). Se contenter de vérifier :

Run: `pg_isready -h 127.0.0.1 -p 5434 && redis-cli ping`
Expected: `127.0.0.1:5434 - accepting connections` puis `PONG`.

Run: `PGPASSWORD=jobtrack psql -h 127.0.0.1 -p 5434 -U jobtrack -d jobtrack -tAc "select 1"`
Expected: `1`.

Puis créer le `.env` local à partir de `.env.example`, en y corrigeant **le seul point qui diffère sur cette machine** — le port de la base :

```bash
cp .env.example .env
```

et dans `.env`, remplacer la ligne `DATABASE_URL` par :

```
DATABASE_URL=postgresql://jobtrack:jobtrack@localhost:5434/jobtrack?schema=public
```

puis renseigner `SESSION_SECRET` avec la sortie de `openssl rand -base64 48`.

`.env.example` conserve le port 5432 : c'est celui du `docker-compose.yml` et de l'intégration continue. Seul le `.env` local, non versionné, pointe sur 5434.

Expected: `git status --short` ne liste pas `.env`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: postgres 16 et redis 7 en docker compose"
```

---

## Task 3: Paquet partagé (contrat Zod)

> **Amendement — configuration ESLint du paquet.** `@jobtrack/config/eslint` expose une **fabrique**, pas une configuration figée : `tsconfigRootDir` doit être la racine du paquet consommateur, faute de quoi `allowDefaultProject` ne correspond à rien et le lint plante fatalement. Ce paquet doit donc déclarer `eslint` (`^10.0.0`) en devDependency et créer son propre `eslint.config.js` :
>
> ```js
> import { createEslintConfig } from '@jobtrack/config/eslint';
>
> export default createEslintConfig(import.meta.dirname);
> ```

`packages/shared` est la source de vérité du contrat d'API. Il est compilé par tsup vers `dist/` avec ses déclarations de types, ce qui le rend consommable à la fois par Vite (web) et par tsc (api).

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/tsup.config.ts`
- Create: `packages/shared/src/index.ts`, `packages/shared/src/env.ts`
- Test: `packages/shared/src/env.test.ts`

- [ ] **Step 1: Créer le paquet**

`packages/shared/package.json` :

```json
{
  "name": "@jobtrack/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@jobtrack/config": "workspace:*",
    "tsup": "^8.3.0",
    "vitest": "^2.1.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/shared/tsup.config.ts` — **double build**. `apps/api` est du CommonJS avec une résolution `Node` classique qui ignore `exports` : sans sortie `.cjs`, `tsc` compile mais `require('@jobtrack/shared')` plante à l'exécution (`ERR_PACKAGE_PATH_NOT_EXPORTED`). `clean: true` doit rester sur une seule des deux entrées, sinon le second build efface le premier.

```ts
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: true,
    outExtension: () => ({ js: '.cjs' }),
  },
]);
```

`packages/shared/tsconfig.json` :

```json
{
  "extends": "@jobtrack/config/tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Écrire le test qui échoue**

`packages/shared/src/env.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { serverEnvSchema } from './env';

const valid = {
  NODE_ENV: 'development',
  API_PORT: '3001',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://jobtrack:jobtrack@localhost:5432/jobtrack',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'a'.repeat(32),
};

describe('serverEnvSchema', () => {
  it('accepte un environnement complet et convertit le port en nombre', () => {
    const parsed = serverEnvSchema.parse(valid);
    expect(parsed.API_PORT).toBe(3001);
    expect(parsed.NODE_ENV).toBe('development');
  });

  it('rejette un SESSION_SECRET trop court', () => {
    const result = serverEnvSchema.safeParse({ ...valid, SESSION_SECRET: 'trop-court' });
    expect(result.success).toBe(false);
  });

  it('rejette une DATABASE_URL absente', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid;
    const result = serverEnvSchema.safeParse(withoutDb);
    expect(result.success).toBe(false);
  });

  it('rejette une WEB_ORIGIN qui n_est pas une URL', () => {
    const result = serverEnvSchema.safeParse({ ...valid, WEB_ORIGIN: 'pas-une-url' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/shared test`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 4: Implémenter le schéma**

`packages/shared/src/env.ts` :

```ts
import { z } from 'zod';

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().trim().url(),

  // `.trim()` partout : une valeur composée d'espaces passerait sinon `.min()`.
  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1),

  // 32 caractères minimum : un secret plus court affaiblit la signature de session.
  SESSION_SECRET: z.string().trim().min(32),

  // Optionnels en tranche 0 ; requis dès que Google est branché (tranche 1).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
```

`packages/shared/src/index.ts` :

```ts
export * from './env';
```

- [ ] **Step 5: Lancer les tests et construire**

Run: `pnpm --filter @jobtrack/shared test`
Expected: PASS — 4 tests.

Run: `pnpm --filter @jobtrack/shared build`
Expected: `dist/index.js`, `dist/index.cjs` et `dist/index.d.ts` sont générés.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): contrat zod partage et validation de l environnement"
```

---

## Task 4: API NestJS sur adaptateur Fastify

> **Amendement après revue.** (1) `apps/api` étant CommonJS, son fichier de lint se nomme **`eslint.config.mjs`** — un `.js` en syntaxe ESM déclenche `MODULE_TYPELESS_PACKAGE_JSON` à chaque lint. (2) Pas d'alias `@/*` dans le tsconfig : `nest build` ne le réécrit pas et il planterait au `require`. (3) La configuration transverse vit dans `src/app.setup.ts` (`configureApp`, `createAdapter`), réutilisée telle quelle par les tests e2e de la tranche 1. (4) `trustProxy` n'est activé qu'en production : sinon un client forgerait `X-Forwarded-For` et contournerait le rate limiting par IP.

> **Amendement — configuration ESLint du paquet.** `@jobtrack/config/eslint` expose une **fabrique**, pas une configuration figée : `tsconfigRootDir` doit être la racine du paquet consommateur, faute de quoi `allowDefaultProject` ne correspond à rien et le lint plante fatalement. Ce paquet doit donc déclarer `eslint` (`^10.0.0`) en devDependency et créer son propre `eslint.config.js` :
>
> ```js
> import { createEslintConfig } from '@jobtrack/config/eslint';
>
> export default createEslintConfig(import.meta.dirname);
> ```

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.setup.ts`, `apps/api/src/app.module.ts`, `apps/api/src/config/env.ts`

- [ ] **Step 1: Créer le paquet API**

`apps/api/package.json` :

```json
{
  "name": "@jobtrack/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@jobtrack/shared": "workspace:*",
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-fastify": "^10.4.0",
    "@fastify/cookie": "^9.4.0",
    "@fastify/helmet": "^11.1.0",
    "@prisma/client": "^5.20.0",
    "dotenv": "^16.4.0",
    "ioredis": "^5.4.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@jobtrack/config": "workspace:*",
    "@nestjs/cli": "^10.4.0",
    "@nestjs/testing": "^10.4.0",
    "prisma": "^5.20.0",
    "supertest": "^7.0.0",
    "vitest": "^2.1.0",
    "unplugin-swc": "^1.5.1",
    "typescript": "^5.6.0"
  }
}
```

`apps/api/nest-cli.json` :

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

`apps/api/tsconfig.json` :

```json
{
  "extends": "@jobtrack/config/tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

`apps/api/vitest.config.ts` :

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
```

- [ ] **Step 2: Écrire le chargeur d'environnement**

`apps/api/src/config/env.ts` :

```ts
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { serverEnvSchema, type ServerEnv } from '@jobtrack/shared';

// Le `.env` vit à la racine du monorepo. Selon qu'on lance depuis la racine
// (`pnpm dev`) ou depuis `apps/api` (`pnpm --filter @jobtrack/api dev`),
// il est à `./.env` ou à `../../.env`. Un fichier absent est ignoré sans
// erreur : en CI et en production, les variables viennent de l'environnement.
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/**
 * Valide l'environnement au démarrage. En cas d'erreur le processus s'arrête :
 * une API qui démarre avec une configuration incomplète échouerait plus tard,
 * de façon plus difficile à diagnostiquer.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide. Corrigez votre fichier .env :\n${details}`);
  }

  return result.data;
}

export const env = loadEnv();
```

- [ ] **Step 3: Écrire le module racine et le bootstrap**

`apps/api/src/app.module.ts` :

```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
})
export class AppModule {}
```

`apps/api/src/app.setup.ts` — configuration transverse, sans effet de bord, importable par les tests :

```ts
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { env } from './config/env';

/**
 * Applique à l'application toute la configuration transverse : sécurité HTTP,
 * cookies, CORS et préfixe d'API. Partagée entre le bootstrap réel et les
 * tests end-to-end, pour que les deux ne divergent jamais.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  await app.register(helmet);
  await app.register(cookie, { secret: env.SESSION_SECRET });

  // CORS strictement limité à l'origine du frontend, cookies autorisés.
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
}

export function createAdapter(): FastifyAdapter {
  // Ne faire confiance aux en-têtes X-Forwarded-* qu'en production, derrière
  // un vrai proxy. Sinon un client pourrait forger son IP et contourner le
  // rate limiting par adresse.
  return new FastifyAdapter({ trustProxy: env.NODE_ENV === 'production' });
}
```

`apps/api/src/main.ts` — point d'entrée, rien d'autre :

```ts
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApp, createAdapter } from './app.setup';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter());
  await configureApp(app);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  Logger.log(`API démarrée sur http://localhost:${env.API_PORT}/api/v1`, 'Bootstrap');
}

void bootstrap();
```

- [ ] **Step 4: Vérifier le démarrage**

Run: `pnpm --filter @jobtrack/api dev`
Expected: le log `API démarrée sur http://localhost:3001/api/v1` s'affiche sans erreur — ce qui prouve au passage que le `.env` racine a bien été chargé depuis `apps/api`. Arrêter avec Ctrl-C.

Run (depuis la racine) : `pnpm dev --filter @jobtrack/api`
Expected: même log — le `.env` est aussi trouvé depuis la racine.

Run: `API_PORT=3001 WEB_ORIGIN=pas-une-url pnpm --filter @jobtrack/api dev`
Expected: le démarrage échoue avec `Configuration invalide. Corrigez votre fichier .env :` suivi de la ligne `- WEB_ORIGIN : Invalid url`. C'est le comportement voulu.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): nestjs sur adaptateur fastify avec validation de l environnement"
```

---

## Task 5: Prisma, Redis et sonde /health

> **Amendement après revue.** Les fichiers ci-dessous sont la version *initiale* ; la revue a imposé trois compléments, reproduits en bac à sable et mesurés :
>
> 1. **Chaque `isReachable()` est borné à 1,5 s** par `apps/api/src/common/with-timeout.ts` (`withTimeout(promise, ms, label)`, minuteur nettoyé en `finally`, 3 tests). Sans cela, un Redis qui absorbe les paquets bloquait `/health` ≈ 30 s et Prisma sans limite — une sonde de vivacité qui se bloque est pire que pas de sonde. Mesuré après correctif : réponse 200 « dégradé » en 1,5 s.
> 2. **`RedisService`** : `lazyConnect: true`, `connectTimeout: 2000`, connexion explicite dans `onModuleInit` sous `try/catch` (un Redis absent ne doit pas empêcher l'API de démarrer), et un écouteur `'error'` qui journalise en `warn` via le `Logger` Nest — sinon ioredis écrit `Unhandled error event` sur la console à chaque reconnexion.
> 3. **Deux tests de non-régression** supplémentaires dans `health.service.spec.ts` : les deux dépendances en panne → `degraded` avec les deux `down` ; `timestamp` en ISO 8601 strict.
>
> Le `try/catch` reste à l'intérieur de chaque `isReachable()` : `check()` ne change pas et `Promise.all` y reste sûr, les deux promesses ne rejetant jamais.

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/common/prisma.service.ts`, `apps/api/src/common/redis.service.ts`, `apps/api/src/common/common.module.ts`
- Create: `apps/api/src/modules/health/health.controller.ts`, `apps/api/src/modules/health/health.service.ts`, `apps/api/src/modules/health/health.module.ts`
- Test: `apps/api/src/modules/health/health.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Initialiser Prisma**

`apps/api/prisma/schema.prisma` :

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Les modèles de données arrivent en tranche 1 (User, Profile et ses relations).
// La tranche 0 n'a besoin que d'une connexion fonctionnelle pour la sonde /health.
```

Run: `pnpm --filter @jobtrack/api exec prisma generate --allow-no-models`
Expected: `Generated Prisma Client` s'affiche. Le drapeau est nécessaire tant que le schéma n'a aucun modèle : Prisma 5.22 refuse sinon de générer (`You don't have any models defined`). Il devient superflu — mais reste inoffensif — dès la tranche 1.

- [ ] **Step 2: Écrire les services d'infrastructure**

`apps/api/src/common/prisma.service.ts` :

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Renvoie true si Postgres répond. Utilisé par la sonde /health. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
```

`apps/api/src/common/redis.service.ts` :

```ts
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Renvoie true si Redis répond au PING. Utilisé par la sonde /health. */
  async isReachable(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
```

`apps/api/src/common/common.module.ts` :

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class CommonModule {}
```

- [ ] **Step 3: Écrire le test qui échoue**

`apps/api/src/modules/health/health.service.spec.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma.service';
import type { RedisService } from '../../common/redis.service';
import { HealthService } from './health.service';

function build(databaseUp: boolean, redisUp: boolean): HealthService {
  const prisma = { isReachable: vi.fn().mockResolvedValue(databaseUp) } as unknown as PrismaService;
  const redis = { isReachable: vi.fn().mockResolvedValue(redisUp) } as unknown as RedisService;
  return new HealthService(prisma, redis);
}

describe('HealthService', () => {
  it('rapporte ok quand postgres et redis repondent', async () => {
    const result = await build(true, true).check();
    expect(result.status).toBe('ok');
    expect(result.services).toEqual({ database: 'up', redis: 'up' });
  });

  it('rapporte degraded quand postgres ne repond pas', async () => {
    const result = await build(false, true).check();
    expect(result.status).toBe('degraded');
    expect(result.services.database).toBe('down');
  });

  it('rapporte degraded quand redis ne repond pas', async () => {
    const result = await build(true, false).check();
    expect(result.status).toBe('degraded');
    expect(result.services.redis).toBe('down');
  });
});
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/api test`
Expected: FAIL — `Cannot find module './health.service'`.

- [ ] **Step 5: Implémenter le module health**

`packages/shared/src/health.ts` — le contrat, exporté depuis `index.ts` :

```ts
/** Rapport de la sonde `GET /health`. Contrat unique, consommé par l'API et le frontend. */
export interface HealthReport {
  status: 'ok' | 'degraded';
  services: { database: 'up' | 'down'; redis: 'up' | 'down' };
  timestamp: string;
}
```

`apps/api/src/modules/health/health.service.ts` :

```ts
import { Injectable } from '@nestjs/common';
import type { HealthReport } from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';

export type { HealthReport };

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthReport> {
    const [databaseUp, redisUp] = await Promise.all([
      this.prisma.isReachable(),
      this.redis.isReachable(),
    ]);

    return {
      status: databaseUp && redisUp ? 'ok' : 'degraded',
      services: {
        database: databaseUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
```

`apps/api/src/modules/health/health.controller.ts` :

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthReport } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
```

`apps/api/src/modules/health/health.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
```

- [ ] **Step 6: Brancher les modules**

`apps/api/src/app.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [CommonModule, HealthModule],
})
export class AppModule {}
```

- [ ] **Step 7: Lancer les tests et vérifier de bout en bout**

Run: `pnpm --filter @jobtrack/api test`
Expected: PASS — 3 tests.

> **Amendement — infrastructure Homebrew.** Les services tournent déjà via `brew services` (Postgres 16 sur 5434, Redis sur 6379 — voir l'amendement de la tâche 2). Ne pas utiliser `docker compose`. Pour vérifier l'état dégradé, ne pas arrêter Redis : il suffit de pointer `REDIS_URL` sur un port où rien n'écoute, le temps d'un démarrage borné. Aucun service n'est touché.

Run (depuis `apps/api`, après `pnpm --filter @jobtrack/api build`) :
`(timeout 15 node dist/main.js &) ; sleep 4 ; curl -s localhost:3001/api/v1/health ; wait`
Expected: `{"status":"ok","services":{"database":"up","redis":"up"},"timestamp":"..."}` — ce qui prouve que Prisma joint bien Postgres sur 5434 via le `.env`.

Run (état dégradé, sans rien arrêter) :
`(REDIS_URL=redis://localhost:6390 timeout 15 node dist/main.js &) ; sleep 4 ; curl -s localhost:3001/api/v1/health ; wait`
Expected: `"status":"degraded"` et `"redis":"down"`, `"database":"up"`. Le démarrage ne doit **pas** échouer : une dépendance injoignable dégrade la sonde, elle n'empêche pas l'API de répondre.

Vérifier ensuite qu'aucun processus ne reste sur 3001 : `lsof -nP -iTCP:3001 -sTCP:LISTEN` doit être vide.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): prisma, redis et sonde health"
```

---

## Task 6: Application web et design system

> **Amendement après revue.** Les valeurs OKLCH ci-dessous ont été vérifiées par reconversion en sRGB (culori, ΔE2000) : violets et fonds sombres exacts à ΔE ≤ 0,65 ; `destructive` et `warning` recalculés depuis leurs hex (ils dérivaient de 3,6 et 2,3). Contrastes WCAG des cinq paires clés tous ≥ 4,71:1 (AA texte normal). L'`@import 'tailwindcss'` porte `source('../../')` pour limiter le scan à `apps/web`.

> **Amendement — configuration ESLint du paquet.** `@jobtrack/config/eslint` expose une **fabrique**, pas une configuration figée : `tsconfigRootDir` doit être la racine du paquet consommateur, faute de quoi `allowDefaultProject` ne correspond à rien et le lint plante fatalement. Ce paquet doit donc déclarer `eslint` (`^10.0.0`) en devDependency et créer son propre `eslint.config.js` :
>
> ```js
> import { createEslintConfig } from '@jobtrack/config/eslint';
>
> export default createEslintConfig(import.meta.dirname);
> ```

Le fichier `tokens.css` est le cœur du design system. Aucune couleur, aucun rayon et aucune ombre ne doit être écrit en dur ailleurs dans l'application.

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/styles/tokens.css`, `apps/web/src/lib/utils.ts`
- Create: `apps/web/components.json`

- [ ] **Step 1: Créer le paquet web**

`apps/web/package.json` :

```json
{
  "name": "@jobtrack/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src e2e"
  },
  "dependencies": {
    "@jobtrack/shared": "workspace:*",
    "@tanstack/react-query": "^5.59.0",
    "@fontsource-variable/inter": "^5.1.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "framer-motion": "^11.11.0",
    "lucide-react": "^0.453.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.53.0",
    "react-router-dom": "^6.27.0",
    "tailwind-merge": "^3.0.0",
    "zod": "^3.23.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@jobtrack/config": "workspace:*",
    "@playwright/test": "^1.48.0",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "tw-animate-css": "^1.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Configurer Vite et TypeScript**

`apps/web/vite.config.ts` :

```ts
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`apps/web/tsconfig.json` :

```json
{
  "extends": "@jobtrack/config/tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "e2e/**/*", "vite.config.ts"]
}
```

> `e2e/**/*` est délibérément inclus : sans lui, les spécifications Playwright retombent sur le projet par défaut d'ESLint et perdent le lint typé. Le `allowDefaultProject` de la config partagée les couvre en secours, mais un vrai typage vaut mieux qu'un repli.

`apps/web/src/test/setup.ts` :

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Écrire les tokens du design system**

`apps/web/src/styles/tokens.css` — les valeurs OKLCH correspondent aux hexadécimaux du cahier des charges, rappelés en commentaire.

```css
/* source() limite le scan des classes à apps/web : sans cela Tailwind parcourt tout le monorepo. */
@import 'tailwindcss' source('../../');
@import 'tw-animate-css';
@import '@fontsource-variable/inter';

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-border: var(--sidebar-border);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --font-sans: 'Inter Variable', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 6px);

  --shadow-xs: var(--elevation-xs);
  --shadow-sm: var(--elevation-sm);
  --shadow-md: var(--elevation-md);
  --shadow-lg: var(--elevation-lg);
}

/* ---------- Thème clair (défaut) ---------- */
:root {
  --radius: 0.625rem;

  --background: oklch(1 0 0); /* #FFFFFF */
  --foreground: oklch(0.181 0 0); /* #111111 */

  --card: oklch(1 0 0); /* #FFFFFF */
  --card-foreground: oklch(0.181 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.181 0 0);

  /* Violet : CTA, éléments actifs, focus, sélection. Jamais en aplat de fond. */
  --primary: oklch(0.541 0.246 293); /* #7C3AED */
  --primary-foreground: oklch(1 0 0);

  --secondary: oklch(0.98 0.002 286); /* #F8F8FA */
  --secondary-foreground: oklch(0.181 0 0);

  --muted: oklch(0.98 0.002 286); /* #F8F8FA */
  --muted-foreground: oklch(0.551 0.023 264); /* #6B7280 */

  --accent: oklch(0.969 0.014 293); /* #F5F3FF — violet très atténué */
  --accent-foreground: oklch(0.491 0.234 293); /* #6D28D9 */

  --destructive: oklch(0.577 0.215 27.3); /* #DC2626 */
  --destructive-foreground: oklch(1 0 0);
  --success: oklch(0.627 0.170 149.2); /* #16A34A */
  --warning: oklch(0.666 0.157 58.3); /* #D97706 */

  --border: oklch(0.922 0.004 286); /* #E5E7EB */
  --input: oklch(0.922 0.004 286);
  --ring: oklch(0.541 0.246 293); /* focus violet */

  --sidebar: oklch(0.98 0.002 286);
  --sidebar-foreground: oklch(0.181 0 0);
  --sidebar-accent: oklch(0.969 0.014 293);
  --sidebar-border: oklch(0.922 0.004 286);

  --chart-1: oklch(0.541 0.246 293);
  --chart-2: oklch(0.709 0.164 293);
  --chart-3: oklch(0.627 0.17 149);
  --chart-4: oklch(0.646 0.15 58);
  --chart-5: oklch(0.551 0.023 264);

  /* Ombres très légères — le cahier des charges proscrit les ombres marquées. */
  --elevation-xs: 0 1px 2px oklch(0 0 0 / 4%);
  --elevation-sm: 0 1px 3px oklch(0 0 0 / 5%);
  --elevation-md: 0 2px 8px oklch(0 0 0 / 6%);
  --elevation-lg: 0 8px 24px oklch(0 0 0 / 8%);
}

/* ---------- Thème sombre : palette recalibrée, pas une inversion ---------- */
.dark {
  --background: oklch(0.141 0.005 286); /* #09090B */
  --foreground: oklch(0.985 0 0); /* #FAFAFA */

  --card: oklch(0.183 0.004 286); /* #111113 */
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.211 0.006 286); /* #18181B */
  --popover-foreground: oklch(0.985 0 0);

  /* Violet plus clair sur fond très noir : le #7C3AED manque de contraste ici. */
  --primary: oklch(0.606 0.219 293); /* #8B5CF6 */
  --primary-foreground: oklch(1 0 0);

  --secondary: oklch(0.211 0.006 286); /* #18181B */
  --secondary-foreground: oklch(0.985 0 0);

  --muted: oklch(0.211 0.006 286);
  --muted-foreground: oklch(0.705 0.015 286); /* #A1A1AA */

  --accent: oklch(0.245 0.04 292);
  --accent-foreground: oklch(0.709 0.164 293); /* #A78BFA */

  --destructive: oklch(0.637 0.208 25.3); /* #EF4444 */
  --destructive-foreground: oklch(1 0 0);
  --success: oklch(0.723 0.192 149.6); /* #22C55E */
  --warning: oklch(0.769 0.165 70.1); /* #F59E0B */

  --border: oklch(0.274 0.006 286); /* #27272A */
  --input: oklch(0.274 0.006 286);
  --ring: oklch(0.606 0.219 293);

  --sidebar: oklch(0.183 0.004 286);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.245 0.04 292);
  --sidebar-border: oklch(0.274 0.006 286);

  --chart-1: oklch(0.606 0.219 293);
  --chart-2: oklch(0.709 0.164 293);
  --chart-3: oklch(0.723 0.19 149.6);
  --chart-4: oklch(0.769 0.16 70);
  --chart-5: oklch(0.705 0.015 286);

  --elevation-xs: 0 1px 2px oklch(0 0 0 / 30%);
  --elevation-sm: 0 1px 3px oklch(0 0 0 / 35%);
  --elevation-md: 0 2px 8px oklch(0 0 0 / 40%);
  --elevation-lg: 0 8px 24px oklch(0 0 0 / 45%);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground font-sans antialiased;
  }

  /* Accessibilité : focus toujours visible, en violet. */
  :focus-visible {
    @apply outline-ring outline-2 outline-offset-2;
  }

  /* Accessibilité : respecter le réglage système de réduction des animations. */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

- [ ] **Step 4: Écrire index.html avec le script anti-flash**

`apps/web/index.html` — le script inline s'exécute avant le premier paint, ce qui évite l'éclair de thème clair sur un utilisateur en mode sombre.

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JobTrack — Toutes vos opportunités. Un seul endroit.</title>
    <meta
      name="description"
      content="JobTrack centralise vos recherches d'emploi, analyse les opportunités et vous aide à postuler plus intelligemment."
    />
    <script>
      // Applique le thème avant le premier paint. Doit rester synchronisé
      // avec src/lib/theme.ts (même clé de stockage, même logique).
      (function () {
        try {
          var mode = localStorage.getItem('jobtrack-theme') || 'light';
          var isDark =
            mode === 'dark' ||
            (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
          if (isDark) document.documentElement.classList.add('dark');
          document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
        } catch (error) {
          // localStorage indisponible (navigation privée) : on garde le thème clair.
        }
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Écrire l'utilitaire de classes et le point d'entrée**

`apps/web/src/lib/utils.ts` :

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`apps/web/src/main.tsx` :

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <p className="text-primary p-8 text-2xl font-semibold">JobTrack</p>
  </StrictMode>,
);
```

- [ ] **Step 6: Déclarer components.json pour shadcn**

`apps/web/components.json` :

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/tokens.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 7: Vérifier visuellement**

Run: `pnpm install && pnpm --filter @jobtrack/web dev`
Expected: `http://localhost:5173` affiche « JobTrack » en violet sur fond blanc, police Inter.

Dans la console du navigateur, exécuter `localStorage.setItem('jobtrack-theme','dark')` puis recharger.
Expected: fond quasi noir, texte violet plus clair, **aucun flash blanc** au chargement.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): vite, tailwind v4 et design system violet clair/sombre"
```

---

## Task 7: Composants shadcn/ui de base

**Files:**
- Create: `apps/web/src/components/ui/*` (généré par la CLI shadcn)

- [ ] **Step 1: Installer les composants**

Run depuis `apps/web` :

```bash
pnpm dlx shadcn@latest add button input textarea label card dropdown-menu avatar dialog sheet tabs select form sonner skeleton badge separator tooltip switch alert
```

Expected: les fichiers apparaissent dans `src/components/ui/` et les dépendances Radix sont ajoutées au `package.json`.

- [ ] **Step 2: Vérifier que les tokens sont respectés**

Run: `grep -rnE '#[0-9a-fA-F]{6}|rgb\(' apps/web/src/components/ui/`
Expected: aucun résultat. Les composants doivent utiliser exclusivement les tokens (`bg-primary`, `text-muted-foreground`…). Si une couleur en dur apparaît, la remplacer par le token équivalent.

- [ ] **Step 3: Vérifier le rendu dans les deux thèmes**

Remplacer temporairement le contenu de `main.tsx` par un `<Button>Postuler</Button>` et un `<Button variant="outline">Sauvegarder</Button>`.
Expected: le bouton plein est violet `#7C3AED` en clair et `#8B5CF6` en sombre ; le focus clavier (Tab) dessine un anneau violet net.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): composants shadcn/ui de base"
```

---

## Task 8: Thème clair / sombre / système

> **Amendement après revue.** Le code ci-dessous est la version initiale ; l'état livré diffère sur quatre points, tous vérifiés dans un vrai navigateur :
>
> 1. **`theme-toggle.tsx` utilise `DropdownMenuRadioGroup` / `DropdownMenuRadioItem`** (déjà générés par shadcn) au lieu de `DropdownMenuItem` + `text-primary`. Radix pose `role="menuitemradio"` et `aria-checked`, shadcn rend un indicateur — l'état actif n'est plus porté par la seule couleur (WCAG 1.4.1). Le test vérifie `aria-checked="true"` avant et après le changement de mode.
> 2. **Une seule application du thème.** `setMode` ne fait que `storeTheme` + `set` ; `ThemeProvider` est le seul endroit qui touche au DOM. Un test qui rend `ThemeToggle` doit donc l'envelopper dans `ThemeProvider`.
> 3. **`app/providers/app-toaster.tsx`** monte le `Toaster` de sonner avec `theme={mode}` depuis le store (`ThemeMode` et `ToasterProps['theme']` ont les mêmes valeurs) ; testé via l'attribut `data-sonner-theme`, qui n'apparaît qu'une fois un toast émis.
> 4. **`src/test/setup.ts`** porte trois polyfills jsdom indispensables et mesurés : un pont `localStorage`/`sessionStorage` vers `globalThis` (absents sous vitest 2 + jsdom 25), des stubs `ResizeObserver` / `PointerEvent` / pointer capture pour Radix, et un court-circuit de `Element.prototype.matches(':fullscreen' | ':modal')` — jsdom les résout par une récursion non mémoïsée que Radix déclenche par nœud : **10,5 s par clic, ramené à 94 ms**. Les tests remettent le store à `{ mode: 'light' }` en `beforeEach`.

**Files:**
- Create: `apps/web/src/lib/theme.ts`, `apps/web/src/stores/theme-store.ts`
- Create: `apps/web/src/app/providers/theme-provider.tsx`
- Create: `apps/web/src/components/shared/theme-toggle.tsx`
- Test: `apps/web/src/lib/theme.test.ts`, `apps/web/src/components/shared/theme-toggle.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/web/src/lib/theme.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readStoredTheme, resolveTheme, THEME_STORAGE_KEY } from './theme';

function mockPrefersDark(prefersDark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: prefersDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('retombe sur le thème clair quand rien n_est stocké', () => {
    expect(readStoredTheme()).toBe('light');
  });

  it('retombe sur le thème clair quand la valeur stockée est invalide', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'bleu-canard');
    expect(readStoredTheme()).toBe('light');
  });

  it('relit une valeur stockée valide', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('résout le mode système selon la préférence du navigateur', () => {
    mockPrefersDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockPrefersDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('ne consulte pas le navigateur pour un mode explicite', () => {
    mockPrefersDark(true);
    expect(resolveTheme('light')).toBe('light');
  });

  it('ajoute et retire la classe dark sur la racine du document', () => {
    mockPrefersDark(false);
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test`
Expected: FAIL — `Failed to resolve import "./theme"`.

- [ ] **Step 3: Implémenter la logique de thème**

`apps/web/src/lib/theme.ts` :

```ts
export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Doit rester identique à la clé lue par le script inline de index.html. */
export const THEME_STORAGE_KEY = 'jobtrack-theme';

const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && MODES.includes(value as ThemeMode);
}

export function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'light';
  } catch {
    // Navigation privée ou stockage bloqué : le thème clair est le défaut produit.
    return 'light';
  }
}

export function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Le thème restera celui de la session en cours.
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 6 tests.

- [ ] **Step 5: Écrire le store et le provider**

`apps/web/src/stores/theme-store.ts` :

```ts
import { create } from 'zustand';
import { applyTheme, readStoredTheme, storeTheme, type ThemeMode } from '@/lib/theme';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: readStoredTheme(),
  setMode: (mode) => {
    storeTheme(mode);
    applyTheme(mode);
    set({ mode });
  },
}));
```

`apps/web/src/app/providers/theme-provider.tsx` :

```tsx
import { useEffect, type ReactNode } from 'react';
import { applyTheme } from '@/lib/theme';
import { useThemeStore } from '@/stores/theme-store';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    applyTheme(mode);

    // En mode système, suivre les changements de préférence en direct.
    if (mode !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  return <>{children}</>;
}
```

- [ ] **Step 6: Écrire le test du sélecteur de thème**

`apps/web/src/components/shared/theme-toggle.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('propose les trois modes et applique le mode sombre', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /thème/i }));

    expect(screen.getByRole('menuitem', { name: 'Clair' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sombre' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Système' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Sombre' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
```

- [ ] **Step 7: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test theme-toggle`
Expected: FAIL — `Failed to resolve import "./theme-toggle"`.

- [ ] **Step 8: Implémenter le sélecteur**

`apps/web/src/components/shared/theme-toggle.tsx` :

```tsx
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ThemeMode } from '@/lib/theme';
import { useThemeStore } from '@/stores/theme-store';

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string; Icon: typeof Sun }> = [
  { mode: 'light', label: 'Clair', Icon: Sun },
  { mode: 'dark', label: 'Sombre', Icon: Moon },
  { mode: 'system', label: 'Système', Icon: Monitor },
];

export function ThemeToggle() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Changer de thème">
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ mode: value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setMode(value)}
            className={value === mode ? 'text-primary' : undefined}
          >
            <Icon className="mr-2 size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 9: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 8 tests au total (6 thème + 1 sélecteur + 1 toaster).

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): theme clair, sombre et systeme sans flash au chargement"
```

---

## Task 9: Composants partagés

Ces quatre composants portent les états vides et d'erreur exigés sur chaque écran du produit. Les écrire une fois ici évite de les réinventer dans chacune des huit tranches suivantes.

**Files:**
- Create: `apps/web/src/components/shared/logo.tsx`, `page-header.tsx`, `empty-state.tsx`, `error-state.tsx`
- Test: `apps/web/src/components/shared/empty-state.test.tsx`, `error-state.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

`apps/web/src/components/shared/empty-state.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Briefcase } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('affiche le titre, la description et déclenche l_action', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <EmptyState
        icon={Briefcase}
        title="Aucun favori"
        description="Vous n'avez pas encore sauvegardé d'offre."
        action={{ label: 'Découvrir les offres', onClick: onAction }}
      />,
    );

    expect(screen.getByText('Aucun favori')).toBeInTheDocument();
    expect(screen.getByText("Vous n'avez pas encore sauvegardé d'offre.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Découvrir les offres' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('se rend sans action', () => {
    render(<EmptyState icon={Briefcase} title="Aucun favori" description="Rien ici." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

`apps/web/src/components/shared/error-state.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './error-state';

describe('ErrorState', () => {
  it('affiche un message lisible et permet de réessayer', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(<ErrorState message="Impossible de charger les offres." onRetry={onRetry} />);

    expect(screen.getByText('Impossible de charger les offres.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('n_affiche jamais de code HTTP brut', () => {
    render(<ErrorState message="Impossible de charger les offres." onRetry={vi.fn()} />);
    expect(screen.queryByText(/500|Error \d+/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm --filter @jobtrack/web test empty-state error-state`
Expected: FAIL — les deux modules sont introuvables.

- [ ] **Step 3: Implémenter les composants**

`apps/web/src/components/shared/empty-state.tsx` :

```tsx
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
        <Icon className="text-muted-foreground size-5" />
      </div>
      <p className="text-base font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      {action && (
        <Button className="mt-6" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
```

`apps/web/src/components/shared/error-state.tsx` :

```tsx
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  /** Message lisible par un humain, en français. Jamais un code HTTP brut. */
  message: string;
  onRetry: () => void;
  /** `alert` interrompt le lecteur d'écran (erreur de page) ; `status` est poli (section). */
  role?: 'alert' | 'status';
}

export function ErrorState({ message, onRetry, role = 'alert' }: ErrorStateProps) {
  return (
    <div
      role={role}
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="bg-destructive/10 mb-4 flex size-12 items-center justify-center rounded-full">
        <AlertCircle className="text-destructive size-5" />
      </div>
      <p className="text-base font-medium">{message}</p>
      <Button variant="outline" className="mt-6" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
```

`apps/web/src/components/shared/page-header.tsx` :

```tsx
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}
```

`apps/web/src/components/shared/logo.tsx` :

```tsx
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span
        aria-hidden
        className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-bold"
      >
        J
      </span>
      JobTrack
    </span>
  );
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 12 tests au total.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shared
git commit -m "feat(web): composants partages logo, entete, etat vide et etat d erreur"
```

---

## Task 10: Navigation, coquille applicative et routage

> **Amendement après revue.** (1) `declaration: false` dans `apps/web/tsconfig.json` et `apps/api/tsconfig.json` : la valeur héritée de la base déclenchait TS2742 sur les types inférés de bibliothèques et faisait émettre des `.d.ts` morts — seul `packages/shared` publie des types. (2) `ComingSoonPage` reçoit `label` en prop depuis `routes.tsx` (`element: <ComingSoonPage label={item.label} />`) au lieu de le déduire de l'URL. (3) Le compte des entrées vit dans `src/constants/navigation.test.ts` (3 tests) ; le test de la sidebar ne fait qu'itérer `NAV_ITEMS`. Une `SheetDescription` masquée accompagne le panneau mobile (exigence Radix). 17 tests web après cette tâche.

> **Amendement.** `routes.tsx` importe `LandingPage`, qui n'existe qu'à la tâche 12. Cette tâche crée donc un **`apps/web/src/features/landing/landing-page.tsx` provisoire** — au même chemin, remplacé intégralement en tâche 12 — pour que le routeur compile. `main.tsx` monte aussi `AppToaster` (tâche 8). Le sélecteur de thème est déjà en radio accessible (tâche 8).

**Files:**
- Create: `apps/web/src/constants/navigation.ts`
- Create: `apps/web/src/app/layouts/app-layout.tsx`, `apps/web/src/app/layouts/app-sidebar.tsx`, `apps/web/src/app/layouts/app-bottom-nav.tsx`
- Create: `apps/web/src/app/router/routes.tsx`
- Create: `apps/web/src/features/misc/coming-soon-page.tsx`, `apps/web/src/features/misc/not-found-page.tsx`
- Create: `apps/web/src/features/landing/landing-page.tsx` (provisoire — voir amendement)
- Test: `apps/web/src/app/layouts/app-sidebar.test.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Déclarer la navigation**

`apps/web/src/constants/navigation.ts` — les neuf entrées du cahier des charges sont déclarées dès maintenant. `available: false` fait pointer l'entrée vers la page « Bientôt disponible » ; chaque tranche suivante bascule la sienne à `true`.

```ts
import {
  BarChart3,
  Bell,
  Briefcase,
  FileText,
  Heart,
  LayoutDashboard,
  Send,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** false tant que la tranche qui livre l'écran n'est pas terminée. */
  available: boolean;
  /** Affichée dans la bottom navigation mobile (5 entrées maximum). */
  primary: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, available: false, primary: true },
  { to: '/jobs', label: 'Offres', icon: Briefcase, available: false, primary: true },
  { to: '/applications', label: 'Mes candidatures', icon: Send, available: false, primary: true },
  { to: '/resume', label: 'Mon CV', icon: FileText, available: false, primary: true },
  { to: '/automation', label: 'Automatisation', icon: Zap, available: false, primary: false },
  { to: '/analytics', label: 'Statistiques', icon: BarChart3, available: false, primary: false },
  { to: '/favorites', label: 'Favoris', icon: Heart, available: false, primary: false },
  { to: '/alerts', label: 'Alertes', icon: Bell, available: false, primary: false },
  { to: '/settings', label: 'Paramètres', icon: Settings, available: false, primary: false },
];
```

- [ ] **Step 2: Écrire le test qui échoue**

`apps/web/src/app/layouts/app-sidebar.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/constants/navigation';
import { AppSidebar } from './app-sidebar';

describe('AppSidebar', () => {
  it('affiche les neuf entrées de navigation du produit', () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(NAV_ITEMS).toHaveLength(9);
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('link', { name: new RegExp(item.label, 'i') })).toBeInTheDocument();
    }
  });

  it('marque « Bientôt » les entrées dont la tranche n_est pas livrée', () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    const pending = NAV_ITEMS.filter((item) => !item.available);
    expect(screen.getAllByText('Bientôt')).toHaveLength(pending.length);
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test app-sidebar`
Expected: FAIL — `Failed to resolve import "./app-sidebar"`.

- [ ] **Step 4: Implémenter la sidebar**

`apps/web/src/app/layouts/app-sidebar.tsx` :

```tsx
import { NavLink } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { Badge } from '@/components/ui/badge';
import { NAV_ITEMS } from '@/constants/navigation';
import { cn } from '@/lib/utils';

export function AppSidebar() {
  return (
    <aside className="bg-sidebar border-sidebar-border hidden w-60 shrink-0 flex-col border-r lg:flex">
      <div className="px-5 py-5">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Navigation principale">
        {NAV_ITEMS.map(({ to, label, icon: Icon, available }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {!available && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                Bientôt
              </Badge>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5: Implémenter la navigation mobile et la coquille**

`apps/web/src/app/layouts/app-bottom-nav.tsx` :

```tsx
import { MoreHorizontal } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NAV_ITEMS } from '@/constants/navigation';
import { cn } from '@/lib/utils';

const PRIMARY = NAV_ITEMS.filter((item) => item.primary);
const SECONDARY = NAV_ITEMS.filter((item) => !item.primary);

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex flex-1 flex-col items-center gap-1 py-2 text-[11px]',
    isActive ? 'text-primary' : 'text-muted-foreground',
  );

export function AppBottomNav() {
  return (
    <nav
      className="bg-background border-border fixed inset-x-0 bottom-0 z-40 flex border-t lg:hidden"
      aria-label="Navigation principale"
    >
      {PRIMARY.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={linkClass}>
          <Icon className="size-5" />
          <span className="truncate px-1">{label}</span>
        </NavLink>
      ))}

      <Sheet>
        <SheetTrigger className="text-muted-foreground flex flex-1 flex-col items-center gap-1 py-2 text-[11px]">
          <MoreHorizontal className="size-5" />
          Plus
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetTitle className="mb-4">Navigation</SheetTitle>
          <div className="flex flex-col">
            {SECONDARY.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-3 text-sm"
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
```

`apps/web/src/app/layouts/app-layout.tsx` :

```tsx
import { Outlet } from 'react-router-dom';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { AppBottomNav } from './app-bottom-nav';
import { AppSidebar } from './app-sidebar';

export function AppLayout() {
  return (
    <div className="bg-background flex min-h-screen">
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex h-14 items-center justify-end gap-2 border-b px-4 lg:px-8">
          <ThemeToggle />
        </header>

        {/* pb-20 laisse la place à la bottom navigation sur mobile. */}
        <main className="flex-1 px-4 py-6 pb-20 lg:px-8 lg:pb-6">
          <Outlet />
        </main>
      </div>

      <AppBottomNav />
    </div>
  );
}
```

- [ ] **Step 6: Implémenter les pages « Bientôt » et 404**

`apps/web/src/features/misc/coming-soon-page.tsx` :

```tsx
import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { NAV_ITEMS } from '@/constants/navigation';

export function ComingSoonPage() {
  const { pathname } = useLocation();
  const label = NAV_ITEMS.find((item) => item.to === pathname)?.label ?? 'Cette section';

  return (
    <EmptyState
      icon={Construction}
      title={`${label} arrive bientôt`}
      description="Cette section n'est pas encore disponible. Elle sera activée dans une prochaine version de JobTrack."
    />
  );
}
```

`apps/web/src/features/misc/not-found-page.tsx` :

```tsx
import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-10" />
      <p className="text-muted-foreground text-sm font-medium">Erreur 404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Cette page n'existe pas.</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm">
        Le lien est peut-être incorrect ou la page a été déplacée.
      </p>
      <Button asChild className="mt-8">
        <Link to="/dashboard">Retour au dashboard</Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: Câbler le routeur**

`apps/web/src/features/landing/landing-page.tsx` — **provisoire**, remplacé en tâche 12 :

```tsx
import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';

/** Page d'accueil provisoire. La landing complète arrive en tâche 12. */
export function LandingPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <h1 className="text-3xl font-semibold tracking-tight">Toutes vos opportunités. Un seul endroit.</h1>
      <Button asChild>
        <Link to="/dashboard">Ouvrir l'application</Link>
      </Button>
    </div>
  );
}
```

`apps/web/src/app/router/routes.tsx` :

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { NAV_ITEMS } from '@/constants/navigation';
import { LandingPage } from '@/features/landing/landing-page';
import { ComingSoonPage } from '@/features/misc/coming-soon-page';
import { NotFoundPage } from '@/features/misc/not-found-page';
import { AppLayout } from '../layouts/app-layout';

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  {
    element: <AppLayout />,
    // En tranche 0 toutes les entrées mènent à « Bientôt disponible ».
    // Chaque tranche suivante remplace sa route par le véritable écran.
    children: NAV_ITEMS.map((item) => ({ path: item.to, element: <ComingSoonPage /> })),
  },
  { path: '*', element: <NotFoundPage /> },
]);
```

`apps/web/src/main.tsx` :

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppToaster } from './app/providers/app-toaster';
import { ThemeProvider } from './app/providers/theme-provider';
import { router } from './app/router/routes';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
      <AppToaster />
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 17 tests au total (14 + 3 sur les constantes de navigation).

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): coquille applicative, navigation definitive et page 404"
```

---

## Task 11: Client API et TanStack Query

> **Amendement après revue.** (1) Le test du 401 utilise `toMatchObject` sur `status`, `code` et `message` — `toThrowError(instance)` ne compare que le message. (2) `Content-Type: application/json` n'est posé que si `init.body` est une chaîne : un `FormData` (import de CV, tranche 2) doit laisser le navigateur écrire `multipart/form-data` et sa frontière. (3) `BASE_URL` perd sa barre finale : Fastify ne tolère pas `//health` (404 vérifié). (4) **`HealthReport` vit dans `packages/shared/src/health.ts`** et est importé par `apps/api` et `apps/web` — pas de DTO dupliqué. 24 tests web après cette tâche (7 client).

> **Amendement.** (1) `import.meta.env` n'est typé que si `vite/client` est référencé : cette tâche crée `apps/web/src/vite-env.d.ts` (fichier standard du scaffold Vite, jamais créé jusqu'ici) avec la déclaration de `VITE_API_URL`. (2) `main.tsx` conserve `AppToaster` (tâche 8). (3) 17 tests existent déjà ; on en attend 22 après cette tâche. (4) **Les en-têtes sont fusionnés via `new Headers(init.headers)`**, jamais par spread d'objet : un spread sur une instance `Headers` donne `{}` et perdrait l'en-tête CSRF de la tranche 1 sans erreur de type. Un test le garantit.

Ce client est le seul point de sortie HTTP de l'application. Toutes les tranches suivantes l'utilisent — d'où l'importance de fixer ici `credentials: 'include'` (indispensable au cookie de session de la tranche 1) et le format d'erreur lisible.

**Files:**
- Create: `apps/web/src/services/api/client.ts`, `apps/web/src/services/api/health.ts`
- Create: `apps/web/src/app/providers/query-provider.tsx`
- Create: `apps/web/src/vite-env.d.ts`
- Test: `apps/web/src/services/api/client.test.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/web/src/services/api/client.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('apiRequest', () => {
  it('renvoie le corps json et transmet les cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/health')).resolves.toEqual({ status: 'ok' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });

  it('lève une ApiError portant le message lisible du serveur', async () => {
    stubFetch(Response.json({ message: 'Identifiants invalides.', code: 'INVALID_CREDENTIALS' }, { status: 401 }));

    await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toThrowError(
      new ApiError('Identifiants invalides.', 401, 'INVALID_CREDENTIALS'),
    );
  });

  it('remplace une reponse illisible par un message francais generique', async () => {
    stubFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      status: 502,
      message: 'Une erreur est survenue. Veuillez réessayer.',
    });
  });

  it('signale une panne reseau avec un message comprehensible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      status: 0,
      message: 'Connexion au serveur impossible. Vérifiez votre connexion internet.',
    });
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @jobtrack/web test client`
Expected: FAIL — `Failed to resolve import "./client"`.

- [ ] **Step 3: Implémenter le client**

`apps/web/src/vite-env.d.ts` — types de Vite et contrat des variables d'environnement du frontend :

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL de base de l'API, avec le préfixe `/api/v1`. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`apps/web/src/services/api/client.ts` :

```ts
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

const GENERIC_MESSAGE = 'Une erreur est survenue. Veuillez réessayer.';
const NETWORK_MESSAGE = 'Connexion au serveur impossible. Vérifiez votre connexion internet.';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  message?: unknown;
  code?: unknown;
}

async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    // Réponse non-JSON (proxy, passerelle) : on ne montre jamais le HTML brut.
    return {};
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  // `new Headers()` accepte les trois formes de HeadersInit ; un spread d'objet
  // sur une instance Headers donnerait `{}` et perdrait silencieusement les en-têtes.
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      // Indispensable : le cookie de session est httpOnly et cross-origin en développement.
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    const message = typeof body.message === 'string' ? body.message : GENERIC_MESSAGE;
    const code = typeof body.code === 'string' ? body.code : undefined;
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
```

`apps/web/src/services/api/health.ts` :

```ts
import type { HealthReport } from '@jobtrack/shared';
import { apiRequest } from './client';

export type { HealthReport };

export function fetchHealth(): Promise<HealthReport> {
  return apiRequest<HealthReport>('/health');
}
```

- [ ] **Step 4: Écrire le provider TanStack Query**

`apps/web/src/app/providers/query-provider.tsx` :

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/services/api/client';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Ne jamais réessayer une erreur d'authentification ou de validation.
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 5: Brancher le provider**

Dans `apps/web/src/main.tsx`, envelopper le `RouterProvider` :

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppToaster } from './app/providers/app-toaster';
import { QueryProvider } from './app/providers/query-provider';
import { ThemeProvider } from './app/providers/theme-provider';
import { router } from './app/router/routes';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable dans index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryProvider>
        <RouterProvider router={router} />
        <AppToaster />
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: Lancer les tests**

Run: `pnpm --filter @jobtrack/web test`
Expected: PASS — 24 tests au total.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): client api unique et provider tanstack query"
```

---

## Task 12: Landing page

> **Amendement après revue.** (1) `e2e/*.ts` est retiré de `allowDefaultProject` de la fabrique ESLint (le `include` du tsconfig le couvre, en typé) et le script `lint` de `apps/web` devient `eslint src e2e` — sinon les specs Playwright n'étaient jamais lintées. (2) `Section` porte `scroll-mt-20` pour que l'ancre `#comment-ca-marche` ne passe pas sous l'en-tête collant. (3) L'offre Pro porte un `<Badge>Recommandé</Badge>`, la bordure seule étant à peine perceptible. Mouvement réduit vérifié : avec `prefers-reduced-motion`, le hero rend à `opacity: 1` sans transition.

> **Amendement.** (1) Le profil Playwright `iPhone 13` impose WebKit, que le plan n'installe pas : le projet mobile utilise `devices['Pixel 7']` (Chromium). (2) Cette tâche enveloppe `RouterProvider` et `AppToaster` dans `<MotionConfig reducedMotion="user">` dans `main.tsx` — première animation Framer Motion du projet. (3) Les liens `/login` et `/register` mènent à la page 404 jusqu'à la tranche 1 : c'est attendu. (4) `landing-page.tsx` provisoire de la tâche 10 est remplacé intégralement.

Une section = un fichier. Le composant `Section` porte l'espacement et la largeur communes ; aucune section ne redéfinit sa propre grille.

**Point de vigilance (spec §55) :** les chiffres affichés (120 offres, 68 pertinentes…) sont des illustrations produit, pas des statistiques réelles. Chaque bloc chiffré porte la mention « Exemple illustratif ». Ne jamais les présenter comme des mesures.

**Files:**
- Create: `apps/web/src/features/landing/landing-page.tsx`
- Create: `apps/web/src/features/landing/components/section.tsx`, `landing-header.tsx`, `landing-footer.tsx`, `dashboard-preview.tsx`
- Create: `apps/web/src/features/landing/sections/hero-section.tsx`, `sources-section.tsx`, `analysis-section.tsx`, `resume-section.tsx`, `pipeline-section.tsx`, `stats-section.tsx`, `pricing-section.tsx`
- Modify: `apps/web/src/main.tsx` (`MotionConfig`)
- Test: `apps/web/e2e/landing.spec.ts`, `apps/web/playwright.config.ts`

- [ ] **Step 1: Écrire la primitive de section et l'en-tête**

`apps/web/src/features/landing/components/section.tsx` :

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function Section({ id, eyebrow, title, description, children, className }: SectionProps) {
  return (
    <section id={id} className={cn('border-border/60 border-t px-6 py-20 lg:py-28', className)}>
      <div className="mx-auto max-w-5xl">
        {eyebrow && (
          <p className="text-primary mb-3 text-sm font-medium">{eyebrow}</p>
        )}
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground mt-4 max-w-2xl text-base">{description}</p>
        )}
        {children && <div className="mt-12">{children}</div>}
      </div>
    </section>
  );
}
```

`apps/web/src/features/landing/components/landing-header.tsx` :

```tsx
import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Button } from '@/components/ui/button';

export function LandingHeader() {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-50 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link to="/" aria-label="JobTrack, accueil">
          <Logo />
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" asChild className="hidden sm:inline-flex">
            <Link to="/login">Se connecter</Link>
          </Button>
          <Button asChild>
            <Link to="/register">Commencer gratuitement</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Écrire le hero et l'aperçu du dashboard**

`apps/web/src/features/landing/components/dashboard-preview.tsx` — une composition réelle de cartes plutôt qu'une capture d'écran : elle reste nette à toute résolution et suit le thème.

```tsx
import { Card } from '@/components/ui/card';

const STATS = [
  { value: '120', label: 'Offres trouvées' },
  { value: '36', label: 'Candidatures' },
  { value: '9', label: 'Entretiens' },
  { value: '72%', label: 'Match moyen' },
];

const JOBS = [
  { score: '92%', role: 'Développeur Full Stack', company: 'LuxProvide — Luxembourg' },
  { score: '88%', role: 'Business Analyst', company: 'Société Générale — Metz' },
  { score: '81%', role: 'Data Analyst', company: 'ArcelorMittal — Nancy' },
];

export function DashboardPreview() {
  return (
    <Card className="shadow-lg overflow-hidden p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="bg-muted/60 rounded-lg p-3">
            <p className="text-xl font-semibold">{stat.value}</p>
            <p className="text-muted-foreground text-xs">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {JOBS.map((job) => (
          <div
            key={job.role}
            className="border-border flex items-center gap-3 rounded-lg border p-3"
          >
            <span className="text-primary bg-accent rounded-md px-2 py-1 text-xs font-semibold">
              {job.score}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{job.role}</p>
              <p className="text-muted-foreground truncate text-xs">{job.company}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground mt-4 text-center text-[11px]">Exemple illustratif</p>
    </Card>
  );
}
```

> **Amendement après revue (tâche 6).** Le bloc `prefers-reduced-motion` de `tokens.css` neutralise les animations CSS, mais **pas** Framer Motion, qui anime `transform`/`opacity` en JavaScript. Avant d'ajouter la première animation, envelopper l'application dans `<MotionConfig reducedMotion="user">` (depuis `framer-motion`) dans `apps/web/src/main.tsx`, autour du `RouterProvider`. Sinon la promesse « respecter le réglage système » du cahier des charges est fausse pour tout ce qui bouge dans l'app.

`apps/web/src/features/landing/sections/hero-section.tsx` :

```tsx
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DashboardPreview } from '../components/dashboard-preview';

export function HeroSection() {
  return (
    <section className="px-6 pt-20 pb-16 lg:pt-28">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <h1 className="text-4xl font-semibold tracking-tight text-balance lg:text-6xl">
            Toutes vos opportunités.
            <br />
            <span className="text-muted-foreground">Un seul endroit.</span>
          </h1>

          <p className="text-muted-foreground mt-6 max-w-xl text-lg">
            JobTrack centralise vos recherches d'emploi, analyse les opportunités et vous aide à
            postuler plus intelligemment.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link to="/register">Commencer gratuitement</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#comment-ca-marche">Voir comment ça marche</a>
            </Button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          className="mt-16"
        >
          <DashboardPreview />
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Écrire les sections « Recherchez partout » et « L'IA analyse »**

`apps/web/src/features/landing/sections/sources-section.tsx` — seules les sources réellement accessibles (spec §1) sont annoncées comme connectées ; les autres portent la mention « candidature assistée ».

```tsx
import { Check } from 'lucide-react';
import { Section } from '../components/section';

const SOURCES = [
  { name: 'France Travail', mode: 'API officielle' },
  { name: 'Adzuna', mode: 'API officielle' },
  { name: 'Jooble', mode: 'API officielle' },
  { name: 'Remotive', mode: 'API officielle' },
  { name: 'LinkedIn', mode: 'Candidature assistée' },
  { name: 'Indeed', mode: 'Candidature assistée' },
];

export function SourcesSection() {
  return (
    <Section
      id="comment-ca-marche"
      eyebrow="Sources"
      title="Recherchez partout"
      description="JobTrack agrège les offres des plateformes qui autorisent l'accès automatisé, et prépare vos candidatures sur les autres. Aucune protection n'est contournée."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.map((source) => (
          <div
            key={source.name}
            className="border-border flex items-center gap-3 rounded-lg border p-4"
          >
            <Check className="text-primary size-4 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{source.name}</p>
              <p className="text-muted-foreground text-xs">{source.mode}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
```

`apps/web/src/features/landing/sections/analysis-section.tsx` :

```tsx
import { Section } from '../components/section';

const FIGURES = [
  { value: '120', label: 'offres trouvées' },
  { value: '68', label: 'pertinentes' },
  { value: '24', label: 'fortes priorités' },
  { value: '12', label: 'nouvelles aujourd’hui' },
];

export function AnalysisSection() {
  return (
    <Section
      eyebrow="Analyse"
      title="L'IA analyse les offres pour vous"
      description="Chaque offre est comparée à votre profil : compétences, expérience, localisation, salaire, contrat. Vous obtenez un score de correspondance expliqué, pas une probabilité inventée."
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {FIGURES.map((figure) => (
          <div key={figure.label} className="border-border rounded-xl border p-6">
            <p className="text-3xl font-semibold tracking-tight">{figure.value}</p>
            <p className="text-muted-foreground mt-1 text-sm">{figure.label}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-xs">Exemple illustratif</p>
    </Section>
  );
}
```

- [ ] **Step 4: Écrire les sections CV, candidatures, statistiques et tarifs**

`apps/web/src/features/landing/sections/resume-section.tsx` :

```tsx
import { ArrowDown } from 'lucide-react';
import { Section } from '../components/section';

const STEPS = ['CV Full Stack', 'Analyse de l’offre', 'CV Business Analyst'];

export function ResumeSection() {
  return (
    <Section
      eyebrow="CV adapté"
      title="Un CV adapté à chaque offre"
      description="JobTrack réorganise et reformule vos expériences réelles pour coller à l'offre visée. Rien n'est inventé : ni diplôme, ni entreprise, ni compétence que vous n'avez pas."
    >
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
        {STEPS.map((step, index) => (
          <div key={step} className="flex w-full flex-col items-center gap-3">
            <div
              className={
                index === 1
                  ? 'border-primary/40 bg-accent text-accent-foreground w-full rounded-lg border p-4 text-center text-sm font-medium'
                  : 'border-border w-full rounded-lg border p-4 text-center text-sm font-medium'
              }
            >
              {step}
            </div>
            {index < STEPS.length - 1 && <ArrowDown className="text-muted-foreground size-4" />}
          </div>
        ))}
      </div>
    </Section>
  );
}
```

`apps/web/src/features/landing/sections/pipeline-section.tsx` :

```tsx
import { Section } from '../components/section';

const COLUMNS = [
  { title: 'À postuler', count: 12 },
  { title: 'Candidature envoyée', count: 24 },
  { title: 'Entretien', count: 9 },
  { title: 'Offre', count: 2 },
  { title: 'Refusée', count: 7 },
];

export function PipelineSection() {
  return (
    <Section
      eyebrow="Suivi"
      title="Suivez vos candidatures"
      description="Chaque candidature, son statut, sa source et le CV exact que vous avez envoyé. Plus de tableur à tenir à jour."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((column) => (
          <div key={column.title} className="bg-muted/60 rounded-lg p-4">
            <p className="text-muted-foreground text-xs font-medium">{column.title}</p>
            <p className="mt-2 text-2xl font-semibold">{column.count}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-xs">Exemple illustratif</p>
    </Section>
  );
}
```

`apps/web/src/features/landing/sections/stats-section.tsx` :

```tsx
import { Section } from '../components/section';

const METRICS = [
  { value: '25%', label: 'taux de réponse moyen', detail: 'mesuré sur vos propres candidatures' },
  { value: '4×', label: 'moins de saisie manuelle', detail: 'plus de tableur à maintenir' },
  { value: '1', label: 'CV par offre', detail: 'généré à partir de votre profil réel' },
];

export function StatsSection() {
  return (
    <Section
      eyebrow="Statistiques"
      title="Sachez ce qui fonctionne vraiment"
      description="Quels CV obtiennent des réponses, quelles sources convertissent, quelles catégories vous répondent. Vos chiffres, pas des moyennes du marché."
    >
      <div className="grid gap-6 sm:grid-cols-3">
        {METRICS.map((metric) => (
          <div key={metric.label}>
            <p className="text-primary text-3xl font-semibold tracking-tight">{metric.value}</p>
            <p className="mt-1 text-sm font-medium">{metric.label}</p>
            <p className="text-muted-foreground mt-1 text-sm">{metric.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-6 text-xs">
        Exemple illustratif. JobTrack n'affiche que des statistiques calculées sur vos propres
        candidatures.
      </p>
    </Section>
  );
}
```

`apps/web/src/features/landing/sections/pricing-section.tsx` :

```tsx
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Section } from '../components/section';

const PLANS = [
  {
    name: 'Gratuit',
    price: '0 €',
    period: '',
    description: 'Pour commencer votre recherche.',
    features: [
      'Recherche multi-sources',
      'Profil et CV principal',
      'Suivi de 20 candidatures',
      'Score de correspondance',
    ],
    cta: 'Commencer gratuitement',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '12 €',
    period: '/ mois',
    description: 'Pour une recherche active.',
    features: [
      'Candidatures illimitées',
      'CV adapté à chaque offre',
      'Lettres de motivation',
      'Alertes instantanées',
      'Statistiques avancées',
    ],
    cta: 'Essayer Pro',
    highlighted: true,
  },
];

export function PricingSection() {
  return (
    <Section eyebrow="Tarifs" title="Simple et sans engagement">
      <div className="grid gap-5 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <Card
            key={plan.name}
            className={cn('p-6', plan.highlighted && 'border-primary/40 shadow-md')}
          >
            <p className="text-sm font-medium">{plan.name}</p>
            <p className="mt-3">
              <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
              <span className="text-muted-foreground text-sm">{plan.period}</span>
            </p>
            <p className="text-muted-foreground mt-2 text-sm">{plan.description}</p>

            <ul className="mt-6 space-y-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              className="mt-8 w-full"
              variant={plan.highlighted ? 'default' : 'outline'}
              asChild
            >
              <Link to="/register">{plan.cta}</Link>
            </Button>
          </Card>
        ))}
      </div>
    </Section>
  );
}
```

- [ ] **Step 5: Écrire le pied de page, assembler et activer le respect du mouvement réduit**

`apps/web/src/main.tsx` — envelopper le routeur et le toaster :

```tsx
import { MotionConfig } from 'framer-motion';
// … imports existants …

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryProvider>
        {/* reducedMotion="user" : Framer Motion respecte prefers-reduced-motion, que le CSS seul ne couvre pas. */}
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} />
          <AppToaster />
        </MotionConfig>
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

`apps/web/src/features/landing/components/landing-footer.tsx` :

```tsx
import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';

export function LandingFooter() {
  return (
    <footer className="border-border/60 border-t px-6 py-12">
      <div className="text-muted-foreground mx-auto flex max-w-5xl flex-col gap-6 text-sm sm:flex-row sm:items-center sm:justify-between">
        <Logo className="text-foreground" />
        <nav className="flex flex-wrap gap-6" aria-label="Liens de pied de page">
          <Link to="/login" className="hover:text-foreground">
            Se connecter
          </Link>
          <Link to="/register" className="hover:text-foreground">
            Créer un compte
          </Link>
        </nav>
        <p>© {new Date().getFullYear()} JobTrack</p>
      </div>
    </footer>
  );
}
```

`apps/web/src/features/landing/landing-page.tsx` :

```tsx
import { LandingFooter } from './components/landing-footer';
import { LandingHeader } from './components/landing-header';
import { AnalysisSection } from './sections/analysis-section';
import { HeroSection } from './sections/hero-section';
import { PipelineSection } from './sections/pipeline-section';
import { PricingSection } from './sections/pricing-section';
import { ResumeSection } from './sections/resume-section';
import { SourcesSection } from './sections/sources-section';
import { StatsSection } from './sections/stats-section';

export function LandingPage() {
  return (
    <div className="bg-background min-h-screen">
      <LandingHeader />
      <main>
        <HeroSection />
        <SourcesSection />
        <AnalysisSection />
        <ResumeSection />
        <PipelineSection />
        <StatsSection />
        <PricingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
```

- [ ] **Step 6: Écrire le test end-to-end**

`apps/web/playwright.config.ts` :

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Pixel 7 et non iPhone 13 : le profil iPhone impose WebKit, que l'on n'installe pas.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
```

`apps/web/e2e/landing.spec.ts` :

```ts
import { expect, test } from '@playwright/test';

test('la landing affiche toutes ses sections', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Toutes vos opportunités.');
  await expect(page.getByRole('heading', { name: 'Recherchez partout' })).toBeVisible();
  await expect(page.getByRole('heading', { name: "L'IA analyse les offres pour vous" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Un CV adapté à chaque offre' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suivez vos candidatures' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sachez ce qui fonctionne vraiment' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Simple et sans engagement' })).toBeVisible();
});

test('la page ne defile jamais horizontalement', async ({ page }) => {
  await page.goto('/');
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test('une url inconnue affiche la page 404', async ({ page }) => {
  await page.goto('/cette-page-nexiste-pas');
  await expect(page.getByText("Cette page n'existe pas.")).toBeVisible();
});

test('le theme sombre est applique sans flash', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jobtrack-theme', 'dark'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
});
```

- [ ] **Step 7: Lancer les tests**

Run: `pnpm --filter @jobtrack/web exec playwright install --with-deps chromium`
Expected: le navigateur est installé.

Run: `pnpm --filter @jobtrack/web test:e2e`
Expected: PASS — 8 tests (4 scénarios × desktop et mobile).

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): landing page complete avec ses sept sections"
```

---

## Task 13: Intégration continue et recette

> **Amendement.** La CI n'exécute que les tests unitaires ; les tests Playwright en CI (installation du navigateur, `webServer` qui démarre `pnpm dev`) sont un suivi de tranche 1. `node-version: 20` résout un 20.x ≥ 20.19 — requis pour `import.meta.dirname` et `require(esm)` ; la machine de développement est en Node 26.

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: Écrire le workflow**

`.github/workflows/ci.yml` :

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: jobtrack
          POSTGRES_PASSWORD: jobtrack
          POSTGRES_DB: jobtrack
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U jobtrack" --health-interval 5s
          --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s
          --health-timeout 5s --health-retries 10

    env:
      NODE_ENV: test
      API_PORT: '3001'
      WEB_ORIGIN: http://localhost:5173
      DATABASE_URL: postgresql://jobtrack:jobtrack@localhost:5432/jobtrack?schema=public
      REDIS_URL: redis://localhost:6379
      SESSION_SECRET: secret-de-test-suffisamment-long-pour-zod

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      # --allow-no-models : le schéma est vide jusqu'à la tranche 1 ; le drapeau reste inoffensif ensuite.
      - run: pnpm --filter @jobtrack/api exec prisma generate --allow-no-models
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
```

- [ ] **Step 2: Écrire le README**

`README.md` :

````markdown
# JobTrack

Plateforme de recherche d'emploi : agrégation multi-sources, analyse des offres,
CV adapté à chaque candidature et suivi complet du processus.

## Démarrage

```bash
cp .env.example .env          # puis SESSION_SECRET=$(openssl rand -base64 48)
docker compose up -d          # Postgres 16 + Redis 7
pnpm install
pnpm --filter @jobtrack/api exec prisma generate --allow-no-models
pnpm dev                      # web sur :5173, api sur :3001
```

### Sans Docker (Homebrew, macOS)

```bash
brew install postgresql@16 redis
brew services start postgresql@16 && brew services start redis
createdb jobtrack
```

Si le port 5432 est déjà occupé par un autre PostgreSQL, changez `port`
dans `/opt/homebrew/var/postgresql@16/postgresql.conf` et reportez le
nouveau port dans le `DATABASE_URL` de votre `.env`.

## Structure

| Dossier | Rôle |
|---------|------|
| `apps/web` | Application React (Vite, Tailwind v4, shadcn/ui) |
| `apps/api` | API NestJS sur adaptateur Fastify |
| `packages/shared` | Schémas Zod partagés — contrat d'API unique |
| `packages/config` | tsconfig, eslint et prettier partagés |

## Commandes

| Commande | Effet |
|----------|-------|
| `pnpm dev` | Démarre web et api |
| `pnpm test` | Tests unitaires de tous les espaces de travail |
| `pnpm lint` | ESLint |
| `pnpm build` | Build de production |
| `pnpm db:migrate` | Applique les migrations Prisma |
| `pnpm --filter @jobtrack/web test:e2e` | Tests Playwright (après `pnpm --filter @jobtrack/web exec playwright install chromium`) |

## Documentation

Les spécifications et les plans d'implémentation sont dans `docs/superpowers/`.
````

- [ ] **Step 3: Recette complète de la tranche**

Vérifier chacun des points suivants avant de déclarer la tranche terminée.

> **Amendement — infrastructure Homebrew.** Sur cette machine les services tournent déjà via `brew services` (voir tâche 2) ; pas de `docker compose`. La recette vérifie simplement que tout démarre depuis un état propre du dépôt.

Run: `pnpm install --frozen-lockfile && pnpm --filter @jobtrack/api exec prisma generate --allow-no-models && pnpm build`
Expected: aucune erreur.

Run (borné, depuis `apps/api`) : `timeout 15 node dist/main.js` puis `curl -s localhost:3001/api/v1/health`

Expected: `{"status":"ok","services":{"database":"up","redis":"up"},...}`.

Run: `pnpm --filter @jobtrack/web test:e2e`
Expected: 8 tests Playwright verts (desktop + mobile).

Ouvrir `http://localhost:5173` :
- [ ] La landing affiche ses sept sections, en français, sans défilement horizontal.
- [ ] Le sélecteur de thème bascule clair / sombre / système ; après rechargement en sombre, **aucun flash blanc**.
- [ ] `http://localhost:5173/jobs` affiche la coquille applicative avec les neuf entrées de navigation, toutes marquées « Bientôt » à ce stade.
- [ ] En largeur mobile, la sidebar est remplacée par la bottom navigation et le bouton « Plus » ouvre le reste des entrées.
- [ ] `http://localhost:5173/nimporte-quoi` affiche la page 404.
- [ ] Au clavier seul (Tab), le focus est visible en violet sur tous les liens et boutons.

Run: `pnpm lint && pnpm build && pnpm test`
Expected: les trois commandes passent sans erreur ni avertissement TypeScript.

Run: `grep -rn ": any\|<any>" apps packages --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: aucun résultat.

- [ ] **Step 4: Commit**

```bash
git add .github README.md
git commit -m "chore: integration continue et documentation de demarrage"
```

---

## Ce que la tranche 0 ne livre pas

Authentification, profil, import de CV, offres, IA, match score, PDF, candidatures, analytics réels, automatisation, abonnement. La tranche 1 enchaîne avec l'authentification et le profil — voir `docs/superpowers/plans/2026-09-15-tranche-1-auth-profil.md`.
