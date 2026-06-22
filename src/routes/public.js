const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.redirect('/admin');
});

router.get('/imagens/:reference', async (req, res, next) => {
  try {
    const reference = String(req.params.reference || '').trim();

    const productResult = await query(
      `SELECT p.id,
              p.reference,
              p.name,
              p.description,
              c.name AS collection_name
         FROM products p
         JOIN collections c ON c.id = p.collection_id
        WHERE LOWER(p.reference) = LOWER($1)
          AND p.active = TRUE
          AND c.active = TRUE
        LIMIT 1`,
      [reference]
    );

    if (productResult.rowCount === 0) {
      return res.status(404).render('public/not-found', {
        title: 'Imagens não encontradas'
      });
    }

    const product = productResult.rows[0];
    const imagesResult = await query(
      `SELECT id, file_url, display_order, is_main
         FROM product_images
        WHERE product_id = $1
        ORDER BY is_main DESC, display_order ASC, id ASC`,
      [product.id]
    );

    res.render('public/product', {
      title: `${product.reference} | Imagens`,
      product,
      images: imagesResult.rows
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
