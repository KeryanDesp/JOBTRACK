# Déploiement

JobTrack se déploie en deux morceaux, sur deux hébergeurs :

| Morceau | Quoi | Où | Configuré par |
|---------|------|----|---------------|
| SPA | `apps/web`, un build statique | Vercel | `vercel.json` (racine) |
| API | `apps/api`, un serveur Node | Render | `render.yaml` + `apps/api/Dockerfile` |

L'API a besoin de trois choses que le SPA n'a pas : **Postgres** (les données), **Redis**
(les sessions) et un **disque persistant** (les CV importés). `render.yaml` les déclare.

Rien n'oblige à utiliser Render : le `Dockerfile` est standard et tourne tel quel sur
Fly.io, Railway ou un VPS. Seul `render.yaml` est spécifique.

---

## 1. L'API

1. Pousser la branche sur GitHub.
2. Sur Render : **New → Blueprint**, choisir le dépôt. Render lit `render.yaml` et propose
   de créer les trois ressources (`jobtrack-postgres`, `jobtrack-keyvalue`, `jobtrack-api`).
3. Render demande les variables marquées `sync: false`. Au premier passage, seule
   `WEB_ORIGIN` bloque — et l'URL du SPA n'existe pas encore. Mettre une valeur provisoire
   (`https://exemple.vercel.app`), elle sera corrigée à l'étape 3.
4. Laisser le déploiement se terminer. L'URL de l'API ressemble à
   `https://jobtrack-api.onrender.com`.

Vérifier que l'API répond :

```bash
curl https://jobtrack-api.onrender.com/api/v1/health
```

La réponse dit si Postgres et Redis sont joignables. Tant qu'elle ne l'est pas, inutile de
continuer : le SPA ne pourra rien afficher.

### Migrations

`preDeployCommand` (dans `render.yaml`) applique `prisma migrate deploy` avant que la
nouvelle version prenne le trafic. **Cette option demande un plan payant.** Sur plan
gratuit, la retirer et lancer la commande à la main depuis le shell du service après chaque
déploiement qui ajoute une migration :

```bash
pnpm --filter @jobtrack/api exec prisma migrate deploy
```

### Compte de démonstration

`pnpm db:seed` crée `demo@jobtrack.local / DemoJobTrack2026!`. Utile pour tester, **à ne pas
lancer sur une base qui sert à de vrais comptes** : c'est un mot de passe public.

---

## 2. Le SPA

1. Sur Vercel : **Add New → Project**, choisir le dépôt. `vercel.json` porte déjà la
   commande d'installation, celle de build, le dossier de sortie, la réécriture SPA et les
   en-têtes de sécurité — ne rien redéfinir dans l'interface.
2. Une seule variable d'environnement, **au moment du build** (le SPA est statique : elle
   est figée dans le bundle, la changer impose un redéploiement) :

   ```
   VITE_API_URL = https://jobtrack-api.onrender.com/api/v1
   ```

   Le suffixe `/api/v1` fait partie de la valeur — l'API monte toutes ses routes derrière ce
   préfixe.
3. Déployer. L'URL du SPA ressemble à `https://jobtrack.vercel.app`.

---

## 3. Relier les deux

C'est l'étape qu'on oublie, et elle casse la connexion en silence.

Sur Render, corriger `WEB_ORIGIN` avec l'URL **exacte** du SPA — protocole compris, sans
barre finale :

```
WEB_ORIGIN = https://jobtrack.vercel.app
```

Puis redéployer l'API. `WEB_ORIGIN` borne le CORS : une valeur fausse fait échouer chaque
appel du navigateur.

### Pourquoi `COOKIE_SAMESITE=none`

`*.vercel.app` et `*.onrender.com` sont deux domaines enregistrables différents. Un cookie
`SameSite=Lax` n'est alors pas envoyé sur les appels `fetch` : l'utilisateur se connecte, le
serveur pose la session, et la requête suivante repart anonyme. Aucun message d'erreur, juste
une application qui renvoie sans cesse vers la page de connexion.

`render.yaml` pose donc `COOKIE_SAMESITE=none`, qui force aussi `Secure` (HTTPS obligatoire).
Cela n'ouvre pas de faille CSRF : la protection ne repose pas sur `SameSite` mais sur un
jeton dérivé de la session (`CsrfGuard`), attendu dans un en-tête qu'un site tiers ne peut
ni lire (le CORS est limité à `WEB_ORIGIN`) ni forger.

Le jour où les deux partagent un domaine — `app.jobtrack.fr` et `api.jobtrack.fr` —
repasser à `lax`, qui est plus strict.

---

## 4. Ce qui reste facultatif

L'API démarre sans ces variables ; la fonctionnalité correspondante est simplement
désactivée, et `/api/v1/health` le signale.

| Variable | Sans elle |
|----------|-----------|
| `ANTHROPIC_API_KEY` | Pas d'extraction de CV ni d'adaptation par IA |
| `FRANCE_TRAVAIL_CLIENT_ID` / `_SECRET` | Aucune offre réelle : `/jobs` reste vide |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL` | Pas de connexion Google (l'e-mail et le mot de passe fonctionnent) |

Pour Google, l'URL de rappel doit être **celle de l'API**, pas celle du SPA :
`https://jobtrack-api.onrender.com/api/v1/auth/google/callback`, et déclarée à l'identique
dans la console Google Cloud.

---

## 5. Points de vigilance

- **Le disque.** Sans le volume déclaré dans `render.yaml`, les CV importés disparaissent à
  chaque redéploiement : le système de fichiers d'un conteneur est éphémère. Les plans
  gratuits n'offrent pas de disque persistant — c'est la principale raison de passer à un
  plan payant. Le dossier monté doit appartenir à l'utilisateur `node` (celui de l'image),
  sinon l'import échoue à l'écriture.
- **La mise en veille.** Sur les plans gratuits, un service inactif s'endort : la première
  requête met une trentaine de secondes. Ce n'est pas une panne.
- **Une seule instance.** Rien n'interdit d'en lancer plusieurs (les sessions sont dans
  Redis, pas en mémoire), sauf le disque : un volume Render n'est monté que sur une
  instance. Passer à plusieurs suppose de déplacer le stockage des CV vers un service objet
  (S3 ou équivalent) — `FileStorage` est une interface, c'est l'implémentation
  `DiskFileStorage` qu'il faudrait doubler.
- **Les secrets.** Aucun ne doit entrer dans le dépôt. `render.yaml` ne contient que des
  `sync: false` (valeur saisie dans l'interface) et un `generateValue` pour `SESSION_SECRET`.
- **Régénérer `SESSION_SECRET`** déconnecte tout le monde et invalide les jetons CSRF en
  circulation. Ne le faire que délibérément.
