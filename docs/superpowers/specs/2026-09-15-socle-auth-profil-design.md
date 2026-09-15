# JobTrack — Tranche 0+1 : Socle, Authentification et Profil

**Date :** 2026-09-15
**Statut :** validé
**Tranche :** 0 (socle + landing) + 1 (auth + profil)

---

## 1. Contexte

JobTrack est une plateforme SaaS de recherche d'emploi qui centralise des offres multi-sources, les analyse, les classe par pertinence réelle, génère des CV adaptés et suit les candidatures.

Le produit complet représente environ 14 écrans, 21 entités, un service IA, des connecteurs multi-sources avec déduplication, de la génération PDF et une file d'auto-candidature. Il est découpé en 9 tranches verticales full-stack, chacune allant du schéma Prisma jusqu'à l'écran et livrant quelque chose d'ouvrable dans un navigateur.

### Découpage retenu

| # | Tranche | Livrable |
|---|---------|----------|
| **0** | Socle + Landing | Monorepo, DB, design system, `/` en ligne, thèmes |
| **1** | Auth + Profil | Inscription, connexion, `/profile` en CRUD réel |
| 2 | Onboarding + Import CV | Upload PDF/DOCX → extraction → profil pré-rempli |
| 3 | Offres | Connecteur France Travail, ingestion, déduplication, `/jobs` |
| 4 | Match Score explicable | Moteur de scoring + panneau « pourquoi cette offre » |
| 5 | CV adapté + PDF | Tailoring IA, versioning, export A4 |
| 6 | Candidatures | Table + Kanban, suivi des statuts |
| 7 | Dashboard + Analytics | Agrégats réels, graphiques, alertes, favoris |
| 8 | Automatisation | Candidature assistée, file de validation |

**Le présent document couvre les tranches 0 et 1, livrées ensemble.**

### Contrainte externe documentée

Sur les sources d'offres citées au cahier des charges, seules certaines offrent un accès automatisé légal. Cette contrainte ne concerne pas la présente tranche mais conditionne la tranche 3 et doit être tracée :

| Source | Accès autorisé |
|--------|----------------|
| France Travail | API publique officielle et gratuite (Offres d'emploi v2) |
| Adzuna, Jooble, Remotive | APIs publiques, agrègent notamment des offres Indeed |
| Indeed | Publisher API fermée aux nouveaux partenaires |
| LinkedIn | Job Search API réservée aux partenaires contractuels |
| Welcome to the Jungle, Glassdoor, Apec | Pas d'API publique ; scraping interdit par les CGU |

Conséquence : l'architecture en connecteurs indépendants est conservée, mais LinkedIn et Indeed relèveront de la **candidature assistée** (préparation des informations + ouverture de l'offre pour validation humaine), jamais de l'auto-candidature. Aucun contournement de CAPTCHA, MFA, anti-bot, rate limit ou authentification.

---

## 2. Décisions d'architecture

| Décision | Choix | Justification |
|----------|-------|---------------|
| Stratégie de construction | Tranches verticales full-stack | Chaque tranche est déployable et rien n'est à réécrire ensuite |
| Framework backend | NestJS sur adaptateur Fastify | Le système de modules épouse les 8 tranches ; `@nestjs/bullmq` et `@nestjs/schedule` couvrent la tranche 8 ; l'adaptateur Fastify conserve les performances |
| Authentification | Cookie de session httpOnly + Redis | App web first-party : aucun token manipulable en JS, révocation serveur immédiate, Redis déjà présent dans la stack |
| Monorepo | pnpm workspaces + Turborepo | Standard, cache de build, pas de configuration exotique |
| Contrat d'API | Schémas Zod partagés dans `packages/shared` | Source de vérité unique : le backend valide et le frontend valide avec le même schéma, les types sont inférés, le contrat ne peut pas dériver |
| Base de données | Postgres 16 en Docker Compose, Prisma | Reproductible en local, migration triviale vers une DB managée |
| Données de développement | Profil de démo fictif et clairement identifié | Aucun document personnel dans le dépôt ; le CV réel reste une fixture locale gitignorée pour la tranche 2 |

---

## 3. Structure du monorepo

```
jobtrack/
├─ apps/
│  ├─ web/                      React 19 · TypeScript · Vite · React Router
│  │  └─ src/
│  │     ├─ app/                router · providers · layouts
│  │     ├─ features/           auth · profile · settings · landing
│  │     ├─ components/         ui (shadcn) · shared
│  │     ├─ services/api/       client HTTP + hooks TanStack Query
│  │     ├─ stores/             Zustand (état UI uniquement)
│  │     ├─ hooks/ utils/ constants/
│  │     └─ styles/             tokens.css
│  └─ api/                      NestJS (adaptateur Fastify)
│     ├─ prisma/                schema.prisma · migrations · seed.ts
│     └─ src/
│        ├─ modules/            auth · profile · health
│        ├─ common/             guards · interceptors · filters · decorators
│        └─ config/             validation Zod de l'environnement
├─ packages/
│  ├─ shared/                   schémas Zod + types (contrat d'API)
│  └─ config/                   tsconfig · eslint · prettier partagés
├─ docker-compose.yml           Postgres 16 + Redis 7
├─ turbo.json
└─ pnpm-workspace.yaml
```

### Architecture frontend

Feature-based, conformément au cahier des charges. Chaque feature expose ses composants, ses hooks et ses types ; elle ne lit jamais dans le dossier `features/` d'une autre. Le partage transite par `components/shared`, `hooks/` ou `services/`.

Règle de taille : un composant a une responsabilité et tient sous ~200 lignes. Au-delà, il est découpé.

---

## 4. Modèle de données

Seules les entités nécessaires à cette tranche sont créées. Les migrations Prisma étant additives, les 12 autres arriveront avec leur tranche sans reprise.

### Entités

**User**
`id` (cuid), `email` (unique, normalisé en minuscules à l'écriture), `passwordHash` (nullable — comptes OAuth purs), `emailVerifiedAt`, `createdAt`, `updatedAt`

**OAuthAccount**
`id`, `userId`, `provider` (enum : `GOOGLE`), `providerAccountId`, `createdAt`
Contrainte unique sur `(provider, providerAccountId)`

**Profile** — relation 1-1 avec `User`
`id`, `userId` (unique), `firstName`, `lastName`, `phone`, `city`, `country`, `title`, `summary`, `yearsExperience`, `avatarUrl`, `createdAt`, `updatedAt`

**Experience** — n-1 avec `Profile`
`id`, `profileId`, `company`, `role`, `location`, `startDate`, `endDate` (nullable), `isCurrent`, `description`, `sortOrder`

**Education** — n-1 avec `Profile`
`id`, `profileId`, `school`, `degree`, `field`, `startDate`, `endDate` (nullable), `description`, `sortOrder`

**Skill** — n-1 avec `Profile`
`id`, `profileId`, `name`, `category` (enum : `TECHNICAL`, `SOFT`, `TOOL`, `OTHER`), `level` (enum : `BEGINNER`, `INTERMEDIATE`, `ADVANCED`, `EXPERT`), `sortOrder`

**Language** — n-1 avec `Profile`
`id`, `profileId`, `name`, `level` (enum CECRL : `A1`…`C2`, `NATIVE`), `sortOrder`

**Certification** — n-1 avec `Profile`
`id`, `profileId`, `name`, `issuer`, `issuedAt`, `expiresAt` (nullable), `credentialUrl` (nullable), `sortOrder`

**Project** — n-1 avec `Profile`
`id`, `profileId`, `name`, `description`, `url` (nullable), `technologies` (String[]), `sortOrder`

**JobPreferences** — relation 1-1 avec `Profile`
`id`, `profileId` (unique), `desiredRoles` (String[]), `desiredCategories` (String[]), `salaryMin`, `salaryMax`, `currency`, `locations` (String[]), `searchRadiusKm`, `remoteModes` (enum[] : `ONSITE`, `HYBRID`, `REMOTE`), `contractTypes` (enum[] : `CDI`, `CDD`, `INTERNSHIP`, `APPRENTICESHIP`, `FREELANCE`, `PART_TIME`), `availability`, `experienceLevel`

### Règles

- Toute suppression de `User` cascade sur `Profile` et ses relations filles.
- `Profile` et `JobPreferences` sont créés automatiquement et vides à la création du compte, que celle-ci vienne de l'inscription par email ou d'une première connexion Google : l'application ne manipule jamais un utilisateur sans profil.
- `sortOrder` permet le réordonnancement manuel des listes, utilisé dès la tranche 5 pour le CV.

### Sessions

Les sessions ne sont pas en base. Elles vivent dans Redis sous `session:{sessionId}` avec pour valeur `{ userId, createdAt, lastSeenAt, userAgent, ip }`, plus un index `user_sessions:{userId}` (set) permettant de lister et révoquer les sessions actives d'un utilisateur.

---

## 5. Contrat d'API

Préfixe : `/api/v1`. Toutes les réponses d'erreur suivent une forme unique `{ statusCode, code, message, details? }`, `message` étant un texte affichable à l'utilisateur en français.

### Authentification

```
POST   /auth/register           { email, password, firstName, lastName }
POST   /auth/login              { email, password }
POST   /auth/logout
GET    /auth/me                 → utilisateur + profil minimal
POST   /auth/forgot-password    { email }
POST   /auth/reset-password     { token, password }
GET    /auth/google             → redirection OAuth
GET    /auth/google/callback
GET    /auth/sessions           → sessions actives
DELETE /auth/sessions/:id       → révocation
```

### Profil

```
GET    /profile
PATCH  /profile
GET    /profile/preferences
PATCH  /profile/preferences
```

Et pour chacune des six collections (`experiences`, `educations`, `skills`, `languages`, `certifications`, `projects`) :

```
GET    /profile/{collection}
POST   /profile/{collection}
PATCH  /profile/{collection}/:id
DELETE /profile/{collection}/:id
PATCH  /profile/{collection}/reorder   { ids: string[] }
```

### Santé

```
GET    /health                  → état de l'API, de Postgres et de Redis
```

Aucun endpoint ne prend d'identifiant d'utilisateur en paramètre : l'utilisateur courant provient toujours de la session.

---

## 6. Authentification et sécurité

### Session

Cookie `jt_session` : `httpOnly`, `Secure` (hors développement local), `SameSite=Lax`, `Path=/`, durée 30 jours glissants (prolongée à chaque requête authentifiée). La valeur est un identifiant opaque de 32 octets aléatoires ; aucune donnée utilisateur n'y transite. La révocation est immédiate car l'état vit dans Redis.

### Mots de passe

Argon2id aux paramètres OWASP : `memoryCost` 19 MiB, `timeCost` 2, `parallelism` 1. Minimum 12 caractères, vérifiés par le même schéma Zod côté client et côté serveur.

### Google OAuth

Authorization code flow avec paramètre `state` signé et vérifié. Si l'email Google correspond à un compte existant, le compte est lié via `OAuthAccount` plutôt que dupliqué.

### Contrôle d'accès

Un guard global exige une session valide sur toutes les routes, à l'exception de celles explicitement marquées `@Public()` (landing, auth, health). Le `userId` est injecté par un décorateur `@CurrentUser()`.

**Règle d'isolation :** aucune requête Prisma sur une ressource de profil ne s'exécute sans filtre sur le `profileId` dérivé de la session. Cette règle est vérifiée par un test e2e dédié : l'utilisateur A recevant un 404 (et non un 403, qui divulguerait l'existence de la ressource) sur toute ressource de l'utilisateur B.

### Autres mesures

- **Rate limiting** (`@nestjs/throttler`) : 5 tentatives sur `/auth/login` par fenêtre de 15 minutes et par couple IP + email ; 3 sur `/auth/forgot-password` ; 100 requêtes/minute par défaut ailleurs.
- **CSRF** : `SameSite=Lax` complété d'un jeton double-submit sur toutes les mutations.
- **Helmet** et **CORS** strictement limité à l'origine du frontend.
- **Validation** : chaque payload passe par son schéma Zod partagé, côté serveur avant tout accès base.
- **Environnement** : toutes les variables sont validées par Zod au démarrage ; l'API refuse de booter s'il en manque une ou si l'une est malformée.
- **Énumération de comptes** : `/auth/register` et `/auth/forgot-password` renvoient une réponse identique que l'email existe ou non.
- **Journalisation** : aucun mot de passe, jeton de session ni jeton de réinitialisation n'est écrit dans les logs.

---

## 7. Design system

### Principes

Interface minimaliste et premium, beaucoup d'espace blanc, hiérarchie visuelle nette, ombres très légères, coins arrondis, animations discrètes. Pas de glassmorphism, pas de gradients décoratifs, pas d'esthétique « startup IA ».

### Tokens

Exposés en variables CSS sur `:root` et `.dark`. Le mode sombre est une palette recalibrée, pas une inversion.

**Violet** — réservé aux CTA, éléments actifs, liens importants, indicateurs, focus et sélection. Jamais en aplat de fond de page.
`#7C3AED` (primaire clair) · `#8B5CF6` (primaire sombre, meilleur contraste sur fond très noir) · `#A78BFA` (accent atténué)

**Fonds** — clair `#FFFFFF` / `#F8F8FA` · sombre `#09090B` / `#111113` / `#18181B`

**Texte** — `#111111` (primaire) / `#6B7280` (secondaire), avec leurs équivalents sombres

Échelles de rayon, d'ombre et d'espacement définies une fois et utilisées partout ; aucune valeur en dur dans les composants.

### Typographie

Inter, auto-hébergée via `@fontsource-variable/inter` — aucun appel CDN. Repli sur `-apple-system, BlinkMacSystemFont, system-ui, sans-serif`.

### Thème

Trois modes : clair (défaut), sombre, système. Préférence persistée en `localStorage`, appliquée par un script inline en `<head>` avant le premier paint pour éliminer le flash de thème incorrect. Le mode système écoute `prefers-color-scheme` en direct.

### Composants

shadcn/ui installés à la demande : `button`, `input`, `textarea`, `label`, `card`, `dropdown-menu`, `avatar`, `dialog`, `sheet`, `tabs`, `select`, `form`, `sonner`, `skeleton`, `badge`, `separator`, `tooltip`, `switch`, `alert`.

Composants propres au produit : `Logo`, `ThemeToggle`, `PageHeader`, `EmptyState`, `ErrorState`, `FormSection`, `StatCard`, `ConfirmDialog`.

### Animations

Framer Motion, uniquement pour les transitions de page, l'apparition des cartes et les changements d'état. Durées courtes, `prefers-reduced-motion` respecté.

---

## 8. Écrans

### Publics

| Route | Contenu |
|-------|---------|
| `/` | Landing : hero « Toutes vos opportunités. Un seul endroit. », preview du dashboard, sources supportées, analyse IA, CV adapté, suivi des candidatures, statistiques, tarifs, footer |
| `/login` | Email + mot de passe, Google, mot de passe oublié |
| `/register` | Prénom, nom, email, mot de passe, Google |
| `/forgot-password` | Demande de lien puis confirmation |
| `/reset-password` | Nouveau mot de passe depuis le jeton |
| `*` | 404 : « Cette page n'existe pas. » + retour au dashboard |

### Authentifiés

| Route | Contenu |
|-------|---------|
| `/profile` | Sept sections en CRUD réel : informations personnelles, profil professionnel, préférences, expériences, formation, certifications, projets |
| `/settings` | Trois sections livrées : Compte, Sécurité (mot de passe, sessions actives), Apparence (clair / sombre / système). Les onglets Notifications, Intégrations, Confidentialité et Abonnement sont visibles mais mènent à « Bientôt disponible », cohéremment avec la navigation |

### Coquille applicative

`AppLayout` porte les neuf entrées de navigation définitives : Dashboard, Offres, Mes candidatures, Mon CV, Automatisation, Statistiques, Favoris, Alertes, Paramètres. Sidebar sur desktop, bottom navigation sur mobile.

Les entrées dont la tranche n'est pas livrée restent **visibles** et mènent à une page « Bientôt disponible » nommée. Elles ne sont ni masquées ni désactivées : la coquille prend ainsi sa forme définitive dès la première tranche, et l'utilisateur comprend la trajectoire du produit.

### États obligatoires

Chaque écran est livré avec ses sept états :

- **loading** — skeletons reproduisant la forme du contenu, jamais un spinner plein écran
- **empty** — message et CTA propres à la section (« Aucune expérience ajoutée » + « Ajouter une expérience »)
- **success** — état nominal
- **error** — message lisible en français et bouton « Réessayer » ; jamais de code HTTP brut affiché
- **disabled / submitting** — boutons désactivés et indicateur pendant les mutations
- **mobile** — tableaux transformés en cartes, actions principales toujours atteignables
- **dark** — vérifié visuellement, contrastes inclus

---

## 9. État et flux de données

**TanStack Query** détient tout l'état serveur. Une clé par ressource (`['profile']`, `['profile', 'experiences']`…), invalidation ciblée après mutation, jamais de `invalidateQueries()` global. Mises à jour optimistes sur le réordonnancement et les bascules.

**Zustand** est réservé à l'état d'interface : thème, ouverture du drawer mobile, état des dialogues. Aucune donnée serveur n'y est stockée.

**React Hook Form + Zod** pour tous les formulaires, avec le schéma importé depuis `packages/shared` — le même que celui qui valide côté API.

---

## 10. Tests

| Portée | Outils | Couverture visée |
|--------|--------|------------------|
| API unitaire | Vitest | Services d'auth et de profil, hachage, validation d'environnement |
| API e2e | Vitest + supertest, Postgres de test | Parcours inscription / connexion / déconnexion, rate limiting, réinitialisation de mot de passe, **isolation des données entre utilisateurs** |
| Web unitaire | Vitest + Testing Library | Formulaires, bascule de thème, états vides et d'erreur |
| Web e2e | Playwright | Smoke : inscription → profil rempli → déconnexion → reconnexion |

Le test d'isolation entre utilisateurs est bloquant : aucune fusion sans lui.

---

## 11. Configuration

`docker-compose.yml` fournit Postgres 16 et Redis 7. Un `.env.example` complet est versionné ; `.env` ne l'est pas.

Variables : `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `WEB_ORIGIN`, `API_PORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `NODE_ENV`.

Commandes racine : `pnpm dev` (web + api), `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:studio`.

Le seed crée un compte de démonstration `demo@jobtrack.local` dont le profil est explicitement fictif et signalé comme tel.

---

## 12. Hors périmètre

Ces éléments appartiennent aux tranches suivantes et ne sont **pas** implémentés ici, même partiellement :

import et parsing de CV · onboarding · offres et connecteurs · service IA · match score · génération et export PDF · lettres de motivation · candidatures et Kanban · favoris · alertes · analytics réels · automatisation et candidature assistée · notifications · abonnement et paiement.

Le dashboard n'est pas livré : la landing présente une image de preview, et la route `/dashboard` mène à la page « Bientôt disponible » jusqu'à la tranche 7.

---

## 13. Critères d'acceptation

La tranche est terminée quand, et seulement quand :

1. `docker compose up` puis `pnpm dev` démarrent l'ensemble sans intervention manuelle.
2. Un visiteur peut lire la landing page complète sur mobile et desktop, en clair et en sombre.
3. Un visiteur peut créer un compte, se déconnecter et se reconnecter — par mot de passe et par Google.
4. Un utilisateur connecté peut renseigner et modifier les sept sections de `/profile`, et les données survivent à un rechargement.
5. Le thème clair / sombre / système fonctionne sur tous les écrans, sans flash au chargement.
6. Le test e2e d'isolation entre utilisateurs passe.
7. `pnpm lint`, `pnpm build` et `pnpm test` passent sans erreur ni avertissement TypeScript.
8. Aucun `any` dans le code livré, sauf exception commentée et justifiée.
