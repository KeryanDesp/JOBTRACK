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

### Task 1 — amendement après exécution (`6914017`, approuvé)
Conforme à la spec §3 (trois enums, `Application`/`ApplicationEvent`, `usedBaseResume`, `position`, `@@unique([userId, jobId])`, cascades `User` → `Application` → `ApplicationEvent`, `SetNull` depuis `Job`/`Resume`/`CoverLetter`). Migration `20260917103545_applications` ; une seconde migration `20260917111746_application_applied_at_date` (revue sécurité, tâche 3) passe `appliedAt` en `@db.Date`. Suites inchangées (api 712 + 175).

### Task 2 — amendement après revue (`087b775` + correctif `4a95b30`)
Revue : enums, libellés, onglets, tris et DTO conformes (§4), `.strict()` partout, dates civiles validées, exclusivité CV correcte. Critiques corrigés : `httpUrlSchema` exécutait `new URL()` dans un `refine` après l'échec de `.url()` → `TypeError` non capturée → **500** sur toute saisie non parsable (`www.linkedin.com/…`) → `superRefine` unique avec `try/catch`, `http(s)` seuls, identifiants et caractères de contrôle refusés (même bug hérité corrigé sur `optionalUrl` de `profile.ts`) ; le nettoyage détruisait les **sauts de ligne des notes** (lignes recollées) → `sanitizeText(value, { multiline })` (tab → espace, `\r\n` normalisé, plage étendue aux C1, largeur nulle, BOM). Importants : `z.union` rendait « Invalid input » sans chemin → aiguillage sur la présence de `jobId` avec erreurs par champ ; `page` borné à 500 ; chaîne vide → `null` sur les champs nullables ; messages français partout ; `APPLICATION_TAB_LABELS`/`APPLICATION_SORT_LABELS` ajoutés ; garde « au moins un champ » réparée (les clés `undefined` existent toujours après `parse`). Renommage `stripControlChars` → `sanitizeText` (homonyme de l'aide API). shared 249 → 313.

### Task 3 — amendement après revues (`a05186d` + correctif `c0c9386`)
Deux revues (sécurité, conformité) : IDOR vérifié sur chaque lecture/écriture, 409 sans fuite, journaux sans notes, nettoyage e2e par préfixes, routes §6 conformes au client web, stats et board corrects, factories d'exceptions cohérentes avec `matching`. Importants corrigés : `move` réindexait les deux colonnes **ligne par ligne** dans une transaction interactive de 5 s (tempête de verrous, P2028 → 500 sur une grande colonne) → trois `UPDATE` ensemblistes paramétrés (`lib/positions.ts`), réindexation bornée en réparation, compteurs `application-move`/`application-write` 600/h ; `update` par seul identifiant dans `move` (P2025 → 500 si la carte disparaît) → `updateMany` filtré par propriétaire ; instantané d'offre moins assaini que le contrat (C1, largeur nulle, BOM conservés ; URL avec identifiants acceptée depuis `applyUrl`) → réutilisation de `sanitizeText`/`httpUrlSchema` partagés, l'aide API `stripControlChars` délègue désormais au partagé ; format du salaire instantané (`45000–55000 € brut/an`) divergent de l'application → `formatSalaryRange` déplacé dans `packages/shared` et réutilisé (une borne seule → « à partir de 45 k€ »). Mineurs : `position` compté dans la transaction ; colonne source resserrée aussi sur changement de statut par `PATCH` et sur suppression ; « aujourd'hui » et le début de semaine calculés en `Europe/Paris` ; `appliedAt` en `@db.Date` ; troncature sûre des paires de substitution ; `resumeId`/`coverLetterId` masqués avec les objets sur échec de propriété ; service de 764 lignes découpé (`lib/{dates,snapshot,query,dto,read,positions}.ts`, `applications-board.service.ts`, `jobs/lib/match-summary.ts`). api 712 → 756 unitaires, 175 → 208 e2e.

### Task 4 — amendement après revue (`76941a0` + correctif `4737f83`)
Revue : chemins/verbes conformes, `moveCardInBoard` retracé (haut/bas, inter-colonnes, bornage, réindexation des deux colonnes, sans mutation), `cancelQueries` présent, `table.tsx` shadcn intégral, verrou pnpm sain (`@dnd-kit` épinglé). Importants corrigés : `useApplication('')` déclenchait `GET /applications/` → `enabled` exige un id non vide ; la fusion optimiste copiait les clés `undefined` (et `updateApplicationSchema.parse` pose **toutes** les clés) → fusion des seules entrées définies. Mineurs : `q` rogné, clés de liste normalisées par le schéma, `all` racine (piège de TDZ rencontré et corrigé par constante de module), `encodeURIComponent` sur les identifiants, invalidations groupées, suppression en `onSettled`, tests purs de `moveCardInBoard`. web 413 → 439 → 537.

### Task 5 — amendement après revue (`1fe1198` + correctif `9b4f3a4`)
Revue : état d'URL, filtres, table, formulaire (nullables envoyés à `null`, `appliedAt` seulement hors « À postuler », exclusivité CV, 409 → fiche existante), états, navigation. Critique corrigé : `?page=9999` faisait planter la page (le contrat lève « Page trop élevée. » dans le rendu) → borne 500 à la lecture de l'URL. Importants : `scope="col"` sur les en-têtes (défaut dans la primitive `TableHead`) ; erreurs de `company`/`locationLabel`/`notes` liées aux champs (`aria-describedby`/`aria-invalid`). Mineurs : pagination fenêtrée, minuterie de recherche annulée sur changement externe, sélecteur de tri (`?tri=`, `APPLICATION_SORT_LABELS`), champs d'erreur `resumeId`/`coverLetterId`/`jobId` rendus, tests mobiles et filtres. Écarts ratifiés (revue finale) : route non paresseuse (aucune route du dépôt ne l'est) ; un `PATCH` posant `usedBaseResume: true` libère le `resumeId` enregistré (et inversement) au lieu du 400 de la spec §4, réservé au corps qui envoie les deux ; tri par défaut « Dernière mise à jour » (`updated_desc`) plutôt que la date de candidature, cette dernière restant disponible dans le sélecteur ; `NOTE_UPDATED` n'enregistre jamais le contenu des notes (colonne `note` inutilisée, §5/§8 : jamais de notes en journal ni en historique).

### Task 6 — amendement après revue (`1997a90` + intégration `1ee1ae7` + correctif `5184b25`)
Livrée en trois phases (composants seuls, intégration dans la page, correctif de revue) pour ne pas partager la page avec la tâche 5. Revue : `resolveDrop` retracé contre `moveCardInBoard` **et** le serveur, capteurs et `closestCorners` adaptés, superposition sur la carte non triable (deux `useSortable` sur un même id se chevaucheraient), poignée = vrai bouton, menu « Déplacer vers… » comme alternative sans souris, dates en UTC, exclusivité CV, notes à enregistrement explicite, 404/erreur/suppression. Importants corrigés : `aria-roledescription="sortable"` injecté en anglais → « candidature déplaçable » ; fiche non plein écran entre 640 et 767 px (`sm:max-w-sm` de la primitive) → largeurs explicites. Mineurs : superposition passive (plus de boutons dupliqués pendant le glissement), dépôt sur sa propre colonne → fin de colonne, crochet `usePrefersReducedMotion` partagé, `isApplicationStatus` unique, `SheetDescription` sur toutes les branches, valeur vide intermédiaire de `input[type=date]` ignorée, « Enregistré » effacé après 2 s, `md:snap-none`. Intégration : ouvrir une fiche depuis la page 3 ne remet plus la liste en page 1. web 556 → 562 → 581.

### Task 7 — amendement après revue (`59809ce`, approuvé)
Un seul dialogue partagé par les deux rangées d'actions (inline et barre collante mobile), CV adaptés de l'offre filtrés et triés, invalidation de `jobKeys.detail` vérifiée, un seul toast, coût de `useResumes()` acceptable (liste mise en cache 60 s). Mineurs reportés au correctif de revue finale : `aria-haspopup="dialog"`, `aria-label` seulement en mode compact, `useMemo` sur les CV filtrés, `importOriginal` dans le mock du test. web 562 → 574.

### Task 8 — amendement après exécution (`0cd41b9`)
Sept scénarios × deux projets (bureau, mobile), 13 verts + 1 ignoré volontairement (débordement mobile sur le projet bureau), stables sur deux répétitions : état vide, ajout manuel avec compteurs et recherche, suivi depuis une offre semée (annotation si aucune offre), statut inline et historique, Kanban (ordre des colonnes, déplacement par le menu « Déplacer vers… », persistance après rechargement), fiche (notes, suppression), mobile, sonde IDOR (second compte → 404). Le glisser-déposer à la souris n'est pas exercé par Playwright (vérifié à la main, voir ci-dessous) ; l'élément de menu Radix a demandé `click({ force: true })` + attente du `PATCH /move` (instabilité de positionnement du menu flottant sous Playwright, pas un défaut de la fonctionnalité).

### Vérification visuelle du coordinateur (compte Sacha) → correctif `9257d18` + `7207fd4`
Serveur API de dev relancé (le watcher Nest n'avait pas rechargé le nouveau module : 404 sur `/applications`). Exercé dans le navigateur intégré : état vide (compteurs à 0, deux actions) ; ajout manuel (Business Analyst, Société Générale, LinkedIn, lien, Entretien, 15/09/2026, notes) → `POST` 201, ligne et compteurs à jour, toast « Candidature ajoutée » avec « Voir » ; statut inline Entretien → Offre (`PATCH` 200, onglets recomptés) ; fiche `?candidature=` (statut, date, CV, lettre, source avec lien externe, notes → `PATCH` 200 et « Enregistré », historique « Entretien → Offre » puis « Candidature créée ») ; Kanban : **glisser-déposer réel à la souris** de « Offre » vers « Refusée » → `PATCH /move` 200, position persistée au rechargement ; fiche offre : « Suivre cette candidature » → dialogue en mode offre (CV adaptés de l'offre listés en premier) → `POST` 201 → « Candidature suivie · À postuler » dans les deux rangées, fiche ouverte depuis ce lien avec le bon CV utilisé ; suppression confirmée → `DELETE`, liste rafraîchie ; mobile 375 px (liste de cartes, aucun débordement, Kanban défilant) ; thème sombre. Anomalies corrigées : sur mobile les onglets passaient sur deux lignes, la seconde masquée par le bouton « Ajouter » ; à 1024 px les colonnes du Kanban se comprimaient (107 à 182 px, dernière colonne rognée) → 280 px défilantes jusqu'à `xl` ; le tableau débordait de 41 px (colonne Actions coupée) ; le CV adapté n'était pas présélectionné dans le dialogue depuis l'offre ; la fiche affichait « introuvable » un instant après suppression ; après correctif le tableau débordait encore de 35 px → disposition fixe (`table-fixed`), cellules tronquées (`7207fd4`), puis — à 1024 px le point de rupture `lg` est déjà atteint alors que le contenu ne fait que 720 px à cause du menu latéral — colonne « CV utilisé » et libellé « Source » (icône seule) masqués **sous `xl`** (`fb56132`) : à cette largeur la table montre cinq des six colonnes de la spec §2, la sixième restant dans la fiche et sur les cartes mobiles. Notés sans correction : le board ne charge que 200 cartes par colonne alors que `move` borne la position sur la taille réelle (divergence théorique au-delà de 200, résorbée à l'invalidation) ; `stripControlChars` de l'API, en déléguant à `sanitizeText`, rogne désormais les espaces de bordure et normalise `\r\n` sur ses chemins hérités (import de CV, offres France Travail) — comportement voulu, suites vertes. Constat d'outillage : dans le navigateur intégré, un `Select` Radix se referme si le déclencheur reçoit un second clic ; ouvrir d'un seul clic puis cliquer l'option par coordonnées relevées en JS.

---

## Limites assumées

| Limite | Résolution |
|---|---|
| Aucune machine à états (retour d'« Offre » à « À postuler » possible) | L'historique garde la trace ; l'utilisateur corrige ses erreurs |
| Instantané de l'offre figé à la création | Le lien vers l'offre vivante reste affiché tant qu'elle existe |
| « CV principal » non versionné (dérivé du profil) | Le CV adapté (versionné) est le chemin recommandé ; T7 pourra archiver un PDF |
| Relances, rappels, alertes | T7 |
| Candidature assistée / auto-apply | T8 |

### Revue finale de branche (lecture seule, après les suites complètes) → correctif `a1e88e3` + docs `c11f054`
Verdict : fusionnable. Cohérence inter-couches vérifiée (codes d'erreur, invalidations, ordre des routes, `move` client ↔ serveur retracé sur quatre cas, `appliedAt` `@db.Date` sans dérive) ; sécurité : les 26 appels Prisma du module et les trois `$executeRaw` paramétrés portent `userId`, débits sur POST/PATCH/move, aucun `@Public`/`@NoCsrf`, journaux sans notes, aucun secret dans le diff, nettoyages e2e par préfixe ; aucun reliquat (`any`, `!`, `eslint-disable`, TODO, octets de contrôle). Réserves documentaires levées : écarts ratifiés consignés, amendement du tableau complété. Mineurs corrigés : commentaire e2e auto-contradictoire, état vide du Kanban sans les deux actions de la spec §7 (test enveloppé dans un routeur). Notés sans correction : divergence théorique au-delà de 200 cartes par colonne, `stripControlChars` de l'API rognant désormais les bordures.

## Recette §11 (2026-09-17)

| # | Critère | Verdict | Évidence |
|---|---|---|---|
| 1 | `/applications` vide → deux actions ; ajout manuel (Société Générale, LinkedIn, 15/09/2026, Entretien) → ligne dans la table | OK | vérification visuelle (`POST` 201, compteurs, toast « Voir ») ; Playwright scénarios 1–2 |
| 2 | Depuis une offre semée : « Suivre cette candidature » → candidature « À postuler » avec le CV adapté ; l'offre affiche « Candidature suivie » | OK | vérification visuelle (CV adapté présélectionné puis affiché dans la fiche) ; Playwright scénario 3 ; e2e `GET /jobs/:id.application` |
| 3 | Table : filtres avec compteurs exacts, recherche, sélecteur de statut inline → historique | OK | visuel (Entretien → Offre, historique « Statut modifié ») ; Playwright scénario 4 ; e2e `stats` |
| 4 | Kanban : glisser une carte (souris et clavier) → statut et ordre persistés ; `appliedAt` renseigné au premier passage | OK | glisser-déposer réel à la souris (`PATCH /move` 200, persistance après rechargement) ; menu « Déplacer vers… » (Playwright scénario 5) ; `appliedAt` auto testé en unitaire et e2e |
| 5 | Détail : changement de CV utilisé, notes sauvegardées, historique, suppression → retour à la liste | OK | visuel (`PATCH` notes 200, « Enregistré », `DELETE` puis liste rafraîchie) ; Playwright scénario 6 |
| 6 | Sécurité : IDOR → 404 ; doublon → 409 et ouverture de la fiche existante ; URL non `http(s)` refusée | OK | e2e (33 + additifs : lecture/modification/déplacement/suppression d'autrui → 404, 409 avec `applicationId`, `javascript:` → 400) ; Playwright scénario 8 ; deux revues de sécurité |
| 7 | Suites vertes, lint/typecheck/build, mobile et sombre, aucune donnée inventée | OK | shared 313, api 756 unitaires + 208 e2e, web 602, Playwright 53 verts + 2 ignorés (dont `applications` 7 × 2, rejoués 2 fois en isolation : 26 verts, 0 instable) ; lint/typecheck/build verts ; mobile et sombre vérifiés |

## Clôture
Tranche 6 fusionnée dans `main` (`--no-ff`) le 2026-09-17. Reportés (voir « Limites assumées ») : machine à états, instantané figé, « CV principal » non versionné, relances/alertes (T7), candidature assistée (T8). Le dashboard (T7) consommera `GET /applications/stats`.
