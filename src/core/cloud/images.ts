import type { StoredReference } from '../vision/reference';

const MAX_IMAGE_BYTES = 2_097_152;

/** Accept only bounded raster data, never a remote URL or executable data URL. */
export function thumbnailBlob(dataURL: string | null): Blob | null {
  if (!dataURL) return null;
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataURL);
  if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
  try {
    const raw = atob(match[2]);
    if (raw.length === 0 || raw.length > MAX_IMAGE_BYTES) return null;
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: match[1] });
  } catch {
    return null;
  }
}

/** Preserve the stored grayscale reference rather than capture a new camera frame. */
export async function referenceBlob(reference: StoredReference): Promise<Blob> {
  const { w, h, pixels } = reference;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 2_048 || h > 2_048 || pixels.length !== w * h) {
    throw new Error('기준 사진의 크기를 확인해 주세요.');
  }
  if (typeof document === 'undefined') throw new Error('이 환경에서 기준 사진을 변환할 수 없어요.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('기준 사진을 변환할 수 없어요.');
  const image = context.createImageData(w, h);
  for (let i = 0; i < pixels.length; i++) {
    image.data[i * 4] = pixels[i];
    image.data[i * 4 + 1] = pixels[i];
    image.data[i * 4 + 2] = pixels[i];
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size > MAX_IMAGE_BYTES) reject(new Error('기준 사진을 저장 가능한 크기로 변환하지 못했어요.'));
      else resolve(blob);
    }, 'image/png');
  });
}
