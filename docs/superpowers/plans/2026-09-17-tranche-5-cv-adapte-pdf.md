# Tranche 5 — CV adapté, lettre de motivation et export PDF : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/resume` présente le CV principal dérivé du profil (aperçu A4, PDF, modèles) ; `/resume/create/:jobId` produit un CV adapté à une offre par l'IA sans rien inventer (sélection par identifiants, reformulations ancrées, avant/après, versioning, traçabilité) ; une lettre de motivation en trois tons se génère, s'édite et s'exporte en PDF.

**Architecture:** contrat partagé `resume.ts` (document de CV autoporteur, `buildBaseResume(profile)` pur, schémas d'adaptation et de lettre) ; module API `resume` = `ResumeTailoringService` (Claude) → `grounding.ts` (ancrage pur) → `changes.ts` (diff) → `ResumeService`/`CoverLetterService` (versions, isolation) → contrôleur ; frontend `features/resume` = modèles (`@react-pdf/renderer` + jumeau HTML), pages Mon CV / création en 4 étapes / détail / lettre, bouton PDF côté client (chargement paresseux). Spec : `docs/superpowers/specs/2026-09-17-tranche-5-cv-adapte-pdf-design.md`.

**Tech Stack:** existant + **`@react-pdf/renderer` 4.9** (web uniquement, `import()` paresseux). Aucune autre dépendance.

**Règles héritées :** `*Input`/`*Dto` ; `ZodValidationPipe` ; 404 jamais 403 ; aucun `any`/`!`/`as`-contournement/`eslint-disable` ; français accentué dans l'interface, tests nommés sans accents ; comptes/lignes e2e préfixés et nettoyés ; vérification visuelle de chaque chemin d'écriture par le coordinateur ; **aucune donnée simulée** ; jamais d'appel réel à Anthropic dans les tests ; jamais de contenu de CV/lettre dans les journaux ; coordonnées jamais envoyées au modèle.

**Compteurs de départ :** shared 182, api 566 unitaires + 137 e2e, web 295 + 34 Playwright.

---

## Task 1: Schéma Prisma — `Resume`, `ResumeVersion`, `CoverLetter`, modèle préféré

**Files:** `apps/api/prisma/schema.prisma`, migration `<ts>_resumes_and_cover_letters`.

- [ ] Enums `ResumeKind { TAILORED }`, `ResumeTemplate { CLASSIC, MODERN }`, `ResumeVersionSource { AI, USER }`, `CoverLetterTone { SHORT, PROFESSIONAL, PERSONAL }` ; modèles de la spec §3 (cascades `User` → `Resume`/`CoverLetter`, `Resume` → `ResumeVersion` ; `Job` → `SetNull` ; `Resume.jobId` index ; `User.resumeTemplate`).
- [ ] `pnpm db:migrate --name resumes_and_cover_letters` ; typecheck ; suites existantes vertes.
- [ ] Commit : `feat(api): schema des cv adaptes, versions et lettres de motivation`.

## Task 2: Contrat partagé `resume.ts`

**Files:** `packages/shared/src/resume.ts` (+ test), `index.ts`.

- [ ] `resumeContentSchema` (spec §4, `schemaVersion` littéral 1, ids obligatoires sur les éléments issus du profil, bornes), `buildBaseResume(profile: ProfileDto-like, options)` pur (découpage des descriptions en puces : lignes commençant par `-`, `•`, `*` ou phrases ; ≤ 6 puces ; ordre par `sortOrder` puis dates décroissantes ; `isCurrent`), `resumeTailoringSchema` (v3 tolérant) + `resumeTailoringWireSchema` (v4 strict, `maxItems`), `coverLetterContentSchema` + `coverLetterWireSchema`, `resumeChangesSchema`, DTO et inputs (`createTailoredResumeSchema { jobId, template }`, `updateResumeSchema { content, template? }`, `createCoverLetterSchema { jobId, tone, resumeId? }`, `updateCoverLetterSchema { content }`), libellés, `resumeFileName(identity, company)` (assainissement ASCII).
- [ ] Tests ≥ 20. Commit : `feat(shared): contrat du cv, de l adaptation et de la lettre`.

## Task 3: Ancrage et diff (purs)

**Files:** `apps/api/src/modules/resume/lib/{grounding.ts,changes.ts,text-units.ts}` (+ specs).

- [ ] `extractNumbers(text)`, `extractProperNouns(text)` (mots capitalisés hors début de phrase, sigles, noms de technologies via `canonicalSkill` de T4), `isGrounded(candidate, sources[]) → { ok, missing: string[] }`.
- [ ] `groundTailoring(base, tailoring) → { content, rejected[] }` : applique `keep`/`order`, vérifie chaque `highlight`/`summary`/`title` selon §5, remplace les puces rejetées par la source, ignore les ids inconnus, complète les compétences absentes.
- [ ] `computeChanges(base, tailored) → ResumeChanges` (§4).
- [ ] `groundLetter(letter, sources, tone) → { content, removedSentences }` (phrases retirées, longueur par ton).
- [ ] Tests ≥ 30 (nombres inventés, entités inventées, technologie connue du profil acceptée, sigle, puce vide, ordre, id inconnu, résumé, lettre par ton).
- [ ] Commit : `feat(api): ancrage des reformulations et diff avant-apres`.

## Task 4: Adaptation et lettre par Claude

**Files:** `apps/api/src/modules/resume/{resume-tailoring.service.ts,resume-tailoring.prompt.ts,cover-letter.service.ts,cover-letter.prompt.ts,resume.errors.ts,resume.module.ts}` (+ specs), `apps/api/fixtures/resume/*.json`.

- [ ] Prompts stables (règles « jamais inventer », sélection par id, reformulation fidèle, langue du profil, `<profil>`/`<offre>` délimités et nettoyés), `messages.parse` + `zodOutputFormat`, `max_tokens 8000` (CV) / 3000 (lettre), `effort medium`, `cache_control`.
- [ ] `tailor(userId, jobId)` : profil → `buildBaseResume` (coordonnées retirées de l'entrée IA), analyse T4 (`JobAnalysis` DONE sinon texte de l'offre borné), appel, normalisation, `groundTailoring`, `computeChanges` ; erreurs : non configuré / indisponible / sortie invalide (`AI_OUTPUT_INVALID`, 502, sans écriture) ; verrou Redis `resume:tailor:{userId}:{jobId}` 2 min ; jetons ; journaux sans contenu.
- [ ] `writeLetter(userId, jobId, tone, resumeId?)` idem + `groundLetter`.
- [ ] Tests ≥ 14 (fake Anthropic).
- [ ] Commit : `feat(api): adaptation de cv et lettre de motivation par claude`.

## Task 5: Services, routes, e2e

**Files:** `apps/api/src/modules/resume/{resume.service.ts,cover-letter-store.service.ts,resume.controller.ts,resume.e2e.spec.ts,testing/fake-anthropic.ts}`, `app.module.ts`.

- [ ] Routes de la spec §6 (budgets `@UserRateLimit` `resume-tailoring` 20/h, `cover-letter` 10/h ; `PROFILE_INCOMPLETE` 409 si aucune expérience ni compétence) ; versions (`currentVersion`, `PATCH` → version `USER` validée, ids d'expérience/formation vérifiés comme appartenant au profil) ; suppression ; lettres CRUD ; `GET /resume/base` (+ `template` préféré) ; `PATCH /resume/template`.
- [ ] e2e ≥ 22 (fake Anthropic à fixtures ; isolation ; versions ; ids étrangers 400 ; suppression d'offre → `jobId null` ; budgets ; non configuré ; profil incomplet ; lettres 3 tons ; aucune coordonnée dans le prompt envoyé au fake).
- [ ] Commit : `feat(api): module cv — versions, lettres, routes`.

## Task 6: Web — modèles A4 (HTML + PDF), bouton PDF, accès API

**Files:** `apps/web/package.json` (+ `@react-pdf/renderer`), `apps/web/src/features/resume/templates/{classic,modern}/{template.preview.tsx,template.pdf.tsx}`, `features/resume/lib/{templates.ts,pdf.ts,format.ts}`, `features/resume/components/{resume-preview,download-pdf-button,template-picker}.tsx`, `services/api/resume.ts`, `features/resume/hooks/use-resume.ts`, `features/resume/lib/query-keys.ts` (+ tests).

- [ ] Deux modèles ; parité des sections (test) ; aperçu A4 (échelle, pagination approximative, clair même en sombre) ; `download-pdf-button` avec `import('@react-pdf/renderer')` paresseux, `pdf(<Doc/>).toBlob()`, nom de fichier assaini ; mock dans les tests.
- [ ] Hooks/accès API pour toutes les routes §6.
- [ ] Tests ≥ 12. Commit : `feat(web): modeles de cv a4, export pdf et acces api`.

## Task 7: Web — pages Mon CV, création en 4 étapes, détail

**Files:** `features/resume/pages/{resume-page,resume-create-page,resume-detail-page}.tsx`, `components/{resume-changes,resume-editor,resume-list,letter-list,step-header}.tsx`, `routes.tsx`, `navigation.ts`, `features/jobs/pages/job-detail-page.tsx` (actions « Adapter mon CV » / « Générer une lettre ») (+ tests).

- [ ] `/resume` (trois sections, états), `/resume/create/:jobId` (étapes dans l'URL, analyse T4 réutilisée, « Adapter mon CV », avant/après avec rétablir/désélectionner/éditer, aperçu, « Générer mon CV » → `POST /resume/tailor` puis `PATCH` si l'utilisateur a modifié, « Télécharger le PDF »), `/resume/:id` (aperçu, changements, édition → nouvelle version, suppression).
- [ ] Tests ≥ 12. Commit : `feat(web): mon cv, generation d un cv adapte et versions`.

## Task 8: Web — lettre de motivation

**Files:** `features/resume/pages/cover-letter-page.tsx`, `components/{cover-letter-editor,tone-picker,letter-preview}.tsx`, `templates/letter/{letter.preview.tsx,letter.pdf.tsx}`, `routes.tsx` (+ tests).

- [ ] Choix du ton, génération, édition, aperçu A4, enregistrement, PDF, états (non configuré, erreur, vide).
- [ ] Tests ≥ 8. Commit : `feat(web): lettre de motivation generee, editee et exportee`.

## Task 9: Playwright, recette

**Files:** `apps/web/e2e/resume.spec.ts`.

- [ ] `/resume` avec un profil rempli (créer le profil par l'API dans le test) : aperçu, téléchargement PDF (`waitForEvent('download')`, nom `CV-…pdf`) ; état vide des CV adaptés ; `/resume/create/:jobId` sans IA → état non configuré à l'étape 2 (avec une offre semée si présente, sinon annotation).
- [ ] Recette §11 par le coordinateur (adaptation réelle dès que `ANTHROPIC_API_KEY` est présente).
- [ ] Commit : `test: cv adapte et pdf end-to-end`.

### Task 1 — amendement après exécution (`ed655c5`, approuvé)
Conforme à la spec §3 (quatre enums, `Resume`/`ResumeVersion`/`CoverLetter`, `User.resumeTemplate`, cascades et `SetNull` vers `Job`). Migration `20260917050408_resumes_and_cover_letters`. Suites inchangées (api 566 + 137).

### Task 2 — amendement après revue (`f6c83ac` + correctif `fd72586`)
Revue : schémas conformes (§4), sondes adversariales rejetées, schémas fil compatibles `zodOutputFormat`. Critique corrigé : `buildBaseResume` pouvait produire un document **invalide au regard de son propre schéma** (résumé de 2000 caractères, collections non bornées) → bornes appliquées à la construction (1200 / 30 / 20 / 60), test sur profil débordant. Importants : puces découpées **par ligne d'abord** (le saut de ligne fusionnait tout), découpage en phrases protégé des abréviations (M., Dr, etc., cf.) et exigeant une majuscule/chiffre après la coupure, listes numérotées reconnues, tolérance **par puce** (une puce invalide ne jette plus l'expérience ; `order` non entier tronqué, manquant → fin). Mineurs : pas de `minItems` dans le schéma fil de la lettre ; champs de lettre non vides ; `includeContact` ne retire que email/téléphone (ville/pays gardés pour le raisonnement du modèle) ; nom de fichier neutre pour un nom non latin. Piège d'outillage : les échappements `\u0300-\u036f` avaient été décodés en caractères combinants invisibles par la chaîne d'écriture — réparé au niveau des octets. shared 230 → 246.

Note d'exécution initiale :
Contrat livré (48 tests). Constat : le profil ne porte aucun champ de lien (LinkedIn, site) — `identity.links` existe dans le document mais `buildBaseResume` ne le remplit jamais ; `email` vient de `User`, à fournir par l'API. shared 182 → 230.

### Task 6 — amendement après revue (`d1a8006` + correctif `5c4ca61`)
`@react-pdf/renderer@4.9.0` installé (épinglé, commenté) sans exclusion pnpm ; chargé paresseusement (chunk `react-pdf.browser` ≈ 1,2 Mo / 454 Ko gzip séparé du bundle principal, un chunk de ~5 Ko par modèle) ; `resumeSections()` source unique de l'ordre des sections pour les deux jumeaux. Critiques corrigés : `project.url` et `identity.links` n'étaient rendus nulle part → rendus dans les quatre rendus (PDF via `Link`, césure des mots longs enregistrée) ; le modèle Moderne n'avait aucune marge de page (pied de page « Page n / N » sur le texte) → marges haut/bas, bandeau d'en-tête compensé en page 1. Importants : aperçu recalculé au changement de contenu (observation de la page, hauteur en état), séparateurs de pages approximés tous les 297 mm avec libellé, région défilable focusable et nom accessible « Aperçu du CV, page n », tests de l'aperçu, test de parité sur un document complet (ordre des titres sur les deux jumeaux, champs de chaque section), URL d'objet révoquée après le clic, erreur journalisée avant le toast, `useTailorResume`/`useCreateLetter` sans toast pour `AI_NOT_CONFIGURED`/`PROFILE_INCOMPLETE`/`RATE_LIMITED` (états rendus par la page), tests des hooks manquants. Mineurs : plus de `as` dans le sélecteur de modèle, `enabled` sur les requêtes par id, clé de détail de lettre hors de la clé de liste. Décision documentée : les compétences sont une liste plate (pas de regroupement par catégorie) ; `lib/pdf.ts` du plan fondu dans `templates.ts` + le bouton. web 295 → 380 (avec les pages).

### Task 3 — amendement après revue (`9da72e2` + correctif `0572b76`)
Revue : nombres et entités sondés conformes (« 30 % » inventé rejeté, « 2,5 M€ » ≡ « 2.5 M€ », `ReactJS` ≡ `React`, « Scrum » rejeté avec « Agile »), déterminisme et idempotence, 0 faux positif sur 10 paraphrases, performances (1,3 ms par document, aucune régression catastrophique). Critiques corrigés : le premier mot de chaque phrase échappait au contrôle (« Kubernetes déployé… » passait) → vérifié comme les autres, exempté seulement s'il est un mot-outil ou un nom commun français (suffixes -tion/-ment/-age/-ance/-ence/-ie/-ure/-eur/-isme/-ité) non suivi d'une majuscule ; les dates du profil n'étaient pas des sources (« depuis 2021 » rejeté) → dates d'expérience, de formation et de certification ajoutées. Importants : termes connus étendus à tout le profil (écoles, organismes, puces des autres expériences) ; nombres connus du profil (« React 18 ») ; entité multi-mots retentée mot par mot (« Docker Java » passe, « Google Cloud » inconnu reste rejeté) ; paragraphes de lettre assainis avant découpage ; **octets NUL bruts** présents dans deux fichiers (vus « binaires » par git) remplacés par un suivi d'indices. Mineurs : raisons de rejet en forme de surface (« Kubernetes », « 30 % »), une seule table de lignes par collection, séparateurs comptés dans le plafond des lettres, titre sans contrôle mort. Limites documentées : « Pilotage » en milieu de phrase est rejeté (nom commun capitalisé) ; « Azure » en début de phrase est exempté par le suffixe « -ure » — à surveiller en recette. lib 74 → 91 tests.

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Ancrage lexical (nombres, noms propres) : ne détecte pas une invention purement qualitative | Vue avant/après obligatoire avant génération ; l'utilisateur valide |
| Pagination de l'aperçu HTML approximative | Le PDF fait foi ; l'aperçu indique « aperçu » |
| PDF côté client uniquement | Archivage serveur en T6 |
| Deux modèles | Personnalisation reportée |
