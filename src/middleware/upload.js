const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { AppError } = require('../utils/errors');

const IMAGE_MIME = new Set(['image/jpeg', 'image/pjpeg', 'image/png', 'image/webp']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Arquivos com tipo não permitido são descartados individualmente (não derrubam
 * o lote) e listados em req.rejectedFiles. O conteúdo real ainda é verificado
 * depois com o sharp antes de ser aceito.
 */
function imageFilter(req, file, callback) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!IMAGE_MIME.has(file.mimetype) || !IMAGE_EXT.has(ext)) {
    req.rejectedFiles = req.rejectedFiles || [];
    req.rejectedFiles.push({ name: file.originalname, ok: false, error: 'Formato inválido. Envie JPG, PNG ou WEBP.' });
    return callback(null, false);
  }
  return callback(null, true);
}

const temporaryStorage = multer.diskStorage({
  destination(req, file, callback) {
    const folder = path.join(config.tmpRoot, 'uploads');
    fs.mkdirSync(folder, { recursive: true });
    callback(null, folder);
  },
  filename(req, file, callback) {
    callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.upload`);
  }
});

function wrap(middleware) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: `Imagem acima do limite de ${config.maxUploadMb} MB.`,
          LIMIT_FILE_COUNT: `Envie no máximo ${config.maxFilesPerRequest} arquivos por vez.`,
          LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado.'
        };
        return next(new AppError(messages[error.code] || 'Falha no envio do arquivo.', { status: 413, code: error.code }));
      }
      return next(error);
    });
  };
}

const imageUpload = multer({
  storage: temporaryStorage,
  fileFilter: imageFilter,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: config.maxFilesPerRequest, fields: 20 }
}).array('images', config.maxFilesPerRequest);

const bulkUpload = multer({
  storage: temporaryStorage,
  fileFilter: imageFilter,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 200, fields: 20 }
}).array('images', 200);

const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.xlsx') {
      return callback(new AppError('Envie uma planilha no formato .xlsx.'));
    }
    return callback(null, true);
  }
}).single('file');

module.exports = {
  productImageUpload: wrap(imageUpload),
  bulkImageUpload: wrap(bulkUpload),
  spreadsheetUpload: wrap(spreadsheetUpload)
};
