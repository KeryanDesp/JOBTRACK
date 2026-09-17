# JobTrack — Tranche 4 : Match Score explicable

**Date :** 2026-09-17
**Tranche :** 4 — Match Score explicable
**Prérequis :** tranches 0 à 3 fusionnées (`main` a9fe7f1)

---

## 1. Objectif et périmètre

Donner à chaque offre un **score de correspondance** avec le profil de l'utilisateur, **explicable facteur par facteur**, jamais présenté comme une probabilité d'embauche (cahier des charges §6, §47, §48). Livrer : l'analyse structurée d'une offre par Claude (exigences : technologies, expérience, formation, langues, télétravail, séniorité), un moteur de score **déterministe** sur ces exigences et le profil, la priorité de candidature, le panneau « Pourquoi cette offre vous correspond » sur le détail, l'explication du classement sur la liste, les onglets « Pour vous » / « Forte priorité » et les tris « Meilleur match » / « Pertinence » jusqu'ici désactivés.

Hors périmètre : CV adapté (T5), candidatures (T6), centre d'activité IA et alertes (T7), automatisation (T8).

### Approches envisagées

| Approche | Principe | Verdict |
|---|---|---|
| A. Score par le modèle | Claude reçoit profil + offre et renvoie un pourcentage et une explication | Rejetée : chiffre non reproductible, coût par utilisateur × offre, opacité contraire au §6 (« ne pas afficher des pourcentages inventés ») |
| B. Règles sur les données structurées seules | Compétences ROME de France Travail, libellés d'expérience, lieu, salaire, contrat | Rejetée seule : les `competences` France Travail sont des libellés ROME génériques (« Concevoir une application web »), la stack réelle est dans la description libre |
| **C. Hybride** | Claude **extrait une seule fois par offre** des exigences structurées (schéma Zod tolérant, mise en cache, indépendante de l'utilisateur) ; un moteur **déterministe et testé** calcule le score par facteur à partir de ces exigences et du profil ; l'explication est la trace du calcul | **Retenue** : coût amorti entre utilisateurs, score reproductible, chaque ligne d'explication correspond à une règle |

---

## 2. Parcours utilisateur

1. **Liste `/jobs`.** Chaque carte porte, **visuellement secondaire**, une pastille « 92 » suivie de « Match » (lettres petites, couleur par bande) et, si applicable, une puce de priorité (« Forte priorité »). Un bouton « Pourquoi ? » sur la carte déplie les trois facteurs les plus favorables et le facteur le plus pénalisant (« + React correspond », « + Metz : à 12 km », « − AWS non présent dans votre profil »). Onglets : « Toutes », « Nouvelles », **« Pour vous »** (score ≥ 60), **« Forte priorité »** (priorité ≥ Forte). Tris : « Plus récentes », « Salaire », **« Meilleur match »** (score décroissant, non évaluées en dernier), **« Pertinence »** (match pondéré par la fraîcheur, cf. §5). Le sous-titre indique l'état de l'analyse : « 13 offres trouvées · 9 analysées » et, pendant l'analyse, une barre discrète « Analyse de 4 offres… ».
2. **Analyse à la demande.** À l'affichage d'une page de résultats, le client demande l'analyse des offres non encore analysées de la page (au plus 20 par appel, `POST /jobs/analyses`). Le serveur analyse celles qui manquent (Claude), calcule les scores pour l'utilisateur et répond ; le client interroge jusqu'à complétion. Les scores des offres déjà analysées (par n'importe quel utilisateur) sont **immédiats**.
3. **Détail `/jobs/:id`.** Section « Pourquoi cette offre vous correspond » : bandeau « Très bonne correspondance · 92 » + priorité, barres par facteur (Compétences 94 %, Expérience 88 %, Localisation 100 %, Salaire 91 %, Contrat, Télétravail, Formation, Langues), puis « Compétences correspondantes » (✓), « Points faibles » (⚠ / ✗), « Non évalué » (facteurs sans donnée : « L'offre n'indique pas de salaire »). Une phrase de recommandation (« Priorité élevée : candidature à préparer cette semaine »). Si l'analyse n'existe pas encore : « Analyser cette offre » (bouton) puis état de chargement.
4. **Profil incomplet.** Sans compétence ni expérience dans le profil, le score n'est pas calculé : bandeau « Complétez vos compétences et expériences pour obtenir un score fiable » avec lien vers `/profile` (ou l'import de CV). Les onglets « Pour vous » / « Forte priorité » restent visibles mais renvoient cet état.
5. **IA non configurée.** Sans `ANTHROPIC_API_KEY`, les offres ne peuvent pas être analysées : les scores restent « non évalués », les onglets/tris dépendants affichent « L'analyse des offres nécessite le service IA (non configuré). » ; rien n'est simulé.

---

## 3. Modèle de données

**`JobAnalysis`** (une par offre, partagée entre utilisateurs) : `id`, `jobId @unique`, `status Enum { PENDING, DONE, FAILED }`, `version Int` (version du prompt/schéma, constante `JOB_ANALYSIS_VERSION`), `requirements Json?` (schéma §4), `model String?`, `inputTokens Int?`, `outputTokens Int?`, `error String?`, `analyzedAt DateTime?`, `createdAt`, `updatedAt`. Index `@@index([status])`.

**`MatchScore`** (une par profil × offre) : `id`, `profileId`, `jobId`, `score Int?` (0–100, `null` si données insuffisantes), `relevance Int?` (score pondéré par la fraîcheur, §5, pour le tri SQL), `band Enum { EXCELLENT, GOOD, PARTIAL, WEAK }`, `priority Enum { VERY_HIGH, HIGH, GOOD, CONSIDER, LOW }`, `factors Json` (liste §5), `profileFingerprint String` (sha256 des entrées du profil utilisées), `analysisVersion Int`, `computedAt`, `@@unique([profileId, jobId])`, `@@index([profileId, score])`, `@@index([profileId, relevance])`, `@@index([profileId, priority])`, cascades depuis `Profile` et `Job`.

Le score est recalculé (à la volée, pas de tâche planifiée) quand `profileFingerprint` ou `analysisVersion` diffère de la valeur stockée, au moment où il est demandé.

---

## 4. Analyse d'une offre (Claude)

`apps/api/src/modules/matching/job-analysis.service.ts`, sur le même socle que l'extraction de CV : `messages.parse` + `zodOutputFormat` (schéma « fil » zod v4), prompt système mis en cache, contenu de l'offre délimité (`<offre>` … `</offre>`, balise de fermeture retirée du texte) et traité comme **donnée**, `max_tokens 4000`, `effort medium`, délai et erreurs mappées comme en tranche 2 (`AI_NOT_CONFIGURED`, `AI_UNAVAILABLE`, non conforme → `FAILED` avec message générique, jamais de 500).

Entrée : titre, entreprise, description, compétences/formations/langues France Travail, libellés d'expérience et de contrat. Sortie (`jobRequirementsSchema`, tolérant, listes filtrées ligne par ligne) :

```text
technologies[]        { name, required: bool, category: 'language'|'framework'|'tool'|'cloud'|'database'|'methodology'|'other' }
softSkills[]          string
experienceYearsMin    number|null     (années demandées, explicite dans l'annonce)
seniority             'junior'|'mid'|'senior'|'lead'|null
educationLevel        'none'|'bac'|'bac2'|'bac3'|'bac5'|'phd'|null   (niveau minimal demandé)
educationFields[]     string
languages[]           { name, level: 'A1'..'C2'|'native'|null, required }
remoteMode            'onsite'|'hybrid'|'remote'|null   (explicite seulement)
contractHints[]       string
mustHaves[]           string   (exigences non négociables, telles que rédigées)
niceToHaves[]         string
summary               string ≤ 300   (une phrase neutre)
```

Le modèle ne reçoit aucune donnée de l'utilisateur ; l'analyse est **indépendante du profil** et donc partageable. Limites : `description` plafonnée à 20 000 caractères (déjà), 1 appel par offre et par version, réessai manuel possible sur `FAILED` (« Réessayer l'analyse »). Budget : 20 offres par appel `POST /jobs/analyses`, **60 analyses / heure / utilisateur** (`UserRateLimit`, seau `job-analysis`) ; une offre déjà `DONE` ou `PENDING` (< 2 min) ne compte pas.

---

## 5. Moteur de score (déterministe, pur, testé)

`apps/api/src/modules/matching/scoring/` — fonctions pures `scoreJob(profileInputs, jobInputs, requirements, now) → MatchResult`.

**Entrées profil** (`ProfileInputs`, construites une fois par requête) : compétences (nom normalisé, niveau), technologies extraites des expériences/projets (`technologies[]` des projets, mots-clés des descriptions par la même table de synonymes), années d'expérience (somme des durées des expériences, chevauchements fusionnés), niveau de formation maximal (déduit du `degree` par table de correspondance : « Master », « Bac+5 », « Ingénieur » → bac5…), langues et niveaux, ville/pays du profil (résolue en commune France Travail si possible → lat/lng), préférences (`salaryMin/Max`, `contractTypes`, `remoteModes`, `locations`, `searchRadiusKm`, `experienceLevel`).

**Facteurs** (poids, `score` 0–100, `status` `evaluated | unknown`, `evidence[]` = lignes ✓/⚠/✗ en français) :

| Facteur | Poids | Règle |
|---|---|---|
| Compétences et technologies | 35 | Correspondance des `technologies` exigées (`required`) puis souhaitées avec les compétences du profil, via normalisation + **table de synonymes** versionnée (`react` ≈ `reactjs`, `node` ≈ `node.js`, `postgres` ≈ `postgresql`, `js` ≈ `javascript`, `ts` ≈ `typescript`, `k8s` ≈ `kubernetes`, …). Score = 70 % × couverture des exigées + 30 % × couverture des souhaitées ; sans technologie exigée dans l'annonce → sur les compétences France Travail (`JobSkill`) ; sans aucune donnée → `unknown`. Evidence : « ✓ React correspond », « ⚠ AWS souhaité, absent de votre profil », « ✗ Node.js exigé, absent de votre profil » |
| Expérience | 15 | `experienceYearsMin` (sinon `experienceLevel` de l'offre → 0/1/3/6 ans) vs années du profil : ≥ demandé → 100 ; manque 1 an → 70 ; 2 ans → 40 ; plus → 15 ; « Débutant accepté » → 100 ; profil sans expérience et offre sans exigence → `unknown` |
| Localisation | 15 | Offre `remote` (analyse explicite) → 100 ; commune de l'offre parmi les lieux souhaités du profil (résolus en codes INSEE par le référentiel, comme sur `/jobs`) → 100 ; même département qu'un lieu souhaité → 80 ; département limitrophe (table statique des 96 départements) → 60 ; sinon 20 ; profil sans lieu souhaité ni ville → `unknown`, offre sans commune → `unknown`. Le référentiel France Travail ne fournit pas de coordonnées : la distance kilométrique (haversine) est reportée à un géocodage ultérieur |
| Salaire | 10 | Fourchette annuelle de l'offre vs `salaryMin` du profil : max ≥ min souhaité → 100 si min ≥ souhaité, sinon 75 ; max < souhaité → 30 ; offre sans salaire ou profil sans attente → `unknown` |
| Contrat | 10 | Type de contrat dans `contractTypes` du profil → 100 ; profil sans préférence → `unknown` ; sinon 20 |
| Télétravail | 5 | `remoteMode` (analyse explicite, sinon déduit de la tranche 3, annoté) vs `remoteModes` du profil : compatible → 100, sinon 30 ; inconnu → `unknown` |
| Formation | 5 | Niveau demandé ≤ niveau du profil → 100 ; un cran en dessous → 60 ; sinon 20 ; sans exigence → `unknown` |
| Langues | 5 | Chaque langue exigée présente au niveau demandé → 100, présente sous le niveau → 60, absente → 0 (moyenne) ; sans exigence → `unknown` |

**Score global** = moyenne pondérée des facteurs `evaluated`, poids renormalisés ; si les facteurs évalués représentent moins de 50 % du poids total → score `null` (« Données insuffisantes pour un score fiable »). Bandes : ≥ 85 `EXCELLENT` « Très bonne correspondance », 70–84 `GOOD` « Bonne correspondance », 50–69 `PARTIAL` « Correspondance partielle », < 50 `WEAK` « Faible correspondance ».

**Priorité** (règles, §6) : `VERY_HIGH` « Très forte priorité » si score ≥ 85 **et** toutes les technologies exigées couvertes **et** publiée depuis ≤ 3 jours ; `HIGH` « Forte priorité » si score ≥ 75 ; `GOOD` « Bonne opportunité » si ≥ 60 ; `CONSIDER` « À considérer » si ≥ 45 ; sinon `LOW` « Faible correspondance ». Jamais de « probabilité ».

**Pertinence** (tri) = `score × f(âge)` avec `f` = 1 jusqu'à 2 jours, décroissante linéairement jusqu'à 0,6 à 45 jours (§7 du cahier des charges : une offre à 85 % publiée il y a 2 h passe devant une offre à 100 % publiée il y a 45 jours) ; non évaluées en dernier.

**Explication du classement** (§48) : pour chaque offre de la page, `explanation.top: string[]` (jusqu'à 3 lignes ✓ des facteurs les mieux notés, plus « Publiée aujourd'hui » si < 24 h) et `explanation.weak: string[]` (jusqu'à 2 lignes ⚠/✗). Toutes les lignes sont produites par le moteur, jamais par le modèle.

**Empreinte du profil** : sha256 des entrées listées ci-dessus ; version de la table de synonymes et des poids incluse (`SCORING_VERSION`), pour recalcul automatique après une évolution du moteur.

---

## 6. Contrat partagé et routes API

`packages/shared/src/matching.ts` : `jobRequirementsSchema` (+ `jobRequirementsWireSchema` zod v4), `MatchFactorDto { key, label, weight, score: number | null, status, evidence: { kind: 'ok' | 'warn' | 'missing' | 'info'; text }[] }`, `MatchScoreDto { score: number | null, band, priority, factors[], explanation: { top, weak }, computedAt, analysis: { status: 'none' | 'pending' | 'done' | 'failed' | 'ai_not_configured' } }`, `MatchScoreSummaryDto { score, band, priority, explanation }` (porté par `JobSummaryDto.match: MatchScoreSummaryDto | null`), `AnalyzeJobsInput { jobIds: string[] (≤ 20) }`, `AnalyzeJobsResponseDto { analyzed: number, pending: number, failed: number, notConfigured: boolean, scores: Record<jobId, MatchScoreSummaryDto | null> }`, libellés `MATCH_BAND_LABELS`, `PRIORITY_LABELS`, `FACTOR_LABELS`. `jobSearchQuerySchema` : `sort` gagne `'match' | 'relevance'`, `tab` gagne `'for_you' | 'priority'` (clés d'URL `tri=match|pertinence`, `onglet=pour-vous|priorite`).

| Route | Rôle | Codes |
|---|---|---|
| `POST /jobs/analyses` `{ jobIds }` | analyse les offres manquantes (Claude), calcule/rafraîchit les scores de l'utilisateur, renvoie l'état par offre | 200 ; 400 ; 429 (seau `job-analysis` 60/h) ; 503 `AI_NOT_CONFIGURED` **seulement** si une analyse était nécessaire |
| `GET /jobs/:id/match` | score détaillé (facteurs, explications) ; recalcul si empreinte/version périmée | 200 (score `null` + `analysis.status` si non analysée) ; 404 |
| `POST /jobs/:id/analyses/retry` | relance une analyse `FAILED` | 202 ; 409 si `DONE`/`PENDING` ; 429 |
| `GET /jobs` | inchangée + `match` sur chaque `item` (score sommaire ou `null`), tri `match`/`relevance`, onglets `for_you`/`priority` (filtres sur `MatchScore` de l'utilisateur, jointure) ; `sync` gagne `analysis: { analyzed, total }` pour la page | 200 |

Les scores sont **personnels** (jointure `MatchScore.profileId`), les analyses partagées ; aucune donnée d'un autre utilisateur ne transite (404 jamais 403 sur les routes par id).

---

## 7. Frontend

`features/matching/` : `components/match-badge.tsx` (pastille + bande, `aria-label` « Correspondance 92 sur 100 »), `priority-chip.tsx`, `match-explanation.tsx` (liste ✓/⚠/✗ dépliable sur la carte : « Pourquoi ? »), `match-panel.tsx` (détail : bandeau, barres `Progress` par facteur avec `aria-valuenow`, listes, non évalués, recommandation), `analysis-progress.tsx` (« Analyse de 4 offres… », `aria-live`), `incomplete-profile-notice.tsx`, `hooks/use-match.ts` (`useAnalyzeJobs` : mutation puis interrogation toutes les 2 s tant que `pending > 0`, au plus 60 s ; `useJobMatch(id)`), `lib/format.ts` (bandes, couleurs sémantiques par bande : `EXCELLENT` → succès, `GOOD` → primaire, `PARTIAL` → avertissement, `WEAK` → atténué).

`features/jobs` : `JobCard` reçoit `match` ; `JobTabs`/`JobSortSelect` activent les entrées (tooltips retirées) ; `jobs-page` déclenche `useAnalyzeJobs` pour les items sans `match` après chaque chargement de page (une fois par jeu d'ids), affiche la progression et l'état « IA non configurée » ; `job-detail-page` insère `MatchPanel` sous l'en-tête (spec produit §17) avec le bouton « Analyser cette offre » si nécessaire. États : chargement (squelette de barres), vide (profil incomplet), erreur (analyse échouée + « Réessayer l'analyse »), mobile (facteurs empilés), sombre (jetons).

---

## 8. Sécurité et robustesse

- Aucune donnée personnelle envoyée au modèle : l'analyse ne contient que l'offre. Le profil ne quitte jamais le serveur.
- Contenu de l'offre délimité et traité comme donnée (injection de prompt : instructions dans une annonce ignorées par consigne système ; sortie contrainte par schéma ; longueurs bornées).
- Budgets : 60 analyses/h/utilisateur ; 20 par appel ; une analyse `PENDING` de plus de 2 min est réputée échouée (comme les imports) ; verrou Redis par offre (`matching:analysis:{jobId}`, 120 s) contre les analyses concurrentes de la même offre par deux utilisateurs.
- Journaux : id d'offre, statut, jetons ; jamais le texte de l'offre ni les exigences extraites.
- Calcul des scores en une transaction courte par page (≤ 20 upserts) ; `findMany` de la liste joint `MatchScore` par `profileId` (index `[profileId, score]`).
- Sans clé IA, tout reste utilisable ; les tests n'appellent jamais l'API réelle (client factice, fixtures d'exigences).

---

## 9. Tests

- **Shared** : schémas (bornes, tolérance ligne par ligne), nouvelles valeurs de tri/onglet, aller-retour d'URL.
- **API unitaires** : moteur de score (≥ 40 cas : chaque facteur, `unknown`, renormalisation, seuil 50 %, bandes, priorité, pertinence/fraîcheur, synonymes, années d'expérience avec chevauchements, niveau de formation), constructeur d'entrées profil, analyse (fake Anthropic : succès, `FAILED`, non configuré, injection ignorée par schéma), empreinte/version.
- **API e2e** : analyse d'une page (fake client) → scores ; seconde demande immédiate (cache) ; 429 ; non configuré → 503 seulement si nécessaire ; `GET /jobs?tri=match` ordonné, non évaluées en dernier ; onglets `pour-vous`/`priorite` ; `GET /jobs/:id/match` facteurs ; recalcul après modification du profil (empreinte) ; isolation (les scores d'un autre utilisateur n'apparaissent pas) ; profil incomplet → `score null` + raison.
- **Web** : badge et bandes, explication de carte, panneau de détail (barres, listes, non évalués), progression d'analyse, état IA non configurée, onglets/tris activés et URL.
- **Playwright** : `/jobs` avec IA non configurée affiche l'état et n'invente aucun score ; détail sans analyse propose « Analyser cette offre » (état seulement).

Fixtures : `apps/api/fixtures/matching/requirements-*.json` (exigences extraites fictives pour les offres semées).

---

## 10. Hors périmètre / reporté

Réseau de synonymes appris ; scoring des soft skills ; géocodage hors référentiel des communes (Luxembourg) ; recalcul planifié des scores (T7) ; centre d'activité IA (T7) ; « recommendJobs » proactif (T7/T8) ; fournisseur IA alternatif (le cahier des charges cite OpenAI : l'interface `JobAnalyzer` permet de l'ajouter).

---

## 11. Critères d'acceptation

1. Avec la clé IA, l'ouverture de `/jobs` analyse les offres de la page (≤ 20) et affiche des scores en quelques secondes ; une seconde ouverture n'appelle plus le modèle (analyses partagées et persistées).
2. Chaque score est reproductible : mêmes entrées → même score ; chaque ligne d'explication correspond à une règle du moteur ; aucun pourcentage n'apparaît sans données suffisantes (« non évalué » sinon).
3. Le détail montre les facteurs, les compétences correspondantes, les points faibles et les facteurs non évalués ; la priorité n'est jamais formulée comme une probabilité.
4. « Meilleur match », « Pertinence », « Pour vous » et « Forte priorité » fonctionnent et se reflètent dans l'URL ; la pertinence favorise la fraîcheur.
5. Sans clé IA ou avec un profil incomplet, l'interface explique l'absence de score ; rien n'est simulé.
6. Aucune donnée du profil n'est envoyée au modèle ; les analyses sont partagées, les scores isolés par utilisateur ; budgets respectés ; jamais de 500.
7. Toutes les suites sont vertes ; aucun `any` ; états chargement/vide/erreur/mobile/sombre.
