-- CreateEnum
CREATE TYPE "JobSourceKind" AS ENUM ('FRANCE_TRAVAIL');

-- CreateEnum
CREATE TYPE "JobRequirementKind" AS ENUM ('EDUCATION', 'LANGUAGE');

-- CreateEnum
CREATE TYPE "JobSyncStatus" AS ENUM ('OK', 'PARTIAL', 'FAILED');

-- AlterEnum
ALTER TYPE "ContractType" ADD VALUE 'INTERIM';

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "companyDescription" TEXT,
    "companyUrl" TEXT,
    "companyLogoUrl" TEXT,
    "description" TEXT NOT NULL,
    "locationLabel" TEXT,
    "communeCode" TEXT,
    "postalCode" TEXT,
    "departmentCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contractType" "ContractType",
    "contractLabel" TEXT,
    "contractNature" TEXT,
    "remoteMode" "RemoteMode",
    "remoteModeInferred" BOOLEAN NOT NULL DEFAULT false,
    "experienceLevel" "ExperienceLevel",
    "experienceLabel" TEXT,
    "experienceRequired" BOOLEAN,
    "salaryMinAnnual" INTEGER,
    "salaryMaxAnnual" INTEGER,
    "salaryLabel" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "workingTimeLabel" TEXT,
    "isFullTime" BOOLEAN,
    "isApprenticeship" BOOLEAN NOT NULL DEFAULT false,
    "positionsCount" INTEGER,
    "accessibleTh" BOOLEAN,
    "sectorLabel" TEXT,
    "romeCode" TEXT,
    "romeLabel" TEXT,
    "qualificationLabel" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "source" "JobSourceKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "applyUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partnerName" TEXT,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSkill" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,

    CONSTRAINT "JobSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequirement" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "JobRequirementKind" NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,

    CONSTRAINT "JobRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSearchSync" (
    "id" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "queryJson" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" "JobSyncStatus" NOT NULL,
    "lastError" TEXT,
    "resultCount" INTEGER NOT NULL,

    CONSTRAINT "JobSearchSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commune" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "postalCode" TEXT,
    "departmentCode" TEXT NOT NULL,

    CONSTRAINT "Commune_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_fingerprint_key" ON "Job"("fingerprint");

-- CreateIndex
CREATE INDEX "Job_publishedAt_idx" ON "Job"("publishedAt");

-- CreateIndex
CREATE INDEX "Job_lastSeenAt_idx" ON "Job"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Job_contractType_publishedAt_idx" ON "Job"("contractType", "publishedAt");

-- CreateIndex
CREATE INDEX "Job_departmentCode_publishedAt_idx" ON "Job"("departmentCode", "publishedAt");

-- CreateIndex
CREATE INDEX "JobSource_jobId_idx" ON "JobSource"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_source_externalId_key" ON "JobSource"("source", "externalId");

-- CreateIndex
CREATE INDEX "JobSkill_jobId_idx" ON "JobSkill"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSkill_jobId_name_key" ON "JobSkill"("jobId", "name");

-- CreateIndex
CREATE INDEX "JobRequirement_jobId_idx" ON "JobRequirement"("jobId");

-- CreateIndex
CREATE INDEX "SavedJob_jobId_idx" ON "SavedJob"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedJob_userId_jobId_key" ON "SavedJob"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSearchSync_queryHash_key" ON "JobSearchSync"("queryHash");

-- CreateIndex
CREATE INDEX "Commune_nameNormalized_idx" ON "Commune"("nameNormalized");

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirement" ADD CONSTRAINT "JobRequirement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
