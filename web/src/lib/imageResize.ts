/** Phone photos are often 3-10MB; the server caps uploads. Shrink instead of rejecting. */

/** Scale (w,h) down so the longest side is at most `max`; never upscales. */
export function fitDimensions(w: number, h: number, max: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** MIME type from the extension when the browser/file picker reports none (common on Android). */
export function guessImageType(name: string, reported: string): string {
  if (reported) return reported;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[ext] ?? '';
}

/**
 * Returns `file` if it already fits in `maxBytes`, otherwise a re-encoded JPEG at a smaller
 * size. GIFs are not re-encoded (that would drop the animation). Resolves to null when the image
 * cannot be decoded or still does not fit.
 */
export async function shrinkImage(file: File, maxBytes: number, maxDim = 1600): Promise<File | null> {
  if (file.size <= maxBytes) return file;
  if (file.type === 'image/gif' || typeof document === 'undefined') return null;
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('decode'));
        el.src = url;
      });
      for (const dim of [maxDim, Math.round(maxDim * 0.7), Math.round(maxDim * 0.5)]) {
        const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, dim);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
        if (blob && blob.size <= maxBytes) {
          return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
        }
      }
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}
