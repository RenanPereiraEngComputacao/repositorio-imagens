const express = require('express');
const { query, transaction } = require('../../db');
const audit = require('../../services/audit');
const trash = require('../../services/trash');
const { storeUploadedImages, cleanupTemporaryFiles } = require('../../services/images');
const { productImageUpload } = require('../../middleware/upload');
const { setFlash } = require('../../middleware/flash');
const { wantsJson } = require('../../middleware/auth');
const { AppError } = require('../../utils/errors');
const config = require('../../config');

const router = express.Router();

async function loadProduct(req, res, next) {
  try {
    const result = await query(
      `SELECT p.*, c.name AS collection_name, c.slug AS collection_slug, c.active AS collection_active
         FROM products p JOIN collections c ON c.id = p.collection_id
        WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) throw new AppError('A referência solicitada não foi encontrada.', { status: 404 });
    req.product = result.rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
}

function respond(req, res, { ok = true, message, status = 200, extra = {} }) {
  if (wantsJson(req)) return res.status(status).json({ ok, message, error: ok ? undefined : message, ...extra });
  setFlash(req, ok ? 'success' : 'error', message);
  return res.redirect(`/admin/products/${req.product.id}/images`);
}

router.get('/products/:id(\\d+)/images', loadProduct, async (req, res, next) => {
  try {
    const images = await query(
      `SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC, id ASC`,
      [req.product.id]
    );
    const totalBytes = images.rows.reduce((sum, image) => sum + Number(image.size_bytes || 0), 0);
    res.render('admin/products/images', {
      title: req.product.reference,
      page: 'products',
      product: req.product,
      images: images.rows,
      totalBytes,
      limits: { maxUploadMb: config.maxUploadMb, maxFiles: config.maxFilesPerRequest }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/products/:id(\\d+)/images', loadProduct, productImageUpload, async (req, res, next) => {
  try {
    const files = req.files || [];
    const rejected = req.rejectedFiles || [];
    if (!files.length && !rejected.length) {
      return respond(req, res, { ok: false, status: 422, message: 'Selecione pelo menos uma imagem.' });
    }

    const results = [...rejected, ...(await storeUploadedImages(req.product, files))];
    const okCount = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);

    await audit.record({
      req,
      action: 'image.upload',
      entityType: 'product',
      entityId: req.product.id,
      status: failed.length && !okCount ? 'failure' : 'success',
      summary: `${okCount} imagem(ns) enviada(s) para ${req.product.reference}`,
      details: { ok: okCount, failed: failed.map((item) => ({ name: item.name, error: item.error })) }
    });

    const message = failed.length
      ? `${okCount} imagem(ns) enviada(s), ${failed.length} com falha: ${failed.map((item) => `${item.name} (${item.error})`).join('; ')}`
      : `${okCount} imagem(ns) enviada(s).`;
    return respond(req, res, { ok: okCount > 0, status: okCount ? 200 : 422, message, extra: { results } });
  } catch (error) {
    await cleanupTemporaryFiles(req.files);
    return next(error);
  }
});

router.post('/products/:id(\\d+)/images/reorder', loadProduct, async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body.order) ? req.body.order.join(',') : String(req.body.image_order || req.body.order || '');
    const order = raw.split(',').map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    if (!order.length) return respond(req, res, { ok: false, status: 422, message: 'Ordem inválida.' });

    await transaction(async (client) => {
      const owned = await client.query('SELECT id FROM product_images WHERE product_id = $1 FOR UPDATE', [req.product.id]);
      const ownedIds = new Set(owned.rows.map((row) => Number(row.id)));
      const unique = [...new Set(order)].filter((id) => ownedIds.has(id));
      for (const id of ownedIds) if (!unique.includes(id)) unique.push(id);
      for (let index = 0; index < unique.length; index += 1) {
        await client.query('UPDATE product_images SET display_order = $1 WHERE id = $2 AND product_id = $3', [index + 1, unique[index], req.product.id]);
      }
    });
    await audit.record({ req, action: 'image.reorder', entityType: 'product', entityId: req.product.id, summary: `Ordem das imagens de ${req.product.reference} atualizada` });
    return respond(req, res, { message: 'Ordem atualizada.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/products/:id(\\d+)/images/:imageId(\\d+)/main', loadProduct, async (req, res, next) => {
  try {
    const updated = await transaction(async (client) => {
      const target = await client.query('SELECT id FROM product_images WHERE id = $1 AND product_id = $2 FOR UPDATE', [req.params.imageId, req.product.id]);
      if (!target.rowCount) return false;
      await client.query('UPDATE product_images SET is_main = FALSE WHERE product_id = $1 AND is_main', [req.product.id]);
      await client.query('UPDATE product_images SET is_main = TRUE WHERE id = $1', [req.params.imageId]);
      return true;
    });
    if (!updated) return respond(req, res, { ok: false, status: 404, message: 'Imagem não encontrada.' });
    await audit.record({ req, action: 'image.main', entityType: 'image', entityId: Number(req.params.imageId), summary: `Imagem principal de ${req.product.reference} definida` });
    return respond(req, res, { message: 'Imagem principal definida.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/products/:id(\\d+)/images/:imageId(\\d+)/delete', loadProduct, async (req, res, next) => {
  try {
    const outcome = await trash.deleteImage({ req, productId: req.product.id, imageId: Number(req.params.imageId) });
    return respond(req, res, { message: `Imagem excluída (recuperável na lixeira, item #${outcome.trashEntryId}).`, extra: { trashEntryId: outcome.trashEntryId } });
  } catch (error) {
    if (error instanceof AppError) return respond(req, res, { ok: false, status: error.status, message: error.message });
    return next(error);
  }
});

module.exports = router;
