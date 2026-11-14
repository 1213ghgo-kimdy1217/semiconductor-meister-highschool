// 기준 사진(빈 자리·정상·불량): 실제 카메라로 여러 장 찍어 평균한 ROI 영상과, 판정에 쓰는 준비값.
import { align, makeTarget, type AlignTarget, type SearchRange } from './align';
import { averageGray, makeGray, makeRoiImage, type Roi, type RoiImage } from './image';
import { circleMask, dotMean, normalize, sampleMask, sharpness, ZERO_POSE, type MaskInfo, type Normed, type Pose } from './mask';

export type RefKind = 'empty' | 'ok' | 'ng';

export const REF_LABEL: Record<RefKind, string> = { empty: '빈 자리', ok: '정상', ng: '불량' };

/** 비교 해상도와 비교 원(가장자리는 위치 오차에 민감해 뺀다) */
export const ANALYSIS_N = 96;
export const CMP_RATIO = 0.9;

export interface StoredReference {
  kind: RefKind;
  w: number;
  h: number;
  /** 평균한 L0 휘도 (0~255 반올림) */
  pixels: Uint8Array;
  roi: Roi;
  frames: number;
  captureIds: string[];
  capturedAt: string;
  cameraLabel: string | null;
}

export function sameRoi(a: Roi, b: Roi): boolean {
  const e = 1e-4;
  return Math.abs(a.cx - b.cx) < e && Math.abs(a.cy - b.cy) < e && Math.abs(a.size - b.size) < e && Math.abs(a.rot - b.rot) < 1e-3;
}

export function buildStored(kind: RefKind, frames: RoiImage[], roi: Roi, captureIds: string[], cameraLabel: string | null): StoredReference {
  const avg = averageGray(frames.map((f) => f.levels[0]));
  const pixels = new Uint8Array(avg.data.length);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.max(0, Math.min(255, Math.round(avg.data[i])));
  return { kind, w: avg.w, h: avg.h, pixels, roi: { ...roi }, frames: frames.length, captureIds, capturedAt: new Date().toISOString(), cameraLabel };
}

export function storedToImage(s: StoredReference): RoiImage {
  const g = makeGray(s.w, s.h);
  for (let i = 0; i < g.data.length; i++) g.data[i] = s.pixels[i];
  return makeRoiImage(g, s.roi.rot);
}

export interface PreparedRefs {
  flatten: boolean;
  cmp: MaskInfo;
  okImg: RoiImage;
  okTarget: AlignTarget;
  zOk: Normed;
  rawOk: Float32Array;
  sharpOk: number;
  sharpNg: number | null;
  ngTarget: AlignTarget | null;
  zNg: Normed | null;
  /** 불량 기준을 정상 기준 자리로 옮긴 자세 */
  ngPose: Pose | null;
  ngAlignScore: number | null;
  /** 정상·불량 기준이 서로 다른 점들 (비교 원 안 번호) */
  disc: Int32Array | null;
  /** 1 - 정상·불량 기준 상관. 0에 가까우면 두 기준이 너무 비슷하다 */
  separation: number | null;
  zEmpty: Normed | null;
  /** 빈 자리 무늬 진하기 / 정상 무늬 진하기 */
  emptyTexture: number | null;
}

/** 이 휘도 이상이면 포화(반사 후보)로 본다 */
export const GLARE_LEVEL = 245;

/** 이웃과 평균한 뒤 값이 큰 위쪽 frac만큼의 점 */
function topPoints(d: Float32Array, mk: MaskInfo, frac: number, minValue: number): Int32Array {
  const m = mk.m;
  const sm = new Float32Array(d.length);
  for (let k = 0; k < mk.count; k++) {
    const i = mk.idx[k];
    let s = 0;
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const u = (i % m) + dx;
        const v = Math.floor(i / m) + dy;
        if (u < 0 || v < 0 || u >= m || v >= m) continue;
        const p = mk.pos[v * m + u];
        if (p >= 0) {
          s += d[p];
          c++;
        }
      }
    }
    sm[k] = s / c;
  }
  const sorted = Array.from(sm).sort((a, b) => b - a);
  const cut = Math.max(minValue, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * frac))]);
  const sel: number[] = [];
  for (let k = 0; k < sm.length; k++) if (sm[k] >= cut) sel.push(k);
  return Int32Array.from(sel);
}

export function prepareRefs(
  refs: { ok: StoredReference; ng?: StoredReference | null; empty?: StoredReference | null },
  flatten: boolean,
  range: SearchRange,
): PreparedRefs {
  const cmp = circleMask(ANALYSIS_N, CMP_RATIO);
  const okImg = storedToImage(refs.ok);
  const okTarget = makeTarget(okImg, ZERO_POSE, flatten);
  const rawOk = sampleMask(okImg, cmp, ZERO_POSE);
  const zOk = normalize(rawOk, cmp, flatten);

  let ngTarget: AlignTarget | null = null;
  let zNg: Normed | null = null;
  let ngPose: Pose | null = null;
  let ngAlignScore: number | null = null;
  let disc: Int32Array | null = null;
  let separation: number | null = null;
  if (refs.ng) {
    const ngImg = storedToImage(refs.ng);
    const a = align(ngImg, okTarget, range);
    ngPose = a.pose;
    ngAlignScore = a.score;
    ngTarget = makeTarget(ngImg, a.pose, flatten);
    zNg = normalize(sampleMask(ngImg, cmp, a.pose), cmp, flatten);
    separation = 1 - dotMean(zOk.z, zNg.z);
    const d = new Float32Array(cmp.count);
    for (let k = 0; k < cmp.count; k++) d[k] = Math.abs(zOk.z[k] - zNg.z[k]);
    disc = topPoints(d, cmp, 0.15, 0.5);
  }

  let zEmpty: Normed | null = null;
  let emptyTexture: number | null = null;
  if (refs.empty) {
    const eImg = storedToImage(refs.empty);
    const e = normalize(sampleMask(eImg, cmp, ZERO_POSE), cmp, flatten);
    emptyTexture = zOk.std > 0 ? e.std / zOk.std : null;
    // 거의 무늬 없는 빈 자리는 상관이 잡음뿐이라 쓰지 않는다
    zEmpty = e.std >= 2 ? e : null;
  }

  return {
    flatten,
    cmp,
    okImg,
    okTarget,
    zOk,
    rawOk,
    sharpOk: sharpness(zOk.z, cmp),
    sharpNg: zNg ? sharpness(zNg.z, cmp) : null,
    ngTarget,
    zNg,
    ngPose,
    ngAlignScore,
    disc,
    separation,
    zEmpty,
    emptyTexture,
  };
}
