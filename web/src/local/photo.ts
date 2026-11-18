import { badRequest } from '../lib/errors';

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 1600;
const MAX_PIXELS = 40_000_000;
const QUALITY = 0.82;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Decodifica con l'orientamento EXIF applicato. Prima createImageBitmap, poi <img> (Safari meno recenti, HEIC). */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* formato non gestito da createImageBitmap: si prova con <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw badRequest('Immagine non valida o formato non supportato da questo browser (usa JPEG o HEIC dalla Fotocamera).', 'invalid_image');
  }
}

export function fitInside(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Elabora la foto SUL DISPOSITIVO: ruota secondo EXIF, ridimensiona (lato max 1600 px) e ricodifica in JPEG.
 * La ricodifica dal canvas produce un file nuovo che non contiene alcun metadato (GPS, modello del telefono, data).
 */
export async function processPhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.size > MAX_INPUT_BYTES) throw badRequest('Foto troppo grande (max 25 MB)', 'invalid_image');
  if (file.type && !file.type.startsWith('image/')) throw badRequest('Il file scelto non è un\'immagine', 'invalid_image');
  const d = await decode(file);
  try {
    if (!d.width || !d.height || d.width * d.height > MAX_PIXELS) throw badRequest('Immagine troppo grande o non valida', 'invalid_image');
    const { width, height } = fitInside(d.width, d.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw badRequest('Elaborazione immagine non disponibile', 'invalid_image');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(d.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    canvas.width = 0; // libera subito la memoria del canvas (importante su iPhone)
    canvas.height = 0;
    if (!blob) throw badRequest('Elaborazione immagine non riuscita', 'invalid_image');
    return { blob, width, height };
  } finally {
    d.close();
  }
}
