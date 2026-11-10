const config = require('./config');
const { pool } = require('./db');
const { createApp } = require('./app');
const trash = require('./services/trash');

async function start() {
  const problems = config.validateConfig();
  if (problems.length) {
    problems.forEach((problem) => console.error(`[config] ${problem}`));
    if (config.isProduction) process.exit(1);
  }

  try {
    await trash.recoverPending();
  } catch (error) {
    console.error('[trash] não foi possível verificar operações pendentes:', error.message);
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`MÁLAGAH Imagens — servidor iniciado na porta ${config.port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} recebido, encerrando…`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
