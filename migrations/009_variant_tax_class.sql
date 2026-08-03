-- Put every existing variation onto its parent listing's tax class.
--
-- A variation is a hidden child shp_products row, and shop rates a basket line
-- from the CHILD's tax class while the product page prices from the PARENT's.
-- The children only ever copied the class at the moment they were created, so a
-- shop that set up its VAT class after generating its matrices - or moved a
-- range onto a different class - has children carrying a stale or blank class,
-- and every one of those went into the basket with no VAT on it.
--
-- New code keeps the two in step on every save (see lib/tax-class-sync), so this
-- is the one-off catch-up for the rows already written. Idempotent by
-- construction: it only touches children that disagree with their parent, so a
-- re-run after a partial failure moves nothing and a fresh install matches
-- nothing at all.
--
-- Deliberately one-directional: the parent is the answer. A per-variation class
-- was never selectable in the editor, so any child that differs is drift, not a
-- decision someone made.

UPDATE "shp_products" AS c
SET "tax_class_id" = p."tax_class_id", "updated_at" = CURRENT_TIMESTAMP
FROM "svr_variants" v
JOIN "shp_products" p ON p."id" = v."product_id"
WHERE c."id" = v."child_product_id"
  AND c."tax_class_id" IS DISTINCT FROM p."tax_class_id";
