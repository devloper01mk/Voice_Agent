-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "greeting" TEXT NOT NULL,
    "persona" TEXT NOT NULL DEFAULT 'friendly and professional',
    "productName" TEXT NOT NULL DEFAULT 'Cronberry CRM',
    "voiceId" TEXT NOT NULL,
    "voiceLanguage" TEXT NOT NULL DEFAULT 'en',
    "voiceLanguages" TEXT NOT NULL DEFAULT 'en,hi,hinglish',
    "voiceSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "voicePitch" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "ttsModel" TEXT NOT NULL DEFAULT 'sonic-3.5',
    "ttsSampleRate" INTEGER NOT NULL DEFAULT 24000,
    "ttsEmotion" TEXT NOT NULL DEFAULT '',
    "voicePipeline" TEXT NOT NULL DEFAULT 'gemini_live',
    "realtimeVoice" TEXT NOT NULL DEFAULT 'Kore',
    "realtimeS2sConfig" JSONB,
    "agentGender" TEXT NOT NULL DEFAULT 'female',
    "llmProvider" TEXT NOT NULL DEFAULT 'gpt',
    "llmModel" TEXT NOT NULL DEFAULT 'gpt-5.4-mini',
    "sttProvider" TEXT NOT NULL DEFAULT 'sarvam',
    "sttModel" TEXT NOT NULL DEFAULT '',
    "brainMarkdown" TEXT NOT NULL,
    "brainSummary" TEXT NOT NULL DEFAULT '',
    "brainLearnings" TEXT NOT NULL DEFAULT '',
    "learningsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "generalKnowledgeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "skillsConfig" JSONB NOT NULL,
    "compiledSystemPrompt" TEXT NOT NULL,
    "promptTokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainMutation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "callId" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalLearningVector" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "callId" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalLearningVector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectMemory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "prospectKey" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "factsMarkdown" TEXT NOT NULL DEFAULT '',
    "callerStyle" TEXT NOT NULL DEFAULT '',
    "lastCallId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "source" TEXT NOT NULL DEFAULT 'simulator',
    "status" TEXT NOT NULL DEFAULT 'created',
    "externalCallId" TEXT,
    "fromNumber" TEXT,
    "toNumber" TEXT,
    "provider" TEXT,
    "prospectName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "outcome" TEXT,
    "transcript" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "brainMutationAt" TIMESTAMP(3),
    "webhookSentAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "callId" TEXT,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "preferredTime" TEXT NOT NULL,
    "preferredTimeRaw" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "bookingType" TEXT NOT NULL DEFAULT 'demo',
    "status" TEXT NOT NULL DEFAULT 'new',
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "productInterest" TEXT,
    "location" TEXT,
    "locationType" TEXT NOT NULL DEFAULT 'showroom',
    "source" TEXT NOT NULL DEFAULT 'voice_inbound',
    "googleEventId" TEXT,
    "calendarSyncStatus" TEXT NOT NULL DEFAULT 'pending',
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Callback" (
    "id" TEXT NOT NULL,
    "callId" TEXT,
    "agentId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "preferredTime" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3),
    "googleEventId" TEXT,
    "calendarSyncStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Callback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRules" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "openDays" TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
    "dayStartHour" INTEGER NOT NULL DEFAULT 10,
    "dayStartMinute" INTEGER NOT NULL DEFAULT 0,
    "dayEndHour" INTEGER NOT NULL DEFAULT 19,
    "dayEndMinute" INTEGER NOT NULL DEFAULT 0,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "capacityPerSlot" INTEGER NOT NULL DEFAULT 1,
    "blockedDates" TEXT NOT NULL DEFAULT '[]',
    "slotMinutesByType" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityRules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProspectMemory_agentId_prospectKey_key" ON "ProspectMemory"("agentId", "prospectKey");

-- CreateIndex
CREATE INDEX "Lead_agentId_scheduledStart_idx" ON "Lead"("agentId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Lead_agentId_status_idx" ON "Lead"("agentId", "status");

-- CreateIndex
CREATE INDEX "Callback_agentId_scheduledAt_idx" ON "Callback"("agentId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityRules_agentId_key" ON "AvailabilityRules"("agentId");

-- AddForeignKey
ALTER TABLE "BrainMutation" ADD CONSTRAINT "BrainMutation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalLearningVector" ADD CONSTRAINT "GlobalLearningVector_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectMemory" ADD CONSTRAINT "ProspectMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Callback" ADD CONSTRAINT "Callback_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Callback" ADD CONSTRAINT "Callback_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRules" ADD CONSTRAINT "AvailabilityRules_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

