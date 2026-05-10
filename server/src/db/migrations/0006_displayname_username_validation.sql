ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_display_name_check";--> statement-breakpoint
WITH ranked_display_names AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY lower("display_name")
      ORDER BY "created_at" ASC, "id" ASC
    ) AS display_name_rank
  FROM "fillx_users"
  WHERE "display_name" IS NOT NULL
    AND "display_name" ~ '^[A-Za-z0-9_]{3,25}$'
),
display_names_to_clear AS (
  SELECT "id"
  FROM "fillx_users"
  WHERE "display_name" IS NOT NULL
    AND "display_name" !~ '^[A-Za-z0-9_]{3,25}$'
  UNION
  SELECT "id"
  FROM ranked_display_names
  WHERE display_name_rank > 1
)
UPDATE "fillx_users"
SET
  "display_name" = NULL,
  "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM display_names_to_clear);--> statement-breakpoint
ALTER TABLE "fillx_users" ADD CONSTRAINT "fillx_users_display_name_check" CHECK ("fillx_users"."display_name" is null or "fillx_users"."display_name" ~ '^[A-Za-z0-9_]{3,25}$');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fillx_users_display_name_lower_unique_idx" ON "fillx_users" USING btree (lower("display_name")) WHERE "display_name" IS NOT NULL;
