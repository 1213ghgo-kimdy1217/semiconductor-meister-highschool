// 영상 비교의 기본 자료형과 표본 추출. 브라우저·Node 공용 순수 함수만 둔다.

export interface Gray {
  w: number;
  h: number;
  /** 휘도 0~255 */
  data: Float32Array;
}

/** 영상 전체 기준 ROI. cx·cy는 가로·세로 비율(0~1), size는 정사각형 한 변 / 영상 높이, rot는 도(시계 방향). */
export interface Roi {
  cx: number;
  cy: number;
  size: number;
  rot: number;
}

export const DEFAULT_ROI: Roi = { cx: 0.5, cy: 0.5, size: 0.7, rot: 0 };

/** 분석 해상도: ROI 한 변을 이 픽셀 수로 맞춰 잘라 온다 */
export const ROI_SIDE_PX = 192;
/** 잘라 올 범위의 반폭 / ROI 한 변 (회전·위치 탐색 여유 포함) */
export const CROP_HALF = 0.82;

/** ROI 둘레를 잘라 온 회색조 영상과 그 안의 ROI 위치 (L0 좌표, 픽셀 중심 = i+0.5) */
export interface RoiImage {
  levels: Gray[];
  cx: number;
  cy: number;
  side: number;
  rot: number;
}

export interface CropPlan {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

export function makeGray(w: number, h: number): Gray {
  return { w, h, data: new Float32Array(w * h) };
}

/** 원본 영상(vw×vh)에서 ROI 둘레를 어디서 얼마나 잘라 올지 */
export function planCrop(roi: Roi, vw: number, vh: number): CropPlan {
  const side = roi.size * vh;
  const half = side * CROP_HALF;
  const k = ROI_SIDE_PX / side;
  const dw = Math.max(8, Math.round(2 * half * k));
  return { sx: roi.cx * vw - half, sy: roi.cy * vh - half, sw: 2 * half, sh: 2 * half, dw, dh: dw };
}

/** RGBA → 휘도. 투명 픽셀(영상 바깥)은 0 */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const g = makeGray(w, h);
  const d = g.data;
  for (let i = 0, j = 0; i < d.length; i++, j += 4) {
    d[i] = ((0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * rgba[j + 3]) / 255;
  }
  return g;
}

/** 2×2 평균으로 절반 크기 */
export function halve(s: Gray): Gray {
  const w = Math.max(1, s.w >> 1);
  const h = Math.max(1, s.h >> 1);
  const g = makeGray(w, h);
  const sd = s.data;
  const d = g.data;
  const sw = s.w;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * sw;
    const r1 = Math.min(2 * y + 1, s.h - 1) * sw;
    for (let x = 0; x < w; x++) {
      const x0 = 2 * x;
      const x1 = Math.min(x0 + 1, sw - 1);
      d[y * w + x] = 0.25 * (sd[r0 + x0] + sd[r0 + x1] + sd[r1 + x0] + sd[r1 + x1]);
    }
  }
  return g;
}

export function makeRoiImage(l0: Gray, rot: number): RoiImage {
  const levels = [l0];
  while (levels.length < 3) levels.push(halve(levels[levels.length - 1]));
  return { levels, cx: l0.w / 2, cy: l0.h / 2, side: ROI_SIDE_PX, rot };
}

/** 픽셀 중심이 (i+0.5, j+0.5)인 연속 좌표에서 쌍선형 보간. 바깥은 가장자리 값 */
export function bilinear(g: Gray, x: number, y: number): number {
  const w = g.w;
  const h = g.h;
  let fx = x - 0.5;
  let fy = y - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const d = g.data;
  const a = d[y0 * w + x0];
  const b = d[y0 * w + x1];
  const c = d[y1 * w + x0];
  const e = d[y1 * w + x1];
  const top = a + (b - a) * tx;
  return top + (c + (e - c) * tx - top) * ty;
}

/** n×n 표본을 만들 때 쓸 피라미드 단계: 표본 간격이 1~2픽셀이 되는 가장 거친 단계 */
export function levelFor(img: RoiImage, n: number): number {
  const pitch = img.side / n;
  const l = Math.floor(Math.log2(pitch + 1e-9));
  return Math.max(0, Math.min(img.levels.length - 1, l));
}

/** 여러 장의 같은 크기 영상을 평균 (기준 등록용) */
export function averageGray(list: Gray[]): Gray {
  const g = makeGray(list[0].w, list[0].h);
  for (const s of list) for (let i = 0; i < g.data.length; i++) g.data[i] += s.data[i];
  for (let i = 0; i < g.data.length; i++) g.data[i] /= list.length;
  return g;
}
