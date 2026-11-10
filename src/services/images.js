const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { transaction } = require('../db');
const storage = require('./storage');
const { inspectImage, createDerivatives } = require('./image-processing');
const { safeFilename } = require('../utils/text');
const { AppError } = require('../utils/errors');

function makeStoredName(originalName, ext) {
  const base = safeFilename(path.parse(String(originalName || 'imagem')).name);
  const suffix = crypto.randomBytes(5).toString('hex');
  return `${Date.now()}-${suffix}-${base}${ext}`;
}

/** Melhor URL para exibir: versão otimizada > original (registros antigos). */
function displayUrl(image) {
  return image.display_url || image.file_url;
}

function thumbUrl(image) {
  return image.thumb_url || image.display_url || image.file_url;
}

/**
 * Valida, armazena e registra as imagens enviadas para um produto.
 * Cada arquivo é tratado isoladamente: falhas individuais não derrubam o lote.
 * Os registros válidos são inseridos em uma única transação; se ela falhar,
 * os arquivos já gravados são removidos para não deixar órfãos.
 */
async function storeUploadedImages(product, files) {
  const results = [];
  const prepared = [];
  const folder = storage.getImageFolder(product.collection_slug, product.reference);

  for (const file of files) {
    const original = file.originalname;
    try {
      const info = await inspectImage(file.path);
      const storedName = makeStoredName(original, info.ext);
      const finalPath = path.join(folder, storedName);
      await storage.moveFile(file.path, finalPath);

      const baseName = path.parse(storedName).name;
      const webFolder = path.join(folder, storage.WEB_FOLDER);
      let derivatives = null;
      try {
        derivatives = await createDerivatives(finalPath, webFolder, baseName);
      } catch (error) {
        console.error('[images] falha ao gerar derivados:', error.message);
      }

      const originalData = storage.getPublicImageData(product.collection_slug, product.reference, storedName);
      const displayData = derivatives
        ? storage.getPublicImageData(product.collection_slug, product.reference, path.basename(derivatives.displayPath), storage.WEB_FOLDER)
        : null;
      const thumbData = derivatives
        ? storage.getPublicImageData(product.collection_slug, product.reference, path.basename(derivatives.thumbPath), storage.WEB_FOLDER)
        : null;

      prepared.push({
        originalName: String(original || '').slice(0, 255),
        info,
        absolutePaths: [finalPath, derivatives?.displayPath, derivatives?.thumbPath].filter(Boolean),
        filePath: originalData.filePath,
        fileUrl: originalData.fileUrl,
        displayPath: displayData?.filePath || null,
        displayUrl: displayData?.fileUrl || null,
        thumbPath: thumbData?.filePath || null,
        thumbUrl: thumbData?.fileUrl || null
      });
    } catch (error) {
      await storage.removeFileQuietly(file.path).catch(() => {});
      results.push({
        name: original,
        ok: false,
        error: error instanceof AppError ? error.message : 'Não foi possível processar a imagem.'
      });
      if (!(error instanceof AppError)) console.error('[images] upload:', error);
    }
  }

  if (!prepared.length) return results;

  try {
    const inserted = await transaction(async (client) => {
      const exists = await client.query('SELECT id FROM products WHERE id = $1 FOR SHARE', [product.id]);
      if (!exists.rowCount) throw new AppError('O produto foi removido durante o envio.', { status: 409 });

      const state = await client.query(
        `SELECT COALESCE(MAX(display_order), 0) AS max_order,
                COALESCE(BOOL_OR(is_main), FALSE) AS has_main
           FROM product_images WHERE product_id = $1`,
        [product.id]
      );
      let nextOrder = Number(state.rows[0].max_order || 0) + 1;
      const hasMain = state.rows[0].has_main;
      const rows = [];

      for (let index = 0; index < prepared.length; index += 1) {
        const item = prepared[index];
        const row = await client.query(
          `INSERT INTO product_images
             (product_id, file_path, file_url, display_order, is_main, original_name, mime_type, size_bytes,
              width, height, display_path, display_url, thumb_path, thumb_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id, file_url, display_url, thumb_url, is_main, display_order`,
          [
            product.id, item.filePath, item.fileUrl, nextOrder, !hasMain && index === 0,
            item.originalName, item.info.mime, item.info.size, item.info.width || null, item.info.height || null,
            item.displayPath, item.displayUrl, item.thumbPath, item.thumbUrl
          ]
        );
        rows.push(row.rows[0]);
        nextOrder += 1;
      }
      return rows;
    });

    inserted.forEach((image, index) => {
      results.push({ name: prepared[index].originalName, ok: true, image: { ...image, thumb: thumbUrl(image) } });
    });
  } catch (error) {
    for (const item of prepared) {
      for (const absolute of item.absolutePaths) {
        await storage.removeFileQuietly(absolute).catch(() => {});
      }
      results.push({ name: item.originalName, ok: false, error: error instanceof AppError ? error.message : 'Falha ao registrar a imagem.' });
    }
    if (!(error instanceof AppError)) console.error('[images] transação:', error);
  }

  return results;
}

async function cleanupTemporaryFiles(files = []) {
  for (const file of files) {
    if (file?.path) await fs.unlink(file.path).catch(() => {});
  }
}

module.exports = {
  storeUploadedImages,
  cleanupTemporaryFiles,
  displayUrl,
  thumbUrl
};
