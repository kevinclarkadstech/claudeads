CREATE TYPE "public"."connection_status" AS ENUM('active', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."entity_level" AS ENUM('account', 'campaign', 'ad_group', 'ad');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('meta', 'google');--> statement-breakpoint
CREATE TYPE "public"."rec_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."rec_source" AS ENUM('rule', 'ai');--> statement-breakpoint
CREATE TYPE "public"."rec_status" AS ENUM('open', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"timezone" text NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"external_user_id" text NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"scopes" text[],
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"level" "entity_level" NOT NULL,
	"parent_id" uuid,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"objective" text,
	"daily_budget_micros" bigint,
	"attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metric" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_metric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ad_account_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"level" "entity_level" NOT NULL,
	"date" date NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"spend_micros" bigint DEFAULT 0 NOT NULL,
	"conversions" double precision DEFAULT 0 NOT NULL,
	"conversion_value_micros" bigint DEFAULT 0 NOT NULL,
	"reach" bigint,
	"video_views" bigint,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "recommendation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"entity_id" uuid,
	"source" "rec_source" NOT NULL,
	"rule_id" text NOT NULL,
	"severity" "rec_severity" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb,
	"estimated_impact" jsonb,
	"status" "rec_status" DEFAULT 'open' NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"status" "sync_status" DEFAULT 'queued' NOT NULL,
	"range_start" date NOT NULL,
	"range_end" date NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_account" ADD CONSTRAINT "ad_account_connection_id_ad_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ad_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_account" ADD CONSTRAINT "ad_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_connection" ADD CONSTRAINT "ad_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entity" ADD CONSTRAINT "ad_entity_ad_account_id_ad_account_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entity" ADD CONSTRAINT "ad_entity_parent_id_ad_entity_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ad_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metric" ADD CONSTRAINT "daily_metric_ad_account_id_ad_account_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metric" ADD CONSTRAINT "daily_metric_entity_id_ad_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."ad_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_ad_account_id_ad_account_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_entity_id_ad_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."ad_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_ad_account_id_ad_account_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_index" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_account_connection_id_external_id_index" ON "ad_account" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "ad_account_user_id_index" ON "ad_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_connection_user_id_platform_external_user_id_index" ON "ad_connection" USING btree ("user_id","platform","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_entity_ad_account_id_level_external_id_index" ON "ad_entity" USING btree ("ad_account_id","level","external_id");--> statement-breakpoint
CREATE INDEX "ad_entity_parent_id_index" ON "ad_entity" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_metric_entity_id_date_index" ON "daily_metric" USING btree ("entity_id","date");--> statement-breakpoint
CREATE INDEX "daily_metric_ad_account_id_level_date_index" ON "daily_metric" USING btree ("ad_account_id","level","date");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_ad_account_id_fingerprint_index" ON "recommendation" USING btree ("ad_account_id","fingerprint");--> statement-breakpoint
CREATE INDEX "recommendation_ad_account_id_status_index" ON "recommendation" USING btree ("ad_account_id","status");--> statement-breakpoint
CREATE INDEX "sync_run_ad_account_id_created_at_index" ON "sync_run" USING btree ("ad_account_id","created_at");