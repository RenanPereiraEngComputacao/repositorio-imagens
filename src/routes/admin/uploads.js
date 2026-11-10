const path = require('path');
const express = require('express');
const { query } = require('../../db');
const audit = require('../../services/audit');
const { storeUploadedImages, cleanupTemporaryFiles } = require('../../services/images');
const { bulkImageUpload } = require('../../middleware/upload');
const { wantsJson } = require('../../middleware/auth');
const { cleanReference } = require('../../utils/text');
const config = require('../../config');

const router = express.Router();
const SEPARATORS = ['_', '-', 'space', 'full'];

function parseBulkReference(originalName, separator) {
  const base = path.parse(String(originalName || '')).name.trim();
  if (separator === 'full') return base;
  if (separator === 'space') return base.split(/\s+/)[0];
  return base.split(separator || '_')[0];
}

async function searchProducts(search) {
  if (!search) return [];
  const result = await query(
    `SELECT p.id, p.reference, p.name, c.name AS collection_name,
            (SELECT COUNT(*)::int FROM product_images pi WHERE pi.product_id = p.id) AS images_count,
            main.file_url, main.display_url, main.thumb_url
       FROM products p
       JOIN collections c ON c.id = p.collection_id
       LEFT JOIN LATERAL (
         SELECT file_url, display_url, thumb_url FROM product_images WHERE product_id = p.id
          ORDER BY is_main DESC, display_order, id LIMIT 1
       ) main ON TRUE
      WHERE p.reference ILIKE $1 OR p.name ILIKE $1
      ORDER BY p.reference ASC
      LIMIT 30`,
    [`%${search}%`]
  );
  return result.rows;
}

router.get('/upload', async (req, res, next) => {
  try {
    const search = String(req.query.reference || '').trim().slice(0, 120);
    const products = await searchProducts(search);
    if (search && products.length === 1 && products[0].reference.toLowerCase() === search.toLowerCase()) {
      return res.redirect(`/admin/products/${products[0].id}/images`);
    }
    return res.render('admin/upload/index', {
      title: 'Envio de imagens',
      page: 'upload',
      search,
      products,
      bulkResult: null,
      limits: { maxUploadMb: config.maxUploadMb }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/upload/bulk', bulkImageUpload, async (req, res, next) => {
  try {
    const files = req.files || [];
    const separator = SEPARATORS.includes(req.body.separator) ? req.body.separator : '_';
    const results = [...(req.rejectedFiles || [])];
    const cache = new Map();

    for (const file of files) {
      const reference = cleanReference(parseBulkReference(file.originalname, separator));
      const key = reference.toLowerCase();
      if (!cache.has(key)) {
        const found = await query(
          `SELECT p.*, c.slug AS collection_slug FROM products p JOIN collections c ON c.id = p.collection_id
            WHERE LOWER(p.reference) = LOWER($1) LIMIT 1`,
          [reference]
        );
        cache.set(key, found.rows[0] || null);
      }
      const product = cache.get(key);
      if (!product) {
        await cleanupTemporaryFiles([file]);
        results.push({ name: file.originalname, ok: false, reference, error: `Referência ${reference || '(vazia)'} não cadastrada.` });
        continue;
      }
      const [outcome] = await storeUploadedImages(product, [file]);
      results.push({ ...outcome, reference: product.reference, productId: product.id });
    }

    const imported = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);
    const missing = [...new Set(failed.filter((item) => item.reference !== undefined && /não cadastrada/.test(item.error)).map((item) => item.reference))];

    await audit.record({
      req,
      action: 'image.bulk_upload',
      summary: `Importação em massa: ${imported} imagem(ns), ${failed.length} ignorada(s)`,
      details: { imported, failed: failed.length, missing: missing.slice(0, 100) }
    });

    const bulkResult = { imported, ignored: failed.length, missing, results };
    if (wantsJson(req)) return res.json({ ok: imported > 0, ...bulkResult });

    return res.render('admin/upload/index', {
      title: 'Envio de imagens',
      page: 'upload',
      search: '',
      products: [],
      bulkResult,
      limits: { maxUploadMb: config.maxUploadMb }
    });
  } catch (error) {
    await cleanupTemporaryFiles(req.files);
    return next(error);
  }
});

module.exports = router;
module.exports.parseBulkReference = parseBulkReference;
