const express = require('express');
const { query } = require('../../db');
const audit = require('../../services/audit');
const trash = require('../../services/trash');
const { setFlash } = require('../../middleware/flash');
const { cleanReference, isValidReference } = require('../../utils/text');
const { parsePage, buildPagination } = require('../../utils/pagination');
const { AppError } = require('../../utils/errors');

const router = express.Router();
const PER_PAGE = 24;

function activeFromBody(body) {
  return body.active === 'on' || body.active === 'true';
}

async function getCollections() {
  const result = await query('SELECT id, name, slug, active FROM collections ORDER BY active DESC, name ASC');
  return result.rows;
}

function readForm(body, id) {
  return {
    id,
    reference: cleanReference(body.reference).slice(0, 120),
    name: String(body.name || '').trim().slice(0, 180),
    description: String(body.description || '').trim().slice(0, 5000),
    collection_id: String(body.collection_id || '').replace(/\D/g, ''),
    active: activeFromBody(body)
  };
}

async function renderForm(res, status, { title, product, action, error }) {
  return res.status(status).render('admin/products/form', {
    title,
    page: 'products',
    product,
    action,
    error,
    collections: await getCollections()
  });
}

function validate(product) {
  if (!product.reference || !isValidReference(product.reference)) {
    return 'Informe uma referência válida (letras, números, ponto, hífen ou sublinhado).';
  }
  if (!product.collection_id) return 'Selecione a coleção.';
  return null;
}

router.get('/products', async (req, res, next) => {
  try {
    const filters = {
      q: String(req.query.q ?? req.query.reference ?? '').trim().slice(0, 120),
      collection: /^\d+$/.test(String(req.query.collection || '')) ? String(req.query.collection) : '',
      status: ['active', 'inactive'].includes(req.query.status) ? req.query.status : '',
      images: ['with', 'without'].includes(req.query.images) ? req.query.images : '',
      view: req.query.view === 'list' ? 'list' : 'grid'
    };
    const page = parsePage(req.query.page);

    const where = [];
    const params = [];
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(`(p.reference ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }
    if (filters.collection) {
      params.push(filters.collection);
      where.push(`p.collection_id = $${params.length}`);
    }
    if (filters.status) where.push(filters.status === 'active' ? 'p.active' : 'NOT p.active');
    if (filters.images) {
      where.push(`${filters.images === 'without' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM product_images x WHERE x.product_id = p.id)`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (await query(`SELECT COUNT(*)::int AS total FROM products p ${whereSql}`, params)).rows[0].total;
    const pagination = buildPagination({ total, page, perPage: PER_PAGE, basePath: '/admin/products', params: filters });

    const rows = await query(
      `SELECT p.*, c.name AS collection_name, c.active AS collection_active,
              (SELECT COUNT(*)::int FROM product_images pi WHERE pi.product_id = p.id) AS images_count,
              main.file_url, main.display_url, main.thumb_url
         FROM products p
         JOIN collections c ON c.id = p.collection_id
         LEFT JOIN LATERAL (
           SELECT file_url, display_url, thumb_url FROM product_images
            WHERE product_id = p.id ORDER BY is_main DESC, display_order ASC, id ASC LIMIT 1
         ) main ON TRUE
         ${whereSql}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${PER_PAGE} OFFSET ${(pagination.page - 1) * PER_PAGE}`,
      params
    );

    res.render('admin/products/index', {
      title: 'Produtos',
      page: 'products',
      products: rows.rows,
      collections: await getCollections(),
      filters,
      pagination
    });
  } catch (error) {
    next(error);
  }
});

router.get('/products/new', async (req, res, next) => {
  try {
    await renderForm(res, 200, {
      title: 'Novo produto',
      product: {
        reference: cleanReference(req.query.reference).slice(0, 120),
        name: '',
        description: '',
        active: true,
        collection_id: String(req.query.collection || '')
      },
      action: '/admin/products'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/products', async (req, res, next) => {
  const product = readForm(req.body);
  const view = { title: 'Novo produto', product, action: '/admin/products' };
  try {
    const invalid = validate(product);
    if (invalid) return await renderForm(res, 422, { ...view, error: invalid });

    const created = await query(
      `INSERT INTO products (reference, name, description, collection_id, active)
       VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5) RETURNING id`,
      [product.reference, product.name, product.description, product.collection_id, product.active]
    );
    const id = created.rows[0].id;
    await audit.record({ req, action: 'product.create', entityType: 'product', entityId: id, summary: `Produto ${product.reference} criado` });
    setFlash(req, 'success', `Produto ${product.reference} cadastrado. Agora envie as imagens.`);
    return res.redirect(`/admin/products/${id}/images`);
  } catch (error) {
    if (error.code === '23505') return renderForm(res, 422, { ...view, error: 'Já existe um produto com esta referência.' });
    if (error.code === '23503') return renderForm(res, 422, { ...view, error: 'Coleção inválida.' });
    return next(error);
  }
});

router.get('/products/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!result.rowCount) throw new AppError('A referência solicitada não foi encontrada.', { status: 404 });
    return await renderForm(res, 200, { title: 'Editar produto', product: result.rows[0], action: `/admin/products/${req.params.id}` });
  } catch (error) {
    return next(error);
  }
});

router.post('/products/:id(\\d+)', async (req, res, next) => {
  const product = readForm(req.body, req.params.id);
  const view = { title: 'Editar produto', product, action: `/admin/products/${req.params.id}` };
  try {
    const invalid = validate(product);
    if (invalid) return await renderForm(res, 422, { ...view, error: invalid });

    const before = await query('SELECT reference, name, collection_id, active FROM products WHERE id = $1', [req.params.id]);
    if (!before.rowCount) throw new AppError('A referência solicitada não foi encontrada.', { status: 404 });

    await query(
      `UPDATE products SET reference = $1, name = NULLIF($2, ''), description = NULLIF($3, ''), collection_id = $4, active = $5
        WHERE id = $6`,
      [product.reference, product.name, product.description, product.collection_id, product.active, product.id]
    );
    await audit.record({
      req,
      action: 'product.update',
      entityType: 'product',
      entityId: Number(product.id),
      summary: `Produto ${product.reference} atualizado`,
      details: { before: before.rows[0], after: { reference: product.reference, name: product.name, collection_id: product.collection_id, active: product.active } }
    });
    setFlash(req, 'success', 'Produto atualizado.');
    return res.redirect(`/admin/products/${product.id}/images`);
  } catch (error) {
    if (error.code === '23505') return renderForm(res, 422, { ...view, error: 'Já existe um produto com esta referência.' });
    if (error.code === '23503') return renderForm(res, 422, { ...view, error: 'Coleção inválida.' });
    return next(error);
  }
});

// Exclusão de produto: exige digitar a referência (validado no servidor).
router.post('/products/:id(\\d+)/excluir', async (req, res, next) => {
  try {
    const result = await query('SELECT id, reference FROM products WHERE id = $1', [req.params.id]);
    if (!result.rowCount) {
      setFlash(req, 'error', 'O produto não existe mais.');
      return res.redirect('/admin/products');
    }
    const product = result.rows[0];
    const typed = String(req.body.confirm_reference || '').trim();
    if (typed.toLowerCase() !== String(product.reference).toLowerCase()) {
      setFlash(req, 'error', 'Para excluir, digite a referência exatamente como aparece.');
      return res.redirect(`/admin/products/${product.id}/edit`);
    }

    const outcome = await trash.deleteProduct({ req, productId: product.id });
    setFlash(req, 'success', `${outcome.label} excluído com ${outcome.images} imagem(ns) — enviado para a lixeira (item #${outcome.trashEntryId}).`);
    return res.redirect('/admin/products');
  } catch (error) {
    if (error instanceof AppError) {
      setFlash(req, 'error', error.message);
      return res.redirect('/admin/products');
    }
    return next(error);
  }
});

module.exports = router;
