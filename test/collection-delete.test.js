const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { setup, login, extractCsrf, seedLegacy, binaryParser } = require('./helpers');

let env;
let agent;
let csrf;

before(async () => {
  env = await setup();
  ({ agent, csrf } = await login(env.app));
});

after(async () => {
  await env.teardown();
});

async function count(sql, params) {
  return Number((await env.db.query(sql, params)).rows[0].count);
}

async function startDeletion(collectionId) {
  const step1 = await agent.get(`/admin/collections/${collectionId}/excluir`);
  assert.equal(step1.status, 200);
  const step2 = await agent.post(`/admin/collections/${collectionId}/excluir/confirmar`).type('form').send({ _csrf: csrf });
  assert.equal(step2.status, 200);
  const intent = /name="intent" value="([a-f0-9]+)"/.exec(step2.text)[1];
  const phrase = /data-phrase>([^<]+)</.exec(step2.text)[1];
  return { step1, step2, intent, phrase };
}

test('etapa 1 mostra nome, produtos e imagens afetados', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'etapa-um', name: 'Coleção Etapa Um', reference: 'ETP.0001', images: 3 });
  const { step1, step2, phrase } = await startDeletion(seed.collection.id);
  assert.match(step1.text, /Coleção Etapa Um/);
  assert.match(step1.text, /<span class="eyebrow">Produtos<\/span><strong>1<\/strong>/);
  assert.match(step1.text, /<span class="eyebrow">Imagens<\/span><strong>3<\/strong>/);
  assert.equal(phrase, 'EXCLUIR etapa-um');
  assert.match(step2.text, /1 produto<\/strong> e <strong>3 imagens/);
});

test('sem a etapa de confirmação (token) nada é excluído', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'sem-token', reference: 'SEM.0001' });
  const response = await agent.post(`/admin/collections/${seed.collection.id}/excluir`).type('form')
    .send({ _csrf: csrf, intent: 'a'.repeat(48), phrase: 'EXCLUIR sem-token' });
  assert.equal(response.status, 302);
  assert.equal(await count('SELECT COUNT(*) FROM collections WHERE id = $1', [seed.collection.id]), 1);
  assert.ok(fs.existsSync(path.join(env.uploadRoot, 'sem-token', 'SEM.0001', 'legado-1.jpg')));
});

test('frase incorreta é rejeitada no servidor e nada é excluído', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'frase-errada', reference: 'FRA.0001' });
  const { intent } = await startDeletion(seed.collection.id);
  const response = await agent.post(`/admin/collections/${seed.collection.id}/excluir`).type('form')
    .send({ _csrf: csrf, intent, phrase: 'excluir frase-errada' });
  assert.equal(response.status, 422);
  assert.match(response.text, /não confere/);
  assert.equal(await count('SELECT COUNT(*) FROM products WHERE collection_id = $1', [seed.collection.id]), 1);
  assert.equal(await count(`SELECT COUNT(*) FROM audit_log WHERE action = 'collection.delete' AND status = 'rejected' AND entity_id = $1`, [seed.collection.id]), 1);
});

test('requisição sem CSRF é bloqueada', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'sem-csrf', reference: 'CSR.0001' });
  const { intent, phrase } = await startDeletion(seed.collection.id);
  const response = await agent.post(`/admin/collections/${seed.collection.id}/excluir`).type('form').send({ intent, phrase });
  assert.equal(response.status, 403);
  assert.equal(await count('SELECT COUNT(*) FROM collections WHERE id = $1', [seed.collection.id]), 1);
});

test('exclusão confirmada remove registros, move arquivos para a lixeira e audita', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'excluir-ok', name: 'Excluir OK', reference: 'EXC.0001', images: 2 });
  const publicBefore = await request(env.app).get('/imagens/EXC.0001');
  assert.equal(publicBefore.status, 200);

  const { intent, phrase } = await startDeletion(seed.collection.id);
  const response = await agent.post(`/admin/collections/${seed.collection.id}/excluir`).type('form').send({ _csrf: csrf, intent, phrase });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/admin/collections');

  assert.equal(await count('SELECT COUNT(*) FROM collections WHERE id = $1', [seed.collection.id]), 0);
  assert.equal(await count('SELECT COUNT(*) FROM products WHERE id = $1', [seed.product.id]), 0);
  assert.equal(await count('SELECT COUNT(*) FROM product_images WHERE product_id = $1', [seed.product.id]), 0);

  // Arquivos saíram da área pública…
  assert.equal(fs.existsSync(path.join(env.uploadRoot, 'excluir-ok')), false);
  // …e estão na lixeira com manifesto.
  const entry = (await env.db.query(`SELECT * FROM trash_entries WHERE entity_type = 'collection' AND entity_id = $1`, [seed.collection.id])).rows[0];
  assert.ok(entry);
  assert.equal(entry.products_count, 1);
  assert.equal(entry.images_count, 2);
  assert.equal(entry.files_count, 2);
  assert.ok(fs.existsSync(path.join(entry.trash_dir, 'arquivos', 'excluir-ok', 'EXC.0001', 'legado-1.jpg')));
  const manifest = JSON.parse(fs.readFileSync(path.join(entry.trash_dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'committed');
  assert.ok(!entry.trash_dir.startsWith(env.uploadRoot));

  const audit = (await env.db.query(`SELECT * FROM audit_log WHERE action = 'collection.delete' AND status = 'success' AND entity_id = $1`, [seed.collection.id])).rows[0];
  assert.ok(audit);
  assert.equal(audit.actor, 'admin');
  assert.equal(audit.details.images, 2);

  const publicAfter = await request(env.app).get('/imagens/EXC.0001');
  assert.equal(publicAfter.status, 404);
  const fileAfter = await request(env.app).get('/imagens/excluir-ok/EXC.0001/legado-1.jpg');
  assert.equal(fileAfter.status, 404);

  // Token é de uso único: reenviar não faz nada.
  const replay = await agent.post(`/admin/collections/${seed.collection.id}/excluir`).type('form').send({ _csrf: csrf, intent, phrase });
  assert.equal(replay.status, 302);
});

test('se a coleção mudar depois da confirmação, a exclusão é cancelada', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'mudou', reference: 'MUD.0001', images: 1 });
  const { intent, phrase } = await startDeletion(seed.collection.id);
  await env.db.query('INSERT INTO products (collection_id, reference) VALUES ($1, $2)', [seed.collection.id, 'MUD.0002']);

  const response = await agent.post(`/admin/collections/${seed.collection.id}/excluir`).type('form').send({ _csrf: csrf, intent, phrase });
  assert.equal(response.status, 302);
  assert.equal(await count('SELECT COUNT(*) FROM products WHERE collection_id = $1', [seed.collection.id]), 2);
  assert.ok(fs.existsSync(path.join(env.uploadRoot, 'mudou', 'MUD.0001', 'legado-1.jpg')));
});

test('confirmação expirada não exclui', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'expirada', reference: 'EXP.0001' });
  const { intent, phrase } = await startDeletion(seed.collection.id);
  // Força a expiração editando a sessão gravada no banco.
  await env.db.query(`UPDATE session SET sess = jsonb_set(sess::jsonb, '{collectionDeletion,expiresAt}', '1')::json WHERE sess::jsonb ? 'collectionDeletion'`);
  const response = await agent.post(`/admin/collections/${seed.collection.id}/excluir`).type('form').send({ _csrf: csrf, intent, phrase });
  assert.equal(response.status, 302);
  assert.equal(await count('SELECT COUNT(*) FROM collections WHERE id = $1', [seed.collection.id]), 1);
});

test('exclusões simultâneas: apenas uma é executada e os arquivos ficam consistentes', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'simultanea', reference: 'SIM.0001', images: 3 });
  const trash = require('../src/services/trash');
  const fakeReq = { session: { admin: { username: 'admin' } }, ip: '127.0.0.1', get: () => 'teste' };

  const results = await Promise.allSettled([
    trash.deleteCollection({ req: fakeReq, collectionId: seed.collection.id }),
    trash.deleteCollection({ req: fakeReq, collectionId: seed.collection.id }),
    trash.deleteCollection({ req: fakeReq, collectionId: seed.collection.id })
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 2);
  rejected.forEach((r) => assert.ok([404, 409].includes(r.reason.status), r.reason.message));

  assert.equal(await count(`SELECT COUNT(*) FROM trash_entries WHERE entity_type = 'collection' AND entity_id = $1`, [seed.collection.id]), 1);
  const entry = (await env.db.query(`SELECT trash_dir, files_count FROM trash_entries WHERE entity_type = 'collection' AND entity_id = $1`, [seed.collection.id])).rows[0];
  assert.equal(entry.files_count, 3);
  assert.equal(fs.readdirSync(path.join(entry.trash_dir, 'arquivos', 'simultanea', 'SIM.0001')).length, 3);
});

test('falha no banco durante a exclusão devolve os arquivos (operação coordenada)', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'falha-banco', reference: 'FAL.0001', images: 2 });
  await env.db.query(`CREATE OR REPLACE FUNCTION test_block_delete() RETURNS trigger AS $$
    BEGIN IF OLD.slug = 'falha-banco' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql`);
  await env.db.query('CREATE TRIGGER test_block_delete BEFORE DELETE ON collections FOR EACH ROW EXECUTE FUNCTION test_block_delete()');

  try {
    const trash = require('../src/services/trash');
    await assert.rejects(trash.deleteCollection({ req: null, collectionId: seed.collection.id }));
  } finally {
    await env.db.query('DROP TRIGGER test_block_delete ON collections');
  }

  assert.equal(await count('SELECT COUNT(*) FROM product_images WHERE product_id = $1', [seed.product.id]), 2);
  for (const image of seed.images) {
    const file = path.join(env.uploadRoot, image.file_path.replace(/^imagens\//, ''));
    assert.ok(fs.existsSync(file), `arquivo deveria ter voltado: ${file}`);
  }
  assert.equal(await count(`SELECT COUNT(*) FROM audit_log WHERE action = 'collection.delete' AND status = 'failure' AND entity_id = $1`, [seed.collection.id]), 1);
  const public200 = await request(env.app).get('/imagens/FAL.0001');
  assert.equal(public200.status, 200);
});

test('restauração devolve registros, arquivos e a URL pública original', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'restaurar', reference: 'RES.0001', images: 2 });
  const trash = require('../src/services/trash');
  const deleted = await trash.deleteCollection({ req: null, collectionId: seed.collection.id });
  assert.equal((await request(env.app).get('/imagens/RES.0001')).status, 404);

  const restored = await trash.restore(deleted.trashEntryId);
  assert.equal(restored.files, 2);

  assert.equal((await request(env.app).get('/imagens/RES.0001')).status, 200);
  const file = await request(env.app).get(seed.images[0].file_url).buffer(true).parse(binaryParser);
  assert.equal(file.status, 200);
  assert.ok(file.body.equals(seed.images[0].buffer));
  assert.equal(await count('SELECT COUNT(*) FROM product_images WHERE product_id = $1 AND is_main', [seed.product.id]), 1);
  const status = (await env.db.query('SELECT status FROM trash_entries WHERE id = $1', [deleted.trashEntryId])).rows[0].status;
  assert.equal(status, 'restored');
  await assert.rejects(trash.restore(deleted.trashEntryId), /não pode ser restaurado/);
});

test('operação interrompida (queda entre mover arquivos e gravar) é revertida no start', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'interrompida', reference: 'INT.0001', images: 1 });
  const original = path.join(env.uploadRoot, 'interrompida', 'INT.0001', 'legado-1.jpg');
  const trashDir = path.join(env.trashRoot, '20200101-000000-collection-999-teste');
  const moved = path.join(trashDir, 'arquivos', 'interrompida', 'INT.0001', 'legado-1.jpg');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.renameSync(original, moved);
  fs.writeFileSync(path.join(trashDir, 'manifest.json'), JSON.stringify({
    status: 'pending',
    createdAt: '2020-01-01T00:00:00Z',
    files: [{ stored: seed.images[0].file_path, relative: 'interrompida/INT.0001/legado-1.jpg' }]
  }));

  const trash = require('../src/services/trash');
  const result = await trash.recoverPending({ log: () => {} });
  assert.equal(result.recovered, 1);
  assert.ok(fs.existsSync(original));
  assert.equal(JSON.parse(fs.readFileSync(path.join(trashDir, 'manifest.json'), 'utf8')).status, 'rolled_back');
});

test('excluir produto exige digitar a referência', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'produto-del', reference: 'PRD.0001', images: 1 });
  const wrong = await agent.post(`/admin/products/${seed.product.id}/excluir`).type('form').send({ _csrf: csrf, confirm_reference: 'outra' });
  assert.equal(wrong.status, 302);
  assert.equal(await count('SELECT COUNT(*) FROM products WHERE id = $1', [seed.product.id]), 1);

  const ok = await agent.post(`/admin/products/${seed.product.id}/excluir`).type('form').send({ _csrf: csrf, confirm_reference: 'prd.0001' });
  assert.equal(ok.status, 302);
  assert.equal(await count('SELECT COUNT(*) FROM products WHERE id = $1', [seed.product.id]), 0);
  assert.equal(fs.existsSync(path.join(env.uploadRoot, 'produto-del', 'PRD.0001', 'legado-1.jpg')), false);
  assert.equal(await count('SELECT COUNT(*) FROM collections WHERE id = $1', [seed.collection.id]), 1);
});

test('página da lixeira lista e restaura pelo painel', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'painel-restore', reference: 'PNL.0001', images: 1 });
  const trash = require('../src/services/trash');
  const deleted = await trash.deleteProduct({ req: null, productId: seed.product.id });
  const page = await agent.get('/admin/lixeira');
  assert.equal(page.status, 200);
  assert.match(page.text, /Produto PNL\.0001/);
  const token = extractCsrf(page.text);
  const response = await agent.post(`/admin/lixeira/${deleted.trashEntryId}/restaurar`).type('form').send({ _csrf: token });
  assert.equal(response.status, 302);
  assert.equal(await count('SELECT COUNT(*) FROM products WHERE id = $1', [seed.product.id]), 1);
});
