-- CreateEnum
CREATE TYPE "JobAnalysisStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchBand" AS ENUM ('EXCELLENT', 'GOOD', 'PARTIAL', 'WEAK');

-- CreateEnum
CREATE TYPE "MatchPriority" AS ENUM ('VERY_HIGH', 'HIGH', 'GOOD', 'CONSIDER', 'LOW');

-- CreateTable
CREATE TABLE "JobAnalysis" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "JobAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL,
    "requirements" JSONB,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchScore" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "score" INTEGER,
    "relevance" INTEGER,
    "band" "MatchBand",
    "priority" "MatchPriority",
    "factors" JSONB NOT NULL,
    "profileFingerprint" TEXT NOT NULL,
    "analysisVersion" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobAnalysis_jobId_key" ON "JobAnalysis"("jobId");

-- CreateIndex
CREATE INDEX "JobAnalysis_status_idx" ON "JobAnalysis"("status");

-- CreateIndex
CREATE INDEX "MatchScore_profileId_score_idx" ON "MatchScore"("profileId", "score");

-- CreateIndex
CREATE INDEX "MatchScore_profileId_relevance_idx" ON "MatchScore"("profileId", "relevance");

-- CreateIndex
CREATE INDEX "MatchScore_profileId_priority_idx" ON "MatchScore"("profileId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "MatchScore_profileId_jobId_key" ON "MatchScore"("profileId", "jobId");

-- AddForeignKey
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScore" ADD CONSTRAINT "MatchScore_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScore" ADD CONSTRAINT "MatchScore_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
