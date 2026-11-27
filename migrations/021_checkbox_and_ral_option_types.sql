-- Two new control types, and one note to go with the second.
--
-- CHECKBOX: a tick box for a yes-or-nothing extra (a power module, a headrest).
-- Still an ordinary two-value option underneath - one value meaning "without",
-- the other the extra.
--
-- RAL: a paint colour picked from the RAL Classic chart. The owner's suggested
-- colours are ordinary values ("RAL 7016 Anthracite grey"); a value labelled
-- "Custom RAL" offers the rest of the chart, and the code the shopper settles on
-- rides on the order line rather than being a value of its own.
--
-- The constraint is dropped and re-added rather than altered, as 002 did:
-- Postgres has no ALTER CONSTRAINT for a check expression, and IF EXISTS makes
-- the pair safe to re-run. Fresh installs get all of this from 001 and land here
-- on a no-op.
ALTER TABLE "svr_options" DROP CONSTRAINT IF EXISTS "svr_options_control_type_check";
ALTER TABLE "svr_options" ADD CONSTRAINT "svr_options_control_type_check"
    CHECK ("control_type" IN ('DROPDOWN', 'SWATCH', 'PILL', 'IMAGE', 'CHECKBOX', 'RAL'));

-- A line of the owner's own words shown with an option's custom choice - "adds
-- five working days", say. NULL shows nothing. Only the RAL type reads it today.
ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "custom_note" TEXT;
