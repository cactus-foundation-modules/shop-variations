-- shop-variations schema. Every table is prefixed svr_ and all DDL is idempotent
-- (IF NOT EXISTS) so this file is both the fresh-install schema and safe to
-- re-run. Later schema changes ship as new numbered files (002_*.sql, ...).
--
-- The variant child products themselves are ordinary (hidden) shp_products rows
-- owned by the shop module; the tables here only map parents to those children
-- and describe the options/add-ons. Cross-module foreign keys to shp_products are
-- safe because shop installs before shop-variations (requiresModules), so the
-- referenced tables always exist first.

-- An option on a parent product, e.g. "Size" or "Colour".
CREATE TABLE IF NOT EXISTS "svr_options" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "control_type" TEXT NOT NULL DEFAULT 'DROPDOWN',
    "position" INTEGER NOT NULL DEFAULT 0,
    -- When true the storefront keeps this option hidden until the option before
    -- it (by position) has a value chosen, so dependent options reveal in order.
    -- Dormant on the first option, which has nothing before it to wait on.
    "requires_previous_option" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "svr_options_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "svr_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "svr_options_control_type_check" CHECK ("control_type" IN ('DROPDOWN', 'SWATCH', 'PILL', 'IMAGE'))
);
CREATE INDEX IF NOT EXISTS "svr_options_product_id_idx" ON "svr_options" ("product_id");

-- A value of an option, e.g. "XL" or "Red". swatch holds a hex colour for SWATCH
-- controls and an image url for IMAGE ones; null otherwise.
CREATE TABLE IF NOT EXISTS "svr_option_values" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "option_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "swatch" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "svr_option_values_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "svr_option_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "svr_options"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "svr_option_values_option_id_idx" ON "svr_option_values" ("option_id");

-- One concrete combination of option values, mapped to the hidden child
-- shp_products row that carries its price/SKU/stock/weight/image.
CREATE TABLE IF NOT EXISTS "svr_variants" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "product_id" TEXT NOT NULL,
    "child_product_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "svr_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "svr_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "svr_variants_child_product_id_fkey" FOREIGN KEY ("child_product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "svr_variants_child_product_id_key" UNIQUE ("child_product_id")
);
CREATE INDEX IF NOT EXISTS "svr_variants_product_id_idx" ON "svr_variants" ("product_id");

-- Which option-values make up a variant (a composite of one value per option).
CREATE TABLE IF NOT EXISTS "svr_variant_values" (
    "variant_id" TEXT NOT NULL,
    "option_value_id" TEXT NOT NULL,
    CONSTRAINT "svr_variant_values_pkey" PRIMARY KEY ("variant_id", "option_value_id"),
    CONSTRAINT "svr_variant_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "svr_variants"("id") ON DELETE CASCADE,
    CONSTRAINT "svr_variant_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "svr_option_values"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "svr_variant_values_option_value_id_idx" ON "svr_variant_values" ("option_value_id");

-- A personalisation add-on field on a product. config JSONB holds the type's
-- extra settings: max length, min/max, priced choices, flat price, per-character
-- price, file limits.
CREATE TABLE IF NOT EXISTS "svr_addons" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "product_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "svr_addons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "svr_addons_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "svr_addons_type_check" CHECK ("type" IN ('TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'CHECKBOX', 'DATE', 'FILE'))
);
CREATE INDEX IF NOT EXISTS "svr_addons_product_id_idx" ON "svr_addons" ("product_id");

-- Tracks personalisation file uploads for GDPR export and orphan cleanup.
-- order_item_id is intentionally NOT a foreign key: an upload is recorded before
-- the order exists, and order items live in the shop module. Orphans (never
-- attached to an order within the retention window) are pruned by cron.
CREATE TABLE IF NOT EXISTS "svr_uploads" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "token" TEXT NOT NULL,
    -- Public url of the stored file (used as the download href in line_meta).
    "media_ref" TEXT NOT NULL,
    -- Provider + storage key, kept so orphan cleanup can delete the blob itself.
    "media_provider" TEXT,
    "media_key" TEXT,
    "filename" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "mime_type" TEXT NOT NULL,
    "order_item_id" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "svr_uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "svr_uploads_token_key" UNIQUE ("token")
);
CREATE INDEX IF NOT EXISTS "svr_uploads_order_item_id_idx" ON "svr_uploads" ("order_item_id");
CREATE INDEX IF NOT EXISTS "svr_uploads_created_at_idx" ON "svr_uploads" ("created_at");

-- Module settings (single row). Upload limits and the orphan-upload retention
-- window; max_variants caps runaway matrix generation.
CREATE TABLE IF NOT EXISTS "svr_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "max_upload_mb" INTEGER NOT NULL DEFAULT 10,
    "allowed_upload_types" TEXT NOT NULL DEFAULT 'image/png,image/jpeg,image/webp,application/pdf',
    "upload_retention_days" INTEGER NOT NULL DEFAULT 30,
    "max_variants" INTEGER NOT NULL DEFAULT 200,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "svr_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "svr_settings_singleton_check" CHECK ("id" = 'singleton')
);
INSERT INTO "svr_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
