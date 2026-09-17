# Tranche 4 — Match Score explicable : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chaque offre reçoit un score de correspondance déterministe et explicable (facteurs, ✓/⚠/✗, priorité) à partir d'une analyse structurée de l'offre par Claude, partagée entre utilisateurs ; la liste `/jobs` gagne « Meilleur match », « Pertinence », « Pour vous », « Forte priorité » ; le détail gagne « Pourquoi cette offre vous correspond ».

**Architecture:** module API `matching` = `JobAnalysisService` (Claude, `messages.parse` + `zodOutputFormat`, cache `JobAnalysis`) → `ProfileInputsBuilder` (entrées du profil + empreinte) → `scoring/` pur (facteurs, poids, bandes, priorité, pertinence, synonymes) → `MatchService` (upsert `MatchScore`, recalcul si empreinte/version périmée) → contrôleur (`POST /jobs/analyses`, `GET /jobs/:id/match`, retry) + extension de `JobsService.search` (jointure des scores, tris et onglets). Frontend `features/matching` (badge, puce de priorité, explication de carte, panneau de détail, progression d'analyse) branché sur `features/jobs`. Spec : `docs/superpowers/specs/2026-09-17-tranche-4-score-explicable-design.md`.

**Tech Stack:** existant (`@anthropic-ai/sdk` déjà en place, zod v4 pour le schéma fil, `radix-ui` Progress).

**Règles héritées :** `*Input`/`*Dto` ; `ZodValidationPipe` ; 404 jamais 403 ; aucun `any`/`!`/`as`-contournement/`eslint-disable` ; français avec accents dans l'interface, tests nommés sans accents ; comptes e2e `e2e-…` nettoyés, préfixes `E2E-` ; vérification visuelle de chaque chemin d'écriture par le coordinateur ; **aucune donnée simulée** ; jamais d'appel réel à Anthropic dans les tests ; jamais le contenu d'une offre ni du profil dans les journaux.

**Compteurs de départ :** shared 141, api 363 unitaires + 115 e2e, web 210 + 26 Playwright.

---

## Task 1: Schéma Prisma — `JobAnalysis`, `MatchScore`

**Files:** `apps/api/prisma/schema.prisma`, migration `<ts>_job_analysis_and_match_score`.

- [ ] Enums `JobAnalysisStatus { PENDING, DONE, FAILED }`, `MatchBand { EXCELLENT, GOOD, PARTIAL, WEAK }`, `MatchPriority { VERY_HIGH, HIGH, GOOD, CONSIDER, LOW }` ; modèles `JobAnalysis` et `MatchScore` exactement comme la spec §3, `MatchScore.relevance Int?` inclus (relations `Job.analysis JobAnalysis?`, `Job.matches MatchScore[]`, `Profile.matches MatchScore[]`, cascades, index).
- [ ] `pnpm db:migrate --name job_analysis_and_match_score` ; typecheck 4/4 ; suites existantes vertes.
- [ ] Commit : `feat(api): schema des analyses d offres et des scores de correspondance`.

## Task 2: Contrat partagé `matching.ts` et extension du contrat des offres

**Files:** `packages/shared/src/matching.ts` (+ test), `packages/shared/src/jobs.ts` (+ test), `index.ts`.

- [ ] `jobRequirementsSchema` (zod v3, tolérant : listes filtrées ligne par ligne, chaînes bornées 80/300, `experienceYearsMin` 0–40, enums fermées) et `jobRequirementsWireSchema` (zod v4 `zod/v4`, miroir plat nullable, `maxItems`) ; type `JobRequirements`.
- [ ] DTO : `MatchEvidenceDto { kind: 'ok' | 'warn' | 'missing' | 'info'; text }`, `MatchFactorDto { key: FactorKey; label; weight; score: number | null; status: 'evaluated' | 'unknown'; evidence[] }`, `MatchScoreSummaryDto { score: number | null; band: MatchBand | null; priority: MatchPriority | null; explanation: { top: string[]; weak: string[] } }`, `MatchScoreDto extends MatchScoreSummaryDto { factors; computedAt: string | null; analysis: { status: 'none' | 'pending' | 'done' | 'failed' | 'ai_not_configured'; error: string | null }; profileComplete: boolean; insufficientData: boolean }`, `analyzeJobsSchema { jobIds: string[] (1–20, cuid) }`, `AnalyzeJobsResponseDto { analyzed; pending; failed; notConfigured; profileComplete; scores: Record<string, MatchScoreSummaryDto | null> }`.
- [ ] Libellés : `MATCH_BAND_LABELS`, `PRIORITY_LABELS`, `FACTOR_LABELS` (Compétences, Expérience, Localisation, Salaire, Contrat, Télétravail, Formation, Langues), `FACTOR_WEIGHTS` (35/15/15/10/10/5/5/5) — exportés pour l'UI et le moteur.
- [ ] `jobs.ts` : `sort` + `'match' | 'relevance'` (clés `tri=match|pertinence`), `tab` + `'for_you' | 'priority'` (`onglet=pour-vous|priorite`), `JobSummaryDto.match: MatchScoreSummaryDto | null`, `JobSyncInfoDto.analysis?: { analyzed: number; total: number; notConfigured: boolean }` ; `JOB_SORT_OPTIONS`/`JOB_TABS` mis à jour (plus de mention « tranche 4 »).
- [ ] Tests (≥ 16). Commit : `feat(shared): contrat des analyses d offres et des scores`.

## Task 3: Moteur de score (pur)

**Files:** `apps/api/src/modules/matching/scoring/{types.ts,synonyms.ts,normalize.ts,factors/{skills,experience,location,salary,contract,remote,education,languages}.ts,score.ts,priority.ts,relevance.ts,explanation.ts,departments.ts}` (+ specs), `apps/api/src/modules/matching/scoring/index.ts`.

- [ ] `ProfileInputs` / `JobInputs` (types purs, sans Prisma) ; `SCORING_VERSION = 1`.
- [ ] `synonyms.ts` : table versionnée (≥ 60 entrées : langages, frameworks, bases, cloud, outils, méthodes ; formes courtes/longues, casse, points, tirets) ; `canonicalSkill(name)` (normalisation `normalizeForKey` + synonymes) ; `departments.ts` : voisinages des départements métropolitains (table statique, tests de symétrie).
- [ ] Un fichier par facteur, signature `(profile, job, requirements, now) → FactorResult { key, weight, score, status, evidence }` ; règles et textes exactement comme la spec §5 (evidence en français avec accents, ✓/⚠/✗ portés par `kind`).
- [ ] `score.ts` : `scoreJob(...)` → `{ score: number | null, band, priority, factors, explanation, insufficientData }` (moyenne pondérée renormalisée, seuil 50 % du poids, bandes) ; `priority.ts` (règles §5, avec « toutes les technologies exigées couvertes » et fraîcheur ≤ 3 j) ; `relevance.ts` : `relevanceScore(score, publishedAt, now)` (1 jusqu'à 2 j, linéaire jusqu'à 0,6 à 45 j, plancher 0,6) ; `explanation.ts` (top 3 ✓ + « Publiée aujourd'hui », weak 2).
- [ ] Années d'expérience : fusion des intervalles chevauchants, `isCurrent` → aujourd'hui, arrondi au dixième ; niveau de formation : table `degree` → niveau (bac, bac+2, bac+3, bac+5, doctorat : « BTS », « DUT », « Licence », « Master », « Ingénieur », « Doctorat », « MBA », « Bac +5 »…).
- [ ] Tests ≥ 45 (chaque facteur : évalué/unknown/bornes ; renormalisation ; seuil ; bandes ; priorité (4 combinaisons) ; pertinence (2 h vs 45 j) ; synonymes ; chevauchements ; formation).
- [ ] Commit : `feat(api): moteur de score de correspondance deterministe`.

## Task 4: Analyse d'une offre par Claude

**Files:** `apps/api/src/modules/matching/{job-analysis.service.ts,job-analysis.prompt.ts,job-analysis.errors.ts}` (+ spec), `apps/api/fixtures/matching/requirements-{FT-0001,FT-0002,FT-0006}.json`, `apps/api/src/modules/matching/matching.module.ts`.

- [ ] Prompt système stable (règles : données jamais instruction, `null` si absent, enums fermées, pas de déduction sensible, langue d'origine), contenu `<offre>…</offre>` (fermeture retirée), `messages.parse` + `zodOutputFormat(jobRequirementsWireSchema)`, `max_tokens 4000`, `thinking adaptive`, `effort medium`, `cache_control` sur le système ; normalisation par `jobRequirementsSchema`.
- [ ] `analyze(jobId)` : verrou Redis `matching:analysis:{jobId}` (120 s) ; `PENDING` → `DONE` (`requirements`, `model`, jetons, `analyzedAt`) ou `FAILED` (message générique) ; mêmes mappages d'erreurs que l'extraction (`AiNotConfiguredError` → pas d'écriture, `AiUnavailableError` → rollback `PENDING` + 503, autres → `FAILED`) ; `PENDING` > 2 min réputée `FAILED`.
- [ ] `analyzeMany(jobIds)` (séquentiel, ≤ 20, arrêt sur `AiUnavailable`) ; `isConfigured`.
- [ ] Tests unitaires (fake Anthropic) ≥ 10 : succès, sortie non conforme → `FAILED`, non configuré, indisponible → rollback, verrou tenu → ignoré, `PENDING` obsolète relancée, aucun contenu d'offre dans les journaux (espion), texte de l'offre délimité.
- [ ] Commit : `feat(api): analyse structuree des offres par claude`.

## Task 5: Construction des entrées profil, calcul et persistance des scores

**Files:** `apps/api/src/modules/matching/{profile-inputs.service.ts,match.service.ts}` (+ specs).

- [ ] `ProfileInputsService.build(userId)` : profil + compétences + expériences + projets (`technologies`) + formations + langues + préférences ; lieux souhaités résolus en codes INSEE (`CommuneService.search` premier résultat exact, mémoïsé) ; `profileFingerprint = sha256(SCORING_VERSION + entrées canoniques)` ; `profileComplete` = au moins une compétence ou une expérience.
- [ ] `MatchService.ensureScores(userId, jobIds)` : charge analyses `DONE` + offres (champs nécessaires) + `MatchScore` existants ; recalcule ceux dont `profileFingerprint`/`analysisVersion` diffèrent ou absents ; upsert par lots (`≤ 20`, transaction courte) ; renvoie `Record<jobId, MatchScoreSummaryDto | null>` ; `getDetail(userId, jobId)` → `MatchScoreDto` (statut d'analyse, profil incomplet, données insuffisantes).
- [ ] Tests ≥ 12 (Prisma réel sur 5434 avec préfixes `E2E-`, nettoyage strict) : empreinte stable, recalcul après changement de profil, pas de recalcul sinon, profil incomplet → null, analyse absente → null + statut.
- [ ] Commit : `feat(api): calcul et persistance des scores de correspondance`.

## Task 6: Routes et intégration à la recherche

**Files:** `apps/api/src/modules/matching/matching.controller.ts`, `apps/api/src/modules/jobs/jobs.service.ts` (jointure, tris, onglets, `analysis` dans `sync`), `apps/api/src/modules/matching/matching.e2e.spec.ts`, `apps/api/src/modules/matching/testing/fake-anthropic.ts`, `app.module.ts`.

- [ ] `POST /jobs/analyses` (`@UserRateLimit({ limit: 60, windowSeconds: 3600, bucket: 'job-analysis' })` — ne compte que les analyses réellement lancées : décompte via `RateLimiterService.hit` dans le service, par offre analysée), `GET /jobs/:id/match`, `POST /jobs/:id/analyses/retry` (202/409) ; 503 `AI_NOT_CONFIGURED` uniquement si une analyse était nécessaire (sinon 200 avec `notConfigured: true` et les scores existants).
- [ ] `JobsService.search` : `include` du `MatchScore` de l'utilisateur (`profileId`) → `item.match` ; `sort=match` (`score desc nulls last, publishedAt desc, id`), `sort=relevance` (calculé en mémoire sur la page ? **non** : pertinence stockée `relevance` dans `MatchScore` recalculée à chaque `ensureScores` — champ `relevance Int` ajouté en tâche 1 — tri SQL `relevance desc nulls last`) ; `tab=for_you` (`score ≥ 60`), `tab=priority` (`priority in (VERY_HIGH, HIGH)`) ; `sync.analysis = { analyzed, total, notConfigured }` pour les ids de la page.
- [ ] e2e ≥ 18 (fake Anthropic à fixtures) : analyse → scores ; cache ; 429 ; non configuré 200/503 ; tri match ; pertinence (offre récente à 85 devant ancienne à 100) ; onglets ; détail facteurs ; retry ; recalcul après PATCH profil ; isolation ; profil incomplet ; aucune fuite du texte d'offre dans les réponses d'erreur.
- [ ] Commit : `feat(api): routes d analyse et de score, tris et onglets de correspondance`.

## Task 7: Web — accès API, hooks, composants de score

**Files:** `apps/web/src/services/api/matching.ts` (+ test), `features/matching/{lib/query-keys.ts,lib/format.ts,hooks/use-match.ts,components/{match-badge,priority-chip,match-explanation,match-panel,analysis-progress,incomplete-profile-notice}.tsx}` (+ tests).

- [ ] `analyzeJobs(jobIds)`, `fetchJobMatch(id)`, `retryJobAnalysis(id)` ; `useAnalyzeJobs()` (mutation ; relance toutes les 2 s tant que `pending > 0`, 60 s max ; met à jour `item.match` dans les listes en cache et le détail) ; `useJobMatch(id)`.
- [ ] Composants : badge (pastille chiffre + « Match », couleur par bande via jetons sémantiques, `aria-label` « Correspondance 92 sur 100 », variante « Non évalué ») ; puce de priorité ; explication de carte (« Pourquoi ? » → `Collapsible`, lignes ✓/⚠/✗ avec icônes + texte, `aria-expanded`) ; panneau de détail (bandeau, barres `Progress` `aria-valuenow`, sections Compétences correspondantes / Points faibles / Non évalué, recommandation ; états chargement/erreur/« Analyser cette offre »/IA non configurée/profil incomplet) ; progression d'analyse (`aria-live="polite"`).
- [ ] Tests ≥ 12. Commit : `feat(web): composants et acces api du score de correspondance`.

## Task 8: Web — intégration liste et détail

**Files:** `features/jobs/pages/jobs-page.tsx`, `components/{job-card,job-tabs,job-sort-select,job-list,sync-banner}.tsx`, `features/jobs/pages/job-detail-page.tsx` (+ tests).

- [ ] Carte : badge + puce + « Pourquoi ? » ; onglets et tris activés (tooltips retirées) ; page : après chaque chargement, `useAnalyzeJobs` sur les items sans `match` (une fois par jeu d'ids, pas en boucle) ; sous-titre « n offres · m analysées » ; bandeau IA non configurée / profil incomplet (une seule fois, sous la bannière de synchro) ; « Pertinence » devient le tri par défaut **seulement** quand le profil est complet et l'IA configurée (sinon « Plus récentes ») — décision tracée.
- [ ] Détail : `MatchPanel` sous l'en-tête ; « Analyser cette offre » ; « Réessayer l'analyse ».
- [ ] Tests ≥ 8 (URL `tri=match`, `onglet=pour-vous`, déclenchement d'analyse une fois, états). Commit : `feat(web): score de correspondance sur la liste et le detail des offres`.

## Task 9: Playwright, recette

**Files:** `apps/web/e2e/matching.spec.ts`.

- [ ] Sans IA : `/jobs` n'affiche aucun score, l'état « service IA non configuré » est visible sur l'onglet « Pour vous » ; le détail propose « Analyser cette offre » ou l'état non configuré ; URL `tri=match` acceptée.
- [ ] Recette §11 par le coordinateur (analyse réelle dès que `ANTHROPIC_API_KEY` est présente).
- [ ] Commit : `test: score de correspondance end-to-end`.

### Task 1 — amendement après exécution (`2a310ca`, approuvé)
Conforme à la spec §3 (`relevance Int?` inclus). Migration `20260917001228_job_analysis_and_match_score`. Suites inchangées (api 363 + 115).

### Task 2 — amendement après revue (`6af9a39` + pont `9900ce7` + correctif `4d05431`)
Revue : contrat conforme (§4/§5/§6), `zodOutputFormat` compatible (constaté : le SDK rétrograde `enum`/`maxItems`/`maxLength` en simples descriptions, non appliquées par l'API — d'où l'importance de la tolérance côté v3). Corrigé : une liste non-tableau (`null`) renvoyée par le modèle faisait échouer toute l'analyse → traitée comme `[]` ; une `category` inconnue supprimait la technologie (y compris exigée) → `'other'`, ligne conservée ; `experienceYearsMin` vide → `null` (plus `0`) ; `level` de langue via l'assistant tolérant (plus de `as`) ; `MATCH_ANALYSIS_STATUSES` exporté ; seuils testés ; côté API, `switch` exhaustifs sur `sort`/`tab` (les nouveaux tris/onglets retombent explicitement sur la récence jusqu'à la tâche 6) ; ordre des espaces réservés du tri et test dédié. `analyzeJobsSchema` garde des ids `min(1).max(64)` (plus strict que le « cuid » du plan). shared 141 → 182.

Note d'exécution initiale :
Contrat livré (28 tests `matching`, 8 tests `jobs`) ; `JobSummaryDto.match` devient obligatoire (`| null`) → le pont `9900ce7` renseigne `match: null` côté API (rempli en tâche 6) et filtre côté web les onglets/tris désormais présents dans `JOB_TABS`/`JOB_SORT_OPTIONS` mais encore rendus comme espaces réservés désactivés (valeurs alignées sur le contrat : `for_you`, `priority`, `match`, `relevance`) — la tâche 8 retire ces espaces réservés. shared 141 → 178.

### Task 4 — amendement après revue sécurité (`35cd5b6` + correctif `3454c3e`)
Port fidèle du socle d'extraction (données jamais instruction, sortie contrainte, mappage d'erreurs à parité, jetons comptés, verrou Redis avec jeton et libération Lua, aucun accès au profil, journaux sans contenu — vérifié par espion). Corrigé : document assemblé borné en cardinalité (50 compétences, 30 exigences, 30 000 caractères au total) ; une analyse `FAILED` de la version courante n'est plus rejouée à chaque page (`skipped_failed`), seul `retry()` force ; l'écriture `FAILED` efface `requirements`/`model`/jetons/`analyzedAt` (plus de charge utile d'une ancienne version sous le nouveau numéro) ; `sanitize` retire les variantes `< / offre >` ouvrantes et fermantes ; plafond dur de 20 analyses par appel ; plus de `as Error` dans les `catch` ; verrou et seuil `PENDING` portés à 5 min (> 3 × 90 s du client). Fixtures d'exigences construites sur les offres semées réelles (FT-0001 : 5 ans, pas de niveau de langue explicite). api 363 → 507 (avec le moteur).

### Task 7 — amendement après revue (`a95469a` + correctif `f6959f9`)
Textes, accessibilité et jetons conformes (badge « Match » avec `aria-label`, puce de priorité, `Collapsible` « Pourquoi ? », panneau avec barres `Progress` et sections, aucun nombre calculé côté client). Critiques corrigés : après une analyse, le détail (`matchKeys.detail`) n'était mis à jour que sur les champs sommaires (facteurs et statut périmés) → invalidation ; un 503 `AI_NOT_CONFIGURED` levé par `apiRequest` n'atteignait jamais l'état `notConfigured` → intercepté. Importants : `pending` remis à 0 sur erreur (progression ne reste plus figée), une nouvelle tentative après 4 s hors 429/503 ; `apiRequest` devient agnostique au corps (202 vide accepté) ; `useJobMatch` re-sonde toutes les 2 s tant que l'analyse est `pending` ; profil incomplet testé avant de proposer « Analyser cette offre » (pas de budget brûlé pour rien). Mineurs : fusion des scores sans re-rendu des cartes inchangées, `null` explicite du serveur respecté, référence affectée dans un effet, `cn(...)`, alias courts du `Collapsible`, tests du sondage (poursuite, plafond 60 s, nettoyage, 429, 503). `analyzeAsync` conservé dans l'API du hook (consommé par l'intégration). web 210 → 289 (avec l'intégration en cours).

### Task 3 — amendement après revue (`ed17186` + correctif `d6620ba`)
Spec §5 suivie règle par règle (seuils sondés, renormalisation, seuil 50 %, bandes, priorité, pertinence, explication), pureté et déterminisme confirmés (20 offres en 0,24 ms), départements symétriques sans isolé hors Corse. Corrigé : collision `C++`/`C` (même classe de bug que `C#`) ; dates de fin futures bornées à aujourd'hui ; quatre tests centraux creux remplacés par des valeurs calculées à la main (91, 100, 78, explication exacte) ; télétravail sans préférence → `unknown` (plus de 100 gratuit qui franchissait le seuil) ; langues France Travail en repli quand l'analyse n'en liste aucune ; synonymes : `csharp`/`dotnet` séparés, variantes `.NET Core`/`ASP.NET`, suffixe de version retiré (« Vue 3 », « PHP 8 »), + 17 outils courants, alias nu `tableau` retiré ; expérience 0 sans exigence → `unknown` ; adjacences 95↔77 et 54↔67, tests de symétrie complets ; CAP/BEP/« sans diplôme » → `none`, DEUG, Bac+4, titres RNCP. Décisions confirmées : renormalisation 70/30 quand une catégorie manque ; repli sur les compétences ROME de France Travail (quasi jamais concordantes — une offre non analysée aura ≈ 0 sur ce facteur, à observer en recette). scoring 117 → 141 tests.

### Task 5 — amendement après revue (`c4fd5c4` + correctif `65989ff`)
Cartographie des entrées, règle `complete`, empreinte (versions du moteur et des synonymes incluses), `safeParse` des exigences, isolation par `profileId` et nettoyage des tests confirmés. Corrigé : la résolution des lieux était N+1 (jusqu'à 11 requêtes) et fragile (« Paris » sans commune homonyme → rien ; « Metz (57) », codes postaux, homonymes départagés par la collation) → **une requête groupée** en égalité exacte sur `nameNormalized`/`postalCode`, suffixe `(NN)` retiré, repli « arrondissements d'un même département » (Paris/Lyon/Marseille → département seul, documenté), homonymes multi-départements ignorés ; le service ne dépend plus de `CommuneService` ni de `JobsModule` ; docstring corrigée (Prisma émet 1 + 6 requêtes) ; la réutilisation exige aussi `computedAt ≥ analyzedAt` (une re-analyse à version égale invalide) ; lignes `MatchScore` périmées **supprimées** dans la même transaction (les jointures de `GET /jobs` ne trient plus sur des scores caducs) ; charge utile stockée validée par `storedMatchPayloadSchema` (échec → recalcul) ; `profileComplete` calculé même sans offre ; `getDetail` sans relectures ; lots de 20 ; `MAX_LOCATIONS` après fusion de la ville ; dérive temporelle de l'empreinte (≈ 36 jours pour un poste en cours) documentée ; docstring `complete` (« ou »). Nouvel assistant `currentProfileFingerprint(userId)` pour filtrer les jointures en tâche 6. Tests : isolation, invalidation (re-analyse, DONE→FAILED), charge utile corrompue, Paris, « Metz (57) », code postal, homonymes. matching 190 → 202 tests.

### Task 9 — amendement après exécution (`291fd16`)
`apps/web/e2e/matching.spec.ts` : sans IA, aucun score inventé (aucun badge « Correspondance … »), alerte « L'analyse des offres nécessite le service IA (non configuré). », onglets « Pour vous »/« Forte priorité » actifs ; onglet et tris reflétés dans l'URL (`onglet=pour-vous`, `tri=match`, `tri=pertinence`) ; détail : section « Pourquoi cette offre vous correspond » avec « Analyser cette offre », l'état non configuré ou l'avis de profil incomplet ; profil incomplet → « Compléter mon profil » vers `/profile`. Un seul compte par fichier (inscription via `page.request`, cookies injectés par `addCookies` — le `storageState` fichier était sujet à une course au démarrage). `jobs.spec.ts` : le localisateur `getByRole('alert')` devenait ambigu avec deux alertes sur `/jobs` → filtré par texte. Playwright 26 → 34.

### Task 8 — amendement après revue (`6f3a2a6` + correctif `f715bd7`)
Onglets et tris actifs, carte avec badge/puce/« Pourquoi ? » uniquement quand un score existe, panneau de détail sous l'en-tête, retry câblé : conformes. Critiques corrigés : la page n'interrogeait qu'une fois (`analyzeAsync`) — `useAnalysisPolling` était mort et la bannière « Analyse de n offres… » restait affichée à vie (`pending` collant) → sondage toutes les 2 s jusqu'à complétion (60 s max), bannière qui disparaît (test à horloge réelle) ; la bascule vers « Pertinence » et la reprise des préférences se disputaient `isDefaultQuery` (l'un annulait l'autre : préférences perdues ou tri jamais appliqué) → drapeau « `tri=` explicite à l'arrivée » capturé au montage, décision séquencée après les préférences et prise même quand toutes les offres sont déjà notées (chemin rapide) ; sous React 18 la transition `isAnalyzing` n'est pas observable en tests (rendu groupé) → détection par identité de référence du résultat du sondage. Importants : états « IA non configurée » / « profil incomplet » hissés au niveau page (visibles sur les onglets « Pour vous »/« Forte priorité » à zéro résultat) ; branche `sync.analysis` morte retirée ; erreurs d'analyse/relance affichées sur le détail (message 429 de l'API) ; jeux d'ids vus en `Set` ; `enabled` sur `useJobMatch` ; message centralisé. web 261 → 295.

### Task 6 — amendement après revue sécurité et vérification visuelle (`9e5c64e` + correctif `108769e`)
Auth/CSRF, validation, sémantique 429 (budget consommé par analyse lancée, 429 seulement si rien n'a pu partir), seau partagé avec `retry` (clé identique vérifiée), isolation (jointures par `profileId` + empreinte courante), hygiène e2e : confirmés. Vérifié visuellement avec 3 analyses fictives semées : score « 77 » sur la carte et le détail, facteurs, points faibles, recommandation. Corrigé : un bump de `JOB_ANALYSIS_VERSION` ne relançait rien (statut sans version) → `needsAnalysis` compare la version ; `analysisVersion` ajouté aux quatre prédicats de jointure ; `POST /jobs/analyses` sans service IA répond désormais **200** avec `notConfigured` et les scores déjà calculés (le 503 cachait les scores existants — contrat §6 amendé) ; message dupliqué du bandeau « non configuré » supprimé ; libellé de localisation distinguant « aucun lieu » de « lieux non reconnus » (`preferredLocationLabels` dans les entrées et l'empreinte) ; `retry` sur offre inconnue → 404 ; `JobSyncInfoDto.analysis` obligatoire ; `JobsService` réutilise `isConfigured()`. Décisions documentées : coût du profil (1 + 6 lectures indexées) sur chaque liste **accepté** (cache Redis reporté : 7 chemins d'écriture à invalider) ; classement `match`/`pertinence` **en mémoire sur les 500 offres les plus récentes** (Prisma ne trie pas une relation filtrée par utilisateur), `total` = candidates considérées, pages au-delà vides — spec §6 amendée. Remarque de recette : la bascule automatique vers « Pertinence » se déclenche aussi quand au moins une offre est déjà notée (chemin rapide), même sans service IA — accepté (les offres notées passent devant). api 565 → 566, e2e 135 → 137.

### Revue finale de branche et recette (2026-09-17)
Revue finale : **fusionnable**, aucun critique ; deux importants corrigés par le coordinateur (`9a5028e`, `6b9c245`) : sans service IA, `POST /jobs/analyses` signalait des analyses « en attente » et le client sondait 60 s pour rien (vérification visuelle) → `pending` à 0 et aucun sondage ; une requête pouvait enchaîner jusqu'à 20 appels Claude (plusieurs minutes) → au plus **5 analyses par requête HTTP**, le reste repris par le sondage ; une analyse d'une version antérieure est traitée comme absente (cohérence avec les jointures) ; les erreurs de sondage (429 notamment) sont affichées sur la liste ; compteur de progression = offres restantes. Mineurs reportés : message 429 de `retry` (« quelques minutes » au lieu d'« une heure », seau partagé) ; `currentProfileFingerprint` sans consommateur ; `JobSyncInfoDto.analysis` émis mais non lu ; index `MatchScore(jobId)` pour les cascades ; commentaire de schéma périmé ; specs unitaires du module `matching` sur Postgres réel (isolées par préfixe, parallélisme des fichiers actif).

Recette des critères (spec §11), par le coordinateur :
1. **En attente** — analyse réelle : `ANTHROPIC_API_KEY` absente ; chaîne prouvée par client factice (e2e) et par 3 analyses fictives semées (`pnpm --filter @jobtrack/api jobs:seed-analyses`) : scores « 77 », « 34 », « 30 » affichés sans second appel.
2. **OK** — moteur pur et versionné (141 tests), score `null` sous 50 % du poids, chaque ligne d'explication produite par une règle ; aucun nombre calculé côté client.
3. **OK** — détail vérifié : bandeau « Bonne correspondance · 77 » + « Forte priorité », huit facteurs (barres ou « Non évalué » expliqué), compétences correspondantes, points faibles (« 5 an(s) demandé(s), vous en avez 2.5 »), recommandation ; priorité jamais une probabilité.
4. **OK** — onglets et tris actifs et reflétés dans l'URL (Playwright) ; pertinence favorise la fraîcheur (e2e) ; classement en mémoire sur 500 candidates documenté.
5. **OK** — sans clé : « L'analyse des offres nécessite le service IA (non configuré). » une seule fois, aucun badge sur les offres non analysées ; profil incomplet → avis avec liens (Playwright).
6. **OK** — aucune donnée du profil au modèle, document borné, budgets 60/h + 5 par requête, verrou, isolation par profil + empreinte + version (e2e), jamais de 500.
7. **OK** — shared 182, api 566 unitaires + 137 e2e, web 295 + 34 Playwright (33 + 1 ignoré par conception) ; lint/typecheck/build 4/4 ; aucun `any` ; états chargement/vide/erreur/mobile/sombre vérifiés sur le détail et la liste.

Note de clôture : 9/9 tâches, chaque tâche revue (deux revues sécurité : analyse et routes) et corrigée ; vérification visuelle du coordinateur sur données semées. Limite d'environnement : sans identifiants France Travail le référentiel des communes est vide, donc le facteur Localisation reste « non évalué » (libellé dédié) — se résorbe dès le premier chargement du référentiel. À valider par l'utilisateur : poids des facteurs, seuils de bande/priorité, 5 analyses par requête, tri « Pertinence » par défaut dès qu'un score existe.

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Distance kilométrique impossible (référentiel sans coordonnées) | Commune / département / département limitrophe ; géocodage reporté |
| Analyse à la demande, 20 offres par page, 60/h | Suffisant pour l'usage individuel ; recalcul planifié en T7 |
| Table de synonymes statique | Versionnée (`SCORING_VERSION`) ; recalcul automatique quand elle évolue |
| Un seul fournisseur IA (Claude) | Interface `JobAnalyzer` ; OpenAI possible plus tard |
