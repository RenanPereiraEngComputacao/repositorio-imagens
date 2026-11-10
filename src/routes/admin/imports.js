const express = require('express');
const XLSX = require('xlsx');
const { transaction, query } = require('../../db');
const audit = require('../../services/audit');
const { spreadsheetUpload } = require('../../middleware/upload');
const { setFlash } = require('../../middleware/flash');
const { cleanReference, isValidReference, normalizeText, makeSlug } = require('../../utils/text');

const router = express.Router();
const MAX_ROWS = 5000;

// Cabeçalhos aceitos (inclui o formato exportado do ERP: REFERENCIA_PRODUTO, DESCRICAO_PRODUTO…)
const HEADER_ALIASES = {
  reference: ['reference', 'referencia', 'referencia_produto', 'ref', 'codigo'],
  name: ['name', 'nome', 'descricao_produto', 'produto', 'nome_produto'],
  description: ['description', 'descricao', 'cores', 'cor', 'detalhes'],
  collection_id: ['collection_id', 'colecao_id', 'id_colecao'],
  collection: ['collection', 'colecao', 'colecao_produto', 'collection_name', 'collection_slug'],
  active: ['active', 'ativo', 'status']
};

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function mapRow(raw) {
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) normalized[normalizeHeader(key)] = value;
  const row = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const key = aliases.find((alias) => normalized[alias] !== undefined && String(normalized[alias]).trim() !== '');
    row[field] = key ? String(normalized[key]).trim() : '';
  }
  return row;
}

function parseActive(value) {
  if (value === '') return true;
  return ['true', 'sim', '1', 'yes', 'ativo', 's', 'verdadeiro'].includes(normalizeText(value).toLowerCase().trim());
}

async function renderPage(res, extra = {}) {
  const collections = await query('SELECT id, name, slug, active FROM collections ORDER BY active DESC, name ASC');
  return res.render('admin/products/import', {
    title: 'Importar planilha',
    page: 'products',
    collections: collections.rows,
    report: null,
    ...extra
  });
}

router.get('/products/import', async (req, res, next) => {
  try {
    await renderPage(res);
  } catch (error) {
    next(error);
  }
});

router.post('/products/import', spreadsheetUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      setFlash(req, 'error', 'Selecione uma planilha .xlsx.');
      return res.redirect('/admin/products/import');
    }

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellFormula: false, cellHTML: false, sheetRows: MAX_ROWS + 1 });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    } catch {
      setFlash(req, 'error', 'Não foi possível ler a planilha. Verifique se o arquivo é um .xlsx válido.');
      return res.redirect('/admin/products/import');
    }

    const simulate = req.body.simulate === 'on';
    const collections = (await query('SELECT id, name, slug FROM collections')).rows;
    const byId = new Map(collections.map((c) => [String(c.id), c]));
    const byKey = new Map();
    for (const c of collections) {
      byKey.set(c.slug.toLowerCase(), c);
      byKey.set(makeSlug(c.name), c);
    }

    const errors = [];
    const valid = new Map();
    rows.slice(0, MAX_ROWS).forEach((raw, index) => {
      const line = index + 2;
      const row = mapRow(raw);
      if (!row.reference && !row.name && !row.collection && !row.collection_id) return; // linha vazia
      const reference = cleanReference(row.reference);
      if (!reference || !isValidReference(reference)) {
        errors.push({ line, reference, error: 'Referência ausente ou inválida.' });
        return;
      }
      const collection = row.collection_id
        ? byId.get(String(Number(row.collection_id)))
        : byKey.get(makeSlug(row.collection)) || byKey.get(String(row.collection).toLowerCase());
      if (!collection) {
        errors.push({ line, reference, error: `Coleção “${row.collection_id || row.collection || '—'}” não encontrada.` });
        return;
      }
      if (valid.has(reference.toLowerCase())) {
        errors.push({ line, reference, error: 'Referência repetida na planilha — a última linha prevaleceu.' });
      }
      valid.set(reference.toLowerCase(), {
        reference,
        name: row.name.slice(0, 180),
        description: row.description.slice(0, 5000),
        collectionId: collection.id,
        active: parseActive(row.active)
      });
    });

    let created = 0;
    let updated = 0;
    const SIMULATION = Symbol('simulation');
    try {
      await transaction(async (client) => {
        for (const item of valid.values()) {
          const result = await client.query(
            `INSERT INTO products (reference, name, description, collection_id, active)
             VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5)
             ON CONFLICT ((LOWER(reference))) DO UPDATE SET
               name = COALESCE(EXCLUDED.name, products.name),
               description = COALESCE(EXCLUDED.description, products.description),
               collection_id = EXCLUDED.collection_id,
               active = EXCLUDED.active
             RETURNING (xmax = 0) AS inserted`,
            [item.reference, item.name, item.description, item.collectionId, item.active]
          );
          if (result.rows[0].inserted) created += 1;
          else updated += 1;
        }
        if (simulate) throw SIMULATION;
      });
    } catch (error) {
      if (error !== SIMULATION) throw error;
    }

    const report = { simulate, total: rows.length, created, updated, errors: errors.slice(0, 200), errorsCount: errors.length };
    if (!simulate) {
      await audit.record({
        req,
        action: 'product.import',
        summary: `Planilha importada: ${created} criado(s), ${updated} atualizado(s), ${errors.length} com aviso`,
        details: { file: req.file.originalname, created, updated, errors: errors.length }
      });
    }
    return renderPage(res, { report });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
