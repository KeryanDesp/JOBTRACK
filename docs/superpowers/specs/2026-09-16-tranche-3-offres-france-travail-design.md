# JobTrack — Tranche 3 : Offres (connecteur France Travail, ingestion, `/jobs`)

**Date :** 2026-09-16
**Tranche :** 3 — Offres
**Prérequis :** tranches 0, 1 et 2 fusionnées (`main` 659edd5)

---

## 1. Objectif et périmètre

Livrer la première source d'offres réelle du produit : le connecteur **France Travail — API Offres d'emploi v2** (API publique officielle, seule source du cahier des charges dont l'accès automatisé est autorisé sans partenariat), l'ingestion des offres dans une base locale dédoublonnée, et les écrans `/jobs` (liste, recherche, filtres, tri, onglets), `/jobs/:id` (détail) et `/favorites` (offres sauvegardées).

Le score de correspondance (« 92 % », « Pour vous », « Meilleur match ») relève de la tranche 4 ; « Postuler avec IA » de la tranche 8 ; les alertes de la tranche 7. **Aucune donnée simulée** (cahier des charges §55) : ce que le score ou l'IA fourniront plus tard n'apparaît pas sous forme de faux boutons ni de faux chiffres ; les onglets et tris qui en dépendent sont visibles mais désactivés, avec la mention de la tranche qui les activera.

### Approches envisagées pour l'ingestion

| Approche | Principe | Verdict |
|---|---|---|
| A. Proxy pur | Chaque recherche interroge France Travail en direct, rien n'est stocké | Rejetée : impossible de filtrer/trier localement, pas de dédoublonnage, pas de socle pour le score (T4) ni les alertes (T7), quota France Travail consommé à chaque clic |
| **B. Ingestion à la demande + cache + persistance** | Une recherche déclenche, si le cache est périmé, un petit lot d'appels France Travail ; les offres sont **persistées et dédoublonnées** ; la liste est servie depuis la base avec filtres et tri locaux | **Retenue** : aucune infrastructure nouvelle (pas de planificateur ni de file), fraîcheur pilotée par l'usage, base complète pour T4/T7 |
| C. Synchronisation planifiée | Un cron rejoue les préférences de chaque utilisateur | Reportée à la tranche 7 (alertes), qui introduira `@nestjs/schedule` ; l'approche B fournit déjà le service de synchronisation qu'elle réutilisera |

---

## 2. Parcours utilisateur

1. **`/jobs` — Offres d'emploi.** À l'arrivée, la recherche est **préremplie depuis les préférences** du profil (postes recherchés → mots-clés, lieux → communes, types de contrat, télétravail, expérience, rayon). Sous-titre : « 120 offres trouvées dans votre zone de recherche. » Barre de recherche : mots-clés + sélecteur de lieux (autocomplétion des communes, puces, jusqu'à trois lieux, rayon en km). Filtres : contrat, télétravail, expérience, salaire minimum (annuel), publication (24 h / 3 j / 7 j / 14 j / 31 j), source. Tri : « Plus récentes » (défaut), « Salaire » ; « Pertinence » et « Meilleur match » désactivés (« avec le score, tranche 4 »). Onglets : « Toutes », « Nouvelles » (publiées depuis 24 h) ; « Pour vous » et « Forte priorité » désactivés (même mention). Chaque carte : titre, entreprise, lieu, contrat, salaire (si connu), télétravail (si détecté), « Publié il y a 2 heures », jusqu'à trois compétences, « Voir » et « Sauvegarder ». Pagination 20 par page. L'état de la recherche vit dans l'URL (`?q=&lieu=&…`) : partageable, rechargeable, bouton « Retour » fiable.
2. **Synchronisation transparente.** Quand la requête n'a pas été rafraîchie depuis 15 minutes, l'API interroge France Travail avant de répondre (1 à 2 s). La liste indique « Actualisé il y a 3 min » et un bouton « Actualiser » force une nouvelle synchronisation (limitée). Si France Travail est indisponible, la liste est servie depuis la base avec un bandeau « Résultats en cache : France Travail ne répond pas. »
3. **Connecteur non configuré** (pas d'identifiants dans `.env`) : `/jobs` affiche un état explicite « Le connecteur France Travail n'est pas configuré (identifiants absents). Les offres apparaîtront dès qu'il le sera. » et la liste reste consultable si la base contient déjà des offres.
4. **`/jobs/:id` — détail.** Logo (si fourni), titre, entreprise, lieu, contrat, salaire, télétravail, expérience exigée, fraîcheur. Actions : **« Voir l'offre sur France Travail »** (lien externe, `rel="noopener"`) et **« Sauvegarder »** / « Retirer des favoris ». Sections : description complète (texte brut de la source, sauts de ligne conservés, jamais interprété en HTML), compétences (exigées / souhaitées), formations et langues demandées, entreprise (description, site), conditions (durée du travail, déplacements, nombre de postes, accessibilité TH), « Disponible sur » (sources connues de l'offre avec leurs liens). Une offre disparue de France Travail est signalée « Cette offre n'est plus publiée » ; elle reste consultable.
5. **`/favorites` — Favoris.** Liste des offres sauvegardées (mêmes cartes), retrait possible, état vide « Aucune offre sauvegardée ». Les entrées « Offres » et « Favoris » de la navigation deviennent disponibles (badge « Bientôt » retiré).

---

## 3. Modèle de données

Enums : `JobSourceKind { FRANCE_TRAVAIL }` (extensible : Adzuna, Jooble… en tranche 8) ; `ContractType` gagne `INTERIM` (mission d'intérim, fréquente chez France Travail).

**`Job`** (offre canonique, dédoublonnée) : `id`, `fingerprint String @unique`, `title`, `company String?`, `companyDescription String?`, `companyUrl String?`, `companyLogoUrl String?`, `description String` (texte), `locationLabel String?`, `communeCode String?` (INSEE), `postalCode String?`, `departmentCode String?`, `latitude Float?`, `longitude Float?`, `contractType ContractType?`, `contractLabel String?`, `contractNature String?`, `remoteMode RemoteMode?`, `remoteModeInferred Boolean @default(false)`, `experienceLevel ExperienceLevel?`, `experienceLabel String?`, `experienceRequired Boolean?`, `salaryMinAnnual Int?`, `salaryMaxAnnual Int?`, `salaryLabel String?`, `currency String @default("EUR")`, `workingTimeLabel String?`, `isFullTime Boolean?`, `isApprenticeship Boolean @default(false)`, `positionsCount Int?`, `accessibleTh Boolean?`, `sectorLabel String?`, `romeCode String?`, `romeLabel String?`, `qualificationLabel String?`, `publishedAt DateTime`, `sourceUpdatedAt DateTime?`, `firstSeenAt`, `lastSeenAt`, `expiredAt DateTime?`, `createdAt`, `updatedAt`. Index : `@@index([publishedAt])`, `@@index([lastSeenAt])`, `@@index([contractType, publishedAt])`, `@@index([departmentCode, publishedAt])`.

**`JobSource`** : `id`, `jobId`, `source JobSourceKind`, `externalId String`, `url String`, `applyUrl String?`, `publishedAt`, `sourceUpdatedAt`, `lastSeenAt`, `partnerName String?` (origine partenaire relayée par France Travail), `@@unique([source, externalId])`, `@@index([jobId])`.

**`JobSkill`** : `id`, `jobId`, `name`, `required Boolean`, `@@index([jobId])`, `@@unique([jobId, name])`.

**`JobRequirement`** (formations et langues demandées) : `id`, `jobId`, `kind Enum { EDUCATION, LANGUAGE }`, `label`, `required Boolean`.

**`SavedJob`** : `id`, `userId`, `jobId`, `createdAt`, `@@unique([userId, jobId])`, cascade des deux côtés.

**`JobSearchSync`** (mémoire des synchronisations) : `id`, `queryHash String @unique`, `queryJson Json`, `lastSyncedAt`, `lastStatus Enum { OK, PARTIAL, FAILED }`, `lastError String?`, `resultCount Int`. Le cache court (15 min) vit dans Redis (`jobs:sync:{hash}`) ; la table sert au diagnostic et au bandeau « Actualisé il y a … ».

**`Commune`** (référentiel France Travail, ~35 000 lignes) : `code String @id` (INSEE), `name`, `nameNormalized`, `postalCode String?`, `departmentCode`, `@@index([nameNormalized])`. Chargée à la première synchronisation puis tous les 30 jours (`jobs:communes:loadedAt` en Redis).

---

## 4. Connecteur France Travail

`apps/api/src/modules/jobs/sources/france-travail/` :

- **`france-travail.client.ts`** — `fetch` natif (Node 20+, aucune dépendance). Jeton OAuth2 `client_credentials` : `POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire` (`grant_type`, `client_id`, `client_secret`, `scope=api_offresdemploiv2 o2dsoffre`), mis en cache Redis (`jobs:ft:token`) avec `expires_in − 60 s`. Méthodes : `search(params)` → `{ offers, total, range }` (`GET /partenaire/offresdemploi/v2/offres/search`, lecture de `Content-Range`, 200/206/204), `getOffer(id)` (`GET /offres/{id}`, 204/404 → `null`), `listCommunes()` (`GET /referentiel/communes`). Délai 10 s, une nouvelle tentative sur 5xx/429 avec attente, jamais sur 4xx. Toute réponse est validée par un **schéma Zod tolérant** (tous les champs optionnels, listes filtrées ligne par ligne) : un champ inattendu ne casse jamais l'ingestion.
- **Débit** : limiteur Redis partagé (`RateLimiterService`, clé `jobs:ft:calls`, 8 appels/s) ; au-delà, l'appel attend ou échoue proprement (`SOURCE_RATE_LIMITED`). Une synchronisation est bornée à **6 appels** (3 lieux × 2 pages de 150).
- **Erreurs** : `SourceNotConfiguredError` (identifiants absents), `SourceAuthError` (401/403 : identifiants ou souscription invalides), `SourceUnavailableError` (réseau, 5xx, délai), `SourceRateLimitedError` (429). Journaux sans secret ni contenu d'offre : codes HTTP, compteurs, identifiants d'offres.
- **Interface** `JobSourceConnector { kind; search(query: SourceQuery): Promise<SourceOffer[]>; getOffer(id): Promise<SourceOffer | null> }` — le mapping vers `Job` se fait en aval ; les connecteurs futurs implémentent la même interface.
- **Paramètres France Travail utilisés** : `motsCles` (mots-clés), `commune` + `distance` (par lieu, rayon des préférences, 10 km par défaut), `typeContrat` (codes séparés par des virgules), `publieeDepuis=31`, `sort=1` (plus récentes), `range=0-149` puis `150-299` si la première page est pleine. Sans lieu : recherche nationale. Les autres filtres (télétravail, expérience, salaire, source, publication fine) s'appliquent **localement** sur la base.

Variables : `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET` (optionnelles ; sans elles le connecteur est « non configuré »), `FRANCE_TRAVAIL_API_URL` (défaut `https://api.francetravail.io/partenaire/offresdemploi/v2`), `FRANCE_TRAVAIL_TOKEN_URL` (défaut ci-dessus). Documentées dans `.env.example` ; l'API démarre sans elles et le journal de démarrage indique « Connecteur France Travail : configuré / non configuré ».

---

## 5. Ingestion, déduplication, fraîcheur

**Normalisation d'une offre** (`france-travail.mapper.ts`, pur, testé unitairement) :

- Contrat : `typeContrat` `CDI`→`CDI`, `CDD`→`CDD`, `MIS`→`INTERIM`, `SAI`→`CDD`, `LIB`/`FRA`/`CCE`/`REP`→`FREELANCE` ; `natureContrat` `E2`/`FS` (apprentissage, professionnalisation) → `APPRENTICESHIP` + `isApprenticeship` ; inconnu → `null` avec `contractLabel` conservé. `tempsPlein` → `isFullTime`.
- Expérience : `experienceExige` `D` (débutant accepté) → `experienceRequired=false`, `JUNIOR` ; `E`/`S` avec `experienceLibelle` (« 3 An(s) », « 6 Mois ») → moins d'un an `JUNIOR`, 1 à 3 ans `MID`, plus de 3 ans `SENIOR` ; sans libellé exploitable → `null`, libellé conservé.
- Salaire (`salaire.libelle`) : « Mensuel de 2500.00 Euros à 3000.00 Euros sur 12.00 mois » → annuel = mensuel × mois ; « Annuel de 45000 Euros » ; « Horaire de 12.50 Euros » → × 151,67 × 12 ; arrondi à l'entier, `null` si le libellé ne suit aucun motif (libellé toujours conservé). Aucune estimation.
- Télétravail : **heuristique annotée** (`remoteModeInferred=true`) sur titre + description : « télétravail complet/total/100 % », « full remote » → `REMOTE` ; « hybride », « télétravail partiel », « N jours de télétravail » → `HYBRID` ; « télétravail » seul → `HYBRID` ; « télétravail non possible/impossible » ou rien → `null`. L'interface affiche « Télétravail mentionné dans l'annonce », jamais un fait.
- Compétences : `competences[]` → `JobSkill(name=libelle, required = exigence === 'E')` ; formations/langues → `JobRequirement`.
- Localisation : `lieuTravail.commune` (INSEE) → `communeCode`, `departmentCode` = deux premiers caractères (trois pour `97x`), `libelle` → `locationLabel` (« 57 - METZ » nettoyé en « Metz (57) »).
- Description : texte brut conservé ; longueur plafonnée à 20 000 caractères ; caractères de contrôle retirés.

**Empreinte** (`fingerprint`) : `sha256(norm(company) | norm(title) | communeCode ?? norm(locationLabel))` avec `norm` = NFD sans accents, minuscules, ponctuation retirée, espaces réduits, mentions parasites retirées (« h/f », « (h/f) », « f/h », « h/f/x »). Sans entreprise, l'empreinte inclut l'identifiant source (pas de fusion aveugle). Deux offres de même empreinte partagent un `Job` et cumulent leurs `JobSource` (« Disponible sur : France Travail (2 annonces) », demain d'autres sources). Le cahier des charges cite aussi description et URL : elles varient d'une republication à l'autre et sont volontairement exclues de l'empreinte ; décision tracée.

**Upsert** (`job-ingestion.service.ts`) : par offre, transaction courte — `JobSource` par `(source, externalId)` ; si absent, `Job` par `fingerprint` (création ou rattachement) ; mise à jour de `lastSeenAt`, `sourceUpdatedAt`, et des champs descriptifs si `dateActualisation` a avancé ; compétences remplacées. Une offre dont l'ingestion échoue (validation) est ignorée et comptée, jamais bloquante.

**Fraîcheur** : `publishedAt = dateCreation`, `sourceUpdatedAt = dateActualisation`, `lastSeenAt` = dernière synchronisation où l'offre est apparue. Le détail d'une offre vue il y a plus de 24 h re-vérifie l'offre chez France Travail (un appel) : 204/404 → `expiredAt`. L'affichage « Publié il y a 2 heures » repose sur `publishedAt` ; le tri « Plus récentes » aussi.

**Cache de synchronisation** : `queryHash = sha256(json trié de { q, communes[], distance, contractTypes[] })` ; Redis `jobs:sync:{hash}` (TTL 15 min) évite de réinterroger ; « Actualiser » invalide la clé (limité à 6 par 10 min et par utilisateur, seau `jobs-sync`). Une synchronisation en cours pour le même hash n'est pas doublée (verrou Redis 30 s).

---

## 6. Contrat partagé et routes API

`packages/shared/src/jobs.ts` : `jobSearchQuerySchema` (`q` ≤ 120, `communes` ≤ 3 codes INSEE, `distance` 0–100, `contractTypes[]`, `remoteModes[]`, `experienceLevels[]`, `salaryMin` ≤ 1 000 000, `publishedWithinDays` ∈ {1,3,7,14,31}, `sources[]`, `sort` ∈ {recent, salary}, `tab` ∈ {all, new}, `page` ≥ 1, `pageSize` ∈ {20}, `refresh` booléen), `JobSummaryDto`, `JobDetailDto` (+ `sources[]`, `skills[]`, `requirements[]`, `saved`), `JobListResponseDto { items, total, page, pageSize, sync: { status: 'ok' | 'cached' | 'degraded' | 'not_configured', syncedAt: string | null, message: string | null } }`, `CommuneDto`, `JobsCapabilitiesDto { sources: { franceTravail: boolean } }`, libellés français des enums (`CONTRACT_TYPE_LABELS`, `REMOTE_MODE_LABELS`, `EXPERIENCE_LEVEL_LABELS`), `PUBLISHED_WITHIN_OPTIONS`.

| Route | Rôle | Codes |
|---|---|---|
| `GET /jobs/capabilities` | connecteurs configurés | 200 |
| `GET /jobs?…` | recherche : synchronise si nécessaire, puis liste paginée depuis la base | 200 ; 400 `VALIDATION_ERROR` ; 429 sur `refresh` |
| `GET /jobs/communes?q=` | autocomplétion (≥ 2 caractères, 10 résultats, préfixe sur `nameNormalized`, code postal accepté) | 200 (liste vide si référentiel absent) |
| `GET /jobs/saved` | favoris de l'utilisateur, plus récents d'abord | 200 |
| `GET /jobs/:id` | détail + re-vérification d'expiration si nécessaire | 200 ; 404 |
| `POST /jobs/:id/save` | sauvegarder (idempotent) | 204 ; 404 |
| `DELETE /jobs/:id/save` | retirer (idempotent) | 204 |

Les offres sont **communes à tous les utilisateurs** (données publiques) ; seuls les favoris sont personnels et isolés (`{userId, jobId}`, 404 jamais 403). Les préférences par défaut de `/jobs` sont résolues **côté web** (lecture des préférences déjà en cache) et envoyées explicitement dans l'URL : l'API reste sans état.

---

## 7. Frontend

`apps/web/src/features/jobs/` :

- **Pages** : `jobs-page.tsx` (`/jobs`), `job-detail-page.tsx` (`/jobs/:id`), `favorites-page.tsx` (`/favorites`). Routes explicites dans `routes.tsx` ; `NAV_ITEMS` : `/jobs` et `/favorites` passent `available: true`.
- **Composants** : `job-search-bar.tsx` (mots-clés + `commune-picker.tsx` : combobox maison sur `Popover` + liste, autocomplétion `useCommuneSearch` avec anti-rebond 250 ms, puces, rayon) ; `job-filters.tsx` (desktop : rangée de `Select`/cases sous la barre ; mobile : `Sheet` « Filtres » avec compteur de filtres actifs) ; `job-tabs.tsx` ; `job-sort-select.tsx` ; `job-card.tsx` ; `job-list.tsx` (squelettes × 5, vide, erreur avec réessai, bandeau de synchronisation) ; `save-job-button.tsx` (optimiste, `aria-pressed`) ; `job-freshness.tsx` (« il y a 2 heures », `<time dateTime>`) ; `components/ui/pagination.tsx` (nouveau, shadcn) ; `lib/format.ts` : `formatRelativeTime` (fr, `Intl.RelativeTimeFormat`), `formatSalaryRange` (« 45–70 k€ », « à partir de 30 k€ »), `formatLocation`.
- **État d'URL** : `lib/search-params.ts` sérialise/désérialise `jobSearchQuerySchema` ↔ `URLSearchParams` (clés courtes : `q`, `lieu`, `rayon`, `contrat`, `remote`, `exp`, `salaire`, `depuis`, `source`, `tri`, `onglet`, `page`) ; `useJobSearchParams()` ; à la première visite sans paramètres, `jobs-page` calcule la requête depuis `useJobPreferences()` (puces de lieux résolues par `GET /jobs/communes?q=<lieu>` — premier résultat) et **remplace** l'URL.
- **Accès API** : `services/api/jobs.ts`, `features/jobs/hooks/use-jobs.ts` (`useJobSearch(query)` avec `placeholderData: keepPreviousData`, `useJob(id)`, `useSavedJobs()`, `useSaveJob()` optimiste avec rollback + invalidation de la liste, `useCommuneSearch(q)`, `useJobsCapabilities()`), `features/jobs/lib/query-keys.ts`.
- **États** : chargement (squelettes), vide (« Aucune offre ne correspond. Élargissez le rayon ou retirez un filtre. »), erreur (`ErrorState` + réessai), non configuré (état dédié), dégradé (bandeau), mobile (filtres en `Sheet`, cartes empilées, barre de recherche collante), sombre (jetons sémantiques uniquement).

---

## 8. Sécurité et robustesse

- Identifiants France Travail côté serveur uniquement ; jamais dans les DTO, les journaux ni les erreurs renvoyées (`SourceAuthError` → 503 `SOURCE_UNAVAILABLE` avec message générique, détail dans le journal serveur sans le secret).
- Rien de personnel n'est envoyé à France Travail : uniquement mots-clés, codes commune, rayon, codes contrat.
- Toute réponse externe passe par Zod ; description tronquée ; caractères de contrôle et séquences bidi retirés ; rendu texte brut (`white-space: pre-line`), jamais `dangerouslySetInnerHTML`. Les URL de source et de candidature ne sont affichées que si `http(s)`.
- `GET /jobs` : validation Zod des paramètres ; pagination plafonnée ; limiteur utilisateur sur `refresh` ; la synchronisation implicite est elle-même bornée par le cache (15 min par requête) et par le limiteur global France Travail.
- Base : `select` explicites sur la liste (pas de description), index sur les tris ; requête de liste en une transaction `findMany` + `count`.
- Le module démarre et sert la base sans identifiants ; une panne de France Travail dégrade (cache) sans jamais rendre `/jobs` indisponible.

---

## 9. Tests

- **Shared** : schéma de recherche (bornes, défauts, `coerce` depuis l'URL), libellés.
- **API unitaires** : client (jeton mis en cache et renouvelé, `Content-Range`, 204, 429 avec nouvelle tentative, 401 → `SourceAuthError`, délai) avec `fetch` simulé ; mapper (contrat, expérience, salaire — au moins 8 libellés réels —, télétravail, empreinte, localisation) ; ingestion (création, rattachement par empreinte, mise à jour si actualisée, offre invalide ignorée) sur Prisma simulé ou en e2e.
- **API e2e** (`jobs.e2e.spec.ts`, connecteur remplacé par un faux `JobSourceConnector` à fixtures) : synchronisation puis liste ; cache (deuxième appel sans synchronisation) ; `refresh` limité ; filtres (contrat, télétravail, expérience, salaire, publication) ; tri ; onglet « Nouvelles » ; pagination ; détail ; 404 ; favoris (isolation entre utilisateurs, idempotence) ; connecteur non configuré → `sync.status='not_configured'` et liste servie ; connecteur en panne → `degraded` ; communes.
- **Web** : sérialisation d'URL aller-retour ; carte (salaire, fraîcheur, télétravail annoté) ; page (préférences → URL, filtres → requête, états) ; sauvegarde optimiste ; combobox de communes.
- **Playwright** (`jobs.spec.ts`) : `/jobs` affiche l'état non configuré ou la liste selon `GET /jobs/capabilities` ; navigation `/jobs` → `/favorites` ; recherche par mots-clés met à jour l'URL.

Fixtures : `apps/api/fixtures/france-travail/{search-page-1.json,search-empty.json,offer-detail.json,communes-sample.json}` — offres **fictives** (entreprises inventées) suivant exactement la forme de l'API.

---

## 10. Hors périmètre / reporté

Score et classement (T4) ; « Postuler avec IA », candidature assistée (T8) ; alertes et synchronisation planifiée (T7) ; autres connecteurs (Adzuna, Jooble, Remotive — même interface, T8) ; offres hors France (France Travail ne couvre pas le Luxembourg : à traiter avec un second connecteur) ; recherche plein texte locale (« Pertinence ») ; historique des recherches ; rétention/purge des offres expirées (à décider quand le volume le justifiera — un job expiré depuis 90 jours sans favori pourra être purgé).

---

## 11. Critères d'acceptation

1. Avec des identifiants valides dans `.env`, une recherche « développeur » à Metz (25 km) remplit la base et affiche des offres réelles, fraîches, avec fraîcheur relative, contrat, salaire quand il est exprimé, et lien vers l'annonce d'origine ; la même recherche relancée dans les 15 minutes ne rappelle pas France Travail.
2. Sans identifiants, `/jobs` explique l'absence de connecteur et l'application reste entièrement utilisable ; toutes les suites passent sans réseau.
3. Deux annonces France Travail de même entreprise, titre et commune donnent **un seul** `Job` avec deux sources ; une annonce actualisée met à jour l'offre sans doublon.
4. Filtres, tri, onglet « Nouvelles » et pagination agissent sur la base locale et se reflètent dans l'URL ; recharger la page conserve la recherche ; la première visite reprend les préférences du profil.
5. Le détail affiche la description en texte brut, les compétences exigées/souhaitées, et signale une offre retirée ; « Sauvegarder » est optimiste, idempotent et isolé par utilisateur ; `/favorites` liste et retire.
6. Une panne ou un 429 de France Travail dégrade proprement (bandeau, cache), jamais un 500 ; aucun secret ni contenu d'offre dans les journaux.
7. Toutes les suites (unitaires, e2e API, Playwright) sont vertes ; aucun `any` ; états chargement/vide/erreur/mobile/sombre sur les trois écrans.
