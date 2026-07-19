-- Lets an option (and each of its values) remember where it was built from, so
-- it can be refreshed against that source later. Deliberately generic: the
-- source is identified by the id of an extension-point provider plus an opaque
-- ref that only that provider understands. This module never learns what a ref
-- means, which keeps any source module (attributes today, something else later)
-- a plug-in rather than a dependency.
--
-- All three columns are nullable: a hand-typed option has no source and stays
-- that way. Idempotent, and mirrored into 001_initial.sql for fresh installs.

ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "source_provider" TEXT;
ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "source_ref" TEXT;
ALTER TABLE "svr_option_values" ADD COLUMN IF NOT EXISTS "source_ref" TEXT;

-- A refresh matches stored values to incoming source values by this pair, so it
-- is worth an index once a product has a few sourced options.
CREATE INDEX IF NOT EXISTS "svr_option_values_source_ref_idx" ON "svr_option_values" ("option_id", "source_ref");
