const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { safeSegment } = require('../utils/text');

const PUBLIC_PREFIX = 'imagens/';
const WEB_FOLDER = '_web';

function encodePart(value) {
  return encodeURIComponent(value).replace(/%2E/g, '.');
}

function uploadRoot() {
  return path.resolve(config.uploadRoot);
}

function getImageFolder(collectionSlug, reference) {
  return path.join(uploadRoot(), safeSegment(collectionSlug), safeSegment(reference));
}

/** Monta file_path (relativo, gravado no banco) e file_url (público) — formato idêntico ao legado. */
function getPublicImageData(collectionSlug, reference, filename, subfolder) {
  const parts = [safeSegment(collectionSlug), safeSegment(reference)];
  if (subfolder) parts.push(subfolder);
  parts.push(filename);
  return {
    filePath: [PUBLIC_PREFIX.slice(0, -1), ...parts].join('/'),
    fileUrl: `/${PUBLIC_PREFIX}${parts.map(encodePart).join('/')}`
  };
}

/**
 * Converte um file_path do banco ("imagens/colecao/ref/arquivo.jpg") em caminho
 * absoluto dentro de UPLOAD_ROOT. Retorna null para qualquer valor suspeito
 * (path traversal, caminho absoluto, byte nulo, prefixo inesperado).
 */
function resolveStoredPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1024) return null;
  if (filePath.includes('\0')) return null;

  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith(PUBLIC_PREFIX)) return null;

  const segments = normalized.slice(PUBLIC_PREFIX.length).split('/');
  if (segments.length < 1 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }

  const root = uploadRoot();
  const absolute = path.resolve(root, ...segments);
  if (!absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/** Caminho relativo à raiz de uploads (usado na lixeira para preservar a estrutura). */
function relativeToUploadRoot(absolute) {
  return path.relative(uploadRoot(), absolute);
}

/**
 * Garante que o caminho aponta para um arquivo regular real, dentro da raiz,
 * sem links simbólicos em nenhum ponto do caminho.
 */
async function assertSafeFile(absolute) {
  if (!absolute) return null;
  try {
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;

    const [realRoot, realFile] = await Promise.all([fs.realpath(uploadRoot()), fs.realpath(absolute)]);
    if (!realFile.startsWith(realRoot + path.sep)) return null;
    if (realFile !== path.join(realRoot, path.relative(uploadRoot(), absolute))) return null;

    return { path: realFile, size: stat.size };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function resolveSafeStoredFile(filePath) {
  return assertSafeFile(resolveStoredPath(filePath));
}

async function ensureFolder(folder) {
  await fs.mkdir(folder, { recursive: true });
}

async function moveFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
}

async function removeFileQuietly(absolute) {
  if (!absolute) return;
  try {
    await fs.unlink(absolute);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Remove diretórios vazios subindo até (sem incluir) a raiz de uploads. */
async function pruneEmptyDirectories(startDirs) {
  const root = uploadRoot();
  const unique = [...new Set(startDirs)].sort((a, b) => b.length - a.length);
  for (const start of unique) {
    let current = start;
    while (current.startsWith(root + path.sep)) {
      try {
        const entries = await fs.readdir(current);
        if (entries.length > 0) break;
        await fs.rmdir(current);
      } catch {
        break;
      }
      current = path.dirname(current);
    }
  }
}

module.exports = {
  PUBLIC_PREFIX,
  WEB_FOLDER,
  uploadRoot,
  getImageFolder,
  getPublicImageData,
  resolveStoredPath,
  relativeToUploadRoot,
  assertSafeFile,
  resolveSafeStoredFile,
  ensureFolder,
  moveFile,
  removeFileQuietly,
  pruneEmptyDirectories
};
