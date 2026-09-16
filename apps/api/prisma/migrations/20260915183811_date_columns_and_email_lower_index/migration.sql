-- AlterTable
ALTER TABLE "Certification" ALTER COLUMN "issuedAt" SET DATA TYPE DATE,
ALTER COLUMN "expiresAt" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Education" ALTER COLUMN "startDate" SET DATA TYPE DATE,
ALTER COLUMN "endDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Experience" ALTER COLUMN "startDate" SET DATA TYPE DATE,
ALTER COLUMN "endDate" SET DATA TYPE DATE;

-- Index unique insensible à la casse, écrit à la main : Prisma ne sait pas exprimer
-- un index sur une expression. Défense en profondeur derrière la normalisation
-- applicative de l'email en minuscules.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
