-- Lets one variation answer to more than one value of the same option, without
-- changing what svr_variant_values says it IS.
--
-- The case that asked for it: a chair whose seat and back are both black. Its back
-- both matches the seat and is black, so "Matching Back" and "Black Back" describe
-- the same chair and the same SKU. With one value per option a shopper who picked
-- the other one found black greyed out, because nothing carried that combination.
--
-- Why a table of its own rather than a second svr_variant_values row:
--
--   svr_variant_values IS the variation's identity everywhere else. Its sorted
--   value-set is the key the CSV importer matches on, the key the Google-Sheet
--   pull-diff compares against and the key the deletion planner asks about, and
--   the sheet carries exactly one value cell per option. A second row there would
--   read as a different combination to all three: the next Pull would find the
--   row's single value disagreeing with the stored pair and call setVariantValues
--   to "correct" it, quietly undoing the alias. Kept apart, the round-trip sees
--   precisely what it sees today and cannot flatten anything.
--
-- Read only by the storefront selector (lib/selection-logic.ts), which prefers an
-- exact value-set match and falls back to an alias only where no variation carries
-- the chosen combination outright. So an alias can never shadow a real variation -
-- it only fills a hole.
--
-- New numbered file rather than an edit to an applied one: editing a migration in
-- place only ever reaches fresh installs, never the sites already running.
-- Idempotent throughout, which keeps a re-run harmless.

CREATE TABLE IF NOT EXISTS "svr_variant_option_aliases" (
    "variant_id" TEXT NOT NULL,
    -- A value of an option on the SAME parent product that this variation also
    -- answers to. Not constrained to a different option from the one the variation
    -- already carries: the whole point is a second value of that same option.
    "option_value_id" TEXT NOT NULL,
    CONSTRAINT "svr_variant_option_aliases_pkey" PRIMARY KEY ("variant_id", "option_value_id"),
    CONSTRAINT "svr_variant_option_aliases_variant_id_fkey"
        FOREIGN KEY ("variant_id") REFERENCES "svr_variants"("id") ON DELETE CASCADE,
    CONSTRAINT "svr_variant_option_aliases_option_value_id_fkey"
        FOREIGN KEY ("option_value_id") REFERENCES "svr_option_values"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "svr_variant_option_aliases_variant_id_idx"
    ON "svr_variant_option_aliases" ("variant_id");
CREATE INDEX IF NOT EXISTS "svr_variant_option_aliases_option_value_id_idx"
    ON "svr_variant_option_aliases" ("option_value_id");
