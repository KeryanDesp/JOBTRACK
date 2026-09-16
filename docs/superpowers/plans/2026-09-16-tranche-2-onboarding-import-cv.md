# Tranche 2 — Onboarding et import de CV : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un nouveau compte importe son CV (PDF/DOCX), vérifie les données extraites par Claude, les applique à son profil, règle ses préférences — ou passe — en un parcours d'onboarding ; l'import reste disponible depuis `/profile`.

**Architecture:** module API `cv-import` (upload multipart → stockage disque → extraction structurée Claude → brouillon `CvImport` → application transactionnelle sur profil/collections/préférences) + module `onboarding` (drapeau `onboardingCompletedAt`) ; contrat partagé `cvExtractionSchema`/`cvApplySchema` ; frontend `features/onboarding` (machine d'étapes dans l'URL) et `features/cv-import` (dropzone, revue, hooks). Spec : `docs/superpowers/specs/2026-09-16-tranche-2-onboarding-import-cv-design.md`.

**Tech Stack:** existant + `@anthropic-ai/sdk` (`messages.parse`, `zodOutputFormat`, `countTokens`), `@fastify/multipart`, `mammoth` (DOCX → texte). Modèle `claude-opus-5` (surchargeable `ANTHROPIC_MODEL`).

**Règles héritées de la tranche 1 :** types d'entrée Zod (`*FormInput`) pour les formulaires ; `ZodValidationPipe` renvoie la sortie parsée ; écritures filtrées par propriétaire, 404 jamais 403 ; `@Public()` ≠ `@NoCsrf()` ; 503 `serviceUnavailable()` sur panne d'infrastructure ; aucun `any`/`!`/`eslint-disable` ; français ; tests nommés sans accents ; comptes e2e `e2e-…` nettoyés ; vérification visuelle de **chaque** chemin d'écriture par le coordinateur.

**Compteurs de départ :** shared 41, api 91 unitaires + 48 e2e, web 57 + 12 Playwright.

---

## Task 1: Drapeau d'onboarding et modèle `CvImport`

**Files:** `apps/api/prisma/schema.prisma` (+ migration `…_onboarding_and_cv_import`), `packages/shared/src/auth.ts` (`SessionUser.onboardingCompleted`), `apps/api/src/modules/auth/auth.service.ts` (`toSessionUser`), `apps/api/src/modules/onboarding/{onboarding.module,onboarding.controller,onboarding.service}.ts`, `apps/api/src/app.module.ts`, `apps/api/src/modules/auth/auth.controller.ts` (callback Google → `/onboarding` si non terminé), tests `onboarding.service.spec.ts` (2), `auth.e2e.spec.ts` (+2).

- [ ] Schéma : `User.onboardingCompletedAt DateTime?` ; `enum CvImportStatus { PENDING EXTRACTED FAILED APPLIED }` ; `model CvImport` (spec §3) ; `pnpm db:migrate` (nom `onboarding_and_cv_import`).
- [ ] `SessionUser.onboardingCompleted: boolean` (shared, rebuild) ; `toSessionUser` le calcule (`onboardingCompletedAt !== null`) — le type `UserWithProfile` inclut déjà le champ.
- [ ] `POST /onboarding/complete` (authentifié, CSRF, 204, idempotent) → `OnboardingService.complete(userId)` (`update` seulement si null) ; `GET /auth/me` reflète le drapeau.
- [ ] Callback Google : redirection `/onboarding` si `!user.onboardingCompleted` sinon `/profile` (`findOrCreateFromGoogle` renvoie le `SessionUser`).
- [ ] Tests : unitaires (complete pose la date, second appel ne la change pas) ; e2e (`POST /onboarding/complete` → 204 puis `/auth/me` → `onboardingCompleted: true` ; sans CSRF → 403).
- [ ] Commit : `feat(api): drapeau d onboarding et modele d import de cv`.

## Task 2: Contrat partagé d'extraction et d'application

**Files:** `packages/shared/src/cv-import.ts` (+ export dans `index.ts`), `packages/shared/src/cv-import.test.ts` (≥ 8 tests).

- [ ] `flexibleDate` : accepte `AAAA`, `AAAA-MM`, `AAAA-MM-JJ`, `MM/AAAA`, `''`, `null` → sortie `AAAA-MM-JJ` (jour/mois manquants → `01`) ou `null` ; refuse une date invalide.
- [ ] `*Draft` : `experienceDraftSchema` (`company`, `role`, `location?`, `startDate: flexibleDate`, `endDate: flexibleDate`, `isCurrent` déduit si `endDate` nul et non fourni, `description?`), `educationDraftSchema`, `skillDraftSchema` (`category` par défaut `TECHNICAL`, `level` par défaut `INTERMEDIATE`, hors énumération → défaut), `languageDraftSchema` (`level` CECRL, « natif/maternelle » → `NATIVE`, inconnu → `B2`), `certificationDraftSchema`, `projectDraftSchema` (`technologies` tableau, `url` http(s) sinon `null`).
- [ ] `cvExtractionSchema` (spec §4) — tolérant à l'entrée (Claude), strict en sortie ; tableaux limités (50 expériences, 100 compétences…), chaînes bornées comme le profil.
- [ ] `cvApplySchema` : blocs avec `selected: boolean` par élément ; `identity` et `preferences` partiels ; les éléments passent par les **schémas stricts du profil** (`experienceSchema`…) car ils sont écrits en base.
- [ ] Types : `CvExtraction`, `CvApplyInput`, `CvApplyFormInput`, `CvImportStatus` (union littérale), `CvImportDto` (`id, fileName, status, extracted: CvExtraction | null, error, createdAt`).
- [ ] Commit : `feat(shared): contrat d extraction et d application d un cv`.

## Task 3: Environnement, dépendances, stockage, limiteur par utilisateur

**Files:** `packages/shared/src/env.ts` (+ test), `.env.example`, `apps/api/package.json` (deps `@anthropic-ai/sdk`, `@fastify/multipart`, `mammoth`), `apps/api/src/app.setup.ts` (multipart : `limits { fileSize: 10 Mo, files: 1 }`), `apps/api/src/common/storage/{file-storage.ts,disk-file-storage.ts,disk-file-storage.spec.ts}`, `apps/api/src/common/anthropic.provider.ts` (`ANTHROPIC_CLIENT` : `new Anthropic({ apiKey })` ou `null`), `apps/api/src/common/rate-limit.guard.ts` (+ `by: 'user'`), `apps/api/src/common/user-rate-limit.guard.ts` (garde locale exécutée après `AuthGuard`, même Lua/clé `ratelimit:{route}:user:{id}`), tests.

- [ ] Env : `ANTHROPIC_API_KEY` optionnel, `ANTHROPIC_MODEL` optionnel (défaut `claude-opus-5`), `STORAGE_DIR` défaut `./storage` ; `.gitignore` += `storage/`.
- [ ] `pnpm add` dans `apps/api` (versions exactes vues : sdk 0.126.x, multipart 10.x compatible Fastify 4 ? **vérifier** : `@fastify/multipart` 10 cible Fastify 5 → prendre la dernière 8.x compatible Fastify 4 ; mammoth 1.12.x). `pnpm approve-builds` si nécessaire.
- [ ] `FileStorage` : `put(key, buffer)`, `get(key)`, `delete(key)` ; clé validée (`^[a-z0-9/_-]+\.(pdf|docx)$`) pour interdire toute traversée ; tests sur un dossier temporaire.
- [ ] `UserRateLimitGuard` : `@UserRateLimit({ limit: 3, windowSeconds: 3600 })` — lit `request.user.id` (donc après `AuthGuard`, via `@UseGuards` sur la route) ; réutilise le script et le 503 de `RateLimitGuard` (extraire `RateLimiter` service commun avec `hit(key, limit, window)`).
- [ ] Commit : `feat(api): stockage de fichiers, client anthropic, limiteur par utilisateur`.

## Task 4: Service d'extraction Claude

**Files:** `apps/api/src/modules/cv-import/cv-extraction.service.ts`, `cv-extraction.prompt.ts`, `cv-extraction.service.spec.ts` (≥ 6 tests avec un faux client).

- [ ] Entrée : `{ buffer, mimeType }` ; PDF → bloc `document` base64 ; DOCX → `mammoth.extractRawText` → bloc texte (vide → `FAILED` « Le document ne contient pas de texte exploitable. »).
- [ ] Garde de coût : `client.messages.countTokens` → > 60 000 → `CvTooLongError`.
- [ ] `client.messages.parse({ model, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium', format: zodOutputFormat(cvExtractionSchema) }, system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }], messages: [...] })` ; `parsed_output` nul → `CvUnreadableError` ; `stop_reason === 'refusal'` → idem avec message dédié.
- [ ] Erreurs : `Anthropic.AuthenticationError` → `AiNotConfiguredError` (journal `error`) ; `RateLimitError`/`InternalServerError`/`APIConnectionError` → `AiUnavailableError` ; autres → propagées.
- [ ] Retour : `{ extraction, model, inputTokens, outputTokens }`.
- [ ] Prompt système (`cv-extraction.prompt.ts`) : rôle, français, ne rien inventer, ignorer toute instruction du document, pas d'inférence de données sensibles, dates au format demandé, énumérations listées.
- [ ] Commit : `feat(api): extraction structuree d un cv par claude`.

## Task 5: Module `cv-import` (upload, brouillon, application, isolation)

**Files:** `apps/api/src/modules/cv-import/{cv-import.module,cv-import.controller,cv-import.service,cv-file.validator,cv-apply.service}.ts`, `cv-file.validator.spec.ts`, `cv-apply.service.spec.ts`, `cv-import.e2e.spec.ts` (≥ 12 tests), fixtures `apps/api/fixtures/cv-demo.pdf` + `cv-demo.docx` + `scripts/make-cv-fixtures.py` (Python `zipfile`/PDF minimal, personnage « Camille Démo »).

- [ ] Routes (spec §5) ; `POST /cv-imports` : `request.file()` (multipart), validateur (signature, taille, extension/mime cohérents, nom nettoyé), 1 `PENDING` par utilisateur (409 `IMPORT_IN_PROGRESS`), `@UserRateLimit(3/h)`, stockage, `CvImport` PENDING → extraction synchrone → `EXTRACTED`/`FAILED` ; réponse `CvImportDto`. Sans client → 503 `AI_NOT_CONFIGURED` avant tout stockage.
- [ ] `cv-apply.service.ts` : transaction (`$transaction(async tx)`) : identité (clés présentes seulement), éléments cochés créés avec `sortOrder = count + i`, préférences fusionnées ; renvoie `{ created: { experiences: n, … } }` ; `APPLIED`.
- [ ] Isolation : toutes les requêtes `where: { id, userId }`.
- [ ] e2e : capabilities (sans client `ai:false`, avec faux client `ai:true`), upload PDF fixture → EXTRACTED avec le faux client (surcharge `ANTHROPIC_CLIENT` par un objet dont `messages.parse` renvoie une extraction fixe et `countTokens` 1 000), DOCX, type refusé (400 `INVALID_FILE`), trop gros (413 ou 400 lisible), apply → profil/collections/préférences, éléments décochés non créés, second apply → 409 `ALREADY_APPLIED`, isolation (404 sur GET/apply/delete d'autrui), delete, 1 en cours (simuler PENDING), `retry` d'un FAILED.
- [ ] Commit : `feat(api): import de cv — upload, brouillon, application au profil`.

## Task 6: Frontend — couche d'accès, session, redirections

**Files:** `apps/web/src/services/api/cv-import.ts` (+ test upload XHR), `apps/web/src/features/cv-import/hooks/use-cv-import.ts`, `services/api/auth.ts` (`completeOnboarding`), `features/auth/pages/{register,login}-page.tsx`, `features/auth/hooks/use-session.ts` (aucun changement de forme : `onboardingCompleted` arrive dans `SessionUser`).

- [ ] `uploadCv(file, { onProgress, signal })` via `XMLHttpRequest` (progression, en-tête CSRF, `withCredentials`, délai 90 s) → `CvImportDto` ; erreurs mappées en `ApiError`.
- [ ] Redirections : inscription → `/onboarding` ; connexion → `from ?? (user.onboardingCompleted ? '/profile' : '/onboarding')`.
- [ ] Tests : upload (en-tête, `FormData`), redirection après inscription.
- [ ] Commit : `feat(web): acces api d import de cv et redirections d onboarding`.

## Task 7: Frontend — onboarding (coquille, étapes Bienvenue / CV / Préférences / Fin)

**Files:** `apps/web/src/features/onboarding/{layouts/onboarding-layout.tsx,pages/onboarding-page.tsx,components/step-indicator.tsx,steps/welcome-step.tsx,steps/cv-step.tsx,steps/preferences-step.tsx,steps/done-step.tsx}`, `features/cv-import/components/cv-dropzone.tsx` (+ test), `app/router/routes.tsx` (`/onboarding/:step?` sous `ProtectedRoute`, hors `AppLayout`), `features/profile` (bannière « Terminer la configuration » si non terminé).

- [ ] Machine d'étapes dans l'URL ; « Passer » → `completeOnboarding` → `/profile` ; l'étape CV appelle `capabilities` (IA absente → seule la saisie manuelle) ; la dropzone : `input type=file` réel, glisser-déposer, erreurs type/taille avant envoi, progression ; succès → étape Vérifier (Task 8) ; échec → `ErrorState` + réessayer.
- [ ] Préférences : réutilise le formulaire de `PreferencesCard` (extraire `PreferencesForm` réutilisable), pré-rempli par `extraction.preferences`.
- [ ] Tests web : dropzone (refus type/taille, sélection), navigation d'étapes, « Passer ».
- [ ] Commit : `feat(web): parcours d onboarding`.

## Task 8: Frontend — vérification et application de l'extraction, import depuis le profil

**Files:** `features/cv-import/components/{extraction-review.tsx,review-block.tsx}` (+ tests), `features/onboarding/steps/review-step.tsx`, `features/cv-import/pages/import-cv-page.tsx` (`/profile/import`), `features/profile/pages/profile-page.tsx` (action « Importer un CV »).

- [ ] Revue : par bloc, liste des éléments avec case à cocher (cochés par défaut), résumé + « Modifier » ouvrant le même dialogue que les sections du profil (réutiliser `renderFields` des sections via un export) ; identité et titre/résumé en champs directs ; compteur « n éléments seront ajoutés » ; « Appliquer au profil » → `applyImport` → toast + étape suivante (ou `/profile` depuis l'import direct).
- [ ] Tests : décocher exclut du corps envoyé ; édition d'un élément reflétée ; erreur serveur affichée.
- [ ] Commit : `feat(web): verification des donnees extraites et import depuis le profil`.

## Task 9: Playwright, CI, recette

**Files:** `apps/web/e2e/onboarding.spec.ts` (2 tests : parcours manuel complet ; état « IA non configurée »), `.github/workflows/ci.yml` (rien à ajouter sauf variables si besoin), docs.

- [ ] Recette des critères (spec §10) par le coordinateur, dont l'extraction réelle sur `fixtures/cv-demo.pdf` avec la clé de l'utilisateur.
- [ ] Commit : `test: parcours d onboarding end-to-end`.

### Task 1 — amendement après revue (`cbbd72a`, approuvé)
Conforme mot pour mot. Notes appliquées ensuite : `CvImport.extracted` (`Json?`) se lit par `cvExtractionSchema.safeParse`, jamais par cast, et s'efface par `Prisma.DbNull` ; côté web, `completeOnboarding()` doit mettre à jour la session en cache (`useSetSession`) pour faire disparaître la bannière sans rechargement. Compteurs : api 93 unitaires, 50 e2e.

### Task 2 — amendement après revue (`c72cc8c` + correctif `2b2f98e`)
Critique corrigé : un brouillon extrait ne repassait pas `cvApplySchema` (les helpers stricts du profil refusaient `null`). `profile.ts` **exporte** désormais `optionalText`/`optionalUrl`/`optionalNumber`/`omitUndefinedValues`, et `optionalText`/`optionalUrl` acceptent `null` en entrée (`'' | null` → `null`, clé absente inchangée — sémantique PATCH intacte) ; test d'aller-retour sur les six blocs. Aussi : accents restaurés dans les messages, refinements de dates sur formation/certification, `draftUrl` borné à 2000, listes de préférences filtrées au lieu d'échouer, `return z.NEVER` après `addIssue` (types de sortie justes), années plausibles (1900 … N+1), `3/2021` accepté, `.default` sur toutes les clés de `cvApplySchema`, types `*Draft` exportés. **`cvExtractionWireSchema`** : miroir plat (nullable, sans transform/défaut/refine, `.strict()`) destiné à `output_config.format` — l'API fait `parse` avec le schéma fil puis normalise avec `cvExtractionSchema`. Shared : 41 → 86 tests.

### Task 3 — amendement après revue (`a0131ed` + correctif `369caba`)
`@fastify/multipart@8.3.1` (ligne Fastify 4), `@anthropic-ai/sdk@0.126.0` (entrée `minimumReleaseAgeExclude` dans `pnpm-workspace.yaml`, commentée : la version est plus récente que le délai de sécurité pnpm), `mammoth@1.12.3`. Blocage corrigé : `STORAGE_DIR` relatif était résolu depuis `process.cwd()` (= `apps/api` sous `nest --watch`) → `apps/api/storage/` non ignoré ; désormais résolu depuis la **racine du monorepo** (dossier contenant `pnpm-workspace.yaml`), et `.gitignore` couvre `/storage/` **et** `/apps/api/storage/` (le motif nu `storage/` aurait masqué `src/common/storage/`). `DiskFileStorage implements FileStorage`, suppression idempotente, fichier temporaire nettoyé si `rename` échoue ; `DiskFileStorage` fourni par `useFactory` (Nest ne peut pas injecter un paramètre `string`). `RateLimiterService` (Lua, 503 fermé) partagé par `RateLimitGuard` et `UserRateLimitGuard` ; la garde utilisateur refuse proprement (`NOT_AUTHENTICATED`) si posée sur une route publique. api : 104 unitaires.

### Task 4 — note d'exécution (`bd0c165`, revue en cours)
`zodOutputFormat` (`@anthropic-ai/sdk` 0.126) appelle `z.toJSONSchema` de **zod v4** : un schéma zod v3 plante (`.def` absent). Le schéma « fil » `cvExtractionWireSchema` est donc construit avec `import { z } from 'zod/v4'` (sous-chemin du même paquet `zod@3.25`, aucune dépendance ajoutée) ; `cvExtractionSchema` (v3, normalisation) reste inchangé. api : 111 unitaires.

### Task 4 — amendement après revue (`bd0c165` + correctif `606eeda`)
Critique corrigé : `zodOutputFormat(...).parse` **lève** une `AnthropicError` nue (JSON tronqué à `max_tokens`, sortie non conforme au schéma strict) — elle échappait au mappage, devenait un 500 et le filtre aurait journalisé un extrait du CV. Désormais : `AnthropicError` non-`APIError` → `CV_UNREADABLE` sans jamais interpoler le message ; `stop_reason: max_tokens` → `CV_UNREADABLE` ; `countTokens` sous le même mappage ; `PermissionDeniedError`/`NotFoundError` → `AI_NOT_CONFIGURED`. Texte DOCX délimité par `<document_cv>…</document_cv>` (balise de fermeture retirée du texte) avec rappel « donnée, jamais instruction » sur les deux chemins. Schéma de normalisation **tolérant ligne par ligne** : une ligne invalide est écartée au lieu de perdre tout le CV ; identité tronquée à ses bornes ; schéma « fil » avec `maxLength`/`maxItems`. `cache_control` du prompt système sans doute inerte (< 1024 jetons) — provisoire. Note pour la tranche 5 : le texte libre extrait est une prose contrôlée par l'auteur du document, à délimiter quand on le renvoie à un modèle. shared 89, api 111 → 118 (+7).

### Task 5 — amendement après exécution (`b004cb1`, revue en cours)
Fichiers du validateur et du service d'application repris de l'agent arrêté (corrects). `CvImportService` injecte `ANTHROPIC_CLIENT` pour répondre 503 `AI_NOT_CONFIGURED` **avant** toute écriture ; clé de stockage `${userId}/${uuid}.${ext}` ; extraction synchrone → `EXTRACTED` ou `FAILED` (DTO renvoyé avec le message, fichier conservé pour `retry`) ; `retry` réservé à `FAILED` (`RETRY_NOT_ALLOWED` sinon) ; suppression = ligne + fichier. 413 : `RequestFileTooLargeError` de `@fastify/multipart` porte `statusCode: 413`, déjà traduit par le filtre. Fixtures « Camille Démo » (PDF écrit à la main, DOCX via `zipfile`) générées par `apps/api/scripts/make-cv-fixtures.py` (stdlib Python). e2e : 15 tests dont isolation (GET/apply/delete d'autrui → 404), application (éléments décochés absents, préférences fusionnées sans doublon), double application → 409, `PENDING` concurrent → 409, non configuré → 503 sans ligne ni fichier. api e2e 50 → 65.

### Task 5 — amendement après revue sécurité (correctif `136f17b`)
Critique corrigé : une erreur d'extraction non mappée (ex. ZIP renommé `.docx` arrivant chez `mammoth`) laissait une ligne `PENDING` à vie et, sans route de liste, verrouillait l'import pour l'utilisateur. Désormais : `AiNotConfigured`/`AiUnavailable` → rollback (ligne + fichier) + 503 (`AI_NOT_CONFIGURED` / `AI_UNAVAILABLE`, sans consommer le quota) ; `CvTooLong`/`CvUnreadable` → `FAILED` avec message métier ; tout le reste → journal (pile seulement, jamais le contenu) + `FAILED` « L'analyse du document a échoué. Réessayez. » — jamais de 500. Le validateur DOCX lit l'enregistrement de fin de répertoire central du ZIP et exige une entrée `word/document.xml`. `PENDING` plus vieux que 5 min basculé en `FAILED` avant un nouvel envoi ; `GET /cv-imports` liste les imports du propriétaire. `apply` atomique : première écriture = `updateMany` compare-et-échange `EXTRACTED → APPLIED` (double clic concurrent → un 201, un 409, collections créées une fois). `retry` et `POST` partagent un seau `bucket: 'cv-extraction'` (3/h) via une option du limiteur utilisateur. Mineurs : non-multipart ou champ ≠ `file` → 400 `INVALID_FILE` ; blob supprimé si l'insertion échoue ; caractères bidi retirés des noms ; fixture DOCX déterministe ; le DTO ne porte jamais `storageKey`. api 134 → 138 unitaires, e2e 65 → 74.

### Task 6 — amendement après revue (`437a8a2` + correctif `db7a058`)
Conforme (routes/verbes exacts, DTO partagés, même source CSRF que `apiRequest` : cookie `jt_csrf` → `x-csrf-token`). Correctifs : annulation et délai distingués (`ApiError` codes `ABORTED` / `TIMEOUT`, l'annulation n'est pas une erreur côté hook, `abort()` exposé par `useUploadCv`) ; écouteur `abort` détaché à la fin ; `useCompleteOnboarding` met à jour la session en cache par mise à jour fonctionnelle **puis** invalide (cache froid couvert) ; boucle d'invalidation par collection supprimée (préfixe `['profile']` suffit) ; clés de requêtes du profil centralisées dans `features/profile/lib/query-keys.ts` (`profileKeys`) ; `useCvImport(id)` ajouté ; `from` transmis à `/onboarding`. Note : `/onboarding` n'existe qu'à la tâche 7 — les deux tâches ne se recettent qu'ensemble. Piège documenté : un 413 est souvent vu par le navigateur comme une coupure réseau (`onerror`) — la vérification de taille côté client de la dropzone est la vraie défense. web 57 → 69.

### Task 5 — amendement après re-revue (correctif `711c300`, approuvé sur le fond)
Le balayage des `PENDING` obsolètes était une mise à jour non conditionnelle (pouvait basculer en `FAILED` une extraction tout juste réussie) → un seul `updateMany` conditionné sur `status: 'PENDING'` à l'écriture. Seuil porté de 5 à **15 min**, dérivé de la config du client Anthropic (`timeout 90 s × (1 + 2 retries) × 2 appels ≈ 9 min` + marge) et commenté pour ne plus dériver. `GET /cv-imports` : `take: 50`, `select` explicite, DTO allégé `CvImportSummaryDto` (sans `extracted` ni `storageKey`, export additif de `packages/shared`). `retry` sur blob absent → 409 au lieu d'un 500. Fixtures ZIP de test exclues du build. Le quota 3/h **est** consommé même sur 503 (le limiteur incrémente à l'entrée) — commentaire corrigé. Analyseur ZIP fuzzé par le relecteur (20 k tampons, pire cas 17 ms) : fermé, ZIP64 volontairement non supporté. Reporté : index unique partiel `(userId) WHERE status='PENDING'` contre la course entre deux envois simultanés (bornée par le seau 3/h). api e2e 74 → 77.

### Task 7 — amendement après revue et vérification visuelle (`5b50c7b` + correctif `20be77c`)
Parcours vérifié par le coordinateur dans le navigateur intégré : inscription → Bienvenue → CV → Préférences → Terminé → profil sans bannière ; bannière « Terminer la configuration » + « Plus tard » ; dialogue « Passer » (Annuler / confirmer) ; rejet d'un `.txt` avec le message attendu ; envoi d'un PDF avec progression, « Analyse en cours… » puis 503 « service non configuré » proprement affiché (clé factice refusée par Anthropic, aucune ligne conservée) ; mobile 375 px sans débordement ; thème sombre. Correctifs : « Voir mon profil » est un lien (navigue toujours, même si l'appel de fin échoue) et l'appel de fin d'onboarding au montage est verrouillé (StrictMode le déclenchait deux fois) ; préremplissage des préférences derrière un squelette tant que l'import charge, appliqué une seule fois (ne peut plus effacer une saisie) ; bouton « Précédent » (spec §2) piloté par l'ordre des étapes, masqué sur `bienvenue`/`fin` ; `state.from` mort retiré de l'inscription (l'accueil mène toujours au profil) ; dialogue renommé « Passer la configuration ? » ; dropzone : un seul arrêt de tabulation, anneau de focus, `aria-describedby` sur l'erreur, tailles < 1 Mo en Ko ; `aria-current` sur le `<li>` + « Étape N sur 5 » ; `replace` après extraction ; retour depuis « Vérifier » supprime le brouillon serveur. `useCvImport(id: string | null)` (`enabled`, sans cast). Piège d'infra noté : l'observateur Nest peut cesser de recompiler — relancer l'API par `preview_stop`/`preview_start`. web 69 → 83.

### Task 8 — amendement après revue et vérification visuelle (`53ad795` + correctif `ae0dbba`)
Vérifié par le coordinateur avec une ligne `EXTRACTED` semée en base (pas de clé d'API) : les sept blocs, compteurs et total ; décocher exclut l'élément ; « Modifier » ouvre le dialogue des sections du profil et l'édition se retrouve en base ; retrait d'une puce de préférence ; application → toast, préférences préremplies, récapitulatif exact sur « Terminé », profil peuplé ; ligne déjà appliquée revisitée → écran dédié ; `/profile/import` et action « Importer un CV » ; mobile et sombre. Critique corrigé : une ligne de brouillon plausible (`isCurrent:false` sans date de fin) faisait échouer toute l'application en 400 générique, et la décocher n'y changeait rien (le contrat valide `item` même non sélectionné) → le client **n'envoie que les lignes cochées**, chacune validée avant envoi avec le schéma strict de son bloc (erreur inline, alerte, focus sur la première ligne fautive) ; un `VALIDATION_ERROR` serveur est reprojeté sur les lignes via une table index-envoyé → ligne. Aussi : sortie de `/profile/import` (« Revenir à mon profil », y compris sans IA) ; noms accessibles par ligne (`Inclure « Poste – Entreprise »`) ; compteurs `aria-live` ; invalidation du détail après application ; « Continuer sans importer » désactivé pendant l'envoi ; puces clés par valeur ; coquilles `cv-step`/`review-step` supprimées (`CvUploadFlow`/`CvImportReview` utilisés directement) ; exports inutiles des sections remis privés ; extraction « vide » tient compte des préférences ; pluriel du compteur ; bloc « Profil professionnel » séparé (spec §2). Reporté : rendre `cvApplySchema` indulgent sur `item` quand `selected` est faux (union discriminée) — inutile tant que le client filtre. web 83 → 88 (2 tests de coquille supprimés, couverts ailleurs).

### Task 9 — amendement après exécution (`80ca79f`)
`apps/web/e2e/onboarding.spec.ts` : parcours manuel complet (inscription → Bienvenue → CV → Préférences → Terminé → profil sans bannière, `onboardingCompleted` vrai, préférence persistée) et passage depuis la première étape (dialogue, profil, `/onboarding` toujours accessible, sans « Précédent ») ; branche sur `GET /cv-imports/capabilities` pour rester vert avec ou sans clé. Le test d'inscription de `auth.spec.ts` attendait `/profile` : depuis la tâche 7 l'inscription mène à `/onboarding` → il l'affirme puis va sur `/profile` (son objet est le CRUD du profil). Playwright 12 → 16 (2 tests × 2 projets), nettoyage des comptes `@playwright.local` confirmé.

### Revue finale de branche et recette (2026-09-16)
Revue finale : **fusionnable**, sans point critique ni important. Mineurs corrigés dans `5431a5b` : le journal d'un refus de permission Anthropic n'inclut plus l'objet d'erreur (corps de réponse) ; le motif de clé de stockage accepte `-` dans le premier segment (indépendant de `cuid()` vs `uuid()`) ; la dropzone dérive « 10 Mo maximum » de `capabilities.maxSizeBytes`. Mineurs reportés : index `(userId, status)` sur `CvImport` (le préfixe `userId` suffit aux volumes actuels) ; `GET /cv-imports` sans consommateur web (socle de l'historique des imports, spec §9) ; alerte serveur dans le dialogue « Passer » et l'étape « Terminé » si l'appel de fin échoue (la bannière du profil réapparaît, donc récupérable) ; `useCompleteOnboarding` à déplacer vers `features/onboarding/hooks` ; quatre types `*FormValues` exportés sans consommateur externe ; casts `normalize(...) as XxxFormInput` non commentés ; rappel « entre les balises » envoyé aussi sur le chemin PDF (sans balises) ; nettoyage du disque à la suppression de compte (aucune route de suppression de compte n'existe encore — à porter dans la tranche qui l'ajoutera).

Recette des critères (spec §10), par le coordinateur dans le navigateur intégré :
1. **OK** — inscription → `/onboarding` ; passage possible (dialogue) ; compte ayant terminé la configuration → `/profile` sans bannière à la connexion ; `/onboarding` reste accessible sans y être forcé.
2. **En attente** — extraction réelle sur `fixtures/cv-demo.pdf` : `ANTHROPIC_API_KEY` absente de `.env` ; le chemin est prouvé avec un client factice (e2e) et l'interface a été exercée jusqu'au 503 avec une clé factice refusée par Anthropic.
3. **OK** — ligne `EXTRACTED` semée : rien n'est écrit avant « Appliquer » ; l'élément décoché n'est pas créé ; l'édition par dialogue est propagée ; l'ajout se fait en fin de liste et les préférences sont fusionnées sans doublon (e2e).
4. **OK** — sans clé : alerte explicite sur l'étape CV et sur `/profile/import`, chemin manuel complet ; 503 `AI_NOT_CONFIGURED` avant toute écriture (e2e).
5. **OK** — `.txt` refusé côté client avec le message attendu ; côté serveur : magic bytes, répertoire central DOCX, taille (413), erreur d'extraction inattendue → `FAILED` jamais 500 (e2e).
6. **OK** — lecture, application, suppression et retry d'un import d'autrui → 404 (e2e).
7. **OK** — shared 89, api 138 unitaires + 77 e2e, web 88 + 16 Playwright ; lint et typecheck 4/4 ; aucun `any`.

Note de clôture : 9/9 tâches, chaque tâche revue (deux revues pour le module d'import) et corrigée ; vérification visuelle de chaque chemin d'écriture par le coordinateur. À valider par l'utilisateur au moment opportun : extraction synchrone (jusqu'à ~90 s), stockage disque local, 3 imports par heure, modèle `claude-opus-5`, `PENDING` réputé obsolète après 15 min.

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Extraction synchrone (≈ 10–30 s) | File BullMQ + progression (tranche 8) |
| Stockage disque local | S3 lors de l'hébergement |
| Pas d'historique des imports dans l'interface | plus tard |
| PDF scannés sans texte : dépend de la lecture d'image de Claude | OCR dédié si besoin |
