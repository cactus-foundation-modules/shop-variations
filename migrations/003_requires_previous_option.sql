-- Adds the "reveal in order" flag to an option: when set, the storefront keeps
-- the option hidden until the option immediately before it has a value chosen,
-- so a shopper works through dependent options one step at a time.
--
-- Idempotent so it is safe to re-run, and fresh installs get the same column
-- straight from 001 - landing here on a harmless no-op.
ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "requires_previous_option" BOOLEAN NOT NULL DEFAULT false;
