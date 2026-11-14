// 원형 마스크 위의 표본 추출·밝기 정규화·유사도. 정상/불량 기준과 새 프레임에 똑같이 적용한다.
import { bilinear, levelFor, type RoiImage } from './image';

export interface Pose {
  /** ROI 한 변 대비 이동 비율 */
  dx: number;
  dy: number;
  /** 도 */
  rot: number;
}

export const ZERO_POSE: Pose = { dx: 0, dy: 0, rot: 0 };

export interface MaskInfo {
  n: number;
  ratio: number;
  /** 격자 한 변 (ratio > 1이면 n보다 큼) */
  m: number;
  count: number;
  /** m×m 격자 안의 위치 */
  idx: Int32Array;
  /** 격자 위치 → 마스크 번호, 마스크 밖은 -1 */
  pos: Int32Array;
  /** ROI 한 변 대비 지역 좌표 */
  lx: Float32Array;
  ly: Float32Array;
  /** 평면 맞춤용 중심 좌표 (표본 픽셀 단위). 대칭이라 합이 0 */
  xs: Float32Array;
  ys: Float32Array;
  sxx: number;
  syy: number;
}

const cache = new Map<string, MaskInfo>();

/** ROI 한가운데 지름 ratio×한 변인 원 안의 n×n 격자점 */
export function circleMask(n: number, ratio: number): MaskInfo {
  const key = `${n}:${ratio}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pad = ratio > 1 ? Math.ceil(((ratio - 1) * n) / 2) : 0;
  const m = n + 2 * pad;
  const r2 = (ratio / 2) ** 2;
  const idx: number[] = [];
  const lx: number[] = [];
  const ly: number[] = [];
  const pos = new Int32Array(m * m).fill(-1);
  for (let v = 0; v < m; v++) {
    for (let u = 0; u < m; u++) {
      const x = (u + 0.5 - m / 2) / n;
      const y = (v + 0.5 - m / 2) / n;
      if (x * x + y * y <= r2) {
        pos[v * m + u] = idx.length;
        idx.push(v * m + u);
        lx.push(x);
        ly.push(y);
      }
    }
  }
  const count = idx.length;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < count; k++) {
    xs[k] = lx[k] * n;
    ys[k] = ly[k] * n;
    sxx += xs[k] * xs[k];
    syy += ys[k] * ys[k];
  }
  const info: MaskInfo = {
    n,
    ratio,
    m,
    count,
    idx: Int32Array.from(idx),
    pos,
    lx: Float32Array.from(lx),
    ly: Float32Array.from(ly),
    xs,
    ys,
    sxx,
    syy,
  };
  cache.set(key, info);
  return info;
}

/** 자세(pose)를 적용해 마스크 점마다 휘도를 뽑는다 */
export function sampleMask(img: RoiImage, mk: MaskInfo, pose: Pose, out = new Float32Array(mk.count)): Float32Array {
  const level = levelFor(img, mk.n);
  const g = img.levels[level];
  const s = 1 / (1 << level);
  const S = img.side * s;
  const th = ((img.rot + pose.rot) * Math.PI) / 180;
  const c = Math.cos(th) * S;
  const sn = Math.sin(th) * S;
  const cx = (img.cx + pose.dx * img.side) * s;
  const cy = (img.cy + pose.dy * img.side) * s;
  const lx = mk.lx;
  const ly = mk.ly;
  for (let k = 0; k < mk.count; k++) {
    out[k] = bilinear(g, cx + lx[k] * c - ly[k] * sn, cy + lx[k] * sn + ly[k] * c);
  }
  return out;
}

export interface Normed {
  /** 평면(조명 기울기) 제거 후 평균 0·표준편차 1 */
  z: Float32Array;
  mean: number;
  /** 평면 제거 후 남은 표준편차 (원래 휘도 단위) — 무늬의 진하기 */
  std: number;
}

/** 밝기 정규화: (선택) 평면 기울기 제거 → 평균·표준편차 정규화 */
export function normalize(v: Float32Array, mk: MaskInfo, flatten: boolean): Normed {
  const M = mk.count;
  let s = 0;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < M; k++) {
    s += v[k];
    sx += v[k] * mk.xs[k];
    sy += v[k] * mk.ys[k];
  }
  const a = s / M;
  const b = flatten ? sx / mk.sxx : 0;
  const c = flatten ? sy / mk.syy : 0;
  const z = new Float32Array(M);
  let ss = 0;
  for (let k = 0; k < M; k++) {
    const r = v[k] - a - b * mk.xs[k] - c * mk.ys[k];
    z[k] = r;
    ss += r * r;
  }
  const std = Math.sqrt(ss / M);
  const inv = std > 1e-6 ? 1 / std : 0;
  for (let k = 0; k < M; k++) z[k] *= inv;
  return { z, mean: a, std };
}

/**
 * 정규화하지 않은 표본 v와 정규화된 기준 z의 상관(NCC).
 * 기준이 평균 0이고 (flatten이면) 평면 성분이 없으므로 한 번의 합산으로 끝난다 — 정렬 탐색용.
 */
export function nccRaw(v: Float32Array, refZ: Float32Array, mk: MaskInfo, flatten: boolean): number {
  const M = mk.count;
  let s = 0;
  let s2 = 0;
  let sx = 0;
  let sy = 0;
  let sr = 0;
  const xs = mk.xs;
  const ys = mk.ys;
  for (let k = 0; k < M; k++) {
    const x = v[k];
    s += x;
    s2 += x * x;
    sr += x * refZ[k];
    if (flatten) {
      sx += x * xs[k];
      sy += x * ys[k];
    }
  }
  const a = s / M;
  let varRes = s2 / M - a * a;
  if (flatten) {
    const b = sx / mk.sxx;
    const c = sy / mk.syy;
    varRes -= (b * b * mk.sxx + c * c * mk.syy) / M;
  }
  if (varRes <= 1e-9) return 0;
  return sr / (M * Math.sqrt(varRes));
}

/** 정규화된 두 배열의 상관 (마스크 전체) */
export function dotMean(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s / a.length;
}

/** 일부 점(sel)만으로 다시 계산한 피어슨 상관 */
export function pearsonAt(a: Float32Array, b: Float32Array, sel: Int32Array): number {
  const n = sel.length;
  if (n < 8) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[sel[i]];
    sb += b[sel[i]];
  }
  const ma = sa / n;
  const mb = sb / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[sel[i]] - ma;
    const y = b[sel[i]] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  if (saa <= 1e-9 || sbb <= 1e-9) return 0;
  return sab / Math.sqrt(saa * sbb);
}

/** 선명도: 정규화된 표본의 이웃 간 평균 기울기 (흐릴수록 작다). ratio ≤ 1 마스크 전용 */
export function sharpness(z: Float32Array, mk: MaskInfo): number {
  const m = mk.m;
  let s = 0;
  let cnt = 0;
  for (let k = 0; k < mk.count; k++) {
    const i = mk.idx[k];
    const u = i % m;
    if (u + 1 < m) {
      const r = mk.pos[i + 1];
      if (r >= 0) {
        s += Math.abs(z[r] - z[k]);
        cnt++;
      }
    }
    if (i + m < m * m) {
      const d = mk.pos[i + m];
      if (d >= 0) {
        s += Math.abs(z[d] - z[k]);
        cnt++;
      }
    }
  }
  return cnt ? s / cnt : 0;
}

/** 두 정규화 표본의 평균 절대 차 (움직임·차이 측정) */
export function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]);
  return s / a.length;
}
