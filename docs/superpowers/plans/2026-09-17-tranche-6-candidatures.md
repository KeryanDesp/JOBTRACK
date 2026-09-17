# Tranche 6 — Candidatures : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/applications` suit les candidatures réelles de l'utilisateur (poste, entreprise, date, **CV exact utilisé**, source, statut) en vue table filtrable et en vue Kanban à glisser-déposer, avec fiche de détail, historique et création depuis une offre ou manuellement.

**Architecture:** contrat partagé `applications.ts` (enums, libellés, schémas de création/mise à jour/déplacement/liste, DTO) ; module API `applications` = `ApplicationsService` (CRUD owner-filtered, instantané de l'offre, réindexation Kanban transactionnelle, évènements) → contrôleur (`stats`/`board` avant `:id`) ; `GET /jobs/:id` expose `application` ; frontend `features/applications` = client typé, hooks TanStack (déplacement optimiste), page table/Kanban (`@dnd-kit`), panneau de détail (`Sheet`), formulaire, bouton « Suivre cette candidature » sur la fiche offre. Spec : `docs/superpowers/specs/2026-09-17-tranche-6-candidatures-design.md`.

**Tech Stack:** existant + **`@dnd-kit/core` ^6.3, `@dnd-kit/sortable` ^10, `@dnd-kit/utilities` ^3.2** (web uniquement) + primitive shadcn `table.tsx` écrite à la main sur `radix-ui` (aucune autre dépendance).

**Règles héritées :** `*Input`/`*Dto` ; `ZodValidationPipe` ; 404 jamais 403 ; aucun `any`/`!`/`as`-contournement/`eslint-disable` ; français accentué dans l'interface, tests nommés sans accents ; comptes/lignes e2e préfixés (`E2E-APP-`, `e2e-app-`) et nettoyés par préfixe seulement ; vérification visuelle de chaque chemin d'écriture par le coordinateur ; **aucune donnée simulée** ; jamais de notes dans les journaux ; jamais d'octet NUL brut dans une source (`\u0000` échappé) ; un seul implémenteur par arbre de fichiers.

**Compteurs de départ :** shared 249, api 712 unitaires + 175 e2e, web 413 + 46 Playwright.

---

## Task 1: Schéma Prisma — `Application`, `ApplicationEvent`

**Files:** `apps/api/prisma/schema.prisma`, migration `<ts>_applications`.

- [ ] Enums `ApplicationStatus`, `ApplicationSource`, `ApplicationEventType` ; modèles de la spec §3 (`@@unique([userId, jobId])`, `usedBaseResume`, `position`, index) ; relations inverses `applications` sur `User`, `Job`, `Resume`, `CoverLetter` (`Cascade` depuis `User`, `SetNull` depuis les trois autres).
- [ ] `pnpm db:migrate --name applications` ; typecheck ; suites existantes vertes.
- [ ] Commit : `feat(api): schema des candidatures et de leur historique`.

## Task 2: Contrat partagé `applications.ts`

**Files:** `packages/shared/src/applications.ts` (+ `applications.test.ts`), `index.ts`.

- [ ] Constantes et libellés (`APPLICATION_STATUSES` dans l'ordre des colonnes, `APPLICATION_STATUS_LABELS`, `APPLICATION_SOURCES`, `APPLICATION_SOURCE_LABELS`, `APPLICATION_TAB_VALUES` + `applicationTabToStatus`, `APPLICATION_EVENT_TYPES`, `APPLICATION_EVENT_LABELS`).
- [ ] Schémas : `createApplicationSchema` = `z.discriminatedUnion`-équivalent via `z.union([fromJobSchema, manualSchema])` (`fromJobSchema { jobId, status?, resumeId?, coverLetterId?, usedBaseResume?, appliedAt? }` ; `manualSchema { jobTitle 1..160, company? ..120, source, sourceUrl? http(s) ..500, locationLabel? ..120, salaryLabel? ..80, contractLabel? ..80, status?, appliedAt?, resumeId?, usedBaseResume?, notes? ..4000 }`), refinement « `resumeId` et `usedBaseResume` exclusifs », `appliedAt` = `z.string().date()` (jour, jamais d'heure) ; `updateApplicationSchema` (champs optionnels + `null` pour `resumeId`/`coverLetterId`/`appliedAt`, « au moins un champ », mêmes bornes) ; `moveApplicationSchema { status, position: int ≥ 0 ≤ 500 }` ; `applicationListQuerySchema { tab = 'all', q? ..120, page ≥ 1, limit 1..50 (20), sort }` ; helpers de texte : `stripControlChars` déjà exporté par `resume.ts` → réutilisé.
- [ ] Types : `ApplicationDto`, `ApplicationDetailDto`, `ApplicationEventDto`, `ApplicationListResponseDto`, `ApplicationBoardDto { columns: Record<ApplicationStatus, ApplicationDto[]> }`, `ApplicationStatsDto`, `JobApplicationRefDto { id, status }` (ajouté à `JobDetailDto.application: JobApplicationRefDto | null` dans `jobs.ts`).
- [ ] Tests ≥ 18 (union, bornes, URL `javascript:` refusée, exclusivité CV, `appliedAt` invalide, `tab → status`, « au moins un champ »). Commit : `feat(shared): contrat des candidatures`.

## Task 3: Module API `applications` — service, contrôleur, e2e

**Files:** `apps/api/src/modules/applications/{applications.service.ts,applications.controller.ts,applications.errors.ts,applications.module.ts,applications.service.spec.ts,applications.e2e.spec.ts}`, `app.module.ts`, `apps/api/src/modules/jobs/jobs.service.ts` (+ `jobs.controller.ts` si nécessaire) pour `JobDetailDto.application`.

- [ ] `ApplicationsService` : `list(userId, query)` (filtre `tab`, `q` insensible à la casse sur `jobTitle`/`company`, tri, pagination, `total`), `stats(userId)` (`groupBy`, `appliedThisWeek` = `appliedAt ≥ lundi 00:00 Europe/Paris` — calculé en UTC à partir de la date du jour, documenté ; `interviewRate` = (entretiens + offres) / (envoyées + entretiens + offres + refusées), `null` sans dénominateur), `board(userId)` (par statut, tri `position`, 200 max), `create(userId, input)` (depuis l'offre : instantané `jobTitle`/`company`/`locationLabel` (`formatLocation`-équivalent serveur : libellé brut)/`salaryLabel` (brut ou `min–max €` calculé)/`contractLabel`/`source FRANCE_TRAVAIL`/`sourceUrl` = premier `applyUrl` puis `url` `http(s)` ; propriété de `resumeId`/`coverLetterId` ; `position` = fin de colonne ; évènement `CREATED` ; `P2002` → 409 `APPLICATION_EXISTS` avec `details.applicationId`), `get(userId, id)` (avec `events` antéchronologiques, `job` (id/title/company/`match` via `MatchService`-summary existant ou `null`), `resume`, `coverLetter`), `update(userId, id, input)` (`updateMany` owner-filtered, `appliedAt` auto au premier passage hors `TO_APPLY`, évènements `STATUS_CHANGED`/`NOTE_UPDATED`/`RESUME_CHANGED`, textes nettoyés), `move(userId, id, { status, position })` (transaction : retire de la colonne source, insère à `position` bornée, réindexe 0..n-1 la colonne cible et la source, évènement si changement de statut), `remove(userId, id)` (404 si absent).
- [ ] Contrôleur (spec §6) : `stats` et `board` avant `:id` ; `@UserRateLimit({ limit: 60, windowSeconds: 3600, bucket: 'application-create' })` sur `POST` ; erreurs → `HttpException` avec codes ; jamais de 500 sur entrée utilisateur.
- [ ] `JobsService.getDetail` : `application: { id, status } | null` (une requête `findUnique` sur `userId_jobId`).
- [ ] Unitaires ≥ 12 (réindexation, instantané, `appliedAt` auto, exclusivité CV, nettoyage) ; e2e ≥ 24 (CRUD, 409 doublon avec `applicationId`, IDOR lecture/modif/move/suppression → 404, stats exacts, board + move positions 0..n-1 sur deux colonnes, suppression de l'offre → `jobId null` et instantané intact, `GET /jobs/:id.application`, `sourceUrl` non http → 400, 429). Nettoyage : `E2E-APP-` sur `jobTitle`, utilisateurs `e2e-app-`, offres `E2E-APP-` avec source dédiée, clés de débit du seul compteur `application-create`.
- [ ] Commit : `feat(api): module candidatures — liste, kanban, historique, routes`.

## Task 4: Web — primitive `table`, accès API, hooks

**Files:** `apps/web/src/components/ui/table.tsx`, `apps/web/src/services/api/applications.ts` (+ test), `apps/web/src/features/applications/{lib/query-keys.ts,hooks/use-applications.ts}` (+ test), `apps/web/package.json` (`@dnd-kit/*`).

- [ ] `table.tsx` shadcn (Table/Header/Body/Row/Head/Cell/Caption), `pnpm add` des trois paquets `@dnd-kit` (versions épinglées, commentaire dans `package.json` si le dépôt en a l'usage).
- [ ] Client : `fetchApplications(query)`, `fetchApplicationStats()`, `fetchApplicationBoard()`, `fetchApplication(id)`, `createApplication(input)`, `updateApplication(id, input)`, `moveApplication(id, input)`, `deleteApplication(id)`.
- [ ] Hooks : clés `applicationKeys.{all, list(query), stats, board, detail(id)}` ; `useMoveApplication` optimiste sur `board` (déplace la carte, réindexe localement, retour arrière + toast « Déplacement impossible. » en cas d'échec, invalide `board`/`list`/`stats`/`detail` en `onSettled`) ; `useUpdateApplication` optimiste sur `detail` + `list` ; `useDeleteApplication` → `removeQueries(detail)` + invalidations ; `useCreateApplication` → invalidations + `jobKeys.detail(jobId)` ; erreurs `APPLICATION_EXISTS` sans toast (la page ouvre la fiche existante).
- [ ] Tests ≥ 16. Commit : `feat(web): acces api et hooks des candidatures`.

## Task 5: Web — page `/applications` : table, filtres, formulaire

**Files:** `apps/web/src/features/applications/{pages/applications-page.tsx,components/{application-status-badge,application-status-select,applications-filters,applications-table,application-form-dialog,add-application-button}.tsx,lib/{format,url-state}.ts}` (+ tests), `routes.tsx`, `constants/navigation.ts`.

- [ ] Route `/applications` (`available: true`), état d'URL `?vue=table|kanban`, `?onglet=`, `?q=`, `?page=`, `?candidature=`, `?ajouter=1`.
- [ ] Filtres : onglets avec compteurs (`useApplicationStats`), recherche débouncée (300 ms) ; table : Poste (titre + entreprise sur mobile), Entreprise, Date (`appliedAt` sinon « — »), CV utilisé (lien `/resume/:id`, « CV principal », « — »), Source (libellé + lien externe `http(s)`), Statut (`ApplicationStatusSelect` inline, optimiste) ; ligne cliquable (bouton accessible « Ouvrir ») → `?candidature=<id>` ; pagination existante ; `< md` : liste de cartes.
- [ ] Formulaire (`Dialog`, RHF + `zodResolverWith(createApplicationSchema)`) : mode manuel (tous les champs, source par défaut « Autre », statut « À postuler », CV utilisé : `useResumes()` + « CV principal » + « Aucun ») et mode « depuis une offre » (`jobId` fourni : champs réduits statut/CV/lettre/date, CV proposés = CV adaptés de cette offre en premier) ; `APPLICATION_EXISTS` → ferme et ouvre `?candidature=<id>`.
- [ ] États : squelette, vide (deux actions), erreur + « Réessayer », sombre, mobile. Tests ≥ 20. Commit : `feat(web): mes candidatures — table, filtres, ajout`.

## Task 6: Web — Kanban (`@dnd-kit`) et panneau de détail

**Files:** `apps/web/src/features/applications/components/{applications-board,board-column,application-card,move-to-menu,application-sheet,application-events,delete-application-button}.tsx` (+ tests), `pages/applications-page.tsx` (bascule de vue).

- [ ] Board : `DndContext` (`PointerSensor` distance 6 px, `KeyboardSensor` avec `sortableKeyboardCoordinates`), une `SortableContext` par colonne, `DragOverlay` pour la carte saisie, `announcements` en français (« Candidature saisie… », « déposée dans Entretien, position 2 »), dépôt → `useMoveApplication` ; `prefers-reduced-motion` : pas de transition ; mobile : colonnes `snap-x` en défilement horizontal, largeur 280 px.
- [ ] Carte : entreprise, poste, salaire (`salaryLabel`), date, source, `MatchBadge` si `job.match` ; menu « Déplacer vers… » (`DropdownMenu`, quatre autres statuts) ; clic → fiche.
- [ ] Fiche (`Sheet` droite, plein écran `< md`) : en-tête, statut (`Select`), date (`input type=date`), CV utilisé (`Select` : CV adaptés de l'utilisateur, « CV principal », « Aucun »), lettre (lien ou « — »), source + lien, notes (`Textarea`, « Enregistrer les notes » actif si modifié), historique (`ApplicationEvents` : libellé + date relative), suppression avec confirmation → retire `?candidature` ; 404 → « Candidature introuvable » + retour.
- [ ] Tests ≥ 18 (déplacement clavier simulé via le menu « Déplacer vers… » et `onDragEnd` direct, retour arrière, fiche, suppression). Commit : `feat(web): kanban des candidatures et fiche de detail`.

## Task 7: Web — fiche offre : « Suivre cette candidature »

**Files:** `apps/web/src/features/jobs/components/job-detail-header.tsx` (+ test), `apps/web/src/features/jobs/pages/job-detail-page.tsx`, `apps/web/src/features/applications/components/track-application-button.tsx`.

- [ ] `TrackApplicationButton({ job })` : sans candidature → bouton secondaire « Suivre cette candidature » → `ApplicationFormDialog` en mode offre ; avec candidature (`job.application`) → lien « Candidature suivie · <statut> » vers `/applications?candidature=<id>` ; rendu dans `ActionsRow` (inline et barre collante mobile) ; création → toast « Candidature ajoutée » avec action « Voir », invalidation du détail de l'offre.
- [ ] Tests ≥ 6. Commit : `feat(web): suivre une candidature depuis une offre`.

## Task 8: Playwright, recette

**Files:** `apps/web/e2e/applications.spec.ts`.

- [ ] Compte partagé (inscription API), profil minimal ; scénarios : `/applications` vide → ajout manuel (Société Générale, LinkedIn, 15/09/2026, Entretien) → ligne visible et filtre « Entretien » = 1 ; suivi d'une offre semée (si présente, sinon annotation) depuis `/jobs/:id` → « Candidature suivie » ; changement de statut inline → historique dans la fiche ; Kanban : menu « Déplacer vers… » → colonne cible et persistance après rechargement ; suppression ; mobile 375 px sans débordement. Nettoyage global existant (`@playwright.local` cascade).
- [ ] Commit : `test: candidatures end-to-end`.
- [ ] Recette §11 par le coordinateur (vérification visuelle : chaque chemin d'écriture, glisser-déposer à la souris dans le navigateur intégré).

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Aucune machine à états (retour d'« Offre » à « À postuler » possible) | L'historique garde la trace ; l'utilisateur corrige ses erreurs |
| Instantané de l'offre figé à la création | Le lien vers l'offre vivante reste affiché tant qu'elle existe |
| « CV principal » non versionné (dérivé du profil) | Le CV adapté (versionné) est le chemin recommandé ; T7 pourra archiver un PDF |
| Relances, rappels, alertes | T7 |
| Candidature assistée / auto-apply | T8 |
