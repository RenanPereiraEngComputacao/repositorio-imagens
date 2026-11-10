/**
 * Lixeira coordenada entre banco de dados e arquivos físicos.
 *
 * Fluxo de exclusão (coleção, produto ou imagem):
 *   1. Bloqueia os registros no banco (advisory lock + SELECT ... FOR UPDATE NOWAIT).
 *   2. Grava um manifesto (status "pending") na pasta da lixeira.
 *   3. Move os arquivos para a lixeira (fora da pasta pública).
 *   4. Remove os registros, grava trash_entries + audit_log e faz COMMIT.
 *   5. Se qualquer passo falhar, os arquivos voltam ao lugar original e nada é removido.
 *   6. Se o processo cair entre 3 e 4, recoverPending() devolve os arquivos no próximo start.
 *
 * Tudo que vai para a lixeira pode ser restaurado com `npm run trash:restore -- <id>`.
 */
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { pool } = require('../db');
const audit = require('./audit');
const storage = require('./storage');
const { AppError, notFound, conflict } = require('../utils/errors');
const { safeSegment } = require('../utils/text');

const LOCK_NAMESPACES = { collection: 7246, product: 7247, image: 7248 };
const MANIFEST = 'manifest.json';

function trashRoot() {
  return path.resolve(config.trashRoot);
}

function timestampForFolder(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

async function writeManifest(dir, manifest) {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, MANIFEST);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2));
  await fs.rename(temporary, target);
}

async function readManifest(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, MANIFEST), 'utf8'));
}

/** Lista os arquivos físicos (original + derivados) de um conjunto de imagens. */
function filesForImages(images) {
  const files = [];
  const invalid = [];
  for (const image of images) {
    for (const column of ['file_path', 'display_path', 'thumb_path']) {
      const value = image[column];
      if (!value) continue;
      const absolute = storage.resolveStoredPath(value);
      if (!absolute) {
        invalid.push({ imageId: image.id, column, value });
        continue;
      }
      files.push({ imageId: image.id, column, stored: value, from: absolute, relative: storage.relativeToUploadRoot(absolute) });
    }
  }
  return { files, invalid };
}

async function moveIntoTrash(trashDir, files) {
  const moved = [];
  const missing = [];
  let bytes = 0;
  for (const file of files) {
    const safe = await storage.assertSafeFile(file.from);
    if (!safe) {
      missing.push(file.stored);
      continue;
    }
    const to = path.join(trashDir, 'arquivos', file.relative);
    await storage.moveFile(file.from, to);
    bytes += safe.size;
    moved.push({ ...file, to, size: safe.size });
  }
  return { moved, missing, bytes };
}

async function moveBack(moved) {
  const failures = [];
  for (const file of [...moved].reverse()) {
    try {
      await storage.moveFile(file.to, file.from);
    } catch (error) {
      failures.push({ file: file.stored, error: error.message });
    }
  }
  if (failures.length) {
    console.error('[trash] falha ao devolver arquivos:', failures);
  }
  return failures;
}

function translateLockError(error) {
  if (error && error.code === '55P03') {
    return conflict('Outra operação está alterando estes registros agora. Aguarde alguns segundos e tente novamente.');
  }
  return error;
}

/**
 * Exclusão genérica. `loadTargets(client)` deve bloquear e devolver
 * { label, collection?, products: [], images: [] }.
 */
async function trashAndDelete({ req, entityType, entityId, loadTargets, verify, deleteRows, action }) {
  const client = await pool.connect();
  let moved = [];
  let trashDir = null;

  try {
    await client.query('BEGIN');

    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', [LOCK_NAMESPACES[entityType], Number(entityId)]);
    if (!lock.rows[0].ok) {
      throw conflict('Já existe uma exclusão em andamento para este item.');
    }

    const targets = await loadTargets(client).catch((error) => {
      throw translateLockError(error);
    });
    if (verify) verify(targets);

    const { files, invalid } = filesForImages(targets.images);
    const actor = audit.requestMeta(req).actor;
    trashDir = path.join(trashRoot(), `${timestampForFolder()}-${entityType}-${entityId}-${safeSegment(targets.label).slice(0, 60)}`);

    const manifest = {
      version: 1,
      status: 'pending',
      createdAt: new Date().toISOString(),
      actor,
      entityType,
      entityId: Number(entityId),
      label: targets.label,
      uploadRoot: storage.uploadRoot(),
      collection: targets.collection || null,
      products: targets.products,
      images: targets.images,
      files: files.map(({ stored, relative, imageId, column }) => ({ stored, relative, imageId, column })),
      invalidPaths: invalid
    };
    await writeManifest(trashDir, manifest);

    const result = await moveIntoTrash(trashDir, files);
    moved = result.moved;

    await deleteRows(client, targets);

    const entry = await client.query(
      `INSERT INTO trash_entries
         (created_by, entity_type, entity_id, label, trash_dir, products_count, images_count, files_count, bytes_total, manifest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        actor,
        entityType,
        entityId,
        targets.label,
        trashDir,
        targets.products.length,
        targets.images.length,
        moved.length,
        result.bytes,
        JSON.stringify({ ...manifest, status: 'committed', missingFiles: result.missing })
      ]
    );

    await audit.record({
      req,
      action,
      entityType,
      entityId,
      summary: `${targets.label} enviado(a) para a lixeira`,
      details: {
        trashEntryId: entry.rows[0].id,
        products: targets.products.length,
        images: targets.images.length,
        filesMoved: moved.length,
        missingFiles: result.missing.length,
        invalidPaths: invalid.length,
        bytes: result.bytes
      }
    }, client);

    await client.query('COMMIT');

    manifest.status = 'committed';
    manifest.trashEntryId = entry.rows[0].id;
    manifest.missingFiles = result.missing;
    await writeManifest(trashDir, manifest).catch((error) => console.error('[trash] manifesto:', error.message));
    await storage.pruneEmptyDirectories(moved.map((file) => path.dirname(file.from)));

    return {
      trashEntryId: entry.rows[0].id,
      label: targets.label,
      products: targets.products.length,
      images: targets.images.length,
      filesMoved: moved.length,
      missingFiles: result.missing.length,
      bytes: result.bytes
    };
  } catch (rawError) {
    const error = translateLockError(rawError);
    await client.query('ROLLBACK').catch(() => {});
    const failures = await moveBack(moved);
    if (trashDir) {
      try {
        const manifest = await readManifest(trashDir);
        manifest.status = failures.length ? 'rollback_incomplete' : 'rolled_back';
        manifest.error = error.message;
        manifest.rollbackFailures = failures;
        await writeManifest(trashDir, manifest);
      } catch {
        /* manifesto pode não existir se a falha foi antes de gravá-lo */
      }
    }
    if (!(error instanceof AppError) || error.status >= 500) {
      await audit.record({
        req,
        action,
        entityType,
        entityId,
        status: 'failure',
        summary: 'Falha na exclusão — nenhum dado foi removido',
        details: { error: error.message, rollbackFailures: failures.length }
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/* Impacto (pré-visualização da exclusão)                              */
/* ------------------------------------------------------------------ */

async function collectionImpact(collectionId, runner = pool) {
  const result = await runner.query(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM products p WHERE p.collection_id = c.id) AS products_count,
            (SELECT COUNT(*)::int FROM products p WHERE p.collection_id = c.id AND p.active) AS active_products_count,
            (SELECT COUNT(*)::int FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE p.collection_id = c.id) AS images_count,
            (SELECT COALESCE(SUM(pi.size_bytes), 0)::bigint FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE p.collection_id = c.id) AS known_bytes
       FROM collections c
      WHERE c.id = $1`,
    [collectionId]
  );
  return result.rows[0] || null;
}

/* ------------------------------------------------------------------ */
/* Operações específicas                                               */
/* ------------------------------------------------------------------ */

function deleteCollection({ req, collectionId, expected }) {
  return trashAndDelete({
    req,
    entityType: 'collection',
    entityId: collectionId,
    action: 'collection.delete',
    async loadTargets(client) {
      const collection = await client.query('SELECT * FROM collections WHERE id = $1 FOR UPDATE NOWAIT', [collectionId]);
      if (!collection.rowCount) throw notFound('A coleção não existe mais — talvez já tenha sido excluída.');
      const products = await client.query('SELECT * FROM products WHERE collection_id = $1 ORDER BY id FOR UPDATE NOWAIT', [collectionId]);
      const ids = products.rows.map((row) => row.id);
      const images = ids.length
        ? await client.query('SELECT * FROM product_images WHERE product_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE NOWAIT', [ids])
        : { rows: [] };
      return {
        label: `Coleção ${collection.rows[0].name}`,
        collection: collection.rows[0],
        products: products.rows,
        images: images.rows
      };
    },
    verify(targets) {
      if (!expected) return;
      if (targets.products.length !== Number(expected.products) || targets.images.length !== Number(expected.images)) {
        throw conflict('A coleção foi alterada desde a confirmação (produtos ou imagens mudaram). Revise o impacto e confirme novamente.');
      }
    },
    async deleteRows(client, targets) {
      const ids = targets.products.map((row) => row.id);
      if (ids.length) {
        await client.query('DELETE FROM product_images WHERE product_id = ANY($1::bigint[])', [ids]);
        await client.query('DELETE FROM products WHERE id = ANY($1::bigint[])', [ids]);
      }
      const removed = await client.query('DELETE FROM collections WHERE id = $1', [targets.collection.id]);
      if (removed.rowCount !== 1) throw conflict('A coleção não pôde ser removida.');
    }
  });
}

function deleteProduct({ req, productId }) {
  return trashAndDelete({
    req,
    entityType: 'product',
    entityId: productId,
    action: 'product.delete',
    async loadTargets(client) {
      const product = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE NOWAIT', [productId]);
      if (!product.rowCount) throw notFound('O produto não existe mais.');
      const images = await client.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY id FOR UPDATE NOWAIT', [productId]);
      return { label: `Produto ${product.rows[0].reference}`, products: product.rows, images: images.rows };
    },
    async deleteRows(client, targets) {
      await client.query('DELETE FROM product_images WHERE product_id = $1', [targets.products[0].id]);
      await client.query('DELETE FROM products WHERE id = $1', [targets.products[0].id]);
    }
  });
}

function deleteImage({ req, productId, imageId }) {
  return trashAndDelete({
    req,
    entityType: 'image',
    entityId: imageId,
    action: 'image.delete',
    async loadTargets(client) {
      const product = await client.query('SELECT id, reference FROM products WHERE id = $1 FOR UPDATE NOWAIT', [productId]);
      if (!product.rowCount) throw notFound('Produto não encontrado.');
      const image = await client.query('SELECT * FROM product_images WHERE id = $1 AND product_id = $2 FOR UPDATE NOWAIT', [imageId, productId]);
      if (!image.rowCount) throw notFound('A imagem não existe mais.');
      return { label: `Imagem ${imageId} de ${product.rows[0].reference}`, products: [], images: image.rows, productId };
    },
    async deleteRows(client, targets) {
      const image = targets.images[0];
      await client.query('DELETE FROM product_images WHERE id = $1', [image.id]);
      if (image.is_main) {
        await client.query(
          `UPDATE product_images SET is_main = TRUE
            WHERE id = (SELECT id FROM product_images WHERE product_id = $1 ORDER BY display_order ASC, id ASC LIMIT 1)`,
          [targets.productId]
        );
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Restauração / manutenção                                            */
/* ------------------------------------------------------------------ */

function insertRow(client, table, row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => {
    const value = row[column];
    return value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value;
  });
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return client.query(
    `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders.join(', ')})`,
    values
  );
}

async function restore(trashEntryId, { actor = 'cli' } = {}) {
  const client = await pool.connect();
  const restoredFiles = [];
  try {
    await client.query('BEGIN');
    const entryResult = await client.query('SELECT * FROM trash_entries WHERE id = $1 FOR UPDATE', [trashEntryId]);
    if (!entryResult.rowCount) throw notFound(`Item ${trashEntryId} não encontrado na lixeira.`);
    const entry = entryResult.rows[0];
    if (entry.status !== 'trashed') throw conflict(`Item ${trashEntryId} está com status "${entry.status}" e não pode ser restaurado.`);

    const manifest = entry.manifest;

    if (manifest.collection) {
      const clash = await client.query('SELECT id FROM collections WHERE id = $1 OR slug = $2', [manifest.collection.id, manifest.collection.slug]);
      if (clash.rowCount) throw conflict('Já existe uma coleção com o mesmo id ou slug. Renomeie-a antes de restaurar.');
      await insertRow(client, 'collections', manifest.collection);
    }

    for (const product of manifest.products) {
      const clash = await client.query('SELECT id FROM products WHERE id = $1 OR LOWER(reference) = LOWER($2)', [product.id, product.reference]);
      if (clash.rowCount) throw conflict(`A referência ${product.reference} já existe novamente. Restauração cancelada.`);
      const collection = await client.query('SELECT id FROM collections WHERE id = $1', [product.collection_id]);
      if (!collection.rowCount) throw conflict(`A coleção original do produto ${product.reference} não existe mais.`);
      await insertRow(client, 'products', product);
    }

    for (const image of manifest.images) {
      const product = await client.query('SELECT id FROM products WHERE id = $1', [image.product_id]);
      if (!product.rowCount) throw conflict(`O produto da imagem ${image.id} não existe mais.`);
      const clash = await client.query('SELECT id FROM product_images WHERE id = $1', [image.id]);
      if (clash.rowCount) throw conflict(`A imagem ${image.id} já existe.`);
      const hasMain = await client.query('SELECT 1 FROM product_images WHERE product_id = $1 AND is_main', [image.product_id]);
      await insertRow(client, 'product_images', { ...image, is_main: image.is_main && hasMain.rowCount === 0 });
    }

    for (const file of manifest.files) {
      const from = path.join(entry.trash_dir, 'arquivos', file.relative);
      const to = storage.resolveStoredPath(file.stored);
      if (!to) continue;
      try {
        await fs.access(from);
      } catch {
        continue; // arquivo já estava ausente no momento da exclusão
      }
      try {
        await fs.access(to);
        throw conflict(`Já existe um arquivo em ${file.stored}. Restauração cancelada.`);
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
      await storage.moveFile(from, to);
      restoredFiles.push({ from, to });
    }

    await client.query(`UPDATE trash_entries SET status = 'restored', restored_at = NOW() WHERE id = $1`, [trashEntryId]);
    await audit.record({
      action: `${entry.entity_type}.restore`,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      summary: `${entry.label} restaurado(a) da lixeira`,
      details: { trashEntryId, files: restoredFiles.length, actor }
    }, client);
    await client.query('COMMIT');

    const manifestOnDisk = await readManifest(entry.trash_dir).catch(() => null);
    if (manifestOnDisk) {
      manifestOnDisk.status = 'restored';
      await writeManifest(entry.trash_dir, manifestOnDisk).catch(() => {});
    }
    return { label: entry.label, files: restoredFiles.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    for (const file of restoredFiles.reverse()) {
      await storage.moveFile(file.to, file.from).catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

async function listEntries({ status, limit = 50 } = {}) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE status = $1';
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT id, created_at, created_by, entity_type, entity_id, label, products_count, images_count,
            files_count, bytes_total, status, restored_at, purged_at, trash_dir
       FROM trash_entries ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

/** Remove definitivamente da lixeira itens mais antigos que `days` dias. */
async function purge({ days = 30 } = {}) {
  const result = await pool.query(
    `SELECT id, trash_dir FROM trash_entries
      WHERE status = 'trashed' AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [days]
  );
  const root = trashRoot();
  let purged = 0;
  for (const row of result.rows) {
    const dir = path.resolve(row.trash_dir);
    if (!dir.startsWith(root + path.sep)) continue;
    await fs.rm(dir, { recursive: true, force: true });
    await pool.query(`UPDATE trash_entries SET status = 'purged', purged_at = NOW() WHERE id = $1`, [row.id]);
    purged += 1;
  }
  return { purged };
}

/**
 * Recupera operações interrompidas (queda do processo entre mover arquivos e o COMMIT).
 * Executado na inicialização do servidor.
 */
async function recoverPending({ minAgeMs = 60_000, log = console.log } = {}) {
  const root = trashRoot();
  let dirs = [];
  try {
    dirs = await fs.readdir(root);
  } catch {
    return { recovered: 0 };
  }

  let recovered = 0;
  for (const name of dirs) {
    const dir = path.join(root, name);
    let manifest;
    try {
      manifest = await readManifest(dir);
    } catch {
      continue;
    }
    if (manifest.status !== 'pending') continue;
    if (Date.now() - new Date(manifest.createdAt).getTime() < minAgeMs) continue;

    const entry = await pool.query('SELECT id FROM trash_entries WHERE trash_dir = $1', [dir]);
    if (entry.rowCount) {
      manifest.status = 'committed';
      manifest.trashEntryId = entry.rows[0].id;
      await writeManifest(dir, manifest);
      continue;
    }

    const moved = manifest.files.map((file) => ({
      stored: file.stored,
      from: storage.resolveStoredPath(file.stored),
      to: path.join(dir, 'arquivos', file.relative)
    })).filter((file) => file.from);
    const present = [];
    for (const file of moved) {
      try {
        await fs.access(file.to);
        present.push(file);
      } catch {
        /* não chegou a ser movido */
      }
    }
    const failures = await moveBack(present);
    manifest.status = failures.length ? 'rollback_incomplete' : 'rolled_back';
    manifest.recoveredAt = new Date().toISOString();
    await writeManifest(dir, manifest);
    recovered += 1;
    log(`[trash] operação interrompida revertida: ${name} (${present.length} arquivo(s) devolvido(s))`);
  }
  return { recovered };
}

module.exports = {
  collectionImpact,
  deleteCollection,
  deleteProduct,
  deleteImage,
  restore,
  listEntries,
  purge,
  recoverPending,
  trashRoot
};
