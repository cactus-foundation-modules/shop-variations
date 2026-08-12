-- Per-product gallery ordering: whether the product's OWN photographs sit behind
-- the promoted variations' ones rather than in front of them.
--
-- The rule until now was fixed: the product's own pictures lead, and any
-- variation marked "Image up front" follows. That is right for a range built
-- around one hero photograph, and wrong for one where the product's own pictures
-- are line drawings, dimensions or a bare white cut-out and the variations are
-- the handsome shots. This lets the owner say which way round it goes, per
-- product, from the product's Images tab.
--
-- Its own table rather than a column on shp_products: that table belongs to the
-- shop module, which knows nothing of variations and must not carry a flag that
-- only means something once this module is installed.
--
-- A row exists only for a product whose owner has turned this on (the writer
-- deletes the row when it goes back off), so "no row" is the default and no
-- backfill is needed - every existing product looks exactly as it did.
CREATE TABLE IF NOT EXISTS "svr_product_gallery" (
    "product_id" TEXT NOT NULL,
    "base_images_last" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "svr_product_gallery_pkey" PRIMARY KEY ("product_id"),
    CONSTRAINT "svr_product_gallery_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE
);
