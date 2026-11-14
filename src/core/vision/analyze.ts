// 한 프레임 판정: 물체 존재 → 정렬 → 밝기 정규화 → 정상/불량 기준 유사도 → 차이 영역.
// 점수는 확률이 아니다. 유사도(상관), 판정 여유(유사도 차), 각종 비율로만 보인다.
import { align } from './align';
import type { RoiImage } from './image';
import { circleMask, dotMean, normalize, pearsonAt, sampleMask, sharpness, ZERO_POSE, type MaskInfo, type Pose } from './mask';
import { ANALYSIS_N, CMP_RATIO, GLARE_LEVEL, type PreparedRefs } from './reference';

export const ENGINE_VERSION = 'cmp1.0';
export const METHOD = 'ref-compare';

export interface Thresholds {
  /** 기준 일치 최소 유사도 */
  minMatch: number;
  /** 판정 여유: 차이 영역에서 정상 유사도 - 불량 유사도 */
  minMargin: number;
  /** 물체 있음 최소 무늬 진하기 비율 (null이면 빈 자리 기준으로 자동) */
  minTexture: number | null;
  minSharp: number;
  maxGlare: number;
  blockErr: number;
  maxOcclusion: number;
  maxMotion: number;
  consensus: number;
  maxShift: number;
  maxRot: number;
  flatten: boolean;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minMatch: 0.55,
  minMargin: 0.25,
  minTexture: null,
  minSharp: 0.75,
  maxGlare: 0.03,
  blockErr: 0.6,
  maxOcclusion: 0.05,
  maxMotion: 0.12,
  consensus: 3,
  maxShift: 0.09,
  maxRot: 15,
  flatten: true,
};

export type HoldReason =
  | 'no_reference'
  | 'no_object'
  | 'unstable'
  | 'blur'
  | 'glare'
  | 'occluded'
  | 'mismatch'
  | 'low_margin'
  | 'no_consensus'
  | 'camera'
  | 'timeout'
  | 'aborted';

export const HOLD_LABEL: Record<HoldReason, string> = {
  no_reference: '기준 사진 미등록',
  no_object: '물체 없음',
  unstable: '움직임·불안정',
  blur: '흐림',
  glare: '반사',
  occluded: '가림·기준과 다른 부분',
  mismatch: '기준 불일치',
  low_margin: '판정 여유 부족',
  no_consensus: '연속 프레임 불일치',
  camera: '카메라 실패',
  timeout: '시간 초과',
  aborted: '검사 중단',
};

export type Verdict3 = 'OK' | 'NG' | 'HOLD';

export interface FrameScores {
  pose: Pose;
  align: number;
  gOk: number;
  gNg: number | null;
  gEmpty: number | null;
  lOk: number | null;
  lNg: number | null;
  margin: number | null;
  texture: number;
  sharp: number;
  glare: number;
  occlusion: number;
}

export interface FrameVerdict {
  verdict: Verdict3;
  reason: HoldReason | null;
  scores: FrameScores;
}

/** 근거 그림용 (n×n, 비교 원 바깥은 NaN) */
export interface FrameDetail {
  n: number;
  view: Float32Array;
  diff: Float32Array;
  disc: Uint8Array | null;
}

const BLOCK = 12;
/** 블록 안 기준 무늬가 이보다 옅으면(정규화 단위) 상관은 보지 않는다 */
const LOCAL_TEXTURE = 0.35;
const LOCAL_MIN_CORR = 0.5;

export function textureFloor(refs: PreparedRefs, th: Thresholds): number {
  if (th.minTexture !== null) return th.minTexture;
  if (refs.emptyTexture !== null) return Math.min(0.6, Math.max(0.15, Math.sqrt(Math.max(refs.emptyTexture, 0.01))));
  return 0.35;
}

export function analyzeFrame(img: RoiImage, refs: PreparedRefs, th: Thresholds, wantDetail = false): { v: FrameVerdict; detail: FrameDetail | null } {
  const range = { maxShift: th.maxShift, maxRot: th.maxRot };
  const cmp = refs.cmp;

  const aOk = align(img, refs.okTarget, range);
  const aNg = refs.ngTarget ? align(img, refs.ngTarget, range) : null;
  const best = aNg && aNg.score > aOk.score ? aNg : aOk;

  const raw = sampleMask(img, cmp, best.pose);
  const X = normalize(raw, cmp, refs.flatten);
  const gOk = dotMean(X.z, refs.zOk.z);
  const gNg = refs.zNg ? dotMean(X.z, refs.zNg.z) : null;

  let gEmpty: number | null = null;
  if (refs.zEmpty) {
    const x0 = normalize(sampleMask(img, cmp, ZERO_POSE), cmp, refs.flatten);
    gEmpty = dotMean(x0.z, refs.zEmpty.z);
  }

  let lOk: number | null = null;
  let lNg: number | null = null;
  if (refs.disc && refs.zNg && refs.disc.length >= 8) {
    lOk = pearsonAt(X.z, refs.zOk.z, refs.disc);
    lNg = pearsonAt(X.z, refs.zNg.z, refs.disc);
  }
  const margin = lOk !== null && lNg !== null ? lOk - lNg : null;

  const occlusion = oddAreaFraction(X.z, refs.zNg ? [refs.zOk.z, refs.zNg.z] : [refs.zOk.z], cmp, th.blockErr);

  // 선명도·반사는 더 닮은 쪽 기준과 견준다 (불량 무늬 자체가 더 밝거나 거칠 수 있다)
  const nearNg = refs.zNg !== null && gNg !== null && gNg > gOk;
  const sharpRef = nearNg && refs.sharpNg ? refs.sharpNg : refs.sharpOk;
  const nearZ = nearNg && refs.zNg ? refs.zNg.z : refs.zOk.z;

  const scores: FrameScores = {
    pose: best.pose,
    align: best.score,
    gOk,
    gNg,
    gEmpty,
    lOk,
    lNg,
    margin,
    texture: refs.zOk.std > 0 ? X.std / refs.zOk.std : 0,
    sharp: sharpRef > 0 ? sharpness(X.z, cmp) / sharpRef : 0,
    glare: unexpectedGlare(raw, X.z, nearZ),
    occlusion,
  };

  const hold = (reason: HoldReason): FrameVerdict => ({ verdict: 'HOLD', reason, scores });
  const top = Math.max(gOk, gNg ?? -1);
  let v: FrameVerdict;
  if (!refs.zNg || margin === null) v = hold('no_reference');
  else if (scores.texture < textureFloor(refs, th) || (gEmpty !== null && gEmpty > 0.5 && gEmpty > top)) v = hold('no_object');
  else if (scores.glare > th.maxGlare) v = hold('glare');
  else if (scores.sharp < th.minSharp) v = hold('blur');
  else if (scores.occlusion > th.maxOcclusion) v = hold('occluded');
  else if (top < th.minMatch) v = hold('mismatch');
  else if (margin >= th.minMargin && gOk >= (gNg ?? -1) && gOk >= th.minMatch) v = { verdict: 'OK', reason: null, scores };
  else if (margin <= -th.minMargin && (gNg ?? -1) >= gOk && (gNg ?? -1) >= th.minMatch) v = { verdict: 'NG', reason: null, scores };
  else v = hold('low_margin');

  let detail: FrameDetail | null = null;
  if (wantDetail) {
    const n = ANALYSIS_N;
    const view = new Float32Array(n * n).fill(NaN);
    const diff = new Float32Array(n * n).fill(NaN);
    const ref = v.verdict === 'NG' && refs.zNg ? refs.zNg.z : refs.zOk.z;
    for (let k = 0; k < cmp.count; k++) {
      view[cmp.idx[k]] = raw[k];
      diff[cmp.idx[k]] = Math.abs(X.z[k] - ref[k]);
    }
    let disc: Uint8Array | null = null;
    if (refs.disc) {
      disc = new Uint8Array(n * n);
      for (let i = 0; i < refs.disc.length; i++) disc[cmp.idx[refs.disc[i]]] = 1;
    }
    detail = { n, view, diff, disc };
  }
  return { v, detail };
}

/** 반사: 포화됐고 기준보다 눈에 띄게 밝은 점의 비율. 원래 흰 인쇄 부분이 노출 때문에 포화된 것은 세지 않는다 */
export function unexpectedGlare(raw: Float32Array, z: Float32Array, refZ: Float32Array): number {
  let c = 0;
  for (let k = 0; k < raw.length; k++) if (raw[k] >= GLARE_LEVEL && z[k] - refZ[k] > 0.8) c++;
  return c / raw.length;
}

/**
 * 가림·처음 보는 무늬의 넓이 비율. 반씩 겹친 블록마다 어느 기준과도 맞지 않으면 그 블록의 점을 표시한다.
 * 맞음 = 평균 절대 차가 작고, 기준 쪽에 무늬가 있으면 그 무늬와 상관도 있어야 한다 (평평한 손이 무늬를 덮은 경우).
 */
export function oddAreaFraction(x: Float32Array, refs: Float32Array[], mk: MaskInfo, blockErr: number): number {
  const m = mk.m;
  const step = BLOCK / 2;
  const marked = new Uint8Array(mk.count);
  const pts: number[] = [];
  let considered = 0;
  const seen = new Uint8Array(mk.count);
  for (let by = 0; by + step < m; by += step) {
    for (let bx = 0; bx + step < m; bx += step) {
      pts.length = 0;
      for (let v = by; v < Math.min(m, by + BLOCK); v++) {
        for (let u = bx; u < Math.min(m, bx + BLOCK); u++) {
          const p = mk.pos[v * m + u];
          if (p >= 0) pts.push(p);
        }
      }
      if (pts.length < 0.3 * BLOCK * BLOCK) continue;
      for (const p of pts) seen[p] = 1;
      let fits = false;
      for (const r of refs) {
        let e = 0;
        let sx = 0;
        let sr = 0;
        for (const p of pts) {
          e += Math.abs(x[p] - r[p]);
          sx += x[p];
          sr += r[p];
        }
        const n = pts.length;
        e /= n;
        if (e > blockErr) continue;
        const mx = sx / n;
        const mr = sr / n;
        let xx = 0;
        let rr = 0;
        let xr = 0;
        for (const p of pts) {
          const a = x[p] - mx;
          const b = r[p] - mr;
          xx += a * a;
          rr += b * b;
          xr += a * b;
        }
        const refStd = Math.sqrt(rr / n);
        const c = xx > 1e-9 && rr > 1e-9 ? xr / Math.sqrt(xx * rr) : 0;
        if (refStd < LOCAL_TEXTURE || c >= LOCAL_MIN_CORR) {
          fits = true;
          break;
        }
      }
      if (!fits) for (const p of pts) marked[p] = 1;
    }
  }
  let odd = 0;
  for (let k = 0; k < mk.count; k++) {
    if (seen[k]) considered++;
    if (marked[k]) odd++;
  }
  return considered ? odd / considered : 0;
}

/**
 * 연속 두 프레임의 움직임: 같은 ROI(정렬 없이)의 평균 절대 차를 무늬 진하기로 나눈 값.
 * 빈 자리처럼 무늬가 없으면 잡음만 남아 작게 나온다.
 */
export function motionBetween(a: RoiImage, b: RoiImage, scale?: number): number {
  const mk = circleMask(48, CMP_RATIO);
  const ra = sampleMask(a, mk, ZERO_POSE);
  const rb = sampleMask(b, mk, ZERO_POSE);
  let ma = 0;
  let mb = 0;
  for (let k = 0; k < mk.count; k++) {
    ma += ra[k];
    mb += rb[k];
  }
  ma /= mk.count;
  mb /= mk.count;
  let s = 0;
  let ss = 0;
  for (let k = 0; k < mk.count; k++) {
    s += Math.abs(ra[k] - ma - (rb[k] - mb));
    ss += (ra[k] - ma) ** 2;
  }
  const sc = scale ?? Math.max(8, Math.sqrt(ss / mk.count));
  return s / mk.count / Math.max(sc, 1);
}
