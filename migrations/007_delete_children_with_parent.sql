-- Deleting a variations parent product used to strand its variant child
-- products. The parent's shp_products delete cascades the svr_variants rows
-- away (product_id FK), but the hidden children are ordinary shp_products rows
-- the shop module owns - no module code runs on shop's own delete path, so they
-- stayed behind: ACTIVE, catalogue-hidden, and still holding their SKUs and
-- slugs, which then blocked those SKUs for every future import (seen live
-- 2026-07-30: ten orphaned OSL02xx children left by a removed boardroom table).
--
-- Fix at the only layer that observes the cascade: a row trigger on
-- svr_variants. When a variant row is deleted, delete its child product too.
--
-- Every module code path already deletes the CHILD product first and lets the
-- child_product_id FK cascade remove the variant row; for those, this trigger
-- re-deletes a row the same transaction has already removed, which matches
-- nothing and is a no-op. The new work happens only on the path module code
-- never sees: the PARENT's delete cascading svr_variants away, where the child
-- is still live and now goes with it. No path deletes an svr_variants row while
-- meaning to keep its child, so the trigger is safe to fire unconditionally.
--
-- TRUNCATE (backup restore) does not fire row triggers, so a restore's
-- table-by-table load is unaffected.
CREATE OR REPLACE FUNCTION svr_delete_variant_child() RETURNS trigger AS $$
BEGIN
  DELETE FROM "shp_products" WHERE "id" = OLD."child_product_id";
  RETURN OLD;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS svr_variants_delete_child ON "svr_variants";
CREATE TRIGGER svr_variants_delete_child
  AFTER DELETE ON "svr_variants"
  FOR EACH ROW EXECUTE FUNCTION svr_delete_variant_child();
