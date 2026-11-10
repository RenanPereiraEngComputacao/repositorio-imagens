#!/usr/bin/env node
/**
 * Lixeira — linha de comando.
 *
 *   npm run trash:list                      lista itens
 *   npm run trash:restore -- <id>           restaura um item (registros + arquivos)
 *   npm run trash:purge -- --days 30        apaga definitivamente itens com mais de N dias
 *   node scripts/trash.js recover           reverte operações interrompidas (também roda no start)
 */
const { pool } = require('../src/db');
const trash = require('../src/services/trash');
const { formatBytes } = require('../src/utils/text');

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'list' || !command) {
    const rows = await trash.listEntries({ limit: 200 });
    if (!rows.length) return console.log('Lixeira vazia.');
    for (const row of rows) {
      console.log(
        `#${String(row.id).padEnd(5)} ${row.status.padEnd(9)} ${new Date(row.created_at).toISOString().slice(0, 16)}  ` +
        `${row.label}  (${row.products_count} produtos, ${row.images_count} imagens, ${formatBytes(row.bytes_total)})`
      );
    }
    return undefined;
  }

  if (command === 'restore') {
    const id = Number(args[0]);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Uso: npm run trash:restore -- <id>');
    const result = await trash.restore(id, { actor: 'cli' });
    return console.log(`✓ ${result.label} restaurado(a) com ${result.files} arquivo(s).`);
  }

  if (command === 'purge') {
    const flag = args.indexOf('--days');
    const days = flag >= 0 ? Number(args[flag + 1]) : 30;
    if (!Number.isInteger(days) || days < 1) throw new Error('Informe --days com um número inteiro ≥ 1.');
    const result = await trash.purge({ days });
    return console.log(`✓ ${result.purged} item(ns) purgado(s) (mais antigos que ${days} dias).`);
  }

  if (command === 'recover') {
    const result = await trash.recoverPending({ minAgeMs: 0 });
    return console.log(`✓ ${result.recovered} operação(ões) interrompida(s) revertida(s).`);
  }

  throw new Error(`Comando desconhecido: ${command}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
