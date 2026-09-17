# Tranche 6 — Candidatures : table, Kanban, suivi des statuts

**Date :** 2026-09-17 · **Statut :** rédigé par le coordinateur, décisions à valider par l'utilisateur (mode « enchaîner toutes les tranches »)

## 1. Objectif

Donner à l'utilisateur un suivi réel de ses candidatures (cahier des charges §21, §22, §40, §41) : chaque candidature avec son poste, son entreprise, sa date, **le CV exact utilisé**, sa source et son statut ; une vue table filtrable et une vue Kanban à glisser-déposer ; un historique des changements. La page `/applications` (« Mes candidatures ») sort de « Bientôt ». Tout est réel (§55 : pas de fausses données) : les compteurs viennent de la base.

Hors périmètre : dashboard et statistiques agrégées (T7, qui consommera `GET /applications/stats`), alertes et relances (T7), candidature assistée et « Postuler avec IA » (T8), pièces jointes, e-mails.

## 2. Parcours

1. **Depuis une offre** (`/jobs/:id`) : bouton « Suivre cette candidature » (secondaire, à côté de « Voir l'offre sur France Travail ») → dialogue court : statut initial (« À postuler » par défaut, « Candidature envoyée » si l'utilisateur a déjà postulé), CV utilisé (liste des CV adaptés de cette offre + « CV principal » + « Aucun »), lettre (facultatif), date. Création → toast « Candidature ajoutée » avec lien « Voir » → si une candidature existe déjà pour cette offre, le bouton devient « Candidature suivie · Entretien » (lien vers la fiche).
2. **Manuellement** (`/applications`, « Ajouter une candidature ») : poste, entreprise, source (France Travail, LinkedIn, Indeed, Site carrière, Réseau, Autre), lien de l'offre (facultatif, `http(s)` seulement), date, statut, CV utilisé, notes. Sert aux candidatures faites hors JobTrack (exemple du cahier : Société Générale via LinkedIn).
3. **Vue table** (défaut) : onglets-filtres « Toutes · À postuler · Envoyées · Entretien · Offre · Refusées » avec compteurs ; recherche par poste/entreprise ; colonnes Poste / Entreprise / Date / CV utilisé / Source / Statut ; tri par date (récente d'abord). Clic sur une ligne → panneau latéral de détail.
4. **Vue Kanban** (`?vue=kanban`) : cinq colonnes dans l'ordre À postuler → Candidature envoyée → Entretien → Offre → Refusée, cartes (entreprise, poste, salaire, date, source, score de correspondance si l'offre est connue), glisser-déposer entre colonnes et réordonnancement dans une colonne ; navigation clavier (`@dnd-kit` : espace pour saisir, flèches, espace pour déposer) et, sur chaque carte, un menu « Déplacer vers… » qui rend la même action sans souris. Sur mobile, colonnes en défilement horizontal avec accrochage.
5. **Panneau de détail** (`?candidature=<id>`, `Sheet`) : en-tête (poste, entreprise, lien vers l'offre si connue), statut (sélecteur), date de candidature, CV utilisé (lien vers `/resume/:id`, ou « CV principal », ou « Aucun » ; changeable parmi les CV de l'utilisateur), lettre (lien), source et lien externe, notes (texte libre, sauvegarde explicite), historique (création, changements de statut, notes) en ordre antéchronologique, « Supprimer » avec confirmation.
6. **Changement de statut** partout (table : sélecteur inline ; Kanban : dépôt ; détail) → `PATCH` optimiste, retour arrière + toast en cas d'échec ; un évènement d'historique est créé côté serveur.

## 3. Modèle de données (Prisma)

```prisma
enum ApplicationStatus { TO_APPLY  APPLIED  INTERVIEW  OFFER  REJECTED }
enum ApplicationSource { FRANCE_TRAVAIL  LINKEDIN  INDEED  CAREER_SITE  NETWORK  OTHER }
enum ApplicationEventType { CREATED  STATUS_CHANGED  NOTE_UPDATED  RESUME_CHANGED }

model Application {
  id            String             @id @default(cuid())
  userId        String
  jobId         String?            // offre JobTrack, SetNull si l'offre est purgée
  resumeId      String?            // CV adapté utilisé, SetNull
  coverLetterId String?            // SetNull
  status        ApplicationStatus  @default(TO_APPLY)
  position      Int                @default(0)   // ordre dans la colonne Kanban
  // Instantané : la candidature survit à la disparition de l'offre (§41)
  jobTitle      String
  company       String?
  locationLabel String?
  salaryLabel   String?
  contractLabel String?
  source        ApplicationSource
  sourceUrl     String?
  appliedAt     DateTime?          // date de candidature (null tant que « À postuler »)
  usedBaseResume Boolean           @default(false) // « CV principal » utilisé (non stocké, dérivé du profil)
  notes         String?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  job    Job?   @relation(fields: [jobId], references: [id], onDelete: SetNull)
  resume Resume? @relation(fields: [resumeId], references: [id], onDelete: SetNull)
  coverLetter CoverLetter? @relation(fields: [coverLetterId], references: [id], onDelete: SetNull)
  events ApplicationEvent[]
  @@unique([userId, jobId])          // une candidature par offre et par utilisateur (NULL libre)
  @@index([userId, status, position])
  @@index([userId, updatedAt])
}

model ApplicationEvent {
  id            String               @id @default(cuid())
  applicationId String
  type          ApplicationEventType
  fromStatus    ApplicationStatus?
  toStatus      ApplicationStatus?
  note          String?
  createdAt     DateTime             @default(now())
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  @@index([applicationId, createdAt])
}
```

`User`, `Job`, `Resume`, `CoverLetter` reçoivent la relation inverse `applications`. Migration `applications`. Pas de table `ApplicationStatus` séparée (§40 la cite : un enum suffit, l'historique est porté par `ApplicationEvent`).

## 4. Contrat partagé (`packages/shared/src/applications.ts`)

- Enums + libellés français : `APPLICATION_STATUS_LABELS` (À postuler, Candidature envoyée, Entretien, Offre, Refusée), `APPLICATION_STATUS_ORDER` (ordre des colonnes), `APPLICATION_SOURCE_LABELS`, `APPLICATION_TAB_VALUES` (`all | to_apply | applied | interview | offer | rejected`).
- `createApplicationSchema` : soit `{ jobId }` (+ `status?`, `resumeId?`, `coverLetterId?`, `appliedAt?`), soit manuel `{ jobTitle (1..160), company? (..120), source, sourceUrl? (http(s), ..500), locationLabel? (..120), status?, appliedAt?, resumeId?, notes? (..4000) }` — union discriminée par la présence de `jobId` ; `.strict()`.
- `updateApplicationSchema` : tous les champs éditables optionnels (`status`, `appliedAt`, `resumeId | null`, `coverLetterId | null`, `notes`, `jobTitle`, `company`, `source`, `sourceUrl`, `locationLabel`) ; `.strict()`, au moins un champ.
- `moveApplicationSchema` : `{ status, position }` (Kanban).
- `applicationListQuerySchema` : `tab`, `q` (..120), `page`, `limit` (≤ 50, défaut 20), `sort` (`updated_desc | applied_desc | company_asc`).
- DTOs : `ApplicationDto` (tous les champs + `job: { id, title, company, match: MatchScoreSummaryDto | null } | null`, `resume: { id, title, currentVersion } | null`, `coverLetter: { id, tone } | null`), `ApplicationDetailDto extends ApplicationDto { events: ApplicationEventDto[] }`, `ApplicationListResponseDto { items, page, limit, total }`, `ApplicationStatsDto { total, byStatus: Record<ApplicationStatus, number>, appliedThisWeek, interviewRate }` (taux = entretiens+offres / envoyées, `null` sans envoi).
- Le CV utilisé peut aussi être « CV principal » : `resumeId = null` + `usedBaseResume: true` ; les deux sont exclusifs (400 sinon).

## 5. Règles

- Une candidature par (utilisateur, offre) : `POST` avec un `jobId` déjà suivi → 409 `APPLICATION_EXISTS` avec `{ applicationId }` dans `details` (le web ouvre la fiche).
- `resumeId`/`coverLetterId` doivent appartenir à l'utilisateur (404 sinon) ; `jobId` doit exister (404 `JOB_NOT_FOUND`).
- Instantané pris à la création depuis l'offre (`jobTitle`, `company`, `locationLabel`, `salaryLabel` via `formatSalaryRange` côté serveur ou `salaryLabel` brut, `contractLabel`, `source = FRANCE_TRAVAIL`, `sourceUrl` = URL de candidature `http(s)` de la source) ; jamais mis à jour ensuite (l'offre peut expirer).
- Transition de statut : libre (aucune machine à états imposée : l'utilisateur corrige ses erreurs), mais `appliedAt` est renseigné automatiquement à `now()` au premier passage hors de `TO_APPLY` s'il est vide.
- Kanban : `position` entier ; déplacement = `PATCH /applications/:id/move { status, position }` → le serveur réindexe la colonne cible (transaction ; positions 0..n-1) et journalise `STATUS_CHANGED` si le statut change.
- Texte libre (notes, titre, entreprise) : caractères de contrôle et séquences bidi retirés, bornes appliquées ; `sourceUrl` `http(s)` uniquement (sinon 400), affiché comme lien avec `rel="noopener noreferrer"`.
- Budget : 60 créations / heure / utilisateur (`@UserRateLimit`, garde de route : ici aucune ressource coûteuse, la garde suffit).
- Suppression : cascade sur les évènements ; jamais de suppression de l'offre.
- Journaux : identifiants et statuts seulement, jamais les notes.

## 6. API (`apps/api/src/modules/applications/`)

| Route | Corps / réponse | Codes |
|---|---|---|
| `GET /applications` | `applicationListQuerySchema` → `ApplicationListResponseDto` | 200 |
| `GET /applications/stats` | → `ApplicationStatsDto` | 200 |
| `GET /applications/board` | → `{ columns: Record<ApplicationStatus, ApplicationDto[]> }` (tri par `position`, 200 cartes max par colonne) | 200 |
| `POST /applications` | `createApplicationSchema` → `ApplicationDetailDto` | 201, 404 `JOB_NOT_FOUND`/`RESUME_NOT_FOUND`/`LETTER_NOT_FOUND`, 409 `APPLICATION_EXISTS`, 429 |
| `GET /applications/:id` | → `ApplicationDetailDto` | 200, 404 `APPLICATION_NOT_FOUND` |
| `PATCH /applications/:id` | `updateApplicationSchema` → `ApplicationDetailDto` | 200, 400, 404 |
| `PATCH /applications/:id/move` | `moveApplicationSchema` → `ApplicationDetailDto` | 200, 404 |
| `DELETE /applications/:id` | | 204, 404 |
| `GET /jobs/:id` | `JobDetailDto` gagne `application: { id, status } \| null` | |

Routes statiques (`stats`, `board`) avant `:id`. Module `ApplicationsModule` (contrôleur, `ApplicationsService`, `ApplicationEventsService` léger), enregistré dans `AppModule`. Conventions : owner-filtered, 404 jamais 403, `ZodValidationPipe`, `HttpExceptionFilter`.

## 7. Web (`apps/web/src/features/applications/`)

- `services/api/applications.ts` (client typé), `hooks/use-applications.ts` (`useApplications(query)`, `useApplicationsBoard()`, `useApplicationStats()`, `useApplication(id)`, `useCreateApplication`, `useUpdateApplication`, `useMoveApplication` (optimiste sur le board), `useDeleteApplication`), `lib/query-keys.ts`.
- Pages : `pages/applications-page.tsx` (`/applications`, `?vue=table|kanban`, `?onglet=`, `?q=`, `?page=`, `?candidature=<id>`).
- Composants : `application-status-badge.tsx` (§57 `ApplicationStatus`), `application-status-select.tsx`, `applications-table.tsx` (table sémantique `<table>` avec `components/ui/table.tsx` shadcn ajouté ; sur mobile `< md`, liste de cartes), `applications-filters.tsx` (onglets + recherche), `application-card.tsx` (Kanban), `applications-board.tsx` (`@dnd-kit/core` + `@dnd-kit/sortable`, `KeyboardSensor` + `PointerSensor`, annonces `aria-live` en français), `application-sheet.tsx` (détail), `application-form-dialog.tsx` (création manuelle et depuis une offre), `application-events.tsx` (historique), `add-application-button.tsx`.
- Fiche offre : `TrackApplicationButton` dans `job-detail-header.tsx` (« Suivre cette candidature » / « Candidature suivie · <statut> »).
- Navigation : `/applications` `available: true`.
- États : chargement (squelettes de lignes/colonnes), vide (« Aucune candidature. Suivez une offre ou ajoutez une candidature. » + deux actions), erreur (+ « Réessayer »), 404 de fiche, mobile, sombre, `prefers-reduced-motion` (pas d'animation de dépôt).
- Dépendance nouvelle : `@dnd-kit/core` `^6.3`, `@dnd-kit/sortable` `^10`, `@dnd-kit/utilities` (épinglées, ~30 Ko gzip, dans le bundle principal — pas de chunk séparé nécessaire).

## 8. Sécurité et confidentialité

Owner filtering sur chaque requête ; `@@unique([userId, jobId])` ; validation stricte ; `sourceUrl` filtré ; aucune donnée d'une autre personne exposée via `job`/`resume` (jointures filtrées par le même `userId` pour `resume`/`coverLetter` ; `job` est le catalogue partagé) ; pas de `@Public`/`@NoCsrf` ; journaux sans notes ; tests e2e d'IDOR (lecture, modification, déplacement, suppression d'une candidature d'autrui → 404).

## 9. Tests

- shared : schémas (union création, bornes, URL), libellés, ordre des colonnes.
- api unitaires : réindexation de colonne, instantané depuis l'offre, `appliedAt` automatique, évènements.
- api e2e (`applications.e2e.spec.ts`, rangées `E2E-APP-`) : CRUD complet, 409 doublon, 404 propriétaire, stats, board + move (positions 0..n-1 vérifiées), suppression de l'offre → `jobId` null et instantané intact, `GET /jobs/:id.application`.
- web : hooks (optimiste + retour arrière), table (filtres, tri, sélecteur inline), board (dépôt via clavier, menu « Déplacer vers… »), sheet (édition, historique, suppression), formulaire (union), fiche offre (bouton et état « suivie »).
- Playwright `applications.spec.ts` : suivre une offre semée → table → changer le statut → Kanban (déplacement clavier) → détail → suppression ; ajout manuel ; mobile.

## 10. Livraison

Branche `feat/tranche-6-candidatures`, tâches du plan, revues (sécurité + conformité pour l'API), vérification visuelle par le coordinateur avec un compte au profil rempli, recette §11, fusion `--no-ff` dans `main` + push.

## 11. Recette

1. `/applications` vide → deux actions ; ajout manuel (Société Générale, LinkedIn, 15/09/2026, Entretien) → ligne dans la table avec « CV Business Analyst » si un CV est choisi.
2. Depuis une offre semée : « Suivre cette candidature » → candidature « À postuler » avec le CV adapté sélectionné ; l'offre affiche « Candidature suivie ».
3. Table : filtres avec compteurs exacts, recherche, sélecteur de statut inline → historique mis à jour.
4. Kanban : glisser une carte (souris et clavier) → statut et ordre persistés au rechargement ; `appliedAt` renseigné au premier passage.
5. Détail : changement de CV utilisé, notes sauvegardées, historique, suppression → retour à la liste.
6. Sécurité : IDOR → 404 ; doublon → 409 et ouverture de la fiche existante ; URL non `http(s)` refusée.
7. Suites vertes, lint/typecheck/build, mobile et sombre, aucune donnée inventée.
