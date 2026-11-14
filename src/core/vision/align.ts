// 작은 위치·회전 오차 보정: 거친 단계에서 넓게, 고운 단계에서 좁게 상관이 가장 큰 자세를 찾는다.
import type { RoiImage } from './image';
import { circleMask, nccRaw, normalize, sampleMask, type MaskInfo, type Pose } from './mask';

/** 정렬은 웨이퍼 가장자리까지 조금 넘겨 본다 (원판 윤곽이 위치 단서) */
export const ALIGN_RATIO = 1.06;
export const ALIGN_STAGES = [32, 48, 96] as const;

export interface AlignTarget {
  flatten: boolean;
  levels: { mk: MaskInfo; z: Float32Array }[];
}

export interface SearchRange {
  /** ROI 한 변 대비 최대 이동 */
  maxShift: number;
  /** 최대 회전(도). 180 이상이면 전체 회전 */
  maxRot: number;
}

export interface AlignResult {
  pose: Pose;
  score: number;
}

/** 기준 영상을 pose 자세로 뽑아 단계별 정렬 목표를 만든다 */
export function makeTarget(img: RoiImage, pose: Pose, flatten: boolean): AlignTarget {
  return {
    flatten,
    levels: ALIGN_STAGES.map((n) => {
      const mk = circleMask(n, ALIGN_RATIO);
      return { mk, z: normalize(sampleMask(img, mk, pose), mk, flatten).z };
    }),
  };
}

function stage(
  img: RoiImage,
  t: AlignTarget,
  li: number,
  center: Pose,
  rotOffsets: number[],
  shiftRadius: number,
  shiftStep = 1,
): AlignResult {
  const { mk, z } = t.levels[li];
  const n = ALIGN_STAGES[li];
  const buf = new Float32Array(mk.count);
  let best: AlignResult = { pose: center, score: -Infinity };
  for (const dr of rotOffsets) {
    for (let iy = -shiftRadius; iy <= shiftRadius; iy++) {
      for (let ix = -shiftRadius; ix <= shiftRadius; ix++) {
        const pose = { dx: center.dx + (ix * shiftStep) / n, dy: center.dy + (iy * shiftStep) / n, rot: center.rot + dr };
        sampleMask(img, mk, pose, buf);
        const s = nccRaw(buf, z, mk, t.flatten);
        if (s > best.score) best = { pose, score: s };
      }
    }
  }
  return best;
}

export function rotationGrid(maxRot: number): { rots: number[]; step: number } {
  if (maxRot <= 0) return { rots: [0], step: 0 };
  if (maxRot >= 180) {
    const rots: number[] = [];
    for (let r = -180; r < 180; r += 6) rots.push(r);
    return { rots, step: 6 };
  }
  const step = Math.min(5, maxRot);
  const k = Math.round(maxRot / step);
  const rots: number[] = [];
  for (let i = -k; i <= k; i++) rots.push(i * step);
  return { rots, step };
}

export function align(img: RoiImage, t: AlignTarget, range: SearchRange): AlignResult {
  const { rots, step } = rotationGrid(range.maxRot);
  const K = Math.max(1, Math.ceil(range.maxShift * ALIGN_STAGES[0]));
  const s1 = stage(img, t, 0, { dx: 0, dy: 0, rot: 0 }, rots, K);
  const step2 = step / 2.5;
  const r2 = step2 > 0 ? [-2, -1, 0, 1, 2].map((i) => i * step2) : [0];
  const s2 = stage(img, t, 1, s1.pose, r2, 2);
  const r3 = step2 > 0 ? [-step2 / 2, 0, step2 / 2] : [0];
  const s3 = stage(img, t, 2, s2.pose, r3, 1);
  // 반 칸 단위로 한 번 더: 가는 선(칩 사이 길)은 표본 한 칸보다 얇아 반 칸 어긋남도 차이로 보인다
  const r4 = step2 > 0 ? [-step2 / 4, 0, step2 / 4] : [0];
  return stage(img, t, 2, s3.pose, r4, 1, 0.5);
}
