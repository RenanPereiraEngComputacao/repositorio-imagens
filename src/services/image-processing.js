const fs = require('fs/promises');
const sharp = require('sharp');

async function optimizeImage(filePath, mimeType) {
  const temporaryPath = `${filePath}.optimized`;
  let pipeline = sharp(filePath, { failOn: 'none' })
    .rotate()
    .resize({
      width: 1800,
      height: 1800,
      fit: 'inside',
      withoutEnlargement: true
    });

  if (mimeType === 'image/png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else if (mimeType === 'image/webp') {
    pipeline = pipeline.webp({ quality: 84, effort: 4 });
  } else {
    pipeline = pipeline.jpeg({ quality: 84, progressive: true, mozjpeg: true });
  }

  await pipeline.toFile(temporaryPath);
  await fs.rename(temporaryPath, filePath);
}

module.exports = {
  optimizeImage
};
