import { describe, expect, it } from 'vitest';
import { analyzeFrame, DEFAULT_THRESHOLDS, motionBetween } from '../src/core/vision/analyze';
import { DEFAULT_ROI } from '../src/core/vision/image';
import { buildStored, prepareRefs, type PreparedRefs } from '../src/core/vision/reference';
import { jitter, shoot } from './helpers/scene';

const th = DEFAULT_THRESHOLDS;
const range = { maxShift: th.maxShift, maxRot: th.maxRot };

function register(specimen: Parameters<typeof jitter>[1], seed: number) {
  // 등록할 때 한 번 놓고 4장을 찍어 평균 (같은 자리, 잡음만 다름)
  const base = jitter(seed, specimen);
  const frames = [0, 1, 2, 3].map((i) => shoot({ ...base, seed: seed * 100 + i }));
  return buildStored(specimen ? (specimen.startsWith('normal') ? 'ok' : 'ng') : 'empty', frames, DEFAULT_ROI, [], null);
}

let refsCache: PreparedRefs | null = null;
function refs(): PreparedRefs {
  if (!refsCache) {
    refsCache = prepareRefs({ ok: register('normal-a', 1), ng: register('defect-a', 2), empty: register(null, 3) }, th.flatten, range);
  }
  return refsCache;
}

describe('기준 준비', () => {
  it('정상·불량 기준이 충분히 다르고 차이 영역을 찾는다', () => {
    const r = refs();
    expect(r.separation).toBeGreaterThan(0.1);
    expect(r.disc!.length).toBeGreaterThan(100);
    expect(r.ngAlignScore).toBeGreaterThan(0.7);
  });
});

describe('재촬영 판정 (등록 프레임 재사용 없음)', () => {
  it('정상 시편 12회: 다시 놓을 때마다 위치·회전·조명이 달라도 모두 OK', () => {
    const r = refs();
    const res = Array.from({ length: 12 }, (_, i) => analyzeFrame(shoot(jitter(1000 + i, 'normal-a')), r, th).v);
    for (const v of res) expect(v.verdict, JSON.stringify(v.scores)).toBe('OK');
  });

  it('불량 시편 A 12회: 모두 NG', () => {
    const r = refs();
    const res = Array.from({ length: 12 }, (_, i) => analyzeFrame(shoot(jitter(2000 + i, 'defect-a')), r, th).v);
    for (const v of res) expect(v.verdict, JSON.stringify(v.scores)).toBe('NG');
  });

  it('빈 자리: 물체 없음 HOLD', () => {
    const r = refs();
    for (let i = 0; i < 4; i++) {
      const v = analyzeFrame(shoot(jitter(3000 + i, null)), r, th).v;
      expect(v.verdict).toBe('HOLD');
      expect(v.reason).toBe('no_object');
    }
  });

  it('빈 자리 기준 없이도 물체 없음 HOLD', () => {
    const r = prepareRefs({ ok: register('normal-a', 1), ng: register('defect-a', 2) }, th.flatten, range);
    const v = analyzeFrame(shoot(jitter(3100, null)), r, th).v;
    expect(v.verdict).toBe('HOLD');
    expect(v.reason).toBe('no_object');
  });

  it('손으로 가림(비교 영역의 약 9%·14%): OK/NG로 내보내지 않고 HOLD', () => {
    const r = refs();
    for (const spec of ['normal-a', 'defect-a'] as const) {
      for (const occlude of [0.3, 0.35]) {
        const v = analyzeFrame(shoot(jitter(4000, spec, { occlude })), r, th).v;
        expect(v.verdict, `${spec} ${occlude} ${JSON.stringify(v.scores)}`).toBe('HOLD');
        expect(v.reason).toBe('occluded');
      }
    }
  });

  it('반사: HOLD', () => {
    const v = analyzeFrame(shoot(jitter(5000, 'normal-a', { glare: true })), refs(), th).v;
    expect(v.verdict).toBe('HOLD');
    expect(v.reason).toBe('glare');
  });

  it('심한 흐림: HOLD', () => {
    const v = analyzeFrame(shoot(jitter(6000, 'normal-a', { blur: 4 })), refs(), th).v;
    expect(v.verdict).toBe('HOLD');
  });

  it('등록하지 않은 불량(B)은 OK가 되지 않는다', () => {
    const r = refs();
    for (let i = 0; i < 4; i++) {
      const v = analyzeFrame(shoot(jitter(7000 + i, 'defect-b')), r, th).v;
      expect(v.verdict, JSON.stringify(v.scores)).not.toBe('OK');
    }
  });

  it('위치가 크게 벗어나면 OK/NG를 내지 않는다', () => {
    const v = analyzeFrame(shoot({ ...jitter(8000, 'normal-a'), dx: 0.3 }), refs(), th).v;
    expect(v.verdict).toBe('HOLD');
  });
});

describe('움직임', () => {
  it('같은 자리 두 장은 작고, 미끄러지는 중이면 크다', () => {
    const r = refs();
    const scale = Math.max(8, r.zOk.std);
    const a = shoot({ ...jitter(9000, 'normal-a'), seed: 1 });
    const b = shoot({ ...jitter(9000, 'normal-a'), seed: 2 });
    const c = shoot({ ...jitter(9000, 'normal-a'), dx: 0.05, seed: 3 });
    expect(motionBetween(a, b, scale)).toBeLessThan(th.maxMotion);
    expect(motionBetween(a, c, scale)).toBeGreaterThan(th.maxMotion);
  });
});
