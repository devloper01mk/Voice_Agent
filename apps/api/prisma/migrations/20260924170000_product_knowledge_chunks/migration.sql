-- CreateTable
CREATE TABLE "ProductKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "heading" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "embedding" JSONB,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductKnowledgeChunk_agentId_position_idx" ON "ProductKnowledgeChunk"("agentId", "position");

-- AddForeignKey
ALTER TABLE "ProductKnowledgeChunk" ADD CONSTRAINT "ProductKnowledgeChunk_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
