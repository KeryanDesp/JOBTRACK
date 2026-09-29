# Image de l'API JobTrack (NestJS sur Fastify).
#
# Le contexte de build est la RACINE du dépôt, pas ce dossier : l'API dépend de
# `packages/shared` (contrat Zod) et du lockfile pnpm, qui vivent tous les deux au-dessus.
# Chez l'hébergeur, déclarer `dockerfilePath: apps/api/Dockerfile` et `dockerContext: .`.
#
#   docker build -f apps/api/Dockerfile -t jobtrack-api .

# ---------------------------------------------------------------------------
# Étape 1 — dépendances et compilation
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build

# `openssl` : le moteur de requêtes Prisma s'y lie au démarrage, et l'image slim ne l'a pas.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Manifestes et schéma Prisma d'abord : tant qu'aucun d'eux ne change, le cache Docker
# réutilise la couche d'installation, de loin la plus lente. Le schéma en fait partie parce
# que le `postinstall` de la racine lance `prisma generate`, qui le lit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma

# `--filter @jobtrack/api...` : l'API et ses dépendances d'espace de travail seulement. Les
# dépendances du front (Playwright, Chromium) n'ont rien à faire dans l'image de l'API.
RUN pnpm install --frozen-lockfile --filter @jobtrack/api...

# Explicite, et non laissé au `postinstall` de la racine : un `install` filtré n'exécute pas
# forcément les scripts du paquet racine, et une image sans client Prisma généré ne casserait
# qu'au premier appel à la base.
RUN pnpm --filter @jobtrack/api exec prisma generate

COPY packages/ packages/
COPY apps/api/ apps/api/

# `@jobtrack/shared` est consommé par son `dist` (cf. son `exports`) : il se compile avant l'API.
RUN pnpm --filter @jobtrack/shared build \
  && pnpm --filter @jobtrack/api build

# ---------------------------------------------------------------------------
# Étape 2 — image d'exécution
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
ENV NODE_ENV=production

# L'arborescence compilée est reprise telle quelle, dépendances de développement comprises :
# la commande de release (`prisma migrate deploy`) a besoin de la CLI Prisma, qui en fait
# partie. Une image plus petite supposerait d'embarquer cette CLI autrement, pour quelques
# dizaines de mégaoctets — pas le bon arbitrage sur un service qu'on déploie, pas qu'on diffuse.
COPY --from=build /app /app

# `node` plutôt que `root` : l'image officielle fournit cet utilisateur non privilégié, et
# rien ici n'a besoin des droits d'administration. Le dossier de stockage (`STORAGE_DIR`, un
# volume monté) doit lui appartenir — sinon l'import de CV échouera à l'écriture.
USER node

# Valeur par défaut de `API_PORT` ; l'hébergeur peut imposer la sienne via l'environnement.
EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
