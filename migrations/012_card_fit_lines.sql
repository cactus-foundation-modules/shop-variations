-- "Show as many values as fit" for an option's category-card summary.
--
-- card_limit (006) caps the values at a fixed COUNT. This adds the other way an
-- owner wants to say it: fill exactly N lines of the tile and no more, however
-- many values that turns out to be on whatever width the card is drawn at. The
-- browser does the counting, since only it knows the card's width; this column
-- just records the owner's choice of lines, 1 to 6. Null means the option stays
-- on the old rule (card_limit, or everything).
ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "card_fit_lines" INTEGER;
