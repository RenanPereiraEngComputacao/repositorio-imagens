const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { extensionForMime, safeFilename } = require('../utils/text');

const allowedMimeTypes = new Set(['image/jpeg', 'image/pjpeg', 'image/png', 'image/webp']);

function fileFilter(req, file, callback) {
  if (!allowedMimeTypes.has(file.mimetype)) {
    return callback(new Error('Formato inválido. Envie JPG, PNG ou WEBP.'));
  }

  callback(null, true);
}

function makeFilename(file) {
  const ext = extensionForMime(file.mimetype);
  const base = safeFilename(path.parse(file.originalname).name);
  const suffix = crypto.randomBytes(5).toString('hex');
  return `${Date.now()}-${suffix}-${base}${ext}`;
}

const productStorage = multer.diskStorage({
  destination(req, file, callback) {
    if (!req.uploadDirectory) {
      return callback(new Error('Produto não encontrado para upload.'));
    }

    fs.mkdirSync(req.uploadDirectory, { recursive: true });
    callback(null, req.uploadDirectory);
  },
  filename(req, file, callback) {
    callback(null, makeFilename(file));
  }
});

const bulkStorage = multer.diskStorage({
  destination(req, file, callback) {
    const folder = path.join(config.rootDir, '.tmp', 'bulk-upload');
    fs.mkdirSync(folder, { recursive: true });
    callback(null, folder);
  },
  filename(req, file, callback) {
    callback(null, makeFilename(file));
  }
});

const limits = {
  fileSize: config.maxUploadMb * 1024 * 1024
};

module.exports = {
  productImageUpload: multer({ storage: productStorage, fileFilter, limits }).array('images', 40),
  bulkImageUpload: multer({ storage: bulkStorage, fileFilter, limits }).array('images', 200)
};
