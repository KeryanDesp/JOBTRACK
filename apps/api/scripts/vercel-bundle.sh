#!/usr/bin/env bash
# Empaquetage autonome de l'API pour une fonction Vercel (préréglage « Services »).
#
# Le builder Vercel (@vercel/backends) bundle lui-même avec rolldown puis trace les modules
# externes avec @vercel/nft ; dans un monorepo pnpm cette chaîne a laissé successivement
# `reflect-metadata` puis `dotenv` introuvables à l'exécution (voir jobtrack-deploiement).
# On lui livre donc un dossier `dist-vercel/` qui se suffit à lui-même :
#   - `bundle.js` (chargé par l'amorce versionnée `main.js`) : l'API compilée par `nest build` puis bundlée par esbuild en un seul fichier
#     CommonJS (toutes les dépendances JavaScript incluses, `@jobtrack/shared` compris) ;
#   - `node_modules/` : uniquement les deux paquets qui ne se bundlent pas (binaires natifs) —
#     `argon2` et `@prisma/client` — installés par npm avec leurs dépendances, plus le client
#     Prisma généré (`.prisma/client`, moteur `rhel-openssl-3.0.x` inclus grâce à `binaryTargets`).
# Vercel prend `dist-vercel/` tel quel (`outputDirectory`), `main.js` en point d'entrée : la
# résolution de `argon2` et `@prisma/client` se fait dans `dist-vercel/node_modules`, à côté.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=dist-vercel
# `main.js` (amorce versionnée) reste en place ; tout le reste est régénéré.
rm -rf "$OUT/bundle.js" "$OUT/node_modules" "$OUT/package.json"
mkdir -p "$OUT"

# 1. Bundle : `nest build` a déjà produit dist/main.js (décorateurs et métadonnées émis par tsc).
#    Les modules optionnels que NestJS/Fastify tentent de charger sans qu'ils soient installés
#    restent externes (ils ne sont jamais atteints à l'exécution).
pnpm exec esbuild dist/main.js \
  --bundle --platform=node --target=node24 --format=cjs \
  --outfile="$OUT/bundle.js" \
  --external:argon2 --external:@prisma/client --external:.prisma/client \
  --external:@nestjs/microservices --external:@nestjs/websockets --external:@nestjs/websockets/socket-module \
  --external:@nestjs/platform-express --external:class-validator --external:class-transformer \
  --external:@fastify/static --external:@fastify/view \
  --log-level=warning

# 2. Modules natifs : versions exactes du package.json de l'API, installées par npm (binaires
#    précompilés Linux x64 pour argon2), sans scripts postinstall superflus ni devDependencies.
ARGON2_VERSION=$(node -p "require('./package.json').dependencies['argon2']")
PRISMA_CLIENT_VERSION=$(node -p "require('./package.json').dependencies['@prisma/client']")
cat > "$OUT/package.json" <<JSON
{ "name": "jobtrack-api-vercel", "private": true, "type": "commonjs", "main": "main.js",
  "dependencies": { "argon2": "$ARGON2_VERSION", "@prisma/client": "$PRISMA_CLIENT_VERSION" } }
JSON
( cd "$OUT" && npm install --omit=dev --no-package-lock --no-audit --no-fund --ignore-scripts --loglevel=error )
# `@prisma/client` a besoin de son postinstall ? Non : le client généré est copié ci-dessous.

# 3. Client Prisma généré (`.prisma/client`), trouvé à côté du paquet @prisma/client du workspace
#    (même chemin relatif en disposition isolée ou hoistée de pnpm).
PRISMA_PKG_DIR=$(node -p "require('path').dirname(require.resolve('@prisma/client/package.json'))")
# Résolution Node depuis le paquet lui-même : c'est ainsi que @prisma/client charge `.prisma/client`.
GENERATED=$(node -p "require('path').dirname(require.resolve('.prisma/client/default', { paths: ['$PRISMA_PKG_DIR'] }))")
test -f "$GENERATED/index.js" || { echo "client Prisma généré introuvable : $GENERATED" >&2; exit 1; }
mkdir -p "$OUT/node_modules/.prisma"
cp -R "$GENERATED" "$OUT/node_modules/.prisma/client"
ls "$OUT/node_modules/.prisma/client" | grep -q "rhel-openssl-3.0.x" || echo "avertissement : moteur rhel-openssl-3.0.x absent (normal hors Linux si binaryTargets n'a pas été régénéré)" >&2

echo "dist-vercel prêt : $(du -sh "$OUT" | cut -f1)"
