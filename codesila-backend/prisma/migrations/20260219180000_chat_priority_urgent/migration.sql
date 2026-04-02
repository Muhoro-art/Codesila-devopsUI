-- AlterTable: Add priority and pinnedAt to chat_messages
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
