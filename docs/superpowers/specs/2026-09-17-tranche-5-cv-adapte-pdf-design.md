# JobTrack — Tranche 5 : CV adapté, lettre de motivation et export PDF

**Date :** 2026-09-17
**Tranche :** 5 — CV adapté + PDF
**Prérequis :** tranches 0 à 4 fusionnées (`main` 12e997a)

---

## 1. Objectif et périmètre

Livrer le cœur « candidature » du produit (cahier des charges §18, §19, §20, §41, §42) : la page **Mon CV** (`/resume`) qui présente le CV principal dérivé du profil, ses versions adaptées et les modèles ; la **génération d'un CV adapté à une offre** (`/resume/create/:jobId`) en quatre étapes (analyse de l'offre, sélection et reformulation par l'IA, aperçu A4, PDF) avec **versioning** et **traçabilité** (avant/après) ; la **lettre de motivation** générée depuis une offre (trois tons), prévisualisée et exportée en PDF.

Règle absolue (§19) : l'IA **réorganise et reformule** le contenu existant du profil, elle **n'invente rien** — ni expérience, ni diplôme, ni entreprise, ni certification, ni compétence, ni résultat. Cette règle est **appliquée par la structure** (l'IA sélectionne des éléments par identifiant) et **vérifiée par le serveur** (ancrage lexical des reformulations), puis **validée par l'utilisateur** (vue avant/après, édition).

Hors périmètre : candidatures et suivi (T6), auto-candidature (T8), modèles personnalisés au-delà des deux fournis, import de CV existants comme base (le profil reste la source).

### Approches envisagées pour le rendu PDF

| Approche | Principe | Verdict |
|---|---|---|
| A. Navigateur sans tête côté serveur | HTML → PDF via Chromium (Playwright) dans l'API | Rejetée : dépendance lourde à l'hébergement de l'API (Chromium), lenteur, contraire à l'API légère hébergée ailleurs |
| **B. `@react-pdf/renderer` côté client** | Le CV est un document JSON ; des composants React le rendent en PDF **dans le navigateur** (4.9.0, React 19) ; l'aperçu A4 est un jumeau HTML des mêmes composants | **Retenue** : aucune charge serveur, rendu vectoriel A4 fidèle, téléchargement immédiat, testable ; l'API ne stocke que le JSON versionné |
| C. Génération serveur avec `@react-pdf/renderer` | Même bibliothèque, `renderToStream` dans l'API pour archiver un PDF | Reportée : utile pour T6 (joindre le PDF exact à une candidature) ; le JSON versionné suffit à régénérer le même PDF |

---

## 2. Parcours utilisateur

1. **`/resume` — Mon CV.** Trois sections. **CV principal** : construit **à la volée depuis le profil** (identité, titre, résumé, expériences, formations, compétences, langues, certifications, projets), aperçu A4 réduit, actions « Modifier » (→ `/profile`), « Prévisualiser » (plein écran), « Télécharger le PDF », sélecteur de modèle (Classique / Moderne) mémorisé. Bandeau si le profil est trop vide (« Complétez votre profil pour un CV exploitable »). **CV adaptés** : liste des versions adaptées (« CV Développeuse React — Piloto Software », date, offre liée, modèle) avec « Ouvrir », « Télécharger le PDF », « Supprimer » ; état vide « Aucun CV adapté. Générez-en un depuis une offre. ». **Lettres** : liste des lettres générées (offre, ton, date), « Ouvrir », « Télécharger le PDF », « Supprimer ».
2. **`/resume/create/:jobId` — Générer un CV adapté.** Bandeau en trois colonnes « Votre CV actuel → Analyse de l'offre → CV adapté ». **Étape 1 — Analyse de l'offre** : réutilise l'analyse de la tranche 4 (`JobAnalysis`) ; affiche technologies exigées/souhaitées, expérience demandée, exigences, résumé ; si absente, « Analyser l'offre » (mêmes budgets qu'en T4). **Étape 2 — Sélection du contenu** : « Adapter mon CV » lance l'IA ; résultat : titre proposé, résumé reformulé, expériences sélectionnées et réordonnées avec leurs points clés reformulés, compétences réordonnées (les pertinentes en tête), formations/certifications/projets conservés ou écartés ; **vue avant/après** par section (§42) avec, pour chaque point reformulé, la mention de sa source ; l'utilisateur peut **désélectionner** un élément, **modifier** un texte, **rétablir** la version du profil. Un élément écarté par l'IA reste rétablissable. **Étape 3 — Aperçu** : rendu A4 réel du modèle choisi, pagination visible. **Étape 4 — PDF** : « Générer mon CV » enregistre la version (§41) puis « Télécharger le PDF » (nom de fichier `CV-Prénom-Nom-Entreprise.pdf`). Le CV adapté apparaît ensuite dans `/resume` et sur l'offre (« CV adapté disponible »).
3. **`/resume/:id` — CV adapté enregistré.** Aperçu A4, modèle, « Voir les changements » (avant/après conservé), « Modifier » (édition des textes → nouvelle version), « Télécharger le PDF », « Supprimer ». En-tête « Ce CV a été adapté à partir de votre profil le {date} pour {offre} ».
4. **Lettre de motivation.** Depuis l'offre (`/jobs/:id`, action « Générer une lettre ») ou depuis l'étape 4 : `/resume/letter/:jobId` — choix du ton (**Courte**, **Professionnelle**, **Très personnalisée**), génération, texte éditable (destinataire, objet, paragraphes, signature), aperçu A4, « Enregistrer », « Télécharger le PDF » (`Lettre-Prénom-Nom-Entreprise.pdf`). La lettre n'invente pas de faits : elle s'appuie sur le profil et l'offre ; l'entreprise n'est décrite qu'à partir de ce que l'offre en dit.
5. **États.** IA non configurée : les étapes 2 (CV) et la génération de lettre affichent « Le service IA n'est pas configuré » ; le CV principal, l'aperçu et le PDF restent utilisables (sans adaptation). Profil vide : bandeau et étape 2 désactivée. Erreurs IA : message + « Réessayer » ; jamais de 500.

---

## 3. Modèle de données

**`Resume`** : `id`, `userId`, `kind Enum { TAILORED }` (le CV principal n'est pas stocké : il se dérive du profil ; l'enum reste ouverte pour T6), `title` (« CV Développeuse React — Piloto Software »), `jobId String?` (offre, `onDelete: SetNull`), `template Enum { CLASSIC, MODERN }`, `currentVersion Int`, `createdAt`, `updatedAt` ; relations `versions ResumeVersion[]`. Index `@@index([userId, updatedAt])`.

**`ResumeVersion`** : `id`, `resumeId`, `version Int`, `content Json` (schéma §4, **document autoporteur** : ne dépend plus du profil), `changes Json?` (avant/après par section, §42, uniquement sur la version générée par l'IA), `source Enum { AI, USER }`, `model String?`, `promptVersion Int?`, `inputTokens Int?`, `outputTokens Int?`, `createdAt`, `@@unique([resumeId, version])`.

**`CoverLetter`** : `id`, `userId`, `jobId String?` (`SetNull`), `resumeId String?` (`SetNull`), `tone Enum { SHORT, PROFESSIONAL, PERSONAL }`, `content Json` (schéma §4), `model String?`, `promptVersion Int?`, `inputTokens Int?`, `outputTokens Int?`, `createdAt`, `updatedAt`, `@@index([userId, updatedAt])`.

**`User.resumeTemplate ResumeTemplate @default(CLASSIC)`** : modèle préféré pour le CV principal.

Traçabilité (§42) : `jobId`, `baseResumeId` (= « profil au moment T » : le contenu de base est **inclus** dans `changes.before`), `createdAt`, `model`, `promptVersion`, `changes` — tous présents.

---

## 4. Contrat partagé (`packages/shared/src/resume.ts`)

`resumeContentSchema` (JSON versionné, `schemaVersion: 1`) :

```text
identity      { firstName, lastName, title, email?, phone?, city?, country?, links[]{ label, url } }
summary       string ≤ 1200
experiences[] { id (Experience.id du profil), company, role, location?, startDate, endDate?, isCurrent, highlights[] ≤ 6 × 300, sourceDescription? }
educations[]  { id, school, degree, field?, startDate, endDate? }
skills[]      { id, name, category, level }
languages[]   { id, name, level }
certifications[] { id, name, issuer, issuedAt }
projects[]    { id, name, description? ≤ 400, url?, technologies[] }
```

`buildBaseResume(profile)` (pur, partagé web/API) construit ce document depuis le profil (mêmes DTO que `/profile`) : les descriptions d'expérience sont découpées en `highlights` (puces existantes ou phrases). `resumeTailoringWireSchema` (zod v4, sortie du modèle) et `resumeTailoringSchema` (v3, tolérant) :

```text
title                string ≤ 120
summary              string ≤ 1200
experiences[]        { id, keep: bool, order: int, highlights[] ≤ 6 × 300 }   (uniquement des ids du profil)
educations[]         { id, keep }
skills[]             { id, order }                                             (ids ; les absents restent après)
certifications[]     { id, keep }
projects[]           { id, keep, order }
notes                string ≤ 300   (une phrase : ce qui a été mis en avant)
```

`coverLetterContentSchema` : `{ recipient?, subject ≤ 160, greeting, paragraphs[] 1–6 × 900, closing, signature }` et le schéma fil correspondant. `resumeChangesSchema` : `{ title: { before, after }, summary: { before, after }, experiences[]: { id, before: highlights[], after: highlights[], kept }, skills: { before: ids[], after: ids[] }, educations/certifications/projects: kept ids }`. DTO : `ResumeSummaryDto`, `ResumeDto` (+ `content`, `changes`, `version`), `CoverLetterDto`, `CreateTailoredResumeInput { jobId, template }`, `UpdateResumeInput { content, template? }` (nouvelle version `USER`), `CreateCoverLetterInput { jobId, tone, resumeId? }`, `UpdateCoverLetterInput { content }`. Libellés `RESUME_TEMPLATE_LABELS`, `COVER_LETTER_TONE_LABELS`, `RESUME_SECTION_LABELS`.

---

## 5. Adaptation par l'IA et ancrage (« jamais inventer »)

`apps/api/src/modules/resume/resume-tailoring.service.ts`, même socle que T2/T4 (`messages.parse` + `zodOutputFormat`, prompt système stable mis en cache, `max_tokens 8000`, `effort medium`, erreurs mappées, aucun 500).

**Entrée** : le document de base (`buildBaseResume(profile)`, avec les ids) et l'analyse de l'offre (`JobRequirements` de T4, à défaut titre/description de l'offre bornée). **Le profil de l'utilisateur est envoyé au modèle** — c'est l'objet même de la fonctionnalité ; seules ses données à lui, jamais celles d'un autre utilisateur, jamais l'email/téléphone (retirés avant envoi, réinjectés côté serveur).

**Contraintes structurelles** : le modèle ne peut que **sélectionner** (`keep`), **ordonner** (`order`) et **reformuler** (`highlights`, `summary`, `title`) ; tout id inconnu est ignoré ; une expérience sans `highlights` garde ceux de la base.

**Ancrage des reformulations** (`grounding.ts`, pur, testé) : chaque `highlight` reformulé est comparé au texte source de l'expérience (description + intitulé + entreprise) et au reste du profil : (1) chaque **nombre** (« 30 % », « 12 personnes », « 2 M€ ») présent dans la reformulation doit exister dans la source, sinon la puce est **rejetée** ; (2) chaque **nom propre** capitalisé (technologie, outil, entreprise, produit) doit exister dans la source ou dans les compétences/projets du profil (normalisation `canonicalSkill` de T4), sinon rejet ; (3) une puce vide ou > 300 caractères est rejetée. Une puce rejetée est remplacée par la puce source correspondante (même index) et signalée dans `changes` (« reformulation écartée : mention non présente dans votre profil »). Le `summary` subit les mêmes règles sur nombres et noms propres. Titre libre (≤ 120) mais sans nombre.

**`changes`** = diff par section calculé par le serveur (base vs résultat ancré), conservé sur la version `AI` ; l'utilisateur voit chaque puce avec sa source.

**Budgets** : 20 adaptations / heure / utilisateur (seau `resume-tailoring`), 10 lettres / heure (`cover-letter`) ; une adaptation = un appel. Verrou par (utilisateur, offre) 5 min (couvre le pire cas d'un appel `messages.parse` avec ses tentatives : 90 s × 3 tentatives, avec marge).

**Lettre** : entrée = profil (sans coordonnées), offre (titre, entreprise, description bornée, exigences), ton ; sortie `coverLetterWireSchema` ; ancrage : nombres et noms propres des paragraphes doivent exister dans le profil ou l'offre, sinon la phrase est retirée ; longueur par ton (Courte ≤ 900 caractères, Professionnelle ≤ 1800, Très personnalisée ≤ 2600).

---

## 6. Routes API

| Route | Rôle | Codes |
|---|---|---|
| `GET /resume/base` | CV principal dérivé du profil (`resumeContent` + `template` préféré + `profileComplete`) | 200 |
| `PATCH /resume/template` `{ template }` | modèle préféré | 200 |
| `GET /resume` | CV adaptés de l'utilisateur (résumés, plus récents d'abord) | 200 |
| `POST /resume/tailor` `{ jobId, template }` | analyse si nécessaire (T4), adaptation IA, ancrage, `changes`, crée `Resume` + version 1 `AI` | 201 `ResumeDto` ; 404 offre ; 409 `PROFILE_INCOMPLETE` ; 429 ; 503 `AI_NOT_CONFIGURED` / `AI_UNAVAILABLE` |
| `GET /resume/:id` | détail (version courante + `changes` de la version IA) | 200 ; 404 |
| `PATCH /resume/:id` `{ content, template? }` | nouvelle version `USER` (validation stricte du contenu ; ids conservés) | 200 ; 404 |
| `DELETE /resume/:id` | suppression (versions en cascade) | 204 |
| `GET /resume/letters` | lettres | 200 |
| `POST /resume/letters` `{ jobId, tone, resumeId? }` | génération IA + ancrage | 201 ; 404 ; 409 ; 429 ; 503 |
| `GET /resume/letters/:id` / `PATCH` / `DELETE` | détail / édition / suppression | 200 / 200 / 204 ; 404 |

Isolation : toutes les requêtes filtrées par `userId` (404 jamais 403). Le PDF n'est pas une route : il est produit côté client.

---

## 7. Frontend

`features/resume/` :

- **Modèles** : `templates/{classic,modern}/` avec deux rendus par modèle — `*.pdf.tsx` (primitives `@react-pdf/renderer` : `Document`, `Page` A4, polices Helvetica/Times embarquées par la bibliothèque, pas de police distante) et `*.preview.tsx` (jumeau HTML/Tailwind à l'échelle A4 : `210mm × 297mm`, sauts de page approximés, `aria-label` « Aperçu du CV, page 1 »). Un test s'assure que les deux rendent les mêmes sections dans le même ordre pour un même document.
- **Pages** : `resume-page.tsx` (`/resume`), `resume-create-page.tsx` (`/resume/create/:jobId`, machine à 4 étapes dans l'URL `?etape=`), `resume-detail-page.tsx` (`/resume/:id`), `cover-letter-page.tsx` (`/resume/letter/:jobId`, `?lettre=<id>` pour une lettre existante).
- **Composants** : `resume-preview.tsx` (cadre A4 avec zoom, pagination), `template-picker.tsx`, `resume-changes.tsx` (avant/après par section, puces avec source, « Rétablir »), `resume-editor.tsx` (édition des textes : titre, résumé, puces ; cases « inclure » ; réordonnancement par boutons ↑↓), `download-pdf-button.tsx` (`pdf(<Doc/>).toBlob()` → lien de téléchargement ; état « Génération… » ; erreur en toast), `cover-letter-editor.tsx`, `tone-picker.tsx`, `resume-list.tsx`, `letter-list.tsx`.
- **Accès API / hooks** : `services/api/resume.ts`, `features/resume/hooks/use-resume.ts` (`useBaseResume`, `useResumes`, `useResume(id)`, `useTailorResume` (mutation + navigation), `useUpdateResume`, `useDeleteResume`, `useLetters`, `useLetter`, `useCreateLetter`, `useUpdateLetter`, `useDeleteLetter`, `useResumeTemplate`).
- **Intégration** : `/jobs/:id` gagne « Adapter mon CV » (→ `/resume/create/:jobId`) et « Générer une lettre » ; `NAV_ITEMS` `/resume` disponible ; `MatchPanel` inchangé.
- **Chargement paresseux** : `@react-pdf/renderer` est chargé à la demande (`import()` dans `download-pdf-button`), jamais dans le bundle initial (il pèse ~500 ko) ; l'aperçu HTML n'en dépend pas.
- **États** : chargement (squelette A4), vide (profil vide, aucune version), erreur (IA, réseau), IA non configurée, mobile (aperçu A4 réduit avec défilement horizontal, éditeur empilé), sombre (l'aperçu reste **toujours clair** : c'est un document papier).

---

## 8. Sécurité et robustesse

- Le modèle reçoit **uniquement** les données de l'utilisateur connecté et l'offre ; coordonnées (email, téléphone, liens) retirées de l'entrée IA ; contenu de l'offre délimité (`<offre>`), profil délimité (`<profil>`), données jamais instruction ; sortie contrainte par schéma ; longueurs bornées (profil ≤ 30 000 caractères après troncature des descriptions, offre ≤ 20 000).
- Ancrage vérifié côté serveur ; le client n'a pas à faire confiance au modèle ; `changes` persistant pour audit.
- `PATCH` de contenu : schéma strict, ids d'expérience/formation vérifiés comme appartenant au profil de l'utilisateur au moment de la sauvegarde (sinon 400), textes nettoyés (caractères de contrôle/bidi).
- PDF côté client : aucune donnée n'est envoyée à un tiers ; noms de fichiers assainis (ASCII, tirets).
- Budgets par utilisateur ; verrou ; journaux sans contenu de CV ni de lettre (ids, jetons, statuts).
- Suppression d'un CV adapté : cascade des versions ; suppression d'une offre : `jobId` mis à `null` (le CV reste).

---

## 9. Tests

- **Shared** : `buildBaseResume` (découpage des puces, ordre, champs optionnels), schémas (tolérance, bornes, ids), `resumeChangesSchema`.
- **API unitaires** : `grounding.ts` (≥ 20 cas : nombres, noms propres, technologies canoniques, rejet et remplacement par la source, résumé, lettre par ton) ; `resume-tailoring.service` (fake Anthropic : succès, ids inconnus ignorés, expérience sans highlights, non configuré, indisponible, sortie non conforme → 502 `AI_OUTPUT_INVALID` sans écriture) ; `cover-letter.service` ; diff `changes`.
- **API e2e** (`resume.e2e.spec.ts`, fake Anthropic à fixtures) : base depuis le profil ; `tailor` → 201 avec `changes`, version 1 ; `PATCH` → version 2 `USER` ; ids étrangers → 400 ; isolation (404) ; suppression ; lettres (3 tons, ancrage) ; budgets 429 ; non configuré 503 ; profil incomplet 409 ; suppression d'offre → `jobId null`.
- **Web** : `buildBaseResume` via l'aperçu (sections rendues), parité HTML/PDF des modèles, machine d'étapes (URL), `resume-changes` (rétablir), éditeur (nouvelle version), bouton PDF (mock de `@react-pdf/renderer` : `toBlob` appelé, lien créé), listes et états, page lettre (tons, édition).
- **Playwright** : `/resume` affiche le CV principal du compte (profil rempli) et « Télécharger le PDF » déclenche un téléchargement (`page.waitForEvent('download')`, nom de fichier) ; `/resume/create/:jobId` sans IA affiche l'état non configuré à l'étape 2 ; état vide des CV adaptés.

Fixtures : `apps/api/fixtures/resume/{tailoring-FT-0001.json,letter-professional.json}` (fictives).

---

## 10. Hors périmètre / reporté

Génération PDF côté serveur et archivage du fichier exact (T6) ; import d'un CV externe comme base ; modèles supplémentaires et personnalisation (couleurs, polices) ; export DOCX ; traduction du CV ; photo.

---

## 11. Critères d'acceptation

1. `/resume` affiche le CV principal construit depuis le profil dans le modèle choisi ; le PDF téléchargé correspond à l'aperçu (sections, ordre, textes) et tient sur des pages A4.
2. Avec la clé IA, `/resume/create/:jobId` produit un CV adapté dont **chaque** élément provient du profil : ids vérifiés, reformulations ancrées (aucun nombre ni nom propre absent de la source), vue avant/après complète, éléments écartés rétablissables.
3. Chaque CV adapté est enregistré avec sa traçabilité (offre, date, modèle, version de prompt, changements) et réapparaît dans `/resume` ; une édition crée une nouvelle version ; on retrouve la version exacte.
4. La lettre de motivation existe en trois tons, respecte les longueurs, n'introduit ni chiffre ni entité absents du profil ou de l'offre, se prévisualise et s'exporte en PDF.
5. Sans clé IA ou avec un profil vide, l'interface explique l'état ; le CV principal reste exportable ; jamais de 500.
6. Isolation stricte par utilisateur ; coordonnées jamais envoyées au modèle ; budgets respectés ; journaux sans contenu.
7. Toutes les suites vertes ; aucun `any` ; états chargement/vide/erreur/mobile/sombre ; aperçu toujours clair.
