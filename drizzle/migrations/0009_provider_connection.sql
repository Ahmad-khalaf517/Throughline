CREATE TABLE "provider_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone,
	"scopes" text DEFAULT '' NOT NULL,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_connection_user_id_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "provider_connection_id_provider_unique" UNIQUE("id","provider"),
	CONSTRAINT "provider_connection_provider_check" CHECK ("provider_connection"."provider" IN ('github','jira','stitch')),
	CONSTRAINT "provider_connection_status_check" CHECK ("provider_connection"."status" IN ('active','needs_reauth','revoked')),
	CONSTRAINT "provider_connection_key_version_check" CHECK ("provider_connection"."key_version" > 0),
	CONSTRAINT "provider_connection_meta_object_check" CHECK (jsonb_typeof("provider_connection"."provider_meta") = 'object'),
	CONSTRAINT "provider_connection_meta_no_secret_keys_check" CHECK (NOT ("provider_connection"."provider_meta" ?| ARRAY['access_token','refresh_token','token','api_key','apiKey','secret','client_secret','password'])),
	CONSTRAINT "provider_connection_token_shape_check" CHECK (("provider_connection"."status" = 'revoked' AND "provider_connection"."access_token_enc" = 'revoked' AND "provider_connection"."refresh_token_enc" IS NULL AND "provider_connection"."expires_at" IS NULL)
        OR
        ("provider_connection"."status" <> 'revoked'
         AND "provider_connection"."access_token_enc" ~ '^v[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
         AND split_part("provider_connection"."access_token_enc", ':', 1) = 'v' || "provider_connection"."key_version"::text
         AND ("provider_connection"."refresh_token_enc" IS NULL
              OR ("provider_connection"."refresh_token_enc" ~ '^v[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
                  AND split_part("provider_connection"."refresh_token_enc", ':', 1) = 'v' || "provider_connection"."key_version"::text))))
);
--> statement-breakpoint
ALTER TABLE "external_operation" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "github_owner" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "jira_cloud_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "jira_project_key" text;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD CONSTRAINT "provider_connection_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_operation" ADD CONSTRAINT "external_operation_connection_id_provider_provider_connection_id_provider_fk" FOREIGN KEY ("connection_id","provider") REFERENCES "public"."provider_connection"("id","provider") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_operation_connection" ON "external_operation" USING btree ("connection_id") WHERE "external_operation"."connection_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_jira_target_pair" CHECK (("project"."jira_cloud_id" IS NULL) = ("project"."jira_project_key" IS NULL));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_target_not_blank" CHECK (("project"."github_owner" IS NULL OR length(btrim("project"."github_owner")) > 0)
        AND ("project"."jira_cloud_id" IS NULL OR length(btrim("project"."jira_cloud_id")) > 0)
        AND ("project"."jira_project_key" IS NULL OR length(btrim("project"."jira_project_key")) > 0));