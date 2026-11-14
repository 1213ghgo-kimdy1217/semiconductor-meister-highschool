// 규약 V1: 파서·포맷·줄 버퍼, 그리고 웹 연결 계층 ↔ 가상 Uno·PLC 통합 시험.
// 가상 장치는 지시서 8·9장의 글을 옮긴 것이다. 동봉 펌웨어 실물과의 대조는 별도로 해야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineBuffer } from '../src/core/protocol/linebuffer';
import { DeviceLink, type LinkEvent } from '../src/core/protocol/link';
import { fmt, MAX_LINE, parseLine, UINT32_MAX } from '../src/core/protocol/v1';
import { SimTransport } from '../src/core/transport/sim';
import { SimDevice, type SimOptions, type SimWafer } from '../src/core/transport/simDevice';
import type { Transport } from '../src/core/transport/types';

describe('규약 V1 파서', () => {
  it('BOOT', () => {
    expect(parseLine('V1,BOOT,101.6MM,PLC_MAIN,NO_AUTOSTART')).toEqual({ kind: 'boot', size: '101.6MM', build: 'PLC_MAIN', autostart: 'NO_AUTOSTART' });
  });

  it('STATUS 13필드와 0/1 플래그', () => {
    const m = parseLine('V1,STATUS,30125,0,NEED_HOME,1,0,0,0,0,0,0,NONE');
    expect(m.kind).toBe('status');
    if (m.kind !== 'status') return;
    expect(m.status).toEqual({
      session: 30125,
      cycle: 0,
      phase: 'NEED_HOME',
      configured: true,
      homed: false,
      busy: false,
      done: false,
      fault: false,
      valid: false,
      ok: false,
      faultCode: 'NONE',
    });
  });

  it('EVENT · DONE(숫자·이름) · REJECT', () => {
    expect(parseLine('V1,EVENT,30125,1,INSPECT_REQUEST')).toEqual({ kind: 'event', session: 30125, cycle: 1, event: 'INSPECT_REQUEST' });
    expect(parseLine('V1,DONE,011,IDLE_CLOSED')).toEqual({ kind: 'done', command: '011', phase: 'IDLE_CLOSED' });
    expect(parseLine('V1,DONE,OPEN_STOP,IDLE_CLOSED')).toEqual({ kind: 'done', command: 'OPEN_STOP', phase: 'IDLE_CLOSED' });
    expect(parseLine('V1,REJECT,LINE_TOO_LONG')).toEqual({ kind: 'reject', reason: 'LINE_TOO_LONG' });
  });

  it('잘못된 행은 버린다', () => {
    const bad = [
      'V2,STATUS,1',
      'v1,BOOT,A,B,C',
      'V1,STATUS,1,0,NEED_HOME,1,0,0,0,0,0,0',
      'V1,STATUS,1,0,NEED_HOME,1,0,0,0,0,2,0,NONE',
      'V1,EVENT,-1,0,X',
      'V1,EVENT,01,0,X',
      'V1,EVENT,4294967296,0,X',
      'V1,EVENT,1,0,결과',
      'V1,EVENT,1,0,"X"',
      `V1,EVENT,1,0,${'A'.repeat(90)}`,
    ];
    for (const line of bad) expect(parseLine(line).kind, line).toBe('invalid');
  });

  it('모르는 종류는 기록만 (unknown)', () => {
    expect(parseLine('V1,HEARTBEAT,1').kind).toBe('unknown');
  });
});

describe('PC → Uno 명령 만들기', () => {
  it('운영 명령은 HELLO·PING·STATUS·RESULT·CAPTURE_FAILED뿐 — 이동 명령은 만들 수 없다', () => {
    expect(Object.keys(fmt).sort()).toEqual(['captureFailed', 'hello', 'ping', 'result', 'status']);
    expect(fmt.hello(30125)).toBe('V1,HELLO,30125');
    expect(fmt.result(30125, 1, 1, 1, 'OK')).toBe('V1,RESULT,30125,1,1,1,OK');
    expect(fmt.captureFailed(30125, 4)).toBe('V1,CAPTURE_FAILED,30125,4');
  });

  it('0·범위 밖·OK/NG 외 값은 거부', () => {
    expect(() => fmt.hello(0)).toThrow();
    expect(() => fmt.result(1, 0, 1, 1, 'OK')).toThrow();
    expect(() => fmt.result(1, 1, 1, 0, 'OK')).toThrow();
    expect(() => fmt.result(UINT32_MAX + 1, 1, 1, 1, 'OK')).toThrow();
    expect(() => fmt.result(1, 1, 1, 1, 'HOLD' as never)).toThrow();
    expect(() => fmt.result(1, 1.5, 1, 1, 'OK')).toThrow();
  });

  it('가장 긴 줄도 95바이트 이하', () => {
    expect(fmt.result(UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX, 'NG').length).toBeLessThanOrEqual(MAX_LINE);
  });
});

describe('줄 버퍼', () => {
  it('쪼개진 줄 · 붙은 줄 · CRLF · 빈 줄', () => {
    const b = new LineBuffer();
    expect(b.push('V1,BO')).toEqual([]);
    expect(b.push('OT,A,B,C\r\nV1,DONE,X,Y\n\r\n\nV1,RE')).toEqual([
      { type: 'line', line: 'V1,BOOT,A,B,C' },
      { type: 'line', line: 'V1,DONE,X,Y' },
    ]);
    expect(b.push('JECT,Z\n')).toEqual([{ type: 'line', line: 'V1,REJECT,Z' }]);
  });

  it('95바이트를 넘는 줄은 다음 줄바꿈까지 통째로 버린다', () => {
    const b = new LineBuffer();
    expect(b.push('X'.repeat(120))[0].type).toBe('overflow');
    expect(b.push('YYY\nV1,DONE,A,B\n')).toEqual([{ type: 'line', line: 'V1,DONE,A,B' }]);
    expect(b.push(`${'Z'.repeat(96)}\nV1,DONE,C,D\n`).map((e) => e.type)).toEqual(['overflow', 'line']);
  });
});

// ---------------- 연결 계층 ↔ 가상 장치 ----------------

function rig(simOpts: Partial<SimOptions> = {}) {
  const sim = new SimDevice(simOpts);
  const tr = new SimTransport(sim);
  const link = new DeviceLink();
  const events: LinkEvent[] = [];
  link.on((e) => events.push(e));
  const tx = () => link.log.filter((l) => l.dir === 'tx').map((l) => l.text);
  return { sim, tr, link, events, tx };
}
type Rig = ReturnType<typeof rig>;

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function until(cond: () => boolean, maxMs = 10000, step = 20) {
  for (let t = 0; t < maxMs && !cond(); t += step) await tick(step);
  expect(cond()).toBe(true);
}

/** 연결 → HMI 준비·원점 → 한 장 투입 → PLC 새 검사 요청까지 */
async function armed(r: Rig, kind: SimWafer = 'normal-a') {
  if (!r.link.isOpen) {
    await r.link.open(r.tr);
    await until(() => r.link.snapshot.phase === 'online');
  }
  if (!r.sim.snapshot.homed) {
    r.sim.hmiPermit(true);
    r.sim.hmiHome();
    await until(() => r.sim.snapshot.phase === 'IDLE_CLOSED' && r.sim.snapshot.plcStep === 'idle');
  }
  r.sim.hmiStart(kind);
  await until(() => r.link.snapshot.request?.open === true && r.sim.snapshot.plcStep === 'wait_result');
  return r.link.snapshot.request!.cycle;
}

async function send(r: Rig, cycle: number, verdict: 'OK' | 'NG') {
  const p = r.link.sendResult(cycle, r.link.nextCapture(), verdict);
  await tick(30);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('연결', () => {
  it('포트를 열면 BOOT → HELLO 한 번 → 등록. 웹은 아무것도 움직이지 않는다', async () => {
    const r = rig();
    await r.link.open(r.tr);
    await tick(3000);
    expect(r.link.snapshot.phase).toBe('online');
    expect(r.link.snapshot.boot).toMatchObject({ build: 'PLC_MAIN', autostart: 'NO_AUTOSTART' });
    expect(r.link.snapshot.status?.phase).toBe('NEED_HOME');
    expect(r.tx().filter((l) => l.startsWith('V1,HELLO'))).toHaveLength(1);
    expect(r.tx().every((l) => /^V1,(HELLO|PING|STATUS),\d+$/.test(l))).toBe(true);
    expect(r.sim.snapshot).toMatchObject({ stopGate: 'closed', diverter: 'center', plcCmd: null, cycle: 0 });
  });

  it('보드가 리셋되지 않아 BOOT가 오지 않으면 기다렸다가 HELLO', async () => {
    const r = rig({ resetOnOpen: false });
    await r.link.open(r.tr);
    await tick(4000);
    expect(r.link.snapshot.phase).toBe('online');
  });

  it('HELLO에 응답이 없으면 no_response — HELLO를 되풀이하지 않는다', async () => {
    const dead: Transport = { kind: 'sim', label: 'dead', onData: null, onClose: null, open: async () => {}, close: async () => {}, write: async () => {} };
    const link = new DeviceLink();
    await link.open(dead);
    await tick(15000);
    expect(link.snapshot.phase).toBe('no_response');
    expect(link.log.filter((l) => l.text.startsWith('V1,HELLO'))).toHaveLength(1);
  });

  it('여러 줄이 붙거나 쪼개져 와도 같은 결과', async () => {
    const r = rig({ chunkNoise: true });
    const cycle = await armed(r);
    await send(r, cycle, 'NG');
    await until(() => r.sim.snapshot.wafer?.at === 'cassette_ng');
    expect(r.link.log.some((l) => l.level === 'warn' && l.dir === 'rx')).toBe(false);
  });

  it('교정 플래그 false(배포 상태)면 BOOT_LOCKED — 원점·검사 요청이 나오지 않는다', async () => {
    const r = rig({ configured: false });
    await r.link.open(r.tr);
    await until(() => r.link.snapshot.status !== null);
    expect(r.link.snapshot.status).toMatchObject({ phase: 'BOOT_LOCKED', configured: false });
    r.sim.hmiPermit(true);
    r.sim.hmiHome();
    await tick(3000);
    expect(r.link.snapshot.status?.phase).toBe('BOOT_LOCKED');
    expect(r.events.some((e) => e.type === 'inspect_request')).toBe(false);
  });
});

describe('한 사이클', () => {
  it('정상: 결과 한 번 → RESULT_VALID → PLC가 OK 경로·열기 → 배출 동작 종료, 실물 수거는 미확인', async () => {
    const r = rig();
    const cycle = await armed(r, 'normal-a');
    expect(cycle).toBe(1);
    expect(r.events.filter((e) => e.type === 'inspect_request')).toHaveLength(1);
    const sent = await send(r, cycle, 'OK');
    expect(sent.state).toBe('accepted');
    await until(() => r.link.snapshot.result?.state === 'valid');
    await until(() => r.sim.snapshot.plcStep === 'wait_collection');
    await tick(30);
    expect(r.sim.snapshot.wafer?.at).toBe('cassette_ok');
    expect(r.sim.snapshot.collection).toBe('pending');
    expect(r.link.snapshot.status?.phase).toBe('IDLE_CLOSED');
    expect(r.link.snapshot.lastDone?.command).toBe('OPEN_STOP');
    expect(r.tx().filter((l) => l.startsWith('V1,RESULT'))).toEqual([`V1,RESULT,${r.link.snapshot.session},1,1,1,OK`]);
  });

  it('한 요청에는 결과를 한 번만: 두 번째는 웹이 막고, 같은 줄 재전송은 장치가 중복으로 무시, 본문 변경은 거부', async () => {
    const r = rig();
    const cycle = await armed(r, 'defect-a');
    await send(r, cycle, 'NG');
    await expect(r.link.sendResult(cycle, r.link.nextCapture(), 'OK')).rejects.toThrow('이미 결과를 보냈어요');
    const line = r.tx().find((l) => l.startsWith('V1,RESULT'))!;
    await r.tr.write(line);
    await tick(30);
    expect(r.link.snapshot.result?.duplicateSeen).toBe(true);
    await r.tr.write(line.replace(/NG$/, 'OK'));
    await tick(30);
    expect(r.link.snapshot.lastReject?.reason).toBe('BODY_CHANGED');
    await until(() => r.sim.snapshot.plcStep === 'wait_collection');
    expect(r.sim.snapshot.wafer?.at).toBe('cassette_ng');
  });

  it('다른 세션·같은 cycle 중복 검사 요청은 무시', async () => {
    const r = rig();
    const cycle = await armed(r);
    r.tr.onData?.(`V1,EVENT,${r.link.snapshot.session},${cycle},INSPECT_REQUEST\n`);
    r.tr.onData?.(`V1,EVENT,999,${cycle + 1},INSPECT_REQUEST\n`);
    await tick(10);
    expect(r.events.filter((e) => e.type === 'inspect_request')).toHaveLength(1);
    expect(r.link.snapshot.request?.cycle).toBe(cycle);
  });

  it('늦게 도착한 이전 cycle 결과는 거부되고 아무것도 움직이지 않는다', async () => {
    const r = rig();
    const c1 = await armed(r);
    await send(r, c1, 'OK');
    await until(() => r.sim.snapshot.plcStep === 'wait_collection');
    r.sim.hmiConfirmCollection();
    const c2 = await armed(r, 'defect-a');
    expect(c2).toBe(2);
    r.sim.injectStaleResult();
    await tick(50);
    expect(r.sim.snapshot.phase).toBe('WAIT_INSPECTION');
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
    expect(r.sim.snapshot.log.some((l) => l.text.includes('늦게 온 이전 결과'))).toBe(true);
  });
});

describe('HOLD와 복구 — 자동 NG·자동 재개 없음', () => {
  it('USB 단절: 장치는 PC 연결 시간 초과로 HOLD, 원판은 게이트에 그대로, 결과를 보낼 수 없음', async () => {
    const r = rig();
    const cycle = await armed(r);
    r.tr.unplug();
    expect(r.link.snapshot.phase).toBe('lost');
    expect(r.link.snapshot.request?.open).toBe(false);
    await tick(3000);
    expect(r.sim.snapshot).toMatchObject({ phase: 'HOLD_FAULT', faultCode: 'PC_LINK_TIMEOUT', stopGate: 'closed' });
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
    await expect(r.link.sendResult(cycle, r.link.nextCapture(), 'OK')).rejects.toThrow();
  });

  it('다시 연결·페이지 새로고침(새 세션 HELLO): HOST_RECONNECTED HOLD 유지, 이전 판정 무효', async () => {
    const r = rig({ resetOnOpen: false });
    await armed(r);
    await r.link.close();
    const fresh = new DeviceLink();
    await fresh.open(new SimTransport(r.sim));
    await until(() => fresh.snapshot.phase === 'online' && fresh.snapshot.status !== null);
    expect(fresh.snapshot.hostReconnected).toBe(true);
    expect(fresh.snapshot.status).toMatchObject({ phase: 'HOLD_FAULT', faultCode: 'HOST_RECONNECTED', valid: false });
    expect(fresh.snapshot.request).toBeNull();
    await tick(5000);
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
    expect(r.sim.snapshot.stopGate).toBe('closed');
  });

  it('보드가 리셋되며 다시 연결돼도 원점 필요 상태로 대기 — 원판이 통로에 있으면 원점도 거부', async () => {
    const r = rig();
    await armed(r);
    r.tr.unplug();
    await tick(3000);
    await r.link.open(new SimTransport(r.sim));
    await until(() => r.link.snapshot.phase === 'online' && r.link.snapshot.status !== null);
    expect(r.link.snapshot.status?.phase).toBe('NEED_HOME');
    r.sim.hmiHome();
    await tick(2000);
    expect(r.sim.snapshot.phase).toBe('NEED_HOME');
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
  });

  it('촬영 실패: CAPTURE_FAILED 한 번 → 장치 HOLD, 자동 NG·재촬영·방출 없음', async () => {
    const r = rig();
    const cycle = await armed(r);
    expect(r.link.sendCaptureFailed(cycle)).toBe(true);
    await tick(100);
    expect(r.sim.snapshot).toMatchObject({ phase: 'HOLD_FAULT', faultCode: 'CAPTURE_FAILED', stopGate: 'closed' });
    expect(r.link.sendCaptureFailed(cycle)).toBe(false);
    await tick(5000);
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
    expect(r.tx().some((l) => l.startsWith('V1,RESULT'))).toBe(false);
  });

  it('검사 시간 초과(60초): HOLD, 요청이 닫혀 결과를 보낼 수 없음', async () => {
    const r = rig();
    const cycle = await armed(r);
    await tick(61000);
    expect(r.sim.snapshot.faultCode).toBe('INSPECTION_TIMEOUT');
    expect(r.link.snapshot.request?.open).toBe(false);
    await expect(r.link.sendResult(cycle, r.link.nextCapture(), 'OK')).rejects.toThrow();
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
  });

  it('운전 허가 상실: HOLD 래치, 허가를 다시 켜도 재개하지 않음', async () => {
    const r = rig();
    await armed(r);
    r.sim.hmiPermit(false);
    r.sim.hmiPermit(true);
    await tick(5000);
    expect(r.link.snapshot.status).toMatchObject({ phase: 'HOLD_FAULT', faultCode: 'RUN_PERMIT_LOST' });
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
  });

  it('PLC가 판정과 반대 경로를 요청하면 Uno가 거부하고 HOLD — 방출 없음', async () => {
    const r = rig();
    const cycle = await armed(r, 'defect-a');
    r.sim.injectOppositeRoute();
    await send(r, cycle, 'NG');
    await tick(3000);
    expect(r.sim.snapshot.phase).toBe('HOLD_FAULT');
    expect(r.sim.snapshot.diverter).toBe('center');
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
  });

  it('배출 중 분기 변경 요청은 거부 — 이미 게이트를 지난 원판은 그대로 떨어진다', async () => {
    const r = rig();
    const cycle = await armed(r, 'normal-a');
    await send(r, cycle, 'OK');
    await until(() => r.sim.snapshot.phase === 'OPEN_WAIT_DRAIN', 10000, 10);
    r.sim.injectRouteDuringDrain();
    await tick(3000);
    expect(r.sim.snapshot.phase).toBe('HOLD_FAULT');
    expect(r.sim.snapshot.diverter).toBe('ok');
    expect(r.sim.snapshot.wafer?.at).toBe('cassette_ok');
  });

  it('Uno 재부팅: 새 세션으로 다시 등록, 이전 요청 무효, 원점 필요로 대기', async () => {
    const r = rig();
    const cycle = await armed(r);
    const s1 = r.link.snapshot.session;
    r.sim.reboot();
    await until(() => r.link.snapshot.reboots === 1 && r.link.snapshot.phase === 'online' && r.link.snapshot.status !== null);
    expect(r.link.snapshot.session).not.toBe(s1);
    expect(r.link.snapshot.request?.open).toBe(false);
    expect(r.link.snapshot.status?.phase).toBe('NEED_HOME');
    await expect(r.link.sendResult(cycle, r.link.nextCapture(), 'OK')).rejects.toThrow();
    expect(r.sim.snapshot.wafer?.at).toBe('gate');
  });
});
