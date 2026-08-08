-- Whether this variation's own photo, and separately its 3D model, show on the
-- parent product's gallery before the shopper has chosen anything.
--
-- A variation's media has always been private to that variation: it appears
-- when the combination carrying it is settled on, and not a moment before. That
-- is the right default (splashing every finish up front tells a shopper nothing
-- about what they will actually get), but it leaves a range with one beige
-- catalogue photo on the parent and six handsome ones nobody sees until they
-- have already picked. These two flags let the owner promote a chosen few onto
-- the opening view, and drop them again the moment the shopper picks any option,
-- leaving only what they chose.
--
-- Two columns rather than one: a variation worth showing off for its photo is
-- not always the one worth leading with in 3D, and an owner may have one without
-- the other (a variation with no model at all still has a photo worth promoting;
-- a site with no 3D module installed has no use for the model flag at all).
--
-- Off by default, so every existing product looks exactly as it did.
--
-- New numbered file rather than an edit to 001: editing an applied migration in
-- place only ever reaches fresh installs, never the sites already running.
-- run-module-migrations.mjs applies this on every install's next deploy. 001 is
-- kept in step so a fresh install still builds the final shape in one go.
ALTER TABLE "svr_variants"
    ADD COLUMN IF NOT EXISTS "show_image_in_gallery" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "svr_variants"
    ADD COLUMN IF NOT EXISTS "show_model_in_gallery" BOOLEAN NOT NULL DEFAULT false;
