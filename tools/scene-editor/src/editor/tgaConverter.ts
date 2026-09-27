/**
 * TGA file parser and converter to PNG/Canvas.
 * Supports uncompressed and RLE-compressed 24/32-bit TGA files.
 */

export async function tgaToCanvas(file: File): Promise<HTMLCanvasElement> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  // TGA Header
  const idLength = data[0];
  const colorMapType = data[1];
  const imageType = data[2]; // 2=uncompressed, 10=RLE
  const width = data[12] | (data[13] << 8);
  const height = data[14] | (data[15] << 8);
  const bitsPerPixel = data[16];
  const descriptor = data[17];

  if (colorMapType !== 0) throw new Error('Color-mapped TGA not supported');
  if (imageType !== 2 && imageType !== 10) throw new Error(`Unsupported TGA type: ${imageType}`);
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) throw new Error(`Unsupported bit depth: ${bitsPerPixel}`);

  const bytesPerPixel = bitsPerPixel / 8;
  const pixelCount = width * height;
  let offset = 18 + idLength;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;

  if (imageType === 2) {
    // Uncompressed
    for (let i = 0; i < pixelCount; i++) {
      const b = data[offset++];
      const g = data[offset++];
      const r = data[offset++];
      const a = bytesPerPixel === 4 ? data[offset++] : 255;
      const idx = i * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = a;
    }
  } else {
    // RLE compressed
    let pixelIndex = 0;
    while (pixelIndex < pixelCount) {
      const packet = data[offset++];
      const count = (packet & 0x7F) + 1;
      if (packet & 0x80) {
        // RLE packet
        const b = data[offset++];
        const g = data[offset++];
        const r = data[offset++];
        const a = bytesPerPixel === 4 ? data[offset++] : 255;
        for (let j = 0; j < count; j++) {
          const idx = pixelIndex * 4;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = a;
          pixelIndex++;
        }
      } else {
        // Raw packet
        for (let j = 0; j < count; j++) {
          const b = data[offset++];
          const g = data[offset++];
          const r = data[offset++];
          const a = bytesPerPixel === 4 ? data[offset++] : 255;
          const idx = pixelIndex * 4;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = a;
          pixelIndex++;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Flip vertically if origin is bottom-left (bit 5 of descriptor = 0)
  const topOrigin = (descriptor & 0x20) !== 0;
  if (!topOrigin) {
    const flipped = document.createElement('canvas');
    flipped.width = width;
    flipped.height = height;
    const fCtx = flipped.getContext('2d')!;
    fCtx.translate(0, height);
    fCtx.scale(1, -1);
    fCtx.drawImage(canvas, 0, 0);
    return flipped;
  }

  return canvas;
}

export async function tgaToBlob(file: File, mimeType = 'image/png'): Promise<Blob> {
  const canvas = await tgaToCanvas(file);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to convert TGA to blob'));
    }, mimeType);
  });
}

export async function tgaToFile(file: File): Promise<File> {
  const blob = await tgaToBlob(file, 'image/png');
  const newName = file.name.replace(/\.tga$/i, '.png');
  return new File([blob], newName, { type: 'image/png' });
}
