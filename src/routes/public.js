const express = require('express');
const path = require('path');
const archiver = require('archiver');
const config = require('../config');
const { query } = require('../db');
const { resolveSafeStoredFile } = require('../services/storage');
const { safeFilename, parsePositiveInt } = require('../utils/text');

const router = express.Router();

router.get('/', (req, res) => {
  res.redirect('/admin');
});

/** Busca um produto publicamente visível (produto e coleção ativos). */
async function findPublicProduct(reference) {
  const value = String(reference || '').trim();
  if (!value || value.length > 120) return null;
  const result = await query(
    `SELECT p.id, p.reference, p.name, p.description, c.name AS collection_name
       FROM products p
       JOIN collections c ON c.id = p.collection_id
      WHERE LOWER(p.reference) = LOWER($1)
        AND p.active = TRUE
        AND c.active = TRUE
      LIMIT 1`,
    [value]
  );
  return result.rows[0] || null;
}

async function publicImages(productId) {
  const result = await query(
    `SELECT id, file_path, file_url, display_url, thumb_url, width, height, size_bytes, mime_type, is_main
       FROM product_images
      WHERE product_id = $1
      ORDER BY is_main DESC, display_order ASC, id ASC`,
    [productId]
  );
  return result.rows;
}

function downloadName(reference, position, filePath) {
  const ext = path.extname(filePath).toLowerCase() || '.jpg';
  return `MALAGAH-${safeFilename(reference)}-${String(position).padStart(2, '0')}${ext}`;
}

// Download de todas as imagens do produto em um único ZIP (originais).
router.get('/download/:reference/todas', async (req, res, next) => {
  try {
    const product = await findPublicProduct(req.params.reference);
    if (!product) return res.sendStatus(404);

    const images = (await publicImages(product.id)).slice(0, config.maxZipImages);
    const entries = [];
    for (let index = 0; index < images.length; index += 1) {
      const safe = await resolveSafeStoredFile(images[index].file_path);
      if (safe) entries.push({ path: safe.path, name: downloadName(product.reference, index + 1, safe.path) });
    }
    if (!entries.length) return res.sendStatus(404);

    const zipName = `MALAGAH-${safeFilename(product.reference)}-imagens.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Cache-Control', 'no-store');

    // Imagens já são comprimidas: "store" evita gastar CPU sem ganho de tamanho.
    const archive = archiver('zip', { store: true, statConcurrency: 1 }); // mantém a ordem da galeria
    archive.on('warning', (error) => console.warn('[zip]', error.message));
    archive.on('error', (error) => {
      console.error('[zip]', error.message);
      res.destroy(error);
    });
    req.on('close', () => {
      if (!res.writableFinished) archive.abort();
    });

    archive.pipe(res);
    for (const entry of entries) archive.file(entry.path, { name: entry.name });
    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

// Download individual na resolução original.
router.get('/download/:reference/:imageId', async (req, res, next) => {
  try {
    const imageId = parsePositiveInt(req.params.imageId);
    if (!imageId) return res.sendStatus(404);

    const product = await findPublicProduct(req.params.reference);
    if (!product) return res.sendStatus(404);

    const images = await publicImages(product.id);
    const position = images.findIndex((image) => Number(image.id) === imageId);
    if (position === -1) return res.sendStatus(404);

    const safe = await resolveSafeStoredFile(images[position].file_path);
    if (!safe) return res.sendStatus(404);

    res.setHeader('Cache-Control', 'private, max-age=0');
    return res.download(safe.path, downloadName(product.reference, position + 1, safe.path), { dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    return next(error);
  }
});

// Página pública acessada pelo QR Code — URL preservada.
router.get('/imagens/:reference', async (req, res, next) => {
  try {
    const product = await findPublicProduct(req.params.reference);
    if (!product) {
      return res.status(404).render('public/not-found', { title: 'Imagens não encontradas' });
    }
    const images = await publicImages(product.id);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.render('public/product', {
      title: product.name ? `${product.reference} · ${product.name}` : product.reference,
      product,
      images,
      pageUrl: `${config.baseUrl}/imagens/${encodeURIComponent(product.reference)}`
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
