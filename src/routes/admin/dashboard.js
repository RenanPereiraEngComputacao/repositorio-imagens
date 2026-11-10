const express = require('express');
const { query } = require('../../db');

const router = express.Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const [stats, recentImages, recentProducts, withoutImages, activity, collections] = await Promise.all([
      query(`SELECT
          (SELECT COUNT(*)::int FROM collections) AS collections,
          (SELECT COUNT(*)::int FROM collections WHERE active) AS active_collections,
          (SELECT COUNT(*)::int FROM products) AS products,
          (SELECT COUNT(*)::int FROM products WHERE active) AS active_products,
          (SELECT COUNT(*)::int FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)) AS products_without_images,
          (SELECT COUNT(*)::int FROM product_images) AS images,
          (SELECT COUNT(*)::int FROM product_images WHERE created_at > NOW() - INTERVAL '7 days') AS images_last_week,
          (SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM product_images) AS known_bytes,
          (SELECT COUNT(*)::int FROM product_images WHERE size_bytes IS NULL) AS images_without_size,
          (SELECT COUNT(*)::int FROM trash_entries WHERE status = 'trashed') AS trash_items`),
      query(`SELECT pi.id, pi.file_url, pi.display_url, pi.thumb_url, pi.created_at, p.id AS product_id, p.reference
               FROM product_images pi JOIN products p ON p.id = pi.product_id
              ORDER BY pi.created_at DESC, pi.id DESC LIMIT 12`),
      query(`SELECT p.id, p.reference, p.name, p.active, p.created_at, c.name AS collection_name,
                    (SELECT COUNT(*)::int FROM product_images pi WHERE pi.product_id = p.id) AS images_count
               FROM products p JOIN collections c ON c.id = p.collection_id
              ORDER BY p.created_at DESC, p.id DESC LIMIT 6`),
      query(`SELECT p.id, p.reference, p.name, c.name AS collection_name
               FROM products p JOIN collections c ON c.id = p.collection_id
              WHERE p.active AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)
              ORDER BY p.created_at DESC LIMIT 6`),
      query(`SELECT id, created_at, actor, action, summary, status FROM audit_log ORDER BY created_at DESC LIMIT 8`),
      query(`SELECT c.id, c.name, c.active,
                    COUNT(DISTINCT p.id)::int AS products_count,
                    COUNT(pi.id)::int AS images_count
               FROM collections c
               LEFT JOIN products p ON p.collection_id = c.id
               LEFT JOIN product_images pi ON pi.product_id = p.id
              GROUP BY c.id
              ORDER BY c.active DESC, products_count DESC, c.name ASC
              LIMIT 6`)
    ]);

    const s = stats.rows[0];
    s.coverage = s.products ? Math.round(((s.products - s.products_without_images) / s.products) * 100) : 0;

    res.render('admin/dashboard', {
      title: 'Visão geral',
      page: 'dashboard',
      stats: s,
      recentImages: recentImages.rows,
      recentProducts: recentProducts.rows,
      withoutImages: withoutImages.rows,
      activity: activity.rows,
      collections: collections.rows
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
