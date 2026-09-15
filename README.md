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
