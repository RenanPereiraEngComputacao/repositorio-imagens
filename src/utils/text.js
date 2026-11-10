function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function makeSlug(value) {
  return normalizeText(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function cleanReference(value) {
  return String(value ?? '').trim();
}

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function isValidReference(value) {
  return typeof value === 'string' && REFERENCE_PATTERN.test(value) && !value.includes('..');
}

function safeSegment(value) {
  return normalizeText(value)
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/g, '')
    .slice(0, 160) || 'item';
}

function safeFilename(value) {
  return safeSegment(value)
    .replace(/\.+$/g, '')
    .slice(0, 120) || 'imagem';
}

function extensionForMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/pjpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '';
}

function parsePositiveInt(value) {
  const text = String(value ?? '');
  if (!/^\d{1,15}$/.test(text)) return null;
  const parsed = Number(text);
  return parsed > 0 ? parsed : null;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toLocaleString('pt-BR', { maximumFractionDigits: size < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** Frase que o administrador precisa digitar para confirmar a exclusão de uma coleção. */
function collectionDeletionPhrase(collection) {
  return `EXCLUIR ${collection.slug}`;
}

module.exports = {
  normalizeText,
  makeSlug,
  cleanReference,
  isValidReference,
  safeSegment,
  safeFilename,
  extensionForMime,
  parsePositiveInt,
  formatBytes,
  collectionDeletionPhrase
};
