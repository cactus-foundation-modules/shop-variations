-- Where a promoted variation's photo sits in the parent product's gallery.
--
-- 014 and 015 gave the owner two tick boxes on the Images tab: whether the
-- product's own photographs went behind the variations ticked "Image up front"
-- rather than in front of them, and whether a grid took its picture from the
-- first promoted variation. Two piles and a coin toss. It never let anyone say
-- "the oak one, then our two studio shots, then the walnut", which is what a
-- gallery actually is.
--
-- So the promoted variations now sit IN the Images grid alongside the product's
-- own pictures and are dragged about with them, and this column is where that
-- arrangement lives: the variation's index in the finished gallery, the parent's
-- own photographs and every promoted variation counted together. NULL means
-- "after the parent's own", which is where a newly promoted variation starts and
-- what every product looked like before any of this existed.
--
-- Read forgivingly rather than exactly (see lib/gallery-order.ts): a variation
-- that asked for slot 7 of a gallery that now holds four pictures lands at the
-- end instead of being stranded past it, so deleting one of the product's own
-- photographs shuffles the rest up rather than scrambling the order.
ALTER TABLE "svr_variants"
    ADD COLUMN IF NOT EXISTS "gallery_position" INTEGER;

-- Carry the old tick boxes over. Either flag being on meant "the promoted
-- variations lead", so their photos take the first slots in matrix order and the
-- product's own follow - which is exactly what those products already looked
-- like. Everything else keeps NULL and is untouched.
--
-- Guarded on the table still being there so this is safe to re-run, and so a
-- fresh install (where 014 built the table and nothing ever wrote to it) simply
-- updates nothing.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'svr_product_gallery') THEN
        UPDATE "svr_variants" AS v
        SET "gallery_position" = ranked."slot"
        FROM (
            SELECT
                sv."id",
                (ROW_NUMBER() OVER (PARTITION BY sv."product_id" ORDER BY sv."position" ASC, sv."created_at" ASC) - 1)::int AS "slot"
            FROM "svr_variants" sv
            JOIN "svr_product_gallery" g ON g."product_id" = sv."product_id"
            WHERE sv."show_image_in_gallery" = true
              AND (g."base_images_last" = true OR g."card_image_from_variation" = true)
        ) AS ranked
        WHERE v."id" = ranked."id" AND v."gallery_position" IS NULL;
    END IF;
END $$;

-- Nothing reads the flags any more, and a table of two dead booleans is a trap
-- for the next person: they would look like settings that still do something.
DROP TABLE IF EXISTS "svr_product_gallery";
