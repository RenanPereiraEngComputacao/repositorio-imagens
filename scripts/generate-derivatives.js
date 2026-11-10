#!/usr/bin/env node
/**
 * Gera versões otimizadas (exibição + miniatura) e preenche metadados
 * (tamanho, dimensões, tipo) das imagens já existentes.
 *
 * NÃO altera, move nem apaga os arquivos originais. Pode ser executado várias vezes.
 *
 *   npm run images:derivatives               processa imagens sem derivados
 *   npm run images:derivatives -- --dry-run  só mostra o que seria feito
 */
const path = require('path');
const { pool } = require('../src/db');
const storage = require('../src/services/storage');
const { inspectImage, createDerivatives } = require('../src/services/image-processing');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { rows } = await pool.query(
    `SELECT id, file_path FROM product_images
      WHERE display_path IS NULL OR thumb_path IS NULL OR size_bytes IS NULL
      ORDER BY id`
  );
  console.log(`${rows.length} imagem(ns) para processar${dryRun ? ' (simulação)' : ''}.`);

  let ok = 0;
  let skipped = 0;
  for (const row of rows) {
    const safe = await storage.resolveSafeStoredFile(row.file_path);
    if (!safe) {
      skipped += 1;
      console.warn(`  ! #${row.id} arquivo ausente ou caminho inválido: ${row.file_path}`);
      continue;
    }
    if (dryRun) {
      ok += 1;
      continue;
    }
    try {
      const info = await inspectImage(safe.path);
      const parts = row.file_path.replace(/\\/g, '/').split('/');
      // file_path = imagens/<colecao>/<referencia>/<arquivo>
      const folder = path.dirname(storage.resolveStoredPath(row.file_path));
      const baseName = path.parse(parts[parts.length - 1]).name;
      const derivatives = await createDerivatives(safe.path, path.join(folder, storage.WEB_FOLDER), baseName);
      const relDisplay = path.relative(storage.uploadRoot(), derivatives.displayPath).split(path.sep);
      const relThumb = path.relative(storage.uploadRoot(), derivatives.thumbPath).split(path.sep);
      const toUrl = (segments) => `/imagens/${segments.map((s) => encodeURIComponent(s).replace(/%2E/g, '.')).join('/')}`;

      await pool.query(
        `UPDATE product_images
            SET mime_type = COALESCE(mime_type, $2), size_bytes = COALESCE(size_bytes, $3),
                width = COALESCE(width, $4), height = COALESCE(height, $5),
                display_path = $6, display_url = $7, thumb_path = $8, thumb_url = $9
          WHERE id = $1`,
        [row.id, info.mime, info.size, info.width || null, info.height || null,
          `imagens/${relDisplay.join('/')}`, toUrl(relDisplay), `imagens/${relThumb.join('/')}`, toUrl(relThumb)]
      );
      ok += 1;
      if (ok % 50 === 0) console.log(`  … ${ok} processada(s)`);
    } catch (error) {
      skipped += 1;
      console.warn(`  ! #${row.id} ${error.message}`);
    }
  }
  console.log(`✓ ${ok} processada(s), ${skipped} ignorada(s).`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
