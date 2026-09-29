-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "playbook" JSONB;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';
