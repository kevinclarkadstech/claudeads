CREATE TYPE "public"."sync_trigger" AS ENUM('initial', 'scheduled', 'manual');--> statement-breakpoint
ALTER TABLE "sync_run" ADD COLUMN "trigger" "sync_trigger" NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_run" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_run_one_active_per_account" ON "sync_run" USING btree ("ad_account_id") WHERE "sync_run"."status" in ('queued', 'running');