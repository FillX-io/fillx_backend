CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE "fillx_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"username_status" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fillx_users_username_unique" UNIQUE("username"),
	CONSTRAINT "fillx_users_username_lowercase" CHECK ("fillx_users"."username" = lower("fillx_users"."username")),
	CONSTRAINT "fillx_users_username_status_check" CHECK ("fillx_users"."username_status" in ('generated', 'claimed')),
	CONSTRAINT "fillx_users_display_name_check" CHECK ("fillx_users"."display_name" is null or char_length("fillx_users"."display_name") <= 50)
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
CREATE TABLE "username_claim_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" text NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_type" text NOT NULL,
	"chain_id" integer,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "username_claim_challenges_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "username_claim_challenges_chain_type_check" CHECK ("username_claim_challenges"."chain_type" in ('evm', 'solana'))
);
--> statement-breakpoint
CREATE TABLE "username_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"username" text NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_type" text NOT NULL,
	"signature" text NOT NULL,
	"message_hash" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "username_claims_chain_type_check" CHECK ("username_claims"."chain_type" in ('evm', 'solana')),
	CONSTRAINT "username_claims_status_check" CHECK ("username_claims"."status" in ('accepted', 'rejected', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "user_auth_identities" ADD CONSTRAINT "user_auth_identities_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_orderly_accounts" ADD CONSTRAINT "user_orderly_accounts_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_claim_challenges" ADD CONSTRAINT "username_claim_challenges_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_claims" ADD CONSTRAINT "username_claims_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fillx_users_username_status_idx" ON "fillx_users" USING btree ("username_status");--> statement-breakpoint
CREATE INDEX "user_orderly_accounts_orderly_address_idx" ON "user_orderly_accounts" USING btree ("orderly_address");--> statement-breakpoint
CREATE INDEX "user_orderly_accounts_user_id_idx" ON "user_orderly_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_wallets_one_primary_per_user" ON "user_wallets" USING btree ("user_id") WHERE "user_wallets"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "username_claim_challenges_user_created_idx" ON "username_claim_challenges" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "username_claims_user_created_idx" ON "username_claims" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "username_claims_username_idx" ON "username_claims" USING btree ("username");
