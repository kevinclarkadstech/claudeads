CREATE TABLE "ai_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"status" "sync_status" DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"summary" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "recommendation" ADD COLUMN "ai_review_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_review" ADD CONSTRAINT "ai_review_ad_account_id_ad_account_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_review_ad_account_id_created_at_index" ON "ai_review" USING btree ("ad_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_one_active_per_account" ON "ai_review" USING btree ("ad_account_id") WHERE "ai_review"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_ai_review_id_ai_review_id_fk" FOREIGN KEY ("ai_review_id") REFERENCES "public"."ai_review"("id") ON DELETE set null ON UPDATE no action;