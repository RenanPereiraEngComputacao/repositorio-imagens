function normalizeText(value) {
  return String(value || '')
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
  return String(value || '').trim();
}

function isValidReference(value) {
  return /^[A-Za-z0-9._-]+$/.test(value);
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

module.exports = {
  makeSlug,
  cleanReference,
  isValidReference,
  safeSegment,
  safeFilename,
  extensionForMime
};
