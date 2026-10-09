ALTER TABLE "user_secret" ADD COLUMN "gemini_key" jsonb;--> statement-breakpoint
ALTER TABLE "user_secret" ADD COLUMN "ai_provider" text;--> statement-breakpoint
ALTER TABLE "ai_job" ADD COLUMN "provider" text;