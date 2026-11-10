const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { setup, login, extractCsrf, seedLegacy } = require('./helpers');

let env;

before(async () => {
  env = await setup();
});

after(async () => {
  await env.teardown();
});

test('rotas administrativas exigem login', async () => {
  for (const url of ['/admin/dashboard', '/admin/collections', '/admin/products', '/admin/upload', '/admin/atividade', '/admin/lixeira', '/admin/collections/1/excluir']) {
    const response = await request(env.app).get(url);
    assert.equal(response.status, 302, url);
    assert.equal(response.headers.location, '/admin/login', url);
  }
  const json = await request(env.app).post('/admin/products/1/images').set('Accept', 'application/json');
  assert.ok([401, 403].includes(json.status));
});

test('POST sem token CSRF é bloqueado mesmo autenticado', async () => {
  const { agent } = await login(env.app);
  const response = await agent.post('/admin/collections').type('form').send({ name: 'Sem token' });
  assert.equal(response.status, 403);
  const total = await env.db.query(`SELECT COUNT(*)::int AS n FROM collections WHERE name = 'Sem token'`);
  assert.equal(total.rows[0].n, 0);
});

test('importação de planilha também exige CSRF (antes não exigia)', async () => {
  const { agent } = await login(env.app);
  const response = await agent.post('/admin/products/import').attach('file', Buffer.from('x'), 'a.xlsx');
  assert.equal(response.status, 403);
});

test('login: credenciais erradas, cookie de sessão preservado e limite de tentativas', async () => {
  const agent = request.agent(env.app);
  const page = await agent.get('/admin/login');
  const csrf = extractCsrf(page.text);
  const bad = await agent.post('/admin/login').type('form').send({ _csrf: csrf, username: 'admin', password: 'errada' });
  assert.equal(bad.status, 401);

  const good = await login(env.app);
  const cookies = (await good.agent.get('/admin/dashboard')).request.cookies || '';
  assert.match(String(cookies), /stylezee\.sid=/, 'nome do cookie legado mantido para preservar sessões');

  const { resetLoginAttempts } = require('../src/middleware/auth');
  resetLoginAttempts();
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    last = await agent.post('/admin/login').type('form').send({ _csrf: csrf, username: 'admin', password: 'errada' });
  }
  assert.equal(last.status, 429);
  resetLoginAttempts();
});

test('download ignora caminhos adulterados no banco (path traversal)', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'seguranca', reference: 'SEG.0001', images: 1 });
  const outside = path.join(env.root, 'segredo.txt');
  fs.writeFileSync(outside, 'segredo');

  for (const evil of ['imagens/../segredo.txt', 'imagens/seguranca/../../segredo.txt', '/etc/passwd', `imagens/${outside}`, 'imagens/a\\..\\..\\segredo.txt', '../segredo.txt']) {
    await env.db.query('UPDATE product_images SET file_path = $1 WHERE id = $2', [evil, seed.images[0].id]);
    const single = await request(env.app).get(`/download/SEG.0001/${seed.images[0].id}`);
    assert.equal(single.status, 404, evil);
    const zip = await request(env.app).get('/download/SEG.0001/todas');
    assert.equal(zip.status, 404, evil);
  }
});

test('download recusa link simbólico apontando para fora da pasta de imagens', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'symlink', reference: 'SYM.0001', images: 1 });
  const outside = path.join(env.root, 'fora.txt');
  fs.writeFileSync(outside, 'fora');
  const link = path.join(env.uploadRoot, 'symlink', 'SYM.0001', 'link.jpg');
  fs.symlinkSync(outside, link);
  await env.db.query('UPDATE product_images SET file_path = $1 WHERE id = $2', ['imagens/symlink/SYM.0001/link.jpg', seed.images[0].id]);
  const response = await request(env.app).get(`/download/SYM.0001/${seed.images[0].id}`);
  assert.equal(response.status, 404);
});

test('imagem de outro produto não pode ser baixada pela referência errada', async () => {
  const a = await seedLegacy(env.db, env.uploadRoot, { slug: 'cruz-a', reference: 'CRZ.000A', images: 1 });
  await seedLegacy(env.db, env.uploadRoot, { slug: 'cruz-b', reference: 'CRZ.000B', images: 1 });
  const response = await request(env.app).get(`/download/CRZ.000B/${a.images[0].id}`);
  assert.equal(response.status, 404);
  const invalid = await request(env.app).get('/download/CRZ.000A/1e3');
  assert.equal(invalid.status, 404);
});

test('produto inativo ou coleção inativa não aparece publicamente', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'inativa', reference: 'INA.0001', images: 1, active: false });
  assert.equal((await request(env.app).get('/imagens/INA.0001')).status, 404);
  assert.equal((await request(env.app).get(`/download/INA.0001/${seed.images[0].id}`)).status, 404);
  assert.equal((await request(env.app).get('/download/INA.0001/todas')).status, 404);

  const other = await seedLegacy(env.db, env.uploadRoot, { slug: 'colecao-off', reference: 'OFF.0001', images: 1 });
  await env.db.query('UPDATE collections SET active = FALSE WHERE id = $1', [other.collection.id]);
  assert.equal((await request(env.app).get('/imagens/OFF.0001')).status, 404);
});

test('arquivo que não é imagem é recusado mesmo com extensão .jpg', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'falsa', reference: 'FAK.0001', images: 0 });
  const { agent, csrf } = await login(env.app);
  const response = await agent.post(`/admin/products/${seed.product.id}/images`)
    .set('X-CSRF-Token', csrf).set('Accept', 'application/json')
    .attach('images', Buffer.from('<?php echo 1; ?>'), { filename: 'foto.jpg', contentType: 'image/jpeg' });
  assert.equal(response.status, 422);
  assert.equal(response.body.results[0].ok, false);
  const total = await env.db.query('SELECT COUNT(*)::int AS n FROM product_images WHERE product_id = $1', [seed.product.id]);
  assert.equal(total.rows[0].n, 0);
  const folder = path.join(env.uploadRoot, 'falsa', 'FAK.0001');
  assert.deepEqual(fs.readdirSync(folder), []);
  const tmp = path.join(process.env.TMP_ROOT, 'uploads');
  assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp) : [], []);
});

test('mensagens de erro internas não são expostas', async () => {
  const { agent } = await login(env.app);
  const response = await agent.get('/admin/products/99999999999/edit');
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.text, /at .*\.js:\d+/);
});

test('cabeçalhos de segurança presentes', async () => {
  const response = await request(env.app).get('/admin/login');
  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-powered-by'], undefined);
});
