const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { safeSegment } = require('../utils/text');

function encodePart(value) {
  return encodeURIComponent(value).replace(/%2E/g, '.');
}

function getImageFolder(collectionSlug, reference) {
  return path.join(config.uploadRoot, safeSegment(collectionSlug), safeSegment(reference));
}

function getPublicImageData(collectionSlug, reference, filename) {
  const collectionPart = safeSegment(collectionSlug);
  const referencePart = safeSegment(reference);
  const filePath = ['imagens', collectionPart, referencePart, filename].join('/');
  const fileUrl = `/imagens/${encodePart(collectionPart)}/${encodePart(referencePart)}/${encodePart(filename)}`;

  return { filePath, fileUrl };
}

async function ensureFolder(folder) {
  await fs.mkdir(folder, { recursive: true });
}

async function removeStoredFile(filePath) {
  if (!filePath) return;
  const relative = filePath.replace(/^imagens[\\/]/, '');
  const fullPath = path.resolve(config.uploadRoot, relative);
  const uploadRoot = path.resolve(config.uploadRoot);

  if (!fullPath.startsWith(uploadRoot)) {
    return;
  }

  try {
    await fs.unlink(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  getImageFolder,
  getPublicImageData,
  ensureFolder,
  removeStoredFile
};
