const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { query, transaction } = require('../db');
const {
  ensureAuthenticated,
  verifyAdminCredentials,
  setFlash,
  pullFlash,
  csrfProtection
} = require('../middleware/auth');
const { productImageUpload, bulkImageUpload } = require('../middleware/upload');
const { optimizeImage } = require('../services/image-processing');
const {
  getImageFolder,
  getPublicImageData,
  ensureFolder,
  removeStoredFile
} = require('../services/storage');
const {
  makeSlug,
  cleanReference,
  isValidReference,
  safeSegment
} = require('../utils/text');

const multer = require("multer");
const XLSX = require("xlsx");

const router = express.Router();

router.use(pullFlash);

router.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/products/import") {
    res.locals.csrfToken = "";
    return next();
  }

  return csrfProtection(req, res, next);
});


const upload = multer({ dest: "uploads/" });

function activeFromBody(body) {
  return body.active === 'on' || body.active === 'true';
}

function renderFormError(res, view, title, data, message) {
  return res.status(422).render(view, {
    title,
    ...data,
    error: message
  });
}

async function getCollections() {
  const result = await query(
    `SELECT id, name, slug, active
       FROM collections
      ORDER BY active DESC, name ASC`
  );
  return result.rows;
}

async function loadProduct(req, res, next) {
  try {
    const result = await query(
      `SELECT p.*,
              c.name AS collection_name,
              c.slug AS collection_slug
         FROM products p
         JOIN collections c ON c.id = p.collection_id
        WHERE p.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).render('admin/error', {
        title: 'Produto não encontrado',
        message: 'A referência solicitada não foi encontrada.'
      });
    }

    req.product = result.rows[0];
    req.uploadDirectory = getImageFolder(req.product.collection_slug, req.product.reference);
    next();
  } catch (error) {
    next(error);
  }
}

async function insertUploadedImages(product, files) {
  const records = [];

  for (const file of files) {
    await optimizeImage(file.path, file.mimetype);
    const publicData = getPublicImageData(product.collection_slug, product.reference, file.filename);
    records.push({
      ...publicData,
      filename: file.filename
    });
  }

  await transaction(async (client) => {
    const state = await client.query(
      `SELECT COALESCE(MAX(display_order), 0) AS max_order,
              COUNT(*)::int AS total,
              COALESCE(BOOL_OR(is_main), FALSE) AS has_main
         FROM product_images
        WHERE product_id = $1`,
      [product.id]
    );

    let nextOrder = Number(state.rows[0].max_order || 0) + 1;
    const hasMain = state.rows[0].has_main;

    for (let index = 0; index < records.length; index += 1) {
      await client.query(
        `INSERT INTO product_images
                (product_id, file_path, file_url, display_order, is_main)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          product.id,
          records[index].filePath,
          records[index].fileUrl,
          nextOrder,
          !hasMain && index === 0
        ]
      );
      nextOrder += 1;
    }
  });
}

function parseBulkReference(originalName, separator) {
  const base = path.parse(originalName).name.trim();

  if (separator === 'full') {
    return base;
  }

  if (separator === 'space') {
    return base.split(/\s+/)[0];
  }

  return base.split(separator || '_')[0];
}

router.get('/login', (req, res) => {
  if (req.session.admin) {
    return res.redirect('/admin');
  }

  return res.render('admin/login', {
    title: 'Entrar'
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '');
    const password = String(req.body.password || '');
    const valid = await verifyAdminCredentials(username, password);

    if (!valid) {
      return res.status(401).render('admin/login', {
        title: 'Entrar',
        error: 'Usuário ou senha inválidos.'
      });
    }

    req.session.admin = {
      username
    };

    setFlash(req, 'success', 'Login realizado com sucesso.');
    return res.redirect('/admin');
  } catch (error) {
    next(error);
  }
});

router.post('/logout', ensureAuthenticated, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.use(ensureAuthenticated);

router.get('/', (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const [counts, recentProducts, recentImages] = await Promise.all([
      query(
        `SELECT
            (SELECT COUNT(*)::int FROM collections) AS collections,
            (SELECT COUNT(*)::int FROM products) AS products,
            (SELECT COUNT(*)::int FROM product_images) AS images`
      ),
      query(
        `SELECT p.id, p.reference, p.name, p.active, c.name AS collection_name
           FROM products p
           JOIN collections c ON c.id = p.collection_id
          ORDER BY p.created_at DESC
          LIMIT 8`
      ),
      query(
        `SELECT pi.file_url, pi.created_at, p.reference
           FROM product_images pi
           JOIN products p ON p.id = pi.product_id
          ORDER BY pi.created_at DESC
          LIMIT 8`
      )
    ]);

    res.render('admin/dashboard', {
      title: 'Dashboard',
      stats: counts.rows[0],
      recentProducts: recentProducts.rows,
      recentImages: recentImages.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/collections', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*,
              COUNT(p.id)::int AS products_count
         FROM collections c
         LEFT JOIN products p ON p.collection_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC`
    );

    res.render('admin/collections/index', {
      title: 'Coleções',
      collections: result.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/collections/new', (req, res) => {
  res.render('admin/collections/form', {
    title: 'Nova coleção',
    collection: { name: '', slug: '', active: true },
    action: '/admin/collections'
  });
});

router.post('/collections', async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const slug = makeSlug(req.body.slug || name);
  const active = activeFromBody(req.body);

  if (!name || !slug) {
    return renderFormError(res, 'admin/collections/form', 'Nova coleção', {
      collection: { name, slug, active },
      action: '/admin/collections'
    }, 'Informe nome e slug da coleção.');
  }

  try {
    await query(
      `INSERT INTO collections (name, slug, active)
       VALUES ($1, $2, $3)`,
      [name, slug, active]
    );

    setFlash(req, 'success', 'Coleção cadastrada.');
    res.redirect('/admin/collections');
  } catch (error) {
    if (error.code === '23505') {
      return renderFormError(res, 'admin/collections/form', 'Nova coleção', {
        collection: { name, slug, active },
        action: '/admin/collections'
      }, 'Já existe uma coleção com este slug.');
    }

    next(error);
  }
});

router.get('/collections/:id/edit', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM collections WHERE id = $1', [req.params.id]);

    if (result.rowCount === 0) {
      return res.status(404).render('admin/error', {
        title: 'Coleção não encontrada',
        message: 'A coleção solicitada não foi encontrada.'
      });
    }

    res.render('admin/collections/form', {
      title: 'Editar coleção',
      collection: result.rows[0],
      action: `/admin/collections/${req.params.id}`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/collections/:id', async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const slug = makeSlug(req.body.slug || name);
  const active = activeFromBody(req.body);

  if (!name || !slug) {
    return renderFormError(res, 'admin/collections/form', 'Editar coleção', {
      collection: { id: req.params.id, name, slug, active },
      action: `/admin/collections/${req.params.id}`
    }, 'Informe nome e slug da coleção.');
  }

  try {
    await query(
      `UPDATE collections
          SET name = $1,
              slug = $2,
              active = $3
        WHERE id = $4`,
      [name, slug, active, req.params.id]
    );

    setFlash(req, 'success', 'Coleção atualizada.');
    res.redirect('/admin/collections');
  } catch (error) {
    if (error.code === '23505') {
      return renderFormError(res, 'admin/collections/form', 'Editar coleção', {
        collection: { id: req.params.id, name, slug, active },
        action: `/admin/collections/${req.params.id}`
      }, 'Já existe uma coleção com este slug.');
    }

    next(error);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const search = String(req.query.reference || '').trim();
    const params = [];
    let where = '';

    if (search) {
      params.push(`%${search}%`);
      where = 'WHERE p.reference ILIKE $1 OR p.name ILIKE $1';
    }

    const result = await query(
      `SELECT p.*,
              c.name AS collection_name,
              COUNT(pi.id)::int AS images_count
         FROM products p
         JOIN collections c ON c.id = p.collection_id
         LEFT JOIN product_images pi ON pi.product_id = p.id
         ${where}
        GROUP BY p.id, c.name
        ORDER BY p.created_at DESC
        LIMIT 200`,
      params
    );

    res.render('admin/products/index', {
      title: 'Produtos',
      products: result.rows,
      search
    });
  } catch (error) {
    next(error);
  }
});

router.get('/products/new', async (req, res, next) => {
  try {
    res.render('admin/products/form', {
      title: 'Novo produto',
      product: {
        reference: String(req.query.reference || ''),
        name: '',
        description: '',
        active: true,
        collection_id: ''
      },
      collections: await getCollections(),
      action: '/admin/products'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/products', async (req, res, next) => {
  const product = {
    reference: cleanReference(req.body.reference),
    name: String(req.body.name || '').trim(),
    description: String(req.body.description || '').trim(),
    collection_id: req.body.collection_id,
    active: activeFromBody(req.body)
  };

  if (!product.reference || !isValidReference(product.reference) || !product.collection_id) {
    return renderFormError(res, 'admin/products/form', 'Novo produto', {
      product,
      collections: await getCollections(),
      action: '/admin/products'
    }, 'Informe uma referência válida e selecione a coleção.');
  }

  try {
    await query(
      `INSERT INTO products
              (reference, name, description, collection_id, active)
       VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5)`,
      [product.reference, product.name, product.description, product.collection_id, product.active]
    );

    setFlash(req, 'success', 'Produto cadastrado.');
    res.redirect('/admin/products');
  } catch (error) {
    if (error.code === '23505') {
      return renderFormError(res, 'admin/products/form', 'Novo produto', {
        product,
        collections: await getCollections(),
        action: '/admin/products'
      }, 'Já existe um produto com esta referência.');
    }

    next(error);
  }
});

router.get("/products/import", async (req, res, next) => {
  try {
    res.render("admin/products/import", {
      title: "Importar produtos",
      collections: await getCollections()
    });
  } catch (error) {
    next(error);
  }
});

router.post("/products/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      setFlash(req, "error", "Selecione uma planilha XLSX.");
      return res.redirect("/admin/products/import");
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    let imported = 0;
    let ignored = 0;

    for (const row of rows) {
      const reference = cleanReference(String(row.reference || "").trim());
      const name = String(row.name || "").trim();
      const description = String(row.description || "").trim();
      const collectionId = Number(row.collection_id);
      const activeValue = String(row.active || "true").toLowerCase().trim();
      const active = ["true", "sim", "1", "yes"].includes(activeValue);

      if (!reference || !collectionId) {
        ignored++;
        continue;
      }

      await query(
        `
        INSERT INTO products
          (reference, name, description, collection_id, active)
        VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5)
        ON CONFLICT (reference) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          collection_id = EXCLUDED.collection_id,
          active = EXCLUDED.active
        `,
        [reference, name, description, collectionId, active]
      );

      imported++;
    }

    await fs.unlink(req.file.path);

    setFlash(req, "success", `Importação concluída. ${imported} importados, ${ignored} ignorados.`);
    res.redirect("/admin/products");
  } catch (error) {
    next(error);
  }
});

router.get('/products/:id/edit', async (req, res, next) => {
  try {
    const productResult = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);

    if (productResult.rowCount === 0) {
      return res.status(404).render('admin/error', {
        title: 'Produto não encontrado',
        message: 'A referência solicitada não foi encontrada.'
      });
    }

    res.render('admin/products/form', {
      title: 'Editar produto',
      product: productResult.rows[0],
      collections: await getCollections(),
      action: `/admin/products/${req.params.id}`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/products/:id', async (req, res, next) => {
  const product = {
    id: req.params.id,
    reference: cleanReference(req.body.reference),
    name: String(req.body.name || '').trim(),
    description: String(req.body.description || '').trim(),
    collection_id: req.body.collection_id,
    active: activeFromBody(req.body)
  };

  if (!product.reference || !isValidReference(product.reference) || !product.collection_id) {
    return renderFormError(res, 'admin/products/form', 'Editar produto', {
      product,
      collections: await getCollections(),
      action: `/admin/products/${req.params.id}`
    }, 'Informe uma referência válida e selecione a coleção.');
  }

  try {
    await query(
      `UPDATE products
          SET reference = $1,
              name = NULLIF($2, ''),
              description = NULLIF($3, ''),
              collection_id = $4,
              active = $5
        WHERE id = $6`,
      [product.reference, product.name, product.description, product.collection_id, product.active, product.id]
    );

    setFlash(req, 'success', 'Produto atualizado.');
    res.redirect('/admin/products');
  } catch (error) {
    if (error.code === '23505') {
      return renderFormError(res, 'admin/products/form', 'Editar produto', {
        product,
        collections: await getCollections(),
        action: `/admin/products/${req.params.id}`
      }, 'Já existe um produto com esta referência.');
    }

    next(error);
  }
});

router.get('/upload', async (req, res, next) => {
  try {
    const search = String(req.query.reference || '').trim();
    let products = [];

    if (search) {
      const result = await query(
        `SELECT p.id, p.reference, p.name, c.name AS collection_name, COUNT(pi.id)::int AS images_count
           FROM products p
           JOIN collections c ON c.id = p.collection_id
           LEFT JOIN product_images pi ON pi.product_id = p.id
          WHERE p.reference ILIKE $1 OR p.name ILIKE $1
          GROUP BY p.id, c.name
          ORDER BY p.reference ASC
          LIMIT 30`,
        [`%${search}%`]
      );
      products = result.rows;
    }

    res.render('admin/upload/index', {
      title: 'Upload de imagens',
      search,
      products,
      bulkResult: null
    });
  } catch (error) {
    next(error);
  }
});

router.get('/products/:id/images', loadProduct, async (req, res, next) => {
  try {
    const images = await query(
      `SELECT *
         FROM product_images
        WHERE product_id = $1
        ORDER BY display_order ASC, id ASC`,
      [req.product.id]
    );

    res.render('admin/upload/product-images', {
      title: `Imagens ${req.product.reference}`,
      product: req.product,
      images: images.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post('/products/:id/images', loadProduct, productImageUpload, async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      setFlash(req, 'error', 'Selecione pelo menos uma imagem.');
      return res.redirect(`/admin/products/${req.product.id}/images`);
    }

    await insertUploadedImages(req.product, req.files);
    setFlash(req, 'success', 'Imagens importadas.');
    res.redirect(`/admin/products/${req.product.id}/images`);
  } catch (error) {
    next(error);
  }
});

router.post('/products/:id/images/reorder', loadProduct, async (req, res, next) => {
  try {
    const order = String(req.body.image_order || '')
      .split(',')
      .map((id) => Number(id))
      .filter(Boolean);

    await transaction(async (client) => {
      for (let index = 0; index < order.length; index += 1) {
        await client.query(
          `UPDATE product_images
              SET display_order = $1
            WHERE id = $2
              AND product_id = $3`,
          [index + 1, order[index], req.product.id]
        );
      }
    });

    setFlash(req, 'success', 'Ordem atualizada.');
    res.redirect(`/admin/products/${req.product.id}/images`);
  } catch (error) {
    next(error);
  }
});

router.post('/products/:id/images/:imageId/main', loadProduct, async (req, res, next) => {
  try {
    await transaction(async (client) => {
      await client.query('UPDATE product_images SET is_main = FALSE WHERE product_id = $1', [req.product.id]);
      await client.query(
        `UPDATE product_images
            SET is_main = TRUE
          WHERE id = $1
            AND product_id = $2`,
        [req.params.imageId, req.product.id]
      );
    });

    setFlash(req, 'success', 'Imagem principal definida.');
    res.redirect(`/admin/products/${req.product.id}/images`);
  } catch (error) {
    next(error);
  }
});

router.post('/products/:id/images/:imageId/delete', loadProduct, async (req, res, next) => {
  try {
    const result = await query(
      `DELETE FROM product_images
        WHERE id = $1
          AND product_id = $2
        RETURNING file_path, is_main`,
      [req.params.imageId, req.product.id]
    );

    if (result.rowCount > 0) {
      await removeStoredFile(result.rows[0].file_path);

      if (result.rows[0].is_main) {
        await query(
          `UPDATE product_images
              SET is_main = TRUE
            WHERE id = (
              SELECT id
                FROM product_images
               WHERE product_id = $1
               ORDER BY display_order ASC, id ASC
               LIMIT 1
            )`,
          [req.product.id]
        );
      }
    }

    setFlash(req, 'success', 'Imagem excluída.');
    res.redirect(`/admin/products/${req.product.id}/images`);
  } catch (error) {
    next(error);
  }
});

router.post('/upload/bulk', bulkImageUpload, async (req, res, next) => {
  try {
    const files = req.files || [];
    const separator = String(req.body.separator || '_');
    const result = {
      imported: 0,
      ignored: 0,
      missing: []
    };

    for (const file of files) {
      const reference = cleanReference(parseBulkReference(file.originalname, separator));
      const productResult = await query(
        `SELECT p.*,
                c.name AS collection_name,
                c.slug AS collection_slug
           FROM products p
           JOIN collections c ON c.id = p.collection_id
          WHERE LOWER(p.reference) = LOWER($1)
          LIMIT 1`,
        [reference]
      );

      if (productResult.rowCount === 0) {
        result.ignored += 1;
        result.missing.push(reference || file.originalname);
        await fs.unlink(file.path);
        continue;
      }

      const product = productResult.rows[0];
      const destinationFolder = getImageFolder(product.collection_slug, product.reference);
      await ensureFolder(destinationFolder);

      const destinationPath = path.join(destinationFolder, file.filename);
      await fs.rename(file.path, destinationPath);
      file.path = destinationPath;

      await insertUploadedImages(product, [file]);
      result.imported += 1;
    }

    const search = String(req.query.reference || '').trim();
    res.render('admin/upload/index', {
      title: 'Upload de imagens',
      search,
      products: [],
      bulkResult: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
