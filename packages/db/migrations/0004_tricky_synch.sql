ALTER TABLE "ai_analyses" ADD COLUMN "provider" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD COLUMN "prompt_template_version" text;