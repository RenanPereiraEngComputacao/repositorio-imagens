-- MÁLAGAH v2 — migração aditiva e não destrutiva.
-- Não remove nem altera colunas existentes; apenas adiciona estrutura nova.
-- Pode ser aplicada com o sistema antigo ainda em execução.

-- 1) Metadados das imagens (todas as colunas são opcionais; registros antigos continuam válidos)
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS original_name TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS mime_type VARCHAR(40);
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS height INTEGER;
-- Versões otimizadas para exibição (o arquivo em file_path permanece o original para download)
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS display_path TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS display_url TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS thumb_path TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS thumb_url TEXT;

CREATE INDEX IF NOT EXISTS product_images_created_at_idx ON product_images (created_at DESC);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON products (created_at DESC);
CREATE INDEX IF NOT EXISTS products_active_idx ON products (active);

-- 2) Auditoria
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor VARCHAR(160),
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40),
    entity_id BIGINT,
    summary TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip VARCHAR(64),
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);

-- 3) Lixeira — registros e arquivos removidos ficam recuperáveis
CREATE TABLE IF NOT EXISTS trash_entries (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(160),
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT NOT NULL,
    label TEXT NOT NULL,
    trash_dir TEXT NOT NULL,
    products_count INTEGER NOT NULL DEFAULT 0,
    images_count INTEGER NOT NULL DEFAULT 0,
    files_count INTEGER NOT NULL DEFAULT 0,
    bytes_total BIGINT NOT NULL DEFAULT 0,
    manifest JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'trashed',
    restored_at TIMESTAMPTZ,
    purged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS trash_entries_created_at_idx ON trash_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS trash_entries_status_idx ON trash_entries (status);
