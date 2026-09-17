-- Index de tri utilisables par le moteur (revue sécurité, tâche 4) : les tris par salaire
-- et par fraîcheur ne filtrent jamais que les offres encore actives (`expiredAt IS NULL`,
-- cf. `jobs.service.ts`) et trient en ordre décroissant — un index ASC plein (comme
-- `Job_salaryMaxAnnual_publishedAt_idx`, créé par `20260916215515_job_salary_index`) n'est
-- d'aucune aide pour ce genre de requête. Remplacé ici par deux index partiels, triés dans
-- le sens du tri effectif, avec `id` en tête de départage pour une pagination par curseur
-- stable. `NULLS LAST` sur `salaryMaxAnnual` : une offre sans salaire renseigné doit
-- apparaître en fin de liste, jamais en tête (comportement par défaut de DESC en SQL).

-- DropIndex
DROP INDEX "Job_salaryMaxAnnual_publishedAt_idx";

-- CreateIndex
CREATE INDEX "Job_salary_sort_idx" ON "Job" ("salaryMaxAnnual" DESC NULLS LAST, "publishedAt" DESC, "id") WHERE "expiredAt" IS NULL;

-- CreateIndex
CREATE INDEX "Job_recent_sort_idx" ON "Job" ("publishedAt" DESC, "id") WHERE "expiredAt" IS NULL;

-- `communeCode, publishedAt` : la recherche par commune (jobs.service.ts) filtre sur les
-- offres actives et trie par fraîcheur décroissante, jamais servie par un index ASC plein.
-- L'index B-tree ASC ci-dessous exprime la partie que Prisma modélise
-- (`@@index([communeCode, publishedAt])` du modèle `Job`) ; le second, sous un nom distinct,
-- porte le tri DESC et la condition partielle que Prisma ne sait pas exprimer. Un même nom
-- pour les deux (le défaut `Job_communeCode_publishedAt_idx` pour les deux) a été vérifié
-- pousser `prisma migrate dev` à tenter de remplacer le second par une version ASC pleine
-- (échec : la relation existe déjà) — d'où le nom distinct.

-- CreateIndex
CREATE INDEX "Job_communeCode_publishedAt_idx" ON "Job"("communeCode", "publishedAt");

-- CreateIndex
CREATE INDEX "Job_communeCode_sort_idx" ON "Job" ("communeCode", "publishedAt" DESC) WHERE "expiredAt" IS NULL;

-- `nameNormalized`/`postalCode` (CommuneService.search) sont interrogés par `startsWith` :
-- un index B-tree ordinaire ne sert ce filtre que si la collation de la base est `C`, jamais
-- garanti sur une base Postgres créée avec une collation régionale. `text_pattern_ops`
-- indexe le motif d'octets brut plutôt que l'ordre de collation et reste utilisable pour
-- l'égalité comme pour un préfixe. Ajoutés ici EN PLUS des index B-tree existants
-- (`Commune_nameNormalized_idx`, `Commune_postalCode_idx`, toujours déclarés dans le modèle
-- `Commune`), jamais à leur place : les retirer du schéma a été vérifié pousser
-- `prisma migrate dev` à proposer de supprimer ces deux index `text_pattern_ops` (les
-- considérant hors schéma), sans jamais rien recréer à la place.

-- CreateIndex
CREATE INDEX "Commune_nameNormalized_pattern_idx" ON "Commune" ("nameNormalized" text_pattern_ops);

-- CreateIndex
CREATE INDEX "Commune_postalCode_pattern_idx" ON "Commune" ("postalCode" text_pattern_ops);
