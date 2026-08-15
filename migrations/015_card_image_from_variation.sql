-- Per-product gallery ordering, second flag: whether the picture a product shows
-- on a CATEGORY page (and every other grid - search, related, featured) is the
-- photo of the first variation ticked "Image up front", instead of the product's
-- own primary.
--
-- 014 let the owner say which way round the two sets go on the product page. The
-- same product looked untouched in a grid, where the parent's own primary still
-- led - so a range whose own shots are line drawings or a bare cut-out read as a
-- handsome product page reached from a dull tile. This is the grid's half of the
-- same decision, kept separate because the two are genuinely independent: an
-- owner may want the variation leading the tile and the parent's own gallery
-- leading the page.
--
-- Same table, same rule as 014: a row exists only while at least one flag is on,
-- and the writer deletes it when the last one goes off - so "no row" stays the
-- default and no backfill is needed.
ALTER TABLE "svr_product_gallery"
    ADD COLUMN IF NOT EXISTS "card_image_from_variation" BOOLEAN NOT NULL DEFAULT false;
