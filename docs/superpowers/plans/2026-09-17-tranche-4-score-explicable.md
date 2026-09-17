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

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Distance kilométrique impossible (référentiel sans coordonnées) | Commune / département / département limitrophe ; géocodage reporté |
| Analyse à la demande, 20 offres par page, 60/h | Suffisant pour l'usage individuel ; recalcul planifié en T7 |
| Table de synonymes statique | Versionnée (`SCORING_VERSION`) ; recalcul automatique quand elle évolue |
| Un seul fournisseur IA (Claude) | Interface `JobAnalyzer` ; OpenAI possible plus tard |
