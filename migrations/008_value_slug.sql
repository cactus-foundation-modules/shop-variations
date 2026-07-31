-- Adds a slug to every option value. The slug, not the label, is now the value's
-- identity within its option: two values may share a label ("Black" in MFC and
-- "Black" in fabric, told apart by their swatches) as long as their slugs differ
-- (black-mfc, black-fabric). The spreadsheet round-trip writes each value cell as
-- "(slug)Label" so a sheet can name either Black unambiguously.
--
-- All DDL here is idempotent so the file is safe to re-run, and 001 creates the
-- column for fresh installs - this file is the upgrade path for existing ones.

ALTER TABLE "svr_option_values" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- Backfill: slugify the label the same way lib/utils generateSlug does (lowercase,
-- strip anything that is not a-z 0-9 space or hyphen, spaces to hyphens, collapse
-- runs), then dedupe within each option by appending the duplicate's rank -
-- "black", "black-2", "black-3" - ordered by position so the visible order decides
-- who keeps the bare slug. Values that already have a slug (a re-run after a
-- partial failure, or rows written by new code before this file ran) are ranked
-- first but never rewritten.
WITH "base" AS (
    SELECT
        "id",
        "option_id",
        "position",
        "slug",
        COALESCE(
            NULLIF(
                trim(BOTH '-' FROM regexp_replace(regexp_replace(lower("label"), '[^a-z0-9\s-]', '', 'g'), '[\s-]+', '-', 'g')),
                ''
            ),
            'value'
        ) AS "b"
    FROM "svr_option_values"
),
"ranked" AS (
    SELECT
        "id",
        "slug",
        "b",
        ROW_NUMBER() OVER (
            PARTITION BY "option_id", "b"
            ORDER BY ("slug" IS NOT NULL) DESC, "position" ASC, "id" ASC
        ) AS "rn"
    FROM "base"
)
UPDATE "svr_option_values" v
SET "slug" = CASE WHEN r."rn" = 1 THEN r."b" ELSE r."b" || '-' || r."rn" END
FROM "ranked" r
WHERE v."id" = r."id" AND v."slug" IS NULL;

ALTER TABLE "svr_option_values" ALTER COLUMN "slug" SET NOT NULL;

-- Same name 001 uses for its inline UNIQUE constraint, so a fresh install (001
-- built the index) and an upgraded one (this file builds it) end up identical
-- and this CREATE is a no-op on the former.
CREATE UNIQUE INDEX IF NOT EXISTS "svr_option_values_option_id_slug_key" ON "svr_option_values" ("option_id", "slug");
