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
ALTER TABLE "fillx_wallet_sessions" ADD CONSTRAINT "fillx_wallet_sessions_family_id_fillx_session_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."fillx_session_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fillx_wallet_sessions" ADD CONSTRAINT "fillx_wallet_sessions_profile_user_id_fillx_users_id_fk" FOREIGN KEY ("profile_user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fillx_session_families_token_hash_idx" ON "fillx_session_families" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "fillx_session_families_expiry_idx" ON "fillx_session_families" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fillx_wallet_sessions_active_unique_idx" ON "fillx_wallet_sessions" USING btree ("family_id","wallet_key") WHERE "fillx_wallet_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "fillx_wallet_sessions_lookup_idx" ON "fillx_wallet_sessions" USING btree ("family_id","wallet_key","expires_at");--> statement-breakpoint
CREATE INDEX "fillx_wallet_sessions_expiry_idx" ON "fillx_wallet_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "wallet_sign_in_challenges_wallet_created_idx" ON "wallet_sign_in_challenges" USING btree ("wallet_key","created_at" DESC NULLS LAST);