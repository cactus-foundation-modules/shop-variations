-- Records that an option's name was deliberately chosen rather than inherited
-- from its source.
--
-- The same source (an attribute, say) can now be added to one product more than
-- once - a chair with a frame colour and a seat colour comes from one Colour
-- attribute twice - and since two options on a product may not share a name, all
-- but one of those copies has to carry a name of its own. Without this flag a
-- refresh would then report "the source now calls this Colour" every single time,
-- for a name the owner picked on purpose, which is exactly the nagging an
-- override is supposed to stop.
--
-- Idempotent, and mirrored into 001_initial.sql for fresh installs. Existing
-- rows default to false: nothing here knows what the source was called when they
-- were made, and a false reading only means the first refresh mentions the
-- difference once, which is what it did before this column existed.

ALTER TABLE "svr_options" ADD COLUMN IF NOT EXISTS "name_overridden" BOOLEAN NOT NULL DEFAULT false;
