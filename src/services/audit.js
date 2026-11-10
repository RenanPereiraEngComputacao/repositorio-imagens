const { query } = require('../db');

function requestMeta(req) {
  if (!req) return { actor: 'sistema', ip: null, userAgent: null };
  return {
    actor: req.session?.admin?.username || 'anônimo',
    ip: String(req.ip || '').slice(0, 64) || null,
    userAgent: String(req.get?.('user-agent') || '').slice(0, 500) || null
  };
}

/**
 * Registra um evento de auditoria. Aceita um client de transação opcional para
 * gravar o evento atomicamente junto com a operação. Nunca lança em modo "best effort".
 */
async function record({ req, action, entityType = null, entityId = null, summary = '', status = 'success', details = {} }, client) {
  const meta = requestMeta(req);
  const runner = client || { query };
  const sql = `INSERT INTO audit_log (actor, action, entity_type, entity_id, summary, status, details, ip, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  const params = [meta.actor, action, entityType, entityId, summary, status, JSON.stringify(details || {}), meta.ip, meta.userAgent];

  if (client) {
    return runner.query(sql, params);
  }

  try {
    return await runner.query(sql, params);
  } catch (error) {
    console.error('[audit] falha ao registrar evento:', action, error.message);
    return null;
  }
}

module.exports = { record, requestMeta };
