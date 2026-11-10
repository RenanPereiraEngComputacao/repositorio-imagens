const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const { setup, login, seedLegacy, makeImage, binaryParser } = require('./helpers');

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

test('URLs públicas legadas continuam funcionando (página e arquivo)', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'legado', reference: '217.0004VT', images: 2 });
  const page = await request(env.app).get('/imagens/217.0004VT');
  assert.equal(page.status, 200);
  assert.match(page.text, /217\.0004VT/);
  assert.equal((await request(env.app).get('/imagens/217.0004vt')).status, 200, 'busca sem diferenciar maiúsculas');

  const file = await request(env.app).get(seed.images[0].file_url).buffer(true).parse(binaryParser);
  assert.equal(file.status, 200);
  assert.ok(file.body.equals(seed.images[0].buffer));
});

test('download individual entrega o arquivo original, byte a byte', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'download', reference: 'DWN.0001', images: 2 });
  const response = await request(env.app).get(`/download/DWN.0001/${seed.images[1].id}`).buffer(true).parse(binaryParser);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-disposition'], /attachment; filename="MALAGAH-DWN\.0001-02\.jpg"/);
  assert.ok(response.body.equals(seed.images[1].buffer));
});

test('ZIP contém todas as imagens do produto, na ordem, com os originais', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'zip', reference: 'ZIP.0001', images: 3 });
  const response = await request(env.app).get('/download/ZIP.0001/todas').buffer(true).parse(binaryParser);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.match(response.headers['content-disposition'], /MALAGAH-ZIP\.0001-imagens\.zip/);

  const zip = new AdmZip(response.body);
  const entries = zip.getEntries().map((entry) => entry.entryName);
  assert.deepEqual(entries, ['MALAGAH-ZIP.0001-01.jpg', 'MALAGAH-ZIP.0001-02.jpg', 'MALAGAH-ZIP.0001-03.jpg']);
  seed.images.forEach((image, index) => {
    assert.ok(zip.getEntry(entries[index]).getData().equals(image.buffer), `entrada ${index + 1} íntegra`);
  });
});

test('ZIP de produto inexistente ou sem imagens retorna 404', async () => {
  assert.equal((await request(env.app).get('/download/NAO.EXISTE/todas')).status, 404);
  await seedLegacy(env.db, env.uploadRoot, { slug: 'vazio', reference: 'VAZ.0001', images: 0 });
  assert.equal((await request(env.app).get('/download/VAZ.0001/todas')).status, 404);
});

test('upload preserva o original, gera versões otimizadas e define a principal', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'upload', reference: 'UPL.0001', images: 0 });
  const big = await makeImage({ width: 3000, height: 3750 });
  const second = await makeImage({ width: 800, height: 1000, format: 'png' });

  const response = await agent.post(`/admin/products/${seed.product.id}/images`)
    .set('X-CSRF-Token', csrf).set('Accept', 'application/json')
    .attach('images', big, { filename: 'Foto Frente.jpg', contentType: 'image/jpeg' })
    .attach('images', second, { filename: 'costas.png', contentType: 'image/png' })
    .attach('images', Buffer.from('texto'), { filename: 'leia.txt', contentType: 'text/plain' });
  assert.equal(response.status, 200);
  assert.equal(response.body.results.filter((r) => r.ok).length, 2);
  assert.equal(response.body.results.filter((r) => !r.ok).length, 1, 'arquivo inválido falha sozinho, sem derrubar o lote');

  const rows = (await env.db.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order', [seed.product.id])).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.is_main).length, 1);
  assert.equal(rows[0].is_main, true);
  assert.equal(rows[0].width, 3000);
  assert.equal(rows[0].height, 3750);
  assert.equal(rows[0].mime_type, 'image/jpeg');
  assert.match(rows[0].file_path, /^imagens\/upload\/UPL\.0001\/\d+-[a-f0-9]{10}-Foto-Frente\.jpg$/);

  const download = await request(env.app).get(`/download/UPL.0001/${rows[0].id}`).buffer(true).parse(binaryParser);
  assert.ok(download.body.equals(big), 'download em resolução original');

  const display = await request(env.app).get(rows[0].display_url).buffer(true).parse(binaryParser);
  assert.equal(display.status, 200);
  const meta = await require('sharp')(display.body).metadata();
  assert.ok(meta.width <= 1600 && meta.height <= 1600);
  assert.equal((await request(env.app).get(rows[0].thumb_url)).status, 200);

  const page = await request(env.app).get('/imagens/UPL.0001');
  assert.ok(page.text.includes(rows[0].display_url), 'galeria usa a versão otimizada');
});

test('excluir a imagem principal promove outra e remove os arquivos da área pública', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'principal', reference: 'PRI.0001', images: 3 });
  const main = seed.images[0];
  const response = await agent.post(`/admin/products/${seed.product.id}/images/${main.id}/delete`)
    .set('X-CSRF-Token', csrf).set('Accept', 'application/json');
  assert.equal(response.status, 200);
  const rows = (await env.db.query('SELECT * FROM product_images WHERE product_id = $1', [seed.product.id])).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.is_main).length, 1);
  assert.equal((await request(env.app).get(main.file_url)).status, 404);
});

test('definir principal e reordenar só afetam imagens do próprio produto', async () => {
  const a = await seedLegacy(env.db, env.uploadRoot, { slug: 'ordem-a', reference: 'ORD.000A', images: 3 });
  const b = await seedLegacy(env.db, env.uploadRoot, { slug: 'ordem-b', reference: 'ORD.000B', images: 1 });

  const foreign = await agent.post(`/admin/products/${a.product.id}/images/${b.images[0].id}/main`)
    .set('X-CSRF-Token', csrf).set('Accept', 'application/json');
  assert.equal(foreign.status, 404);
  assert.equal((await env.db.query('SELECT is_main FROM product_images WHERE id = $1', [b.images[0].id])).rows[0].is_main, true);

  const ids = a.images.map((image) => String(image.id)).reverse();
  const reorder = await agent.post(`/admin/products/${a.product.id}/images/reorder`)
    .set('X-CSRF-Token', csrf).set('Accept', 'application/json')
    .send({ order: [b.images[0].id, ...ids] });
  assert.equal(reorder.status, 200);
  const order = (await env.db.query('SELECT id FROM product_images WHERE product_id = $1 ORDER BY display_order', [a.product.id])).rows.map((r) => String(r.id));
  assert.deepEqual(order, ids);
  assert.equal((await env.db.query('SELECT display_order FROM product_images WHERE id = $1', [b.images[0].id])).rows[0].display_order, 1);

  const setMain = await agent.post(`/admin/products/${a.product.id}/images/${a.images[2].id}/main`)
    .set('X-CSRF-Token', csrf).set('Accept', 'application/json');
  assert.equal(setMain.status, 200);
  const mains = (await env.db.query('SELECT id FROM product_images WHERE product_id = $1 AND is_main', [a.product.id])).rows;
  assert.deepEqual(mains.map((r) => Number(r.id)), [Number(a.images[2].id)]);
});

test('envio em massa vincula pela referência no nome do arquivo', async () => {
  await seedLegacy(env.db, env.uploadRoot, { slug: 'massa', reference: 'MAS.0001', images: 0 });
  const image = await makeImage({ width: 600, height: 750 });
  const response = await agent.post('/admin/upload/bulk')
    .set('X-CSRF-Token', csrf).set('Accept', 'application/json')
    .field('separator', '_')
    .attach('images', image, { filename: 'MAS.0001_01.jpg', contentType: 'image/jpeg' })
    .attach('images', image, { filename: 'NAO.0001_01.jpg', contentType: 'image/jpeg' });
  assert.equal(response.status, 200);
  assert.equal(response.body.imported, 1);
  assert.deepEqual(response.body.missing, ['NAO.0001']);
});

test('importação de planilha: simula sem gravar, depois cria/atualiza sem duplicar', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'inverno-27', name: 'INVERNO 27', reference: '818.0008VT', images: 0 });
  const sheet = XLSX.utils.json_to_sheet([
    { REFERENCIA_PRODUTO: '818.0008vt', DESCRICAO_PRODUTO: 'VESTIDO FESTA', CORES: 'ROSA', COLECAO_PRODUTO: 'INVERNO 27' },
    { REFERENCIA_PRODUTO: '818.0010VT', DESCRICAO_PRODUTO: 'VESTIDO BABADO', CORES: 'PRETO', COLECAO_PRODUTO: 'INVERNO 27' },
    { REFERENCIA_PRODUTO: '../hack', DESCRICAO_PRODUTO: 'X', COLECAO_PRODUTO: 'INVERNO 27' },
    { REFERENCIA_PRODUTO: '818.0012VT', DESCRICAO_PRODUTO: 'Y', COLECAO_PRODUTO: 'NAO EXISTE' }
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'VW');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });

  const simulated = await agent.post(`/admin/products/import?_csrf=${csrf}`).field('simulate', 'on').attach('file', buffer, 'lista.xlsx');
  assert.equal(simulated.status, 200);
  assert.match(simulated.text, /Resultado da simulação/);
  assert.equal((await env.db.query(`SELECT COUNT(*)::int AS n FROM products WHERE reference = '818.0010VT'`)).rows[0].n, 0);

  const applied = await agent.post(`/admin/products/import?_csrf=${csrf}`).attach('file', buffer, 'lista.xlsx');
  assert.equal(applied.status, 200);
  assert.match(applied.text, /Importação concluída/);
  const rows = (await env.db.query(`SELECT reference, name, description, collection_id FROM products WHERE collection_id = $1 ORDER BY reference`, [seed.collection.id])).rows;
  assert.deepEqual(rows.map((r) => r.reference), ['818.0008VT', '818.0010VT']);
  assert.equal(rows[0].name, 'VESTIDO FESTA', 'referência existente atualizada sem diferenciar maiúsculas');
  assert.equal((await env.db.query(`SELECT COUNT(*)::int AS n FROM products WHERE reference ILIKE '%hack%'`)).rows[0].n, 0);
});

test('dashboard e listagens respondem com dados reais, filtros e paginação', async () => {
  const dashboard = await agent.get('/admin/dashboard');
  assert.equal(dashboard.status, 200);
  const products = (await env.db.query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n;
  assert.match(dashboard.text, new RegExp(`<span class="stat-value">${products}</span>`));

  for (let index = 0; index < 30; index += 1) {
    await env.db.query(`INSERT INTO products (collection_id, reference) SELECT id, $1 FROM collections ORDER BY id LIMIT 1`, [`PAG.${String(index).padStart(4, '0')}`]);
  }
  const page1 = await agent.get('/admin/products?q=PAG.&view=list');
  assert.equal(page1.status, 200);
  assert.match(page1.text, /Exibindo 1–24 de 30 produtos/);
  const page2 = await agent.get('/admin/products?q=PAG.&view=list&page=2');
  assert.match(page2.text, /Exibindo 25–30 de 30 produtos/);
  const without = await agent.get('/admin/products?images=without&q=PAG.0001');
  assert.match(without.text, /PAG\.0001/);

  for (const url of ['/admin/collections', '/admin/upload?reference=PAG', '/admin/atividade', '/admin/lixeira', '/admin/products/import', '/admin/collections/new', '/admin/products/new']) {
    assert.equal((await agent.get(url)).status, 200, url);
  }
});

test('arquivos derivados existentes podem ser gerados para imagens legadas sem tocar no original', async () => {
  const seed = await seedLegacy(env.db, env.uploadRoot, { slug: 'derivados', reference: 'DER.0001', images: 1 });
  const original = path.join(env.uploadRoot, 'derivados', 'DER.0001', 'legado-1.jpg');
  const before = fs.readFileSync(original);
  const { inspectImage, createDerivatives } = require('../src/services/image-processing');
  const info = await inspectImage(original);
  assert.equal(info.mime, 'image/jpeg');
  await createDerivatives(original, path.join(path.dirname(original), '_web'), 'legado-1');
  assert.ok(fs.readFileSync(original).equals(before));
  assert.ok(fs.existsSync(path.join(path.dirname(original), '_web', 'legado-1.display.webp')));
  assert.ok(seed);
});
