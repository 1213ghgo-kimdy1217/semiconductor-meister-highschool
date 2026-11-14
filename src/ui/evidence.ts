// 판정 근거 그림: 비교 원 안의 회색 영상 + 기준과 다른 곳(빨강) + 정상·불량 기준이 서로 다른 곳(파랑 점)
import type { FrameDetail } from '../core/vision/analyze';

export type EvidenceLayer = 'view' | 'diff';

export function evidenceImage(d: FrameDetail, layer: EvidenceLayer): ImageData {
  const n = d.n;
  const img = new ImageData(n, n);
  const vals: number[] = [];
  for (let i = 0; i < d.view.length; i++) if (!Number.isNaN(d.view[i])) vals.push(d.view[i]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)] ?? 0;
  const hi = vals[Math.floor(vals.length * 0.98)] ?? 255;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n * n; i++) {
    const j = i * 4;
    const v = d.view[i];
    if (Number.isNaN(v)) {
      img.data[j] = 15;
      img.data[j + 1] = 21;
      img.data[j + 2] = 26;
      img.data[j + 3] = 255;
      continue;
    }
    let g = Math.max(0, Math.min(255, ((v - lo) / span) * 255));
    let r = g;
    let b = g;
    if (layer === 'diff') {
      g = g * 0.55 + 40;
      r = g;
      b = g;
      if (d.disc?.[i]) {
        b = Math.min(255, b + 70);
        r *= 0.85;
      }
      const a = Math.max(0, Math.min(0.9, (d.diff[i] - 1) / 2));
      r = r * (1 - a) + 232 * a;
      g = g * (1 - a) + 54 * a;
      b = b * (1 - a) + 44 * a;
    }
    img.data[j] = r;
    img.data[j + 1] = g;
    img.data[j + 2] = b;
    img.data[j + 3] = 255;
  }
  return img;
}

/** 기록에 남길 작은 회색 그림 (PNG data URL) */
export function thumbnail(d: FrameDetail): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = d.n;
    c.getContext('2d')!.putImageData(evidenceImage(d, 'view'), 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}
