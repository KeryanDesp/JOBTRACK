# Tranche 3 — Offres (France Travail, ingestion, `/jobs`) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** les offres réelles de France Travail (API Offres d'emploi v2) sont ingérées à la demande, dédoublonnées et servies sur `/jobs` (recherche, filtres, tri, onglets, pagination, URL), `/jobs/:id` et `/favorites`.

**Architecture:** module API `jobs` = connecteur `france-travail` (client `fetch` natif, jeton OAuth2 en Redis, schémas Zod tolérants) → mapper pur (contrat, expérience, salaire, télétravail annoté, empreinte) → service d'ingestion (upsert `Job`/`JobSource`/`JobSkill`, cache Redis 15 min par requête normalisée) → contrôleur `jobs` (liste depuis la base, détail, favoris, communes, capacités). Frontend `features/jobs` (état de recherche dans l'URL, préférences comme valeurs par défaut, cartes, filtres, `Sheet` mobile, pagination, sauvegarde optimiste). Spec : `docs/superpowers/specs/2026-09-16-tranche-3-offres-france-travail-design.md`.

**Tech Stack:** existant, aucune dépendance nouvelle (`fetch` natif Node 20+, `Intl.RelativeTimeFormat`, composants shadcn `pagination`/`popover` ajoutés à la main sur `radix-ui`).

**Règles héritées :** `*FormInput`/`*Input`/`*Dto` ; `ZodValidationPipe` ; propriétaire filtré, 404 jamais 403 ; `@Public()` ≠ `@NoCsrf()` ; 503 sur panne d'infrastructure ; aucun `any`/`!`/`as`-contournement/`eslint-disable` ; français avec accents dans l'interface, tests nommés sans accents ; comptes e2e `e2e-…` nettoyés ; vérification visuelle de **chaque** chemin d'écriture par le coordinateur ; **aucune donnée simulée** ; jamais de secret ni de contenu d'offre dans les journaux ; jamais d'appel réel à France Travail dans les tests.

**Compteurs de départ :** shared 89, api 138 unitaires + 77 e2e, web 88 + 16 Playwright.

---

## Task 1: Schéma Prisma — offres, sources, favoris, communes

**Files:** `apps/api/prisma/schema.prisma`, migration `apps/api/prisma/migrations/<ts>_jobs_sources_saved_jobs_communes/migration.sql`.

- [ ] Enums : `JobSourceKind { FRANCE_TRAVAIL }`, `JobRequirementKind { EDUCATION, LANGUAGE }`, `JobSyncStatus { OK, PARTIAL, FAILED }` ; `ContractType` + `INTERIM`.
- [ ] Modèles `Job`, `JobSource`, `JobSkill`, `JobRequirement`, `SavedJob`, `JobSearchSync`, `Commune` exactement comme la spec §3 (champs, `@unique`, index, cascades ; `User.savedJobs`, `Job.sources/skills/requirements/savedBy`).
- [ ] `pnpm --filter @jobtrack/api prisma migrate dev --name jobs_sources_saved_jobs_communes` ; `prisma generate` ; typecheck 4/4 ; e2e existants verts.
- [ ] Commit : `feat(api): schema des offres, sources, favoris et communes`.

## Task 2: Contrat partagé `jobs.ts`

**Files:** `packages/shared/src/jobs.ts` (+ `jobs.test.ts`), `packages/shared/src/index.ts`.

- [ ] `jobSearchQuerySchema` avec `z.coerce` (URL) : `q` (trim, ≤ 120, défaut `''`), `communes` (tableau ou chaîne séparée par des virgules → ≤ 3 codes `^\d{5}$|^2[AB]\d{3}$`), `distance` (0–100, défaut 10), `contractTypes`/`remoteModes`/`experienceLevels` (enums, dédoublonnés), `salaryMin` (0–1 000 000), `publishedWithinDays` (1|3|7|14|31), `sources` (`JobSourceKind[]`), `sort` (`recent`|`salary`, défaut `recent`), `tab` (`all`|`new`, défaut `all`), `page` (≥ 1, défaut 1), `pageSize` (20 fixe), `refresh` (booléen depuis `'1'`/`'true'`). Types `JobSearchQuery` (sortie) / `JobSearchQueryInput` (entrée).
- [ ] DTO : `JobSummaryDto`, `JobDetailDto` (`sources[]` avec `kind`, `url`, `applyUrl`, `partnerName`, `publishedAt` ; `skills[]` ; `requirements[]` ; `saved` ; `expiredAt`), `JobListResponseDto` (`items`, `total`, `page`, `pageSize`, `sync { status, syncedAt, message }`), `CommuneDto`, `JobsCapabilitiesDto`, `SyncStatus` union.
- [ ] Libellés : `CONTRACT_TYPE_LABELS` (avec `INTERIM` : « Intérim »), `REMOTE_MODE_LABELS`, `EXPERIENCE_LEVEL_LABELS`, `JOB_SOURCE_LABELS` (« France Travail »), `PUBLISHED_WITHIN_OPTIONS`.
- [ ] Tests (≥ 12) : défauts, coercition depuis `URLSearchParams`, bornes, communes invalides rejetées, dédoublonnage.
- [ ] Commit : `feat(shared): contrat de recherche et dto des offres`.

## Task 3: Environnement et client France Travail

**Files:** `packages/shared/src/env.ts`, `apps/api/src/config/env.ts` (si nécessaire), `.env.example`, `apps/api/src/modules/jobs/sources/{job-source.connector.ts,source.errors.ts}`, `apps/api/src/modules/jobs/sources/france-travail/{france-travail.client.ts,france-travail.schemas.ts,france-travail.provider.ts,france-travail.client.spec.ts}`, `apps/api/fixtures/france-travail/{search-page-1.json,search-page-2.json,search-empty.json,offer-detail.json,communes-sample.json}`, `apps/api/src/main.ts` (journal « Connecteur France Travail : configuré / non configuré »).

- [ ] Variables `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET`, `FRANCE_TRAVAIL_API_URL` (défaut `https://api.francetravail.io/partenaire/offresdemploi/v2`), `FRANCE_TRAVAIL_TOKEN_URL` (défaut `https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire`), `FRANCE_TRAVAIL_SCOPE` (défaut `api_offresdemploiv2 o2dsoffre`).
- [ ] `france-travail.schemas.ts` : schémas Zod **tolérants** (tout optionnel/nullable, `.passthrough()` refusé → `.strip()`, listes filtrées ligne par ligne) pour la réponse de recherche (`resultats`), une offre (spec §4 de la fiche), le jeton, une commune.
- [ ] `FranceTravailClient` (`fetch` injectable pour les tests) : `getToken()` (Redis `jobs:ft:token`, TTL `expires_in − 60`), `search(params: { motsCles?, commune?, distance?, typeContrat?, publieeDepuis?, sort?, range })` → `{ offers, total, first, last }` (200/206 + `Content-Range`, 204 → vide), `getOffer(id)` → offre ou `null` (204/404), `listCommunes()` ; délai 10 s (`AbortController`), une nouvelle tentative sur 5xx/429 (attente 500 ms puis 1 500 ms), 401/403 → `SourceAuthError`, réseau/délai → `SourceUnavailableError`, 429 persistant → `SourceRateLimitedError` ; limiteur global `RateLimiterService.hit('jobs:ft:calls', 8, 1)` avant chaque appel (attente courte puis erreur).
- [ ] `job-source.connector.ts` : `interface JobSourceConnector { readonly kind: JobSourceKind; search(query: SourceQuery): Promise<SourceOffer[]>; getOffer(externalId: string): Promise<SourceOffer | null>; listCommunes(): Promise<SourceCommune[]> }` ; `FranceTravailConnector` implémente en enchaînant `range 0-149` puis `150-299` si `last − first + 1 === 150` ; `FRANCE_TRAVAIL_CONNECTOR` = jeton d'injection (`null` sans identifiants), `isConfigured`.
- [ ] Fixtures fictives (entreprises inventées, ≥ 6 offres variées : CDI cadre, CDD, MIS, apprentissage, salaire horaire, sans salaire, télétravail mentionné, offre relayée par un partenaire).
- [ ] Tests unitaires (≥ 14) : jeton mis en cache puis renouvelé, corps du POST de jeton (aucun secret dans les journaux : espion sur `Logger`), `Content-Range`, 204, 206 puis seconde page, 401 → `SourceAuthError`, 429 → nouvelle tentative puis `SourceRateLimitedError`, délai, réponse malformée tolérée, limiteur.
- [ ] Commit : `feat(api): client france travail (oauth2, recherche, referentiels)`.

## Task 4: Mapper France Travail → offre canonique

**Files:** `apps/api/src/modules/jobs/sources/france-travail/france-travail.mapper.ts` (+ `.spec.ts`), `apps/api/src/modules/jobs/lib/{fingerprint.ts,salary.ts,remote.ts,experience.ts,text.ts}` (+ specs).

- [ ] `mapOffer(offer): JobDraft | null` (null si `id` ou `intitule` absents) selon la spec §5 : contrat/nature, expérience, salaire (≥ 8 libellés testés, dont « Mensuel de 2500.00 Euros à 3000.00 Euros sur 12.00 mois », « Annuel de 45000.00 Euros à 55000.00 Euros », « Horaire de 12.50 Euros », « Selon profil » → null, « Mensuel de 2000 Euros sur 13 mois »), télétravail annoté, compétences/formations/langues, localisation (`departmentCode` `2A`/`2B`/`97x`), description nettoyée et plafonnée (contrôles, bidi, 20 000), URLs `http(s)` uniquement, `publishedAt` (`dateCreation` ; à défaut `dateActualisation` ; à défaut maintenant), `partnerName` depuis `origineOffre.partenaires[0].nom`, `url` = `origineOffre.urlOrigine` ou `https://candidat.francetravail.fr/offres/recherche/detail/{id}`, `applyUrl` = `contact.urlPostulation`.
- [ ] `fingerprint(draft)` : `sha256(norm(company)|norm(title)|communeCode ?? norm(locationLabel))`, `norm` (NFD, minuscules, ponctuation, espaces, « h/f » etc.), sans entreprise → inclut `source:externalId`.
- [ ] Tests (≥ 25).
- [ ] Commit : `feat(api): normalisation des offres france travail et empreinte de deduplication`.

## Task 5: Ingestion, cache et référentiel des communes

**Files:** `apps/api/src/modules/jobs/{job-ingestion.service.ts,job-sync.service.ts,commune.service.ts}` (+ specs), `apps/api/src/modules/jobs/jobs.module.ts`.

- [ ] `JobIngestionService.upsertMany(drafts, kind)` : par offre, transaction courte (`JobSource` par `(source, externalId)` → sinon `Job` par `fingerprint` → création ou rattachement ; mise à jour de `lastSeenAt`/`sourceUpdatedAt`/champs si `sourceUpdatedAt` a avancé ; `JobSkill`/`JobRequirement` remplacés) ; retour `{ created, updated, attached, skipped }` ; une erreur sur une offre est journalisée (id seulement) et comptée.
- [ ] `JobSyncService.ensureFresh(query, { force })` : `queryHash` (spec §5), Redis `jobs:sync:{hash}` (TTL 15 min) et verrou `jobs:sync:lock:{hash}` (30 s) ; sans connecteur → `{ status: 'not_configured' }` ; par commune (ou national) `connector.search(...)` (≤ 6 appels), ingestion, `JobSearchSync` mis à jour ; erreurs source → `{ status: 'degraded', message }` sans lever ; `force` → invalide la clé.
- [ ] `CommuneService` : `ensureLoaded()` (Redis `jobs:communes:loadedAt`, 30 j ; `connector.listCommunes()` → upsert par lots de 1 000 ; `nameNormalized`), `search(q)` (préfixe sur `nameNormalized` ou `postalCode`, 10 résultats, ordre nom), `resolveByName(name)`.
- [ ] Tests unitaires (Prisma et Redis simulés) ≥ 12 : rattachement par empreinte, mise à jour conditionnelle, offre invalide ignorée, cache chaud, verrou, dégradé, non configuré.
- [ ] Commit : `feat(api): ingestion des offres, cache de synchronisation et referentiel des communes`.

## Task 6: Module `jobs` — liste, détail, favoris, communes, capacités

**Files:** `apps/api/src/modules/jobs/{jobs.controller.ts,jobs.service.ts,saved-jobs.service.ts,jobs.e2e.spec.ts}`, `apps/api/src/app.module.ts`, `apps/api/src/modules/jobs/testing/fake-connector.ts`.

- [ ] Routes de la spec §6 ; `GET /jobs` : `ZodValidationPipe(jobSearchQuerySchema)` sur la query → `ensureFresh` (sauf `refresh` sans limite : `@UserRateLimit({ limit: 6, windowSeconds: 600, bucket: 'jobs-sync' })` appliqué seulement quand `refresh=1`, via une garde dédiée ou une vérification dans le service avec `RateLimiterService`) → `findMany` (`select` sans description, filtres locaux : `q` en `contains` insensible sur titre/entreprise si présent, communes → `communeCode in` ou `departmentCode`, contrat, télétravail, expérience, `salaryMaxAnnual >= salaryMin` ou `salaryMinAnnual >= salaryMin`, `publishedAt >= now − N j`, `expiredAt null`, onglet `new` = 24 h) + `count` en transaction ; tri `recent` (`publishedAt desc`) ou `salary` (`salaryMaxAnnual desc nulls last`).
- [ ] `GET /jobs/:id` : détail + `saved` ; si `lastSeenAt` > 24 h et connecteur configuré, `getOffer` (erreur source ignorée) → `expiredAt` si absent.
- [ ] Favoris : `POST/DELETE /jobs/:id/save` idempotents (`upsert` / `deleteMany`), `GET /jobs/saved`.
- [ ] `GET /jobs/communes?q=` (≥ 2 caractères sinon liste vide), `GET /jobs/capabilities`.
- [ ] e2e (≥ 22, connecteur remplacé par `FakeConnector` à fixtures, `overrideProvider(FRANCE_TRAVAIL_CONNECTOR)`) : liste après synchro ; cache ; `refresh` 429 ; chaque filtre ; tri salaire (nulls derniers) ; onglet `new` ; pagination (`total`, page 2) ; détail ; 404 ; expiration détectée ; favoris (isolation, idempotence, liste) ; non configuré ; dégradé ; communes ; DTO sans champs internes ; aucun `any`.
- [ ] Commit : `feat(api): module des offres — recherche, detail, favoris, communes`.

## Task 7: Web — accès API, hooks, formats, `Pagination`/`Popover`

**Files:** `apps/web/src/services/api/jobs.ts` (+ test), `apps/web/src/features/jobs/{lib/query-keys.ts,lib/search-params.ts,lib/format.ts,hooks/use-jobs.ts}` (+ tests), `apps/web/src/components/ui/{pagination.tsx,popover.tsx}`, `apps/web/src/constants/navigation.ts` (`/jobs`, `/favorites` disponibles — commité avec la tâche 9 si les pages n'existent pas encore).

- [ ] `searchParamsToQuery`/`queryToSearchParams` (clés courtes de la spec §7, aller-retour stable, valeurs par défaut omises) ; `useJobSearchParams()` (`useSearchParams`, `replace`).
- [ ] `formatRelativeTime(iso, now)` (« il y a 2 heures », « il y a 3 jours », « à l'instant »), `formatSalaryRange(min, max, currency)` (« 45–70 k€ », « à partir de 30 k€ », « jusqu'à 40 k€ »), `formatLocation`.
- [ ] Hooks : `useJobSearch(query)` (`keepPreviousData`), `useJob(id)`, `useSavedJobs()`, `useSaveJob()` (optimiste sur le détail et les listes en cache, rollback, invalidation), `useCommuneSearch(q)` (anti-rebond 250 ms, `enabled: q.length ≥ 2`), `useJobsCapabilities()` (5 min).
- [ ] Tests ≥ 10.
- [ ] Commit : `feat(web): acces api des offres, etat d url et formats`.

## Task 8: Web — page `/jobs`

**Files:** `apps/web/src/features/jobs/pages/jobs-page.tsx`, `features/jobs/components/{job-search-bar,commune-picker,job-filters,job-tabs,job-sort-select,job-card,job-list,job-freshness,save-job-button,sync-banner}.tsx` (+ tests), `app/router/routes.tsx`.

- [ ] Première visite sans paramètres : requête depuis `useJobPreferences()` (lieux → `GET /jobs/communes?q=` premier résultat, en parallèle, tolérant), URL remplacée ; puis tout changement de filtre/tri/onglet/page réécrit l'URL (page remise à 1 sauf sur pagination).
- [ ] Barre de recherche (formulaire : mots-clés + `CommunePicker` + rayon + « Rechercher »), filtres desktop en rangée, mobile en `Sheet` avec compteur ; onglets (« Pour vous », « Forte priorité » désactivés avec info-bulle « Disponible avec le score (tranche 4) ») ; tri (« Pertinence », « Meilleur match » désactivés) ; `SyncBanner` (`cached`/`degraded`/`not_configured` + « Actualiser » avec `refresh=1`) ; liste (squelettes, vide, erreur), pagination, sous-titre « n offres trouvées ».
- [ ] `JobCard` : titre → `/jobs/:id`, entreprise, lieu, badges contrat/salaire/télétravail (« mentionné dans l'annonce » en info-bulle), fraîcheur, ≤ 3 compétences, « Voir », `SaveJobButton`.
- [ ] Tests ≥ 8 : préférences → URL ; filtre → requête ; états ; sauvegarde optimiste ; picker de communes.
- [ ] Commit : `feat(web): page des offres — recherche, filtres, tri, pagination`.

## Task 9: Web — détail `/jobs/:id`, favoris `/favorites`, navigation

**Files:** `features/jobs/pages/{job-detail-page,favorites-page}.tsx` (+ tests), `features/jobs/components/{job-description,job-sources,job-requirements}.tsx`, `routes.tsx`, `constants/navigation.ts`.

- [ ] Détail : en-tête (logo si `http(s)`, titre, entreprise, lieu, badges), actions « Voir l'offre sur France Travail » (`target=_blank rel=noopener noreferrer`) et sauvegarde, bandeau « Cette offre n'est plus publiée » si `expiredAt`, description `whitespace-pre-line`, compétences exigées/souhaitées, formations/langues, entreprise, conditions, « Disponible sur ». Squelette, 404 → `ErrorState` « Offre introuvable » + lien retour, mobile (actions collantes en bas), sombre.
- [ ] Favoris : liste de `JobCard`, retrait, vide, erreur ; `NAV_ITEMS` `/jobs` et `/favorites` → `available: true` ; `ComingSoon` retiré pour ces routes.
- [ ] Tests ≥ 6.
- [ ] Commit : `feat(web): detail d une offre et favoris`.

## Task 10: Playwright, recette

**Files:** `apps/web/e2e/jobs.spec.ts`.

- [ ] Tests : `/jobs` affiche l'état « non configuré » ou une liste selon `GET /api/v1/jobs/capabilities` ; une recherche par mots-clés met à jour l'URL (`?q=`) ; `/favorites` accessible et vide pour un nouveau compte ; navigation sans « Bientôt » sur Offres/Favoris.
- [ ] Recette des critères (spec §11) par le coordinateur, dont la recherche réelle avec les identifiants de l'utilisateur dès qu'ils sont dans `.env`.
- [ ] Commit : `test: offres end-to-end`.

### Task 1 — amendement après vérification (`2a7758c`, approuvé)
Conforme à la spec §3 (7 modèles, 3 enums, `INTERIM`, uniques, index, cascades). `INTERIM` ajouté aussi au contrat partagé (`contractTypes` des préférences) et au formulaire des préférences web (« Intérim »). Migration `20260916203158_jobs_sources_saved_jobs_communes` appliquée via le script racine `pnpm db:migrate` (le `.env` racine n'est pas vu par `prisma` lancé depuis `apps/api`). `JobSearchSync` et `Commune` sans `createdAt/updatedAt`, comme `JobPreferences`. Compteurs inchangés (shared 89, api 138 + 77, web 88).

### Task 2 — amendement après revue (`729566f` + correctif `d1ff134`)
Conforme champ par champ. Correctifs : les champs numériques acceptent aussi des nombres (une `JobSearchQuery` se re-parse par son propre schéma ; `0` survit aux valeurs par défaut) ; `JobDetailDto` remplace `skills`/`sources` du résumé par les listes détaillées (plus de `sourceDetails`/`skillDetails`) ; `parseJobSearchParams` retente une fois en retirant seulement les champs invalides (un lien tronqué garde `q`) ; **clés d'URL courtes** portées par le contrat (`JOB_SEARCH_PARAM_KEYS`, `toJobSearchParams`) — le web n'a plus de table de correspondance à maintenir ; `JOB_REQUIREMENT_KINDS` + libellés ; schémas de tri/onglet exportés ; enums `contractType/remoteMode/experienceLevel` extraits de `profile.ts` (additif). shared 89 → 135 (dont 14 de `env.test.ts` de la tâche 3).

### Task 3 — amendement après revue sécurité (`ebee020` + correctif `39ec1a8`)
Revue : secrets, SSRF, mappage d'erreurs et câblage propres ; trois points importants corrigés — le délai de 10 s ne couvrait pas la lecture du corps (désormais l'`AbortController` reste armé jusqu'à la fin de la lecture) et la taille n'était pas plafonnée (`content-length` puis mesure : 64 Mio pour le référentiel, 8 Mio ailleurs) ; les erreurs Redis sur le chemin du jeton s'échappaient brutes (désormais dégradées en absence de cache, avertissement dédoublonné) ; l'attente du limiteur (750 ms) ne pouvait pas franchir la fenêtre d'une seconde (150/300/600/1200 ms). Mineurs : pagination sur `Content-Range` (`last − first + 1 === 150`) plutôt que sur la longueur après filtrage ; chemin réel dans les journaux d'erreur ; `Retry-After` honoré (plafond 5 s) ; URLs France Travail en `https://` sans `?` ; fixture avec `salaire: null` ; pages 2 et vide exercées. api 162 → 273 (après mapper), shared 135 → 139.

Note d'exécution initiale :
Client `fetch` natif : jeton en Redis (`jobs:ft:token`, TTL `expires_in − 60`, un seul renouvellement en vol), 8 appels/s via `RateLimiterService`, délai 10 s, une nouvelle tentative sur 5xx/429/réseau, 401 → invalidation + un renouvellement, 400 → seul `codeErreur` remonte ; JSON malformé → résultat vide + avertissement. Connecteur : `sort=1`, `publieeDepuis=31`, deux pages max, borne 1149. `JOB_SOURCE_CONNECTORS` = tableau (vide sans identifiants), `JobsModule` importé. Fixtures fictives (8 + 3 offres, 14 communes dont 2 invalides). api 138 → 162.

### Task 4 — amendement après revue (`af24129` + correctif `80a7660`)
Conforme à la spec §5 (codes de contrat, seuils d'expérience, 19 libellés de salaire vérifiés, chaîne `publishedAt`, URLs `http(s)`, troncature). Correctifs : négations « télétravail : non », « n'est pas possible », « refusé/non autorisé/exclu » gagnent sur toute mention positive ; deux regex quadratiques bornées (`trimEnd`, `\d{1,2} jours`) avec tests de performance (< 20 ms sur 20 000 caractères) ; tous les libellés (titre, contrat, expérience, lieu, secteur, ROME, compétences, exigences, partenaire) passent par le nettoyage des caractères de contrôle/bidi, titre blanc → brouillon nul ; tabulation → espace ; repli du code postal refusé pour la Corse (`20xxx`) et les valeurs non numériques ; `Object.hasOwn` sur la table des contrats (`typeContrat: 'constructor'`) ; mention de genre délimitée (« Chef/Hôtesse » intact) ; `normalizeCompany` pour l'empreinte (« ACME S.A.S. » = « Acme SAS » = « Acme ») ; `positionsCount` entier > 0 ; particules en minuscules (« Aix en Provence (13) ») ; `encodeURIComponent(id)` ; retrait des caractères de contrôle **consolidé** dans `common/text/control-chars.ts` (`keepNewlines`) partagé avec le validateur de CV. Les specs de test contenaient des octets de contrôle bruts (fichiers vus « binaires » par git) : réécrits en séquences d'échappement. api 273 → 339.

### Task 7 — amendement après revue (`92d56f6` + correctif `585e6f4`)
Routes, verbes et chaîne de requête conformes (clés courtes déléguées au contrat). Correctifs : `refresh` retiré de la clé de cache (un rafraîchissement forcé met à jour la même entrée) et jamais écrit dans l'URL ni conservé d'une interaction à l'autre ; `useJobSearchParams` lit les paramètres vivants via une référence (la forme fonctionnelle de `setSearchParams` en react-router 6.30 lit une fermeture périmée), setter stable, requête mémoïsée ; temps relatif borné (dates futures → « à l'instant », arrondi vers le bas : 23 h 59 → « il y a 23 heures », 47 h → « hier », 7 j → « la semaine dernière ») ; `useSaveJob` sérialisé (`scope`) et invalidation seulement à la dernière mutation en vol ; `formatSalaryRange` compacte les deux bornes ensemble, bornes égales → valeur unique, devise non-EUR via `Intl.NumberFormat` compact ; `staleTime` 5 min commenté contre le cache serveur de 15 min ; tests des hooks (`useCommuneSearch` anti-rebond, `keepPreviousData`, double clic rapide). web 138 → 161.

### Task 5 — amendement après revue (`60b2a0a` + correctif `807f5c9`)
Sémantique d'upsert, `force`, recherche nationale, `lastError` générique et codes de contrat confirmés. Correctifs : les tests d'intégration fuyaient quatre lignes dans la base de dev (nettoyage par `company` sur des fixtures sans entreprise) → nettoyage par `externalId` puis orphelins, lignes purgées ; verrou de synchronisation avec jeton `randomUUID()`, libération par compare-et-supprime Lua, TTL 60 s rafraîchi entre communes ; verrou tenu sans synchro antérieure → `cached` (jamais `ok`) ; pannes de connexion Prisma (`P1xxx`, `P2024`, erreurs inconnues) propagées au lieu d'être comptées `skipped` ; course P2002 entre synchros → une nouvelle tentative qui prend le chemin du rattachement ; erreurs non-source (mapper, DB) propagées hors du catch par commune ; référentiel vide → la porte de 30 jours n'est pas posée ; index `Commune.postalCode` (migration `20260916213313`) ; `resolveByName` refuse les homonymes ; `queryJson` canonique, empreinte de requête calculée sur les codes France Travail (les types locaux ne fragmentent plus le cache), `distance` ignorée sans commune ; pas de clé de cache sur `degraded` ; journaux d'ingestion sans `message` ; `fingerprint` recalculée quand titre/entreprise/lieu changent (collision → ancienne gardée) ; `communes.slice(0, 3)`. Reporté : mise à jour des communes renommées (le rechargement n'ajoute que les nouveaux codes) ; une transaction par offre (~450 allers-retours pour trois communes) — à optimiser si la latence le justifie. api 339 → 351.

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Un seul connecteur (France Travail, France uniquement) | Interface `JobSourceConnector` prête ; Adzuna/Jooble/Remotive en tranche 8 |
| Télétravail déduit du texte | Annoté « mentionné dans l'annonce », jamais présenté comme un fait |
| Salaire annuel parsé depuis un libellé | Aucune estimation : `null` et libellé conservé si le motif est inconnu |
| Pas de « Pertinence » ni de score | Tranche 4 |
| Synchronisation seulement à la demande | Tranche 7 (planifiée, alertes) |
| Pas de purge des offres expirées | À décider avec le volume réel |
