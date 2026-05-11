CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
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
CREATE TABLE "fillx_session_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "fillx_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"avatar_key" text,
	"avatar_updated_at" timestamp with time zone,
	"nationality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fillx_users_display_name_check" CHECK ("fillx_users"."display_name" is null or "fillx_users"."display_name" ~ '^[A-Za-z0-9_]{3,25}$'),
	CONSTRAINT "fillx_users_nationality_check" CHECK ("fillx_users"."nationality" is null or "fillx_users"."nationality" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "fillx_wallet_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"wallet_key" text NOT NULL,
	"wallet_address" text NOT NULL,
	"wallet_namespace" text NOT NULL,
	"signature_scheme" text NOT NULL,
	"last_signed_chain" text,
	"signed_at" timestamp with time zone NOT NULL,
	"profile_user_id" uuid NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "fillx_wallet_sessions_wallet_namespace_check" CHECK ("fillx_wallet_sessions"."wallet_namespace" in ('evm', 'solana'))
);
--> statement-breakpoint
CREATE TABLE "user_auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_auth_identities_provider_user_unique" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "user_auth_identities_provider_check" CHECK ("user_auth_identities"."provider" in ('privy'))
);
--> statement-breakpoint
CREATE TABLE "user_orderly_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"orderly_account_id" text NOT NULL,
	"orderly_address" text NOT NULL,
	"broker_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_orderly_accounts_account_unique" UNIQUE("orderly_account_id")
);
--> statement-breakpoint
CREATE TABLE "user_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_type" text NOT NULL,
	"wallet_address" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_wallets_chain_wallet_unique" UNIQUE("chain_type","wallet_address"),
	CONSTRAINT "user_wallets_chain_type_check" CHECK ("user_wallets"."chain_type" in ('evm', 'solana'))
);
--> statement-breakpoint
CREATE TABLE "wallet_sign_in_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_key" text NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_type" text NOT NULL,
	"chain_id" integer,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_sign_in_challenges_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "wallet_sign_in_challenges_chain_type_check" CHECK ("wallet_sign_in_challenges"."chain_type" in ('evm', 'solana'))
);
--> statement-breakpoint
ALTER TABLE "fillx_avatar_uploads" ADD CONSTRAINT "fillx_avatar_uploads_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fillx_wallet_sessions" ADD CONSTRAINT "fillx_wallet_sessions_family_id_fillx_session_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."fillx_session_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fillx_wallet_sessions" ADD CONSTRAINT "fillx_wallet_sessions_profile_user_id_fillx_users_id_fk" FOREIGN KEY ("profile_user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_auth_identities" ADD CONSTRAINT "user_auth_identities_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_orderly_accounts" ADD CONSTRAINT "user_orderly_accounts_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fillx_avatar_uploads_user_status_idx" ON "fillx_avatar_uploads" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "fillx_avatar_uploads_expiry_idx" ON "fillx_avatar_uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fillx_session_families_token_hash_idx" ON "fillx_session_families" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "fillx_session_families_expiry_idx" ON "fillx_session_families" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fillx_users_display_name_lower_unique_idx" ON "fillx_users" USING btree (lower("display_name")) WHERE "fillx_users"."display_name" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fillx_wallet_sessions_active_unique_idx" ON "fillx_wallet_sessions" USING btree ("family_id","wallet_key") WHERE "fillx_wallet_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "fillx_wallet_sessions_lookup_idx" ON "fillx_wallet_sessions" USING btree ("family_id","wallet_key","expires_at");--> statement-breakpoint
CREATE INDEX "fillx_wallet_sessions_expiry_idx" ON "fillx_wallet_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_orderly_accounts_orderly_address_idx" ON "user_orderly_accounts" USING btree ("orderly_address");--> statement-breakpoint
CREATE INDEX "user_orderly_accounts_user_id_idx" ON "user_orderly_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_wallets_one_primary_per_user" ON "user_wallets" USING btree ("user_id") WHERE "user_wallets"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "wallet_sign_in_challenges_wallet_created_idx" ON "wallet_sign_in_challenges" USING btree ("wallet_key","created_at" DESC NULLS LAST);
