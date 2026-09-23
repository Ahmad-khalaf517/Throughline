CREATE TABLE "ai_generation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"artifact_version_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_generation_run_purpose_check" CHECK ("ai_generation_run"."purpose" IN ('generation','semantic_mapping','revision','quality_check')),
	CONSTRAINT "ai_generation_run_status_check" CHECK ("ai_generation_run"."status" IN ('succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "approval_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"feedback" text,
	"overrode_stale_check" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_event_action_check" CHECK ("approval_event"."action" IN ('approved','revision_requested','rejected','draft_replaced')),
	CONSTRAINT "approval_event_override_requires_note_check" CHECK (NOT "approval_event"."overrode_stale_check" OR ("approval_event"."action" = 'approved' AND "approval_event"."feedback" IS NOT NULL AND btrim("approval_event"."feedback") <> ''))
);
--> statement-breakpoint
CREATE TABLE "artifact_version_item_membership" (
	"artifact_version_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"logical_item_id" uuid NOT NULL,
	"item_version_id" uuid NOT NULL,
	"parent_logical_item_id" uuid,
	"position" integer,
	CONSTRAINT "artifact_version_item_membership_artifact_version_id_item_version_id_pk" PRIMARY KEY("artifact_version_id","item_version_id"),
	CONSTRAINT "artifact_version_item_membership_artifact_version_id_logical_item_id_unique" UNIQUE("artifact_version_id","logical_item_id"),
	CONSTRAINT "artifact_version_item_membership_parent_not_self_check" CHECK ("artifact_version_item_membership"."parent_logical_item_id" IS DISTINCT FROM "artifact_version_item_membership"."logical_item_id")
);
--> statement-breakpoint
CREATE TABLE "architecture_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"option_key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"stack" jsonb NOT NULL,
	"candidate_decisions" jsonb NOT NULL,
	"tradeoffs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "architecture_option_artifact_version_id_option_key_unique" UNIQUE("artifact_version_id","option_key"),
	CONSTRAINT "architecture_option_id_artifact_version_id_unique" UNIQUE("id","artifact_version_id"),
	CONSTRAINT "architecture_option_option_key_check" CHECK ("architecture_option"."option_key" IN ('A','B'))
);
--> statement-breakpoint
CREATE TABLE "artifact_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text NOT NULL,
	"schema_version" integer NOT NULL,
	"base_approved_version_id" uuid,
	"selected_architecture_option_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_output" jsonb,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_version_artifact_id_version_number_unique" UNIQUE("artifact_id","version_number"),
	CONSTRAINT "artifact_version_id_artifact_id_unique" UNIQUE("id","artifact_id"),
	CONSTRAINT "artifact_version_version_number_check" CHECK ("artifact_version"."version_number" > 0),
	CONSTRAINT "artifact_version_status_check" CHECK ("artifact_version"."status" IN ('draft','approved','superseded','rejected')),
	CONSTRAINT "artifact_version_status_reason_check" CHECK ("artifact_version"."status_reason" IN ('revision_requested','user_rejected','replaced_by_regeneration','stale_generation_context')),
	CONSTRAINT "artifact_version_base_approved_not_self_check" CHECK ("artifact_version"."base_approved_version_id" IS DISTINCT FROM "artifact_version"."id"),
	CONSTRAINT "artifact_version_rejected_has_reason_check" CHECK (("artifact_version"."status" = 'rejected') = ("artifact_version"."status_reason" IS NOT NULL)),
	CONSTRAINT "artifact_version_option_requires_approved_check" CHECK ("artifact_version"."selected_architecture_option_id" IS NULL OR "artifact_version"."status" IN ('approved','superseded')),
	CONSTRAINT "artifact_version_stale_has_raw_output_check" CHECK (("artifact_version"."status_reason" IS NOT DISTINCT FROM 'stale_generation_context') = ("artifact_version"."raw_output" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_project_id_type_unique" UNIQUE("project_id","type"),
	CONSTRAINT "artifact_id_project_id_unique" UNIQUE("id","project_id"),
	CONSTRAINT "artifact_type_check" CHECK ("artifact"."type" IN ('requirements','architecture','ui_requirements','backlog'))
);
--> statement-breakpoint
CREATE TABLE "external_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"operation_type" text NOT NULL,
	"operation_key" text NOT NULL,
	"status" text NOT NULL,
	"request_hash" text NOT NULL,
	"source_artifact_version_id" uuid NOT NULL,
	"source_item_version_id" uuid,
	"target_descriptor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_operation_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "external_operation_status_check" CHECK ("external_operation"."status" IN ('pending','completed','failed','reconciliation_required')),
	CONSTRAINT "external_operation_provider_check" CHECK ("external_operation"."provider" IN ('github','jira','stitch')),
	CONSTRAINT "external_operation_completed_has_external_id_check" CHECK ("external_operation"."status" <> 'completed' OR "external_operation"."external_id" IS NOT NULL),
	CONSTRAINT "external_operation_jira_requires_item_check" CHECK (("external_operation"."provider" = 'jira') = ("external_operation"."source_item_version_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "external_ref" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_key" text,
	"external_url" text,
	"source_artifact_version_id" uuid NOT NULL,
	"source_item_version_id" uuid,
	"external_operation_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_ref_external_operation_id_unique" UNIQUE("external_operation_id"),
	CONSTRAINT "external_ref_provider_external_id_unique" UNIQUE("provider","external_id"),
	CONSTRAINT "external_ref_provider_check" CHECK ("external_ref"."provider" IN ('github','jira','stitch')),
	CONSTRAINT "external_ref_jira_requires_item_check" CHECK (("external_ref"."provider" = 'jira') = ("external_ref"."source_item_version_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "generation_context_ref" (
	"target_artifact_version_id" uuid NOT NULL,
	"source_artifact_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_context_ref_target_artifact_version_id_source_artifact_version_id_pk" PRIMARY KEY("target_artifact_version_id","source_artifact_version_id"),
	CONSTRAINT "generation_context_ref_target_not_source_check" CHECK ("generation_context_ref"."target_artifact_version_id" <> "generation_context_ref"."source_artifact_version_id")
);
--> statement-breakpoint
CREATE TABLE "impact_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_item_version_id" uuid,
	"subject_external_ref_id" uuid,
	"root_logical_item_id" uuid NOT NULL,
	"obsolete_upstream_item_version_id" uuid NOT NULL,
	"acknowledged_against_upstream_item_version_id" uuid,
	"acknowledged_by_user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "impact_acknowledgement_exactly_one_subject_check" CHECK (num_nonnulls("impact_acknowledgement"."subject_item_version_id", "impact_acknowledgement"."subject_external_ref_id") = 1),
	CONSTRAINT "impact_acknowledgement_obsolete_not_against_check" CHECK ("impact_acknowledgement"."obsolete_upstream_item_version_id" IS DISTINCT FROM "impact_acknowledgement"."acknowledged_against_upstream_item_version_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brief" text NOT NULL,
	"input_context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logical_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"display_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logical_item_project_id_display_key_unique" UNIQUE("project_id","display_key"),
	CONSTRAINT "logical_item_id_artifact_id_unique" UNIQUE("id","artifact_id"),
	CONSTRAINT "logical_item_id_project_id_unique" UNIQUE("id","project_id"),
	CONSTRAINT "logical_item_item_type_check" CHECK ("logical_item"."item_type" IN ('requirement','architecture_decision','ui_requirement','epic','story')),
	CONSTRAINT "logical_item_display_key_format_check" CHECK (("logical_item"."item_type" = 'requirement'           AND "logical_item"."display_key" ~ '^R-[0-9]{2,}$')   OR
          ("logical_item"."item_type" = 'architecture_decision' AND "logical_item"."display_key" ~ '^ADR-[0-9]{2,}$') OR
          ("logical_item"."item_type" = 'ui_requirement'        AND "logical_item"."display_key" ~ '^UI-[0-9]{2,}$')  OR
          ("logical_item"."item_type" = 'epic'                  AND "logical_item"."display_key" ~ '^E-[0-9]{2,}$')   OR
          ("logical_item"."item_type" = 'story'                 AND "logical_item"."display_key" ~ '^S-[0-9]{2,}$'))
);
--> statement-breakpoint
CREATE TABLE "item_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"logical_item_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"semantic_hash" text NOT NULL,
	"semantic_hash_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_version_logical_item_id_revision_number_unique" UNIQUE("logical_item_id","revision_number"),
	CONSTRAINT "item_version_id_logical_item_id_unique" UNIQUE("id","logical_item_id"),
	CONSTRAINT "item_version_id_project_id_unique" UNIQUE("id","project_id"),
	CONSTRAINT "item_version_revision_number_check" CHECK ("item_version"."revision_number" > 0),
	CONSTRAINT "item_version_semantic_hash_check" CHECK ("item_version"."semantic_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "semantic_dependency" (
	"project_id" uuid NOT NULL,
	"downstream_item_version_id" uuid NOT NULL,
	"upstream_item_version_id" uuid NOT NULL,
	"proposed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semantic_dependency_downstream_item_version_id_upstream_item_version_id_pk" PRIMARY KEY("downstream_item_version_id","upstream_item_version_id"),
	CONSTRAINT "semantic_dependency_downstream_not_upstream_check" CHECK ("semantic_dependency"."downstream_item_version_id" <> "semantic_dependency"."upstream_item_version_id"),
	CONSTRAINT "semantic_dependency_proposed_by_check" CHECK ("semantic_dependency"."proposed_by" IN ('ai','system','user'))
);
--> statement-breakpoint
CREATE TABLE "stitch_output" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_ui_requirements_version_id" uuid NOT NULL,
	"external_ref_id" uuid,
	"mode" text NOT NULL,
	"prompt_text" text NOT NULL,
	"html_storage_key" text,
	"html_checksum" text,
	"screenshot_storage_key" text,
	"screenshot_checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stitch_output_source_ui_requirements_version_id_unique" UNIQUE("source_ui_requirements_version_id"),
	CONSTRAINT "stitch_output_mode_check" CHECK ("stitch_output"."mode" IN ('api','manual_fallback')),
	CONSTRAINT "stitch_output_api_requires_ref_check" CHECK (("stitch_output"."mode" = 'api') = ("stitch_output"."external_ref_id" IS NOT NULL)),
	CONSTRAINT "stitch_output_html_pair_check" CHECK (("stitch_output"."html_storage_key" IS NULL) = ("stitch_output"."html_checksum" IS NULL)),
	CONSTRAINT "stitch_output_screenshot_pair_check" CHECK (("stitch_output"."screenshot_storage_key" IS NULL) = ("stitch_output"."screenshot_checksum" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ai_generation_run" ADD CONSTRAINT "ai_generation_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_run" ADD CONSTRAINT "ai_generation_run_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_item_membership" ADD CONSTRAINT "artifact_version_item_membership_artifact_version_id_artifact_id_artifact_version_id_artifact_id_fk" FOREIGN KEY ("artifact_version_id","artifact_id") REFERENCES "public"."artifact_version"("id","artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_item_membership" ADD CONSTRAINT "artifact_version_item_membership_logical_item_id_artifact_id_logical_item_id_artifact_id_fk" FOREIGN KEY ("logical_item_id","artifact_id") REFERENCES "public"."logical_item"("id","artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_item_membership" ADD CONSTRAINT "artifact_version_item_membership_item_version_id_logical_item_id_item_version_id_logical_item_id_fk" FOREIGN KEY ("item_version_id","logical_item_id") REFERENCES "public"."item_version"("id","logical_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_item_membership" ADD CONSTRAINT "artifact_version_item_membership_artifact_version_id_parent_logical_item_id_artifact_version_item_membership_artifact_version_id_logical_item_id_fk" FOREIGN KEY ("artifact_version_id","parent_logical_item_id") REFERENCES "public"."artifact_version_item_membership"("artifact_version_id","logical_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_option" ADD CONSTRAINT "architecture_option_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_base_approved_version_id_artifact_id_artifact_version_id_artifact_id_fk" FOREIGN KEY ("base_approved_version_id","artifact_id") REFERENCES "public"."artifact_version"("id","artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_selected_architecture_option_id_id_architecture_option_id_artifact_version_id_fk" FOREIGN KEY ("selected_architecture_option_id","id") REFERENCES "public"."architecture_option"("id","artifact_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_operation" ADD CONSTRAINT "external_operation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_operation" ADD CONSTRAINT "external_operation_source_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("source_artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_operation" ADD CONSTRAINT "external_operation_source_artifact_version_id_source_item_version_id_artifact_version_item_membership_artifact_version_id_item_version_id_fk" FOREIGN KEY ("source_artifact_version_id","source_item_version_id") REFERENCES "public"."artifact_version_item_membership"("artifact_version_id","item_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ref" ADD CONSTRAINT "external_ref_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ref" ADD CONSTRAINT "external_ref_source_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("source_artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ref" ADD CONSTRAINT "external_ref_external_operation_id_external_operation_id_fk" FOREIGN KEY ("external_operation_id") REFERENCES "public"."external_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ref" ADD CONSTRAINT "external_ref_source_artifact_version_id_source_item_version_id_artifact_version_item_membership_artifact_version_id_item_version_id_fk" FOREIGN KEY ("source_artifact_version_id","source_item_version_id") REFERENCES "public"."artifact_version_item_membership"("artifact_version_id","item_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_context_ref" ADD CONSTRAINT "generation_context_ref_target_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("target_artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_context_ref" ADD CONSTRAINT "generation_context_ref_source_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("source_artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_acknowledgement" ADD CONSTRAINT "impact_acknowledgement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_acknowledgement" ADD CONSTRAINT "impact_acknowledgement_subject_item_version_id_item_version_id_fk" FOREIGN KEY ("subject_item_version_id") REFERENCES "public"."item_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_acknowledgement" ADD CONSTRAINT "impact_acknowledgement_subject_external_ref_id_external_ref_id_fk" FOREIGN KEY ("subject_external_ref_id") REFERENCES "public"."external_ref"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_acknowledgement" ADD CONSTRAINT "impact_acknowledgement_acknowledged_by_user_id_app_user_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_acknowledgement" ADD CONSTRAINT "impact_acknowledgement_obsolete_upstream_item_version_id_root_logical_item_id_item_version_id_logical_item_id_fk" FOREIGN KEY ("obsolete_upstream_item_version_id","root_logical_item_id") REFERENCES "public"."item_version"("id","logical_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_acknowledgement" ADD CONSTRAINT "impact_acknowledgement_acknowledged_against_upstream_item_version_id_root_logical_item_id_item_version_id_logical_item_id_fk" FOREIGN KEY ("acknowledged_against_upstream_item_version_id","root_logical_item_id") REFERENCES "public"."item_version"("id","logical_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_item" ADD CONSTRAINT "logical_item_artifact_id_project_id_artifact_id_project_id_fk" FOREIGN KEY ("artifact_id","project_id") REFERENCES "public"."artifact"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_version" ADD CONSTRAINT "item_version_logical_item_id_project_id_logical_item_id_project_id_fk" FOREIGN KEY ("logical_item_id","project_id") REFERENCES "public"."logical_item"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_dependency" ADD CONSTRAINT "semantic_dependency_downstream_item_version_id_project_id_item_version_id_project_id_fk" FOREIGN KEY ("downstream_item_version_id","project_id") REFERENCES "public"."item_version"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_dependency" ADD CONSTRAINT "semantic_dependency_upstream_item_version_id_project_id_item_version_id_project_id_fk" FOREIGN KEY ("upstream_item_version_id","project_id") REFERENCES "public"."item_version"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stitch_output" ADD CONSTRAINT "stitch_output_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stitch_output" ADD CONSTRAINT "stitch_output_source_ui_requirements_version_id_artifact_version_id_fk" FOREIGN KEY ("source_ui_requirements_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stitch_output" ADD CONSTRAINT "stitch_output_external_ref_id_external_ref_id_fk" FOREIGN KEY ("external_ref_id") REFERENCES "public"."external_ref"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_generation_run_version" ON "ai_generation_run" USING btree ("artifact_version_id");--> statement-breakpoint
CREATE INDEX "ai_generation_run_project" ON "ai_generation_run" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_approval_event" ON "approval_event" USING btree ("artifact_version_id") WHERE "approval_event"."action" = 'approved';--> statement-breakpoint
CREATE INDEX "approval_event_version_time" ON "approval_event" USING btree ("artifact_version_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_item_version" ON "artifact_version_item_membership" USING btree ("item_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_approved_version" ON "artifact_version" USING btree ("artifact_id") WHERE "artifact_version"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "one_draft_version" ON "artifact_version" USING btree ("artifact_id") WHERE "artifact_version"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "one_github_ref_per_project" ON "external_ref" USING btree ("project_id") WHERE "external_ref"."provider" = 'github';--> statement-breakpoint
CREATE INDEX "external_ref_source_item" ON "external_ref" USING btree ("source_item_version_id");--> statement-breakpoint
CREATE INDEX "external_ref_source_version" ON "external_ref" USING btree ("source_artifact_version_id");--> statement-breakpoint
CREATE INDEX "semantic_dependency_upstream" ON "semantic_dependency" USING btree ("upstream_item_version_id");