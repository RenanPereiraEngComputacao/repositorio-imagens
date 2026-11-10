/**
 * Erro "esperado" — a mensagem pode ser exibida ao usuário com segurança.
 * Qualquer outro erro é tratado como interno e a mensagem original não é exposta.
 */
class AppError extends Error {
  constructor(message, { status = 400, code = 'APP_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

function notFound(message = 'Registro não encontrado.') {
  return new AppError(message, { status: 404, code: 'NOT_FOUND' });
}

function conflict(message) {
  return new AppError(message, { status: 409, code: 'CONFLICT' });
}

module.exports = { AppError, notFound, conflict };
