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

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Ancrage lexical (nombres, noms propres) : ne détecte pas une invention purement qualitative | Vue avant/après obligatoire avant génération ; l'utilisateur valide |
| Pagination de l'aperçu HTML approximative | Le PDF fait foi ; l'aperçu indique « aperçu » |
| PDF côté client uniquement | Archivage serveur en T6 |
| Deux modèles | Personnalisation reportée |
