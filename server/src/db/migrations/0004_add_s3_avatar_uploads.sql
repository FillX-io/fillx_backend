CREATE TABLE "fillx_avatar_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"incoming_bucket" text NOT NULL,
	"incoming_key" text NOT NULL,
	"source_content_type" text NOT NULL,
	"source_content_length" integer NOT NULL,
	"status" text NOT NULL,
	"public_bucket" text,
	"public_key" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "fillx_avatar_uploads_status_check" CHECK ("fillx_avatar_uploads"."status" in ('pending', 'finalized', 'failed', 'expired')),
	CONSTRAINT "fillx_avatar_uploads_source_length_check" CHECK ("fillx_avatar_uploads"."source_content_length" > 0)
);
--> statement-breakpoint
ALTER TABLE "fillx_users" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "fillx_users" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fillx_avatar_uploads" ADD CONSTRAINT "fillx_avatar_uploads_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fillx_avatar_uploads_user_status_idx" ON "fillx_avatar_uploads" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "fillx_avatar_uploads_expiry_idx" ON "fillx_avatar_uploads" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "fillx_users" DROP COLUMN "avatar_url";