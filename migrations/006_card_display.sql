-- Lets an option put a summary of its values on the product CARD (the tile in a
-- category grid or on the shop home), not just on the product page.
--
-- card_display is the switch, off everywhere until an owner turns it on per
-- option. card_label is the heading shown in front of the values there, which is
-- often shorter than the name the product page uses ("Colour" rather than "Seat
-- upholstery colour"); null falls back to the option's own name. card_limit caps
-- how many values are shown before the "+4" marker; null shows the lot.
ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "card_display" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "card_label" TEXT;
ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "card_limit" INTEGER;
