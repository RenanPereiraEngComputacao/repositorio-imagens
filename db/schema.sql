CREATE TABLE IF NOT EXISTS collections (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(160) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
    reference VARCHAR(120) NOT NULL,
    name VARCHAR(180),
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_reference_unique_lower
    ON products (LOWER(reference));

CREATE INDEX IF NOT EXISTS products_collection_id_idx
    ON products (collection_id);

CREATE TABLE IF NOT EXISTS product_images (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_main BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_images_product_order_idx
    ON product_images (product_id, display_order, id);

CREATE UNIQUE INDEX IF NOT EXISTS product_images_one_main_per_product
    ON product_images (product_id)
    WHERE is_main = TRUE;

CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'session_pkey'
    ) THEN
        ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS collections_set_updated_at ON collections;
CREATE TRIGGER collections_set_updated_at
BEFORE UPDATE ON collections
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
