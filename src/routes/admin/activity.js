const express = require('express');
const { query } = require('../../db');
const trash = require('../../services/trash');
const { setFlash } = require('../../middleware/flash');
const { parsePage, buildPagination } = require('../../utils/pagination');
const { AppError } = require('../../utils/errors');

const router = express.Router();
const PER_PAGE = 40;

router.get('/atividade', async (req, res, next) => {
  try {
    const filters = {
      action: /^[a-z_.]{1,80}$/.test(String(req.query.action || '')) ? req.query.action : '',
      status: ['success', 'failure', 'rejected'].includes(req.query.status) ? req.query.status : ''
    };
    const page = parsePage(req.query.page);
    const where = [];
    const params = [];
    if (filters.action) {
      params.push(`${filters.action}%`);
      where.push(`action LIKE $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await query(`SELECT COUNT(*)::int AS total FROM audit_log ${whereSql}`, params)).rows[0].total;
    const pagination = buildPagination({ total, page, perPage: PER_PAGE, basePath: '/admin/atividade', params: filters });
    const rows = await query(
      `SELECT * FROM audit_log ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ${PER_PAGE} OFFSET ${(pagination.page - 1) * PER_PAGE}`,
      params
    );
    res.render('admin/activity/index', { title: 'Atividade', page: 'activity', entries: rows.rows, filters, pagination });
  } catch (error) {
    next(error);
  }
});

router.get('/lixeira', async (req, res, next) => {
  try {
    const entries = await trash.listEntries({ limit: 100 });
    res.render('admin/activity/trash', { title: 'Lixeira', page: 'trash', entries });
  } catch (error) {
    next(error);
  }
});

router.post('/lixeira/:id(\\d+)/restaurar', async (req, res, next) => {
  try {
    const result = await trash.restore(Number(req.params.id), { actor: req.session.admin.username });
    setFlash(req, 'success', `${result.label} restaurado(a) com ${result.files} arquivo(s).`);
  } catch (error) {
    if (!(error instanceof AppError)) return next(error);
    setFlash(req, 'error', error.message);
  }
  return res.redirect('/admin/lixeira');
});

module.exports = router;
