-- CreateEnum
CREATE TYPE "CvImportStatus" AS ENUM ('PENDING', 'EXTRACTED', 'FAILED', 'APPLIED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CvImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "CvImportStatus" NOT NULL DEFAULT 'PENDING',
    "extracted" JSONB,
    "error" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "CvImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CvImport_userId_createdAt_idx" ON "CvImport"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CvImport" ADD CONSTRAINT "CvImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
