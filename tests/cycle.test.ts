// 장치 검사 요청 하나를 웹이 처리하는 규칙 (지시서 5·6·8장)
// 확정 OK/NG만 한 번 보낸다 · 손 가림·물체 없음·흔들림은 보내지 않고 새 프레임으로 계속 본다 ·
// 판정 불확실·기준 미등록은 보내지 않고 멈춘다 · 복구할 수 없는 카메라 실패만 CAPTURE_FAILED.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN, exhaustedReason, type Frame, type FrameRecord, type Outcome, type RunOptions } from '../src/core/inspect/runner';
import type { DeviceLink, SentResult } from '../src/core/protocol/link';
import { CycleRunner, decide, type LiveFrames } from '../src/core/station/cycle';
import { DEFAULT_THRESHOLDS, HOLD_LABEL, type HoldReason } from '../src/core/vision/analyze';
import { DEFAULT_ROI } from '../src/core/vision/image';
import { buildStored, prepareRefs, type PreparedRefs } from '../src/core/vision/reference';
import { jitter, shoot, type Shot } from './helpers/scene';

const th = DEFAULT_THRESHOLDS;

function register(specimen: Parameters<typeof jitter>[1], seed: number) {
  const base = jitter(seed, specimen);
  const frames = [0, 1, 2, 3].map((i) => shoot({ ...base, seed: seed * 100 + i }));
  return buildStored(specimen ? (specimen.startsWith('normal') ? 'ok' : 'ng') : 'empty', frames, DEFAULT_ROI, [], null);
}

let refsCache: PreparedRefs | null = null;
function refs(): PreparedRefs {
  refsCache ??= prepareRefs({ ok: register('normal-a', 1), ng: register('defect-a', 2), empty: register(null, 3) }, th.flatten, {
    maxShift: th.maxShift,
    maxRot: th.maxRot,
  });
  return refsCache;
}

const outcome = (verdict: Outcome['verdict'], reason: HoldReason | null = null): Outcome => ({
  verdict,
  reason,
  frames: [],
  decisive: null,
  requestedAt: 0,
  firstFrameAt: null,
  decidedAt: 0,
});

const rec = (verdict: 'OK' | 'NG' | 'HOLD', reason: HoldReason | null = null) =>
  ({ id: 'f', t: 0, motion: 0, v: { verdict, reason, scores: null } }) as unknown as FrameRecord;

describe('시도 결과 → 다음 할 일', () => {
  it('OK·NG만 보낸다. 어떤 HOLD 사유도 OK/NG로 바꿔 보내지 않는다', () => {
    expect(decide(outcome('OK'), true, 0)).toBe('send');
    expect(decide(outcome('NG'), true, 0)).toBe('send');
    for (const r of Object.keys(HOLD_LABEL) as HoldReason[]) {
      for (const live of [true, false]) for (const fails of [0, 1, 5]) expect(decide(outcome('HOLD', r), live, fails), r).not.toBe('send');
    }
  });

  it('물체 없음·흔들림·손 가림·반사·흐림은 보내지 않고 계속 본다', () => {
    for (const r of ['no_object', 'unstable', 'occluded', 'glare', 'blur', 'timeout'] as HoldReason[]) expect(decide(outcome('HOLD', r), true, 0), r).toBe('keep_watching');
  });

  it('기준 불일치·판정 여유 부족·프레임 불일치·기준 미등록은 보내지 않고 멈춘다', () => {
    for (const r of ['mismatch', 'low_margin', 'no_consensus', 'no_reference'] as HoldReason[]) expect(decide(outcome('HOLD', r), true, 0), r).toBe('withhold');
  });

  it('카메라: 연결된 채 한 번 멈추면 다시 보고, 끊겼거나 두 번째면 CAPTURE_FAILED', () => {
    expect(decide(outcome('HOLD', 'camera'), true, 0)).toBe('keep_watching');
    expect(decide(outcome('HOLD', 'camera'), true, 1)).toBe('capture_failed');
    expect(decide(outcome('HOLD', 'camera'), false, 0)).toBe('capture_failed');
    expect(decide(outcome('HOLD', 'aborted'), true, 0)).toBe('stop');
  });
});

describe('합의가 안 된 시도의 사유', () => {
  it('OK와 NG가 엇갈리면 판정 불확실', () => {
    expect(exhaustedReason([rec('OK'), rec('NG'), rec('OK'), rec('HOLD', 'unstable'), rec('NG')])).toBe('no_consensus');
  });

  it('한쪽 판정 사이에 손·움직임이 섞였을 뿐이면 마지막 방해 사유 → 새 프레임으로 다시 본다', () => {
    const r = exhaustedReason([rec('HOLD', 'occluded'), rec('HOLD', 'unstable'), rec('OK'), rec('HOLD', 'unstable'), rec('OK'), rec('OK'), rec('HOLD', 'unstable'), rec('OK')]);
    expect(r).toBe('unstable');
    expect(decide(outcome('HOLD', r), true, 0)).toBe('keep_watching');
  });

  it('판정 여유가 들쭉날쭉하면 그대로 멈춘다', () => {
    const r = exhaustedReason([rec('OK'), rec('HOLD', 'low_margin'), rec('OK'), rec('HOLD', 'low_margin')]);
    expect(decide(outcome('HOLD', r), true, 0)).toBe('withhold');
  });

  it('모두 보류면 가장 많은 사유', () => {
    expect(exhaustedReason([rec('HOLD', 'glare'), rec('HOLD', 'occluded'), rec('HOLD', 'occluded')])).toBe('occluded');
  });
});

// ---------- 가짜 카메라·가짜 장치로 요청 하나를 끝까지 ----------

type Scene = Shot | 'dead';

class ScriptedCamera implements LiveFrames {
  live = true;
  private n = 0;
  constructor(private scene: () => Scene) {}

  nextFrame(after: number, signal: AbortSignal): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const s = this.scene();
      if (s === 'dead') {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        return;
      }
      setTimeout(() => {
        const n = ++this.n;
        resolve({ id: `f${n}`, t: Math.max(performance.now(), after + 0.01), img: shoot({ ...s, seed: 50_000 + n }) });
      }, 1);
    });
  }
}

function fakeLink() {
  const sent: { cycle: number; capture: number; verdict: string }[] = [];
  const failed: number[] = [];
  let capture = 0;
  const link = {
    nextCapture: () => ++capture,
    canSend: () => null,
    async sendResult(cycle: number, cap: number, verdict: 'OK' | 'NG') {
      sent.push({ cycle, capture: cap, verdict });
      return { cycle, capture: cap, seq: sent.length, verdict, state: 'valid', reason: null, sentAt: 0, tries: 1 } as unknown as SentResult;
    },
    sendCaptureFailed(cycle: number) {
      failed.push(cycle);
      return true;
    },
  };
  return { link: link as unknown as DeviceLink, sent, failed };
}

const RUN: RunOptions = { ...DEFAULT_RUN, settleMs: 0, frameTimeoutMs: 150 };

function start(scene: () => Scene, refsFn: () => PreparedRefs | null = refs) {
  const cam = new ScriptedCamera(scene);
  const dev = fakeLink();
  const runner = new CycleRunner(dev.link, cam, { refs: refsFn, thresholds: () => th, run: RUN, retryDelayMs: 5, onState: () => {} });
  runner.begin(7, 3);
  return { runner, cam, ...dev };
}

async function until(pred: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('시간 안에 끝나지 않았어요');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 150));

describe('검사 요청 하나 (가짜 카메라 · 가짜 장치)', () => {
  it('손으로 가린 동안에는 보내지 않고 새 프레임으로 계속 본다 → 손을 치우면 OK를 한 번만 보낸다', async () => {
    const base = jitter(4000, 'normal-a');
    let hand = true;
    const t = start(() => (hand ? { ...base, occlude: 0.3 } : base));
    await until(() => (t.runner.state?.trail.length ?? 0) >= 3);
    expect(t.sent).toEqual([]);
    expect(t.failed).toEqual([]);
    expect(t.runner.watching).toBe(true);
    expect(t.runner.state!.trail.every((r) => r === 'occluded' || r === 'unstable')).toBe(true);
    hand = false;
    await until(() => t.sent.length > 0);
    await settle();
    expect(t.sent).toEqual([{ cycle: 3, capture: 1, verdict: 'OK' }]);
    t.runner.dispose();
  });

  it('판정 중 흔들린 프레임이 끼어 연속 일치가 안 나와도(손을 치우며 원판을 건드림) 멈추지 않고, 안정된 뒤 OK 한 번', async () => {
    const base = jitter(4100, 'normal-a');
    const bumped = { ...base, dx: (base.dx ?? 0) + 0.05 };
    let k = 0;
    // 안정 3장 → 판정 프레임 3장마다 한 번 밀린 프레임: 판정 8장이 '흔들림, 흔들림, OK'로 반복돼 연속 3장 일치가 없다 → 다시 안정
    const t = start(() => {
      k++;
      return k > 3 && k <= 12 && (k - 4) % 3 === 0 ? bumped : base;
    });
    await until(() => (t.runner.state?.trail.length ?? 0) >= 1);
    expect(t.runner.state!.trail[0]).toBe('unstable');
    expect(t.runner.state!.stage).not.toBe('gave_up');
    expect(t.sent).toEqual([]);
    await until(() => t.sent.length > 0);
    await settle();
    expect(t.sent.map((s) => s.verdict)).toEqual(['OK']);
    expect(t.failed).toEqual([]);
    t.runner.dispose();
  });

  it('빈 자리: 원판이 보일 때까지 기다린다 → 불량 시편을 놓으면 NG 한 번', async () => {
    let placed = false;
    const empty = jitter(4200, null);
    const wafer = jitter(4201, 'defect-a');
    const t = start(() => (placed ? wafer : empty));
    await until(() => (t.runner.state?.trail.length ?? 0) >= 2);
    expect(t.runner.state!.stage).toBe('waiting_object');
    expect(t.sent).toEqual([]);
    placed = true;
    await until(() => t.sent.length > 0);
    await settle();
    expect(t.sent.map((s) => s.verdict)).toEqual(['NG']);
    t.runner.dispose();
  });

  it('기준 미등록: 보내지 않고 멈춘다 (CAPTURE_FAILED도 아님)', async () => {
    const t = start(() => jitter(4300, 'normal-a'), () => null);
    await until(() => t.runner.state?.stage === 'gave_up');
    await settle();
    expect(t.runner.state!.trail).toEqual(['no_reference']);
    expect(t.sent).toEqual([]);
    expect(t.failed).toEqual([]);
  });

  it('카메라가 끊긴 채면 CAPTURE_FAILED 한 번, 결과는 보내지 않는다', async () => {
    const t = start(() => 'dead');
    t.cam.live = false;
    await until(() => t.runner.state?.stage === 'gave_up');
    await settle();
    expect(t.failed).toEqual([3]);
    expect(t.sent).toEqual([]);
  });

  it('카메라가 한 번 멈췄다 살아나면 다시 보고 결과 한 번 · 두 번 연속 멈추면 CAPTURE_FAILED', async () => {
    const base = jitter(4400, 'normal-a');
    let stalls = 1;
    const t = start(() => (stalls > 0 ? 'dead' : base));
    await until(() => (t.runner.state?.trail.length ?? 0) >= 1);
    stalls = 0;
    await until(() => t.sent.length > 0);
    await settle();
    expect(t.runner.state!.trail[0]).toBe('camera');
    expect(t.sent.map((s) => s.verdict)).toEqual(['OK']);
    expect(t.failed).toEqual([]);

    const t2 = start(() => 'dead');
    await until(() => t2.runner.state?.stage === 'gave_up');
    await settle();
    expect(t2.runner.state!.trail).toEqual(['camera', 'camera']);
    expect(t2.failed).toEqual([3]);
    expect(t2.sent).toEqual([]);
  });

  it('장치가 요청을 닫으면(시간 초과·연결 끊김) 즉시 멈추고 아무것도 보내지 않는다', async () => {
    const base = jitter(4500, 'normal-a');
    const t = start(() => ({ ...base, occlude: 0.3 }));
    await until(() => (t.runner.state?.trail.length ?? 0) >= 1);
    t.runner.close(3, '검사 시간 초과');
    await settle();
    expect(t.runner.state!.closed).toBe('검사 시간 초과');
    expect(t.runner.watching).toBe(false);
    expect(t.sent).toEqual([]);
    expect(t.failed).toEqual([]);
  });
});
