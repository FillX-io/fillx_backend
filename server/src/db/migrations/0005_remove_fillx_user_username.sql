DROP TABLE IF EXISTS "username_claims";
--> statement-breakpoint
DROP TABLE IF EXISTS "username_claim_challenges";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_username_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "fillx_users_username_status_idx";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_username_lowercase";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_username_status_check";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP COLUMN IF EXISTS "username";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP COLUMN IF EXISTS "username_status";
