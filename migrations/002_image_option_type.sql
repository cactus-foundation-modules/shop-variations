-- Adds the IMAGE control type: a swatch that shows a picture rather than a
-- colour. The image url lives in the existing "swatch" column, which is already
-- TEXT and already means "whatever this control shows beside the label", so no
-- new column is needed - only the check constraint has to let the new type in.
--
-- Dropped and re-added rather than altered: Postgres has no ALTER CONSTRAINT for
-- a check expression, and IF EXISTS makes the pair safe to re-run. Fresh installs
-- get the four-value constraint straight from 001 and land here on a no-op.
ALTER TABLE "svr_options" DROP CONSTRAINT IF EXISTS "svr_options_control_type_check";
ALTER TABLE "svr_options" ADD CONSTRAINT "svr_options_control_type_check"
    CHECK ("control_type" IN ('DROPDOWN', 'SWATCH', 'PILL', 'IMAGE'));
