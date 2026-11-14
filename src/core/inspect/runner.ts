// 검사 한 번: 요청 이후의 새 프레임만 써서 → 프레임 안정 확인 → 여러 장 판정 → 연속 프레임 합의.
// 합의가 안 되면 HOLD. HOLD를 NG로 바꾸지 않는다.
import { analyzeFrame, motionBetween, type FrameDetail, type FrameVerdict, type HoldReason, type Thresholds, type Verdict3 } from '../vision/analyze';
import type { RoiImage } from '../vision/image';
import type { PreparedRefs } from '../vision/reference';

export interface Frame {
  id: string;
  /** performance.now() 기준 프레임 시각 */
  t: number;
  img: RoiImage;
}

export interface FrameSource {
  /** `after` 이후에 들어온 새 프레임 하나 */
  nextFrame(after: number, signal: AbortSignal): Promise<Frame>;
}

export interface RunOptions {
  stableFrames: number;
  stableTimeoutMs: number;
  maxFrames: number;
  totalTimeoutMs: number;
  /** 요청 시각 + settleMs 이전 프레임은 쓰지 않는다 */
  settleMs: number;
  frameTimeoutMs: number;
}

export const DEFAULT_RUN: RunOptions = {
  stableFrames: 3,
  stableTimeoutMs: 3000,
  maxFrames: 8,
  totalTimeoutMs: 6500,
  settleMs: 120,
  frameTimeoutMs: 1500,
};

export interface FrameRecord {
  id: string;
  t: number;
  motion: number | null;
  v: FrameVerdict;
}

export interface Outcome {
  verdict: Verdict3;
  reason: HoldReason | null;
  frames: FrameRecord[];
  decisive: { frame: FrameRecord; detail: FrameDetail | null } | null;
  requestedAt: number;
  firstFrameAt: number | null;
  decidedAt: number;
}

export type RunProgress =
  | { phase: 'stabilizing'; stable: number; need: number; motion: number | null }
  | { phase: 'judging'; frames: FrameRecord[]; need: number };

/** 이 사유가 k번 연속이면 더 볼 필요 없이 HOLD */
const EARLY_HOLD: HoldReason[] = ['no_object', 'occluded', 'glare', 'blur', 'mismatch', 'no_reference'];

export function decideConsensus(frames: FrameRecord[], k: number): { verdict: Verdict3; reason: HoldReason | null } | null {
  if (frames.length < k) return null;
  const tail = frames.slice(-k);
  const first = tail[0].v;
  if (first.verdict !== 'HOLD' && tail.every((f) => f.v.verdict === first.verdict)) return { verdict: first.verdict, reason: null };
  if (first.verdict === 'HOLD' && first.reason && EARLY_HOLD.includes(first.reason) && tail.every((f) => f.v.reason === first.reason))
    return { verdict: 'HOLD', reason: first.reason };
  return null;
}

/**
 * 프레임 예산을 다 쓰고도 합의가 안 됐을 때의 HOLD 사유.
 * OK와 NG가 엇갈리면 판정 불확실(no_consensus). 한쪽 판정 사이에 손·움직임 같은 방해 프레임이 섞였을 뿐이면
 * 마지막 방해 사유를 돌려줘 새 프레임으로 다시 보게 한다. 어느 경우든 이 시도에서는 아무것도 보내지 않는다.
 */
export function exhaustedReason(frames: FrameRecord[]): HoldReason {
  const decided = new Set(frames.filter((f) => f.v.verdict !== 'HOLD').map((f) => f.v.verdict));
  if (decided.size > 1) return 'no_consensus';
  if (decided.size === 1) {
    for (let i = frames.length - 1; i >= 0; i--) {
      const v = frames[i].v;
      if (v.verdict === 'HOLD' && v.reason) return v.reason;
    }
    return 'no_consensus';
  }
  const count = new Map<HoldReason, number>();
  for (const f of frames) if (f.v.reason) count.set(f.v.reason, (count.get(f.v.reason) ?? 0) + 1);
  let best: HoldReason = 'no_consensus';
  let n = 0;
  count.forEach((c, r) => {
    if (c > n) {
      best = r;
      n = c;
    }
  });
  return best;
}

class StepTimeout extends Error {}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new StepTimeout('프레임이 들어오지 않아요')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function runInspection(
  src: FrameSource,
  refs: PreparedRefs | null,
  th: Thresholds,
  signal: AbortSignal,
  onProgress?: (p: RunProgress) => void,
  opts: RunOptions = DEFAULT_RUN,
  now: () => number = () => performance.now(),
): Promise<Outcome> {
  const requestedAt = now();
  let firstFrameAt: number | null = null;
  const frames: FrameRecord[] = [];
  const done = (verdict: Verdict3, reason: HoldReason | null, decisive: Outcome['decisive'] = null): Outcome => ({
    verdict,
    reason,
    frames,
    decisive,
    requestedAt,
    firstFrameAt,
    decidedAt: now(),
  });
  if (!refs || !refs.zNg) return done('HOLD', 'no_reference');

  const scale = Math.max(8, refs.zOk.std);
  let after = requestedAt + opts.settleMs;
  const next = async () => {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const f = await within(src.nextFrame(after, signal), opts.frameTimeoutMs);
    if (f.t <= after) throw new Error('이전 프레임이 섞였어요');
    after = f.t;
    firstFrameAt ??= f.t;
    return f;
  };

  try {
    // 1) 프레임 안정 확인
    let prev: Frame | null = null;
    let stable = 0;
    while (stable < opts.stableFrames) {
      if (now() - requestedAt > opts.stableTimeoutMs) return done('HOLD', 'unstable');
      const f = await next();
      const m = prev ? motionBetween(prev.img, f.img, scale) : null;
      stable = m === null || m <= th.maxMotion ? stable + 1 : 1;
      prev = f;
      onProgress?.({ phase: 'stabilizing', stable, need: opts.stableFrames, motion: m });
    }

    // 2) 여러 장 판정 → 연속 합의
    let last = prev!;
    for (;;) {
      if (frames.length >= opts.maxFrames || now() - requestedAt > opts.totalTimeoutMs) {
        const tailRec = frames[frames.length - 1];
        return done('HOLD', frames.length ? exhaustedReason(frames) : 'timeout', tailRec ? { frame: tailRec, detail: null } : null);
      }
      const f = await next();
      const motion = motionBetween(last.img, f.img, scale);
      const { v, detail } = analyzeFrame(f.img, refs, th, true);
      const rec: FrameRecord = {
        id: f.id,
        t: f.t,
        motion,
        v: motion > th.maxMotion ? { verdict: 'HOLD', reason: 'unstable', scores: v.scores } : v,
      };
      frames.push(rec);
      last = f;
      onProgress?.({ phase: 'judging', frames: [...frames], need: th.consensus });
      const c = decideConsensus(frames, th.consensus);
      if (c) return done(c.verdict, c.reason, { frame: rec, detail });
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || signal.aborted) return done('HOLD', 'aborted');
    if (e instanceof StepTimeout) return done('HOLD', 'camera');
    return done('HOLD', 'camera');
  }
}
