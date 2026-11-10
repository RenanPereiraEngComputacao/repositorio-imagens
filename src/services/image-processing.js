const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { AppError } = require('../utils/errors');

const FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: '.jpg' },
  png: { mime: 'image/png', ext: '.png' },
  webp: { mime: 'image/webp', ext: '.webp' }
};

const DISPLAY_SIZE = 1600;
const THUMB_SIZE = 480;

/**
 * Lê o conteúdo real do arquivo (não confia na extensão nem no MIME enviado pelo navegador).
 */
async function inspectImage(filePath) {
  let metadata;
  try {
    metadata = await sharp(filePath, { failOn: 'error' }).metadata();
  } catch {
    throw new AppError('Arquivo não é uma imagem válida.', { code: 'INVALID_IMAGE' });
  }

  const format = FORMATS[metadata.format];
  if (!format) {
    throw new AppError('Formato inválido. Envie JPG, PNG ou WEBP.', { code: 'INVALID_FORMAT' });
  }

  const stat = await fs.stat(filePath);
  const rotated = metadata.orientation && metadata.orientation >= 5;
  return {
    mime: format.mime,
    ext: format.ext,
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
    size: stat.size
  };
}

/**
 * Gera versões otimizadas (exibição e miniatura) SEM alterar o original,
 * que continua disponível para download em resolução máxima.
 */
async function createDerivatives(originalPath, targetFolder, baseName) {
  await fs.mkdir(targetFolder, { recursive: true });
  const displayPath = path.join(targetFolder, `${baseName}.display.webp`);
  const thumbPath = path.join(targetFolder, `${baseName}.thumb.webp`);

  const source = sharp(originalPath, { failOn: 'none' }).rotate();

  await source
    .clone()
    .resize({ width: DISPLAY_SIZE, height: DISPLAY_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(displayPath);

  await source
    .clone()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 74, effort: 4 })
    .toFile(thumbPath);

  return { displayPath, thumbPath };
}

module.exports = {
  FORMATS,
  inspectImage,
  createDerivatives
};
