const crypto = require('crypto');
const express = require('express');
const { query } = require('../../db');
const audit = require('../../services/audit');
const trash = require('../../services/trash');
const { setFlash } = require('../../middleware/flash');
const { safeCompare } = require('../../middleware/auth');
const { makeSlug, collectionDeletionPhrase, parsePositiveInt } = require('../../utils/text');
const { parsePage, buildPagination } = require('../../utils/pagination');
const { AppError } = require('../../utils/errors');

const router = express.Router();
const PER_PAGE = 20;
const INTENT_TTL_MS = 10 * 60 * 1000;

function activeFromBody(body) {
  return body.active === 'on' || body.active === 'true';
}

function readForm(body) {
  const name = String(body.name || '').trim().slice(0, 160);
  const slug = makeSlug(body.slug || name);
  return { name, slug, active: activeFromBody(body) };
}

function renderForm(res, status, { title, collection, action, error }) {
  return res.status(status).render('admin/collections/form', { title, page: 'collections', collection, action, error });
}

async function findCollection(id) {
  const result = await query('SELECT * FROM collections WHERE id = $1', [id]);
  return result.rows[0] || null;
}

router.get('/collections', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 120);
    const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : '';
    const page = parsePage(req.query.page);

    const where = [];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(c.name ILIKE $${params.length} OR c.slug ILIKE $${params.length})`);
    }
    if (status) where.push(status === 'active' ? 'c.active' : 'NOT c.active');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (await query(`SELECT COUNT(*)::int AS total FROM collections c ${whereSql}`, params)).rows[0].total;
    const pagination = buildPagination({ total, page, perPage: PER_PAGE, basePath: '/admin/collections', params: { q, status } });

    const rows = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM products p WHERE p.collection_id = c.id) AS products_count,
              (SELECT COUNT(*)::int FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE p.collection_id = c.id) AS images_count,
              cover.thumb_url, cover.display_url, cover.file_url
         FROM collections c
         LEFT JOIN LATERAL (
           SELECT pi.thumb_url, pi.display_url, pi.file_url
             FROM product_images pi JOIN products p ON p.id = pi.product_id
            WHERE p.collection_id = c.id
            ORDER BY pi.is_main DESC, pi.created_at DESC
            LIMIT 1
         ) cover ON TRUE
         ${whereSql}
        ORDER BY c.active DESC, c.created_at DESC, c.id DESC
        LIMIT ${PER_PAGE} OFFSET ${(pagination.page - 1) * PER_PAGE}`,
      params
    );

    res.render('admin/collections/index', {
      title: 'Coleções',
      page: 'collections',
      collections: rows.rows,
      filters: { q, status },
      pagination
    });
  } catch (error) {
    next(error);
  }
});

router.get('/collections/new', (req, res) => {
  renderForm(res, 200, {
    title: 'Nova coleção',
    collection: { name: '', slug: '', active: true },
    action: '/admin/collections'
  });
});

router.post('/collections', async (req, res, next) => {
  const collection = readForm(req.body);
  const view = { title: 'Nova coleção', collection, action: '/admin/collections' };
  if (!collection.name || !collection.slug) return renderForm(res, 422, { ...view, error: 'Informe nome e slug da coleção.' });

  try {
    const created = await query('INSERT INTO collections (name, slug, active) VALUES ($1, $2, $3) RETURNING id', [collection.name, collection.slug, collection.active]);
    await audit.record({ req, action: 'collection.create', entityType: 'collection', entityId: created.rows[0].id, summary: `Coleção ${collection.name} criada`, details: collection });
    setFlash(req, 'success', `Coleção “${collection.name}” cadastrada.`);
    return res.redirect('/admin/collections');
  } catch (error) {
    if (error.code === '23505') return renderForm(res, 422, { ...view, error: 'Já existe uma coleção com este slug.' });
    return next(error);
  }
});

router.get('/collections/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const collection = await findCollection(req.params.id);
    if (!collection) throw new AppError('A coleção solicitada não foi encontrada.', { status: 404 });
    return renderForm(res, 200, { title: 'Editar coleção', collection, action: `/admin/collections/${collection.id}` });
  } catch (error) {
    return next(error);
  }
});

router.post('/collections/:id(\\d+)', async (req, res, next) => {
  const collection = { id: req.params.id, ...readForm(req.body) };
  const view = { title: 'Editar coleção', collection, action: `/admin/collections/${req.params.id}` };
  if (!collection.name || !collection.slug) return renderForm(res, 422, { ...view, error: 'Informe nome e slug da coleção.' });

  try {
    const before = await findCollection(req.params.id);
    if (!before) throw new AppError('A coleção solicitada não foi encontrada.', { status: 404 });
    await query('UPDATE collections SET name = $1, slug = $2, active = $3 WHERE id = $4', [collection.name, collection.slug, collection.active, req.params.id]);
    await audit.record({
      req,
      action: 'collection.update',
      entityType: 'collection',
      entityId: Number(req.params.id),
      summary: `Coleção ${collection.name} atualizada`,
      details: { before: { name: before.name, slug: before.slug, active: before.active }, after: collection }
    });
    setFlash(req, 'success', 'Coleção atualizada.');
    return res.redirect('/admin/collections');
  } catch (error) {
    if (error.code === '23505') return renderForm(res, 422, { ...view, error: 'Já existe uma coleção com este slug.' });
    return next(error);
  }
});

/* ---------------- Exclusão em duas etapas ---------------- */

// Etapa 1: impacto da exclusão.
router.get('/collections/:id(\\d+)/excluir', async (req, res, next) => {
  try {
    const impact = await trash.collectionImpact(req.params.id);
    if (!impact) throw new AppError('A coleção não existe mais.', { status: 404 });
    return res.render('admin/collections/delete-impact', { title: 'Excluir coleção', page: 'collections', impact });
  } catch (error) {
    return next(error);
  }
});

// Etapa 2: gera a intenção (token de uso único) e pede a frase de confirmação.
router.post('/collections/:id(\\d+)/excluir/confirmar', async (req, res, next) => {
  try {
    const impact = await trash.collectionImpact(req.params.id);
    if (!impact) throw new AppError('A coleção não existe mais.', { status: 404 });

    const intent = {
      token: crypto.randomBytes(24).toString('hex'),
      collectionId: Number(impact.id),
      products: impact.products_count,
      images: impact.images_count,
      expiresAt: Date.now() + INTENT_TTL_MS
    };
    req.session.collectionDeletion = intent;

    return res.render('admin/collections/delete-confirm', {
      title: 'Confirmar exclusão',
      page: 'collections',
      impact,
      intent,
      phrase: collectionDeletionPhrase(impact)
    });
  } catch (error) {
    return next(error);
  }
});

// Execução: valida token, frase e impacto no backend antes de excluir.
router.post('/collections/:id(\\d+)/excluir', async (req, res, next) => {
  const collectionId = parsePositiveInt(req.params.id);
  const intent = req.session.collectionDeletion;
  const backToStart = `/admin/collections/${collectionId}/excluir`;

  try {
    if (!intent || intent.collectionId !== collectionId || !safeCompare(String(req.body.intent || ''), intent.token)) {
      setFlash(req, 'error', 'Confirmação inválida. Inicie a exclusão novamente.');
      return res.redirect(backToStart);
    }
    if (Date.now() > intent.expiresAt) {
      delete req.session.collectionDeletion;
      setFlash(req, 'error', 'A confirmação expirou (10 minutos). Inicie a exclusão novamente.');
      return res.redirect(backToStart);
    }

    const collection = await findCollection(collectionId);
    if (!collection) {
      delete req.session.collectionDeletion;
      setFlash(req, 'error', 'A coleção não existe mais — talvez já tenha sido excluída.');
      return res.redirect('/admin/collections');
    }

    const expectedPhrase = collectionDeletionPhrase(collection);
    const typed = String(req.body.phrase || '').trim().replace(/\s+/g, ' ');
    if (typed !== expectedPhrase) {
      const impact = await trash.collectionImpact(collectionId);
      await audit.record({ req, action: 'collection.delete', entityType: 'collection', entityId: collectionId, status: 'rejected', summary: 'Frase de confirmação incorreta' });
      return res.status(422).render('admin/collections/delete-confirm', {
        title: 'Confirmar exclusão',
        page: 'collections',
        impact,
        intent,
        phrase: expectedPhrase,
        error: 'A frase digitada não confere. Digite exatamente como indicado.'
      });
    }

    // Token de uso único: consumido antes da operação para impedir reenvio duplicado.
    delete req.session.collectionDeletion;
    await new Promise((resolve) => req.session.save(resolve));

    const result = await trash.deleteCollection({
      req,
      collectionId,
      expected: { products: intent.products, images: intent.images }
    });

    setFlash(req, 'success', `${result.label} excluída: ${result.products} produto(s) e ${result.images} imagem(ns) enviados para a lixeira (item #${result.trashEntryId}).`);
    return res.redirect('/admin/collections');
  } catch (error) {
    if (error instanceof AppError) {
      setFlash(req, 'error', error.message);
      return res.redirect(error.status === 404 ? '/admin/collections' : backToStart);
    }
    return next(error);
  }
});

module.exports = router;
