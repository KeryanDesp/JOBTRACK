# Déploiement

JobTrack se déploie en **un seul projet Vercel**, qui porte les deux applications sur le
même domaine (préréglage « Services », décrit dans `vercel.json` à la racine) :

| Service | Quoi | Chemin servi |
|---------|------|--------------|
| `web` | `apps/web`, le SPA (build Vite statique) | tout sauf `/api/*` |
| `api` | `apps/api`, l'API NestJS empaquetée en fonction | `/api/*` |

Partager le domaine n'est pas un détail : le jeton CSRF est un cookie posé par l'API et lu
par le SPA en JavaScript, ce qui n'est possible que si les deux vivent sur le même site.
C'est aussi ce qui permet aux cookies de session de rester en `SameSite=Lax`.

L'API a besoin de deux services de données, branchés depuis le Marketplace Vercel :
**Postgres** (Neon) pour les données et **Redis** (Upstash) pour les sessions et le
plafonnement des requêtes.

---

## 1. Créer le projet

1. Sur Vercel : **Add New → Project**, choisir le dépôt. `vercel.json` porte déjà
   l'installation, les builds, les réécritures et les en-têtes de sécurité des deux services
   — ne rien redéfinir dans l'interface.
2. **Ne pas importer le dépôt une seconde fois** : si un projet `jobtrack` existe déjà,
   Vercel en proposera un `jobtrack-xxxx`, qui ferait doublon sur le même dépôt.

## 2. Brancher Postgres et Redis

Dans le projet, onglet **Storage** :

- **Neon** (Postgres) — injecte `DATABASE_URL` et `DATABASE_URL_UNPOOLED` ;
- **Upstash** (Redis) — injecte `KV_URL`.

Les connecter aux environnements *Production* et *Preview*.

## 3. Les variables d'environnement

Une seule est à saisir à la main, dans **Settings → Environment Variables**, pour
*Production* et *Preview* :

```
SESSION_SECRET = <sortie de : openssl rand -base64 48>
```

Les autres se déduisent au démarrage de l'API (`apps/api/src/config/env.ts`), sans rien
recopier — une valeur saisie explicitement garde toujours la priorité :

| Variable | Déduite de |
|----------|-----------|
| `REDIS_URL` | `KV_URL` (Upstash) |
| `WEB_ORIGIN` | l'URL de production du projet, ou celle du déploiement en prévisualisation |
| `STORAGE_DIR` | `/tmp/jobtrack-storage`, seul dossier inscriptible d'une fonction |

**Pas de `VITE_API_URL`.** Un build de production appelle `/api/v1` sur son propre domaine,
ce qui est exactement la disposition de `vercel.json`. Si la variable existe dans le projet
— reliquat d'une configuration précédente —, **la supprimer** ou lui donner la valeur
`/api/v1` : une ancienne valeur (`http://localhost:3001/…`, une API hébergée ailleurs) est
figée dans le bundle au build, et chaque appel du site échoue, inscription comprise.

Changer une variable n'agit qu'au **déploiement suivant** : relancer un déploiement
(**Deployments → … → Redeploy**) après chaque modification.

## 4. Déployer

Chaque fusion dans `main` déclenche un déploiement de production ; chaque branche poussée,
une prévisualisation.

Les migrations Prisma s'appliquent au build du service `api` (`prisma migrate deploy` sur
`DATABASE_URL_UNPOOLED`, retenté trois fois : une base Neon endormie met quelques secondes à
répondre). Un build qui échoue sur une migration ne met rien en ligne.

Vérifier ensuite que l'API répond :

```bash
curl https://<projet>.vercel.app/api/v1/health
```

La réponse dit si Postgres et Redis sont joignables. Une 500 sur toutes les routes signale
presque toujours une variable manquante (`SESSION_SECRET` d'abord) : l'API valide son
environnement au démarrage et refuse de servir sans lui. Le détail est dans les journaux de
la fonction (**Deployments → le déploiement → Logs**).

---

## 5. Ce qui reste facultatif

L'API démarre sans ces variables ; la fonctionnalité correspondante est simplement
désactivée, et `/api/v1/health` le signale.

| Variable | Sans elle |
|----------|-----------|
| `ANTHROPIC_API_KEY` | Pas d'extraction de CV ni d'adaptation par IA |
| `FRANCE_TRAVAIL_CLIENT_ID` / `_SECRET` | Aucune offre réelle : `/jobs` reste vide |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL` | Pas de connexion Google (l'e-mail et le mot de passe fonctionnent) |

Pour Google, l'URL de rappel est `https://<projet>.vercel.app/api/v1/auth/google/callback`,
déclarée à l'identique dans la console Google Cloud.

---

## 6. Points de vigilance

- **Les CV importés ne sont pas conservés.** Le dossier `/tmp` d'une fonction est éphémère
  et propre à chaque instance : le fichier n'est lu que le temps de l'extraction. Garder les
  originaux supposerait un stockage objet — `FileStorage` est une interface, c'est
  l'implémentation `DiskFileStorage` qu'il faudrait doubler.
- **Compte de démonstration.** `pnpm db:seed` crée `demo@jobtrack.local / DemoJobTrack2026!`.
  Utile en local, **à ne jamais lancer sur la base de production** : c'est un mot de passe
  public.
- **Les secrets.** Aucun ne doit entrer dans le dépôt : ils vivent dans les variables du
  projet Vercel.
- **Régénérer `SESSION_SECRET`** déconnecte tout le monde et invalide les jetons CSRF en
  circulation. Ne le faire que délibérément.
