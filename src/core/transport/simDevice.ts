// 시험 모드용 가상 장치: 동봉 Uno 운영 펌웨어(규약 V1)의 겉동작 + 가상 PLC 순서 + 가상 HMI + 기구 위치.
// 실제 포트·PLC 신호와 아무 관계가 없다. 웹 쪽 코드는 실제 SerialTransport와 똑같은 인터페이스로 이것과 대화한다.
// 거부 사유·고장 코드 문자열은 시뮬레이터가 정한 이름이다 — 동봉 펌웨어의 실제 문자열과 대조해야 한다.
import { MAX_LINE, parseUint, type Phase } from '../protocol/v1';

export type SimWafer = 'normal-a' | 'defect-a' | 'defect-b' | 'defect-c' | 'empty';
export type WaferAt = 'chute' | 'gate' | 'passing' | 'cassette_ok' | 'cassette_ng' | 'removed';

export const SIM_WAFER_LABEL: Record<SimWafer, string> = {
  'normal-a': '정상 시편 A',
  'defect-a': '불량 시편 A',
  'defect-b': '불량 시편 B (기준 미등록)',
  'defect-c': '불량 시편 C (어려움)',
  empty: '빈 트레이 (물체 없음)',
};

export interface SimDisturb {
  hand: boolean;
  glare: boolean;
  blur: boolean;
  dim: boolean;
}

export interface SimOptions {
  /** 동봉 펌웨어 교정 플래그 4개가 모두 확인됐다고 가정. false면 BOOT_LOCKED로 잠긴다(실제 초기 상태). */
  configured: boolean;
  /** 포트를 열면 보드가 리셋되는 Uno 동작 */
  resetOnOpen: boolean;
  bootMs: number;
  linkTimeoutMs: number;
  inspectionTimeoutMs: number;
  validDelayMs: number;
  homeMs: number;
  routeMs: number;
  openMs: number;
  drainMs: number;
  slideMs: number;
  /** 줄을 쪼개거나 여러 줄을 붙여 보내기 (수신 파서 시험) */
  chunkNoise: boolean;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  configured: true,
  resetOnOpen: true,
  bootMs: 900,
  linkTimeoutMs: 2500,
  inspectionTimeoutMs: 60000,
  validDelayMs: 100,
  homeMs: 1200,
  routeMs: 700,
  openMs: 400,
  drainMs: 1600,
  slideMs: 900,
  chunkNoise: false,
};

export type PlcStep =
  | 'idle'
  | 'homing'
  | 'closing'
  | 'inserting'
  | 'arming'
  | 'wait_result'
  | 'routing'
  | 'opening'
  | 'wait_collection'
  | 'resetting'
  | 'hold';

export const PLC_STEP_LABEL: Record<PlcStep, string> = {
  idle: '대기',
  homing: '원점 복귀 요청 (100)',
  closing: '정지 게이트 닫힘 확인 (000)',
  inserting: '한 장 투입 중',
  arming: '새 검사 요청 (110)',
  wait_result: 'RESULT_VALID 대기',
  routing: '경로 요청 (001/010)',
  opening: '정지 게이트 열기 (011)',
  wait_collection: '배출 동작 종료 · 실물 수거 미확인 — HMI 확인 대기',
  resetting: 'HOLD 복구 요청 (101)',
  hold: 'HOLD — HMI 복구 필요',
};

const CMD_NAME: Record<string, string> = {
  '000': 'CLOSE_STOP',
  '001': 'ROUTE_OK',
  '010': 'ROUTE_NG',
  '011': 'OPEN_STOP',
  '100': 'HOME',
  '101': 'RESET_HOLD',
  '110': 'ARM_INSPECTION',
  '111': 'RESERVED',
};

const ACTIVE: Phase[] = ['IDLE_CLOSED', 'WAIT_INSPECTION', 'RESULT_PENDING', 'RESULT_READY', 'ROUTE_SET', 'OPEN_WAIT_DRAIN'];

export interface SimSnapshot {
  usb: boolean;
  running: boolean;
  session: number;
  cycle: number;
  phase: Phase;
  homed: boolean;
  busy: boolean;
  done: boolean;
  fault: boolean;
  valid: boolean;
  ok: boolean;
  faultCode: string;
  stopGate: 'closed' | 'open' | 'moving';
  diverter: 'center' | 'ok' | 'ng' | 'moving';
  permit: boolean;
  plcCmd: string | null;
  plcReq: boolean;
  plcStep: PlcStep;
  wafer: { kind: SimWafer; at: WaferAt; since: number } | null;
  /** 가상 HMI의 수거 확인 (웹은 이 값을 받지 못한다 — 규약에 없음) */
  collection: 'none' | 'pending' | 'confirmed';
  disturb: SimDisturb;
  options: SimOptions;
  log: { t: number; text: string }[];
}

export class SimDevice {
  private o: SimOptions;
  private usbOut: ((chunk: string) => void) | null = null;
  private rxBuf = '';
  private rxDrop = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private inspectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private accepted: { seq: number; cycle: number; capture: number; verdict: 'OK' | 'NG' } | null = null;
  private lastPcAt = 0;
  private outQueue: string[] = [];
  private outFlush: ReturnType<typeof setTimeout> | null = null;
  private oppositeNext = false;
  private s: SimSnapshot;

  constructor(opts: Partial<SimOptions> = {}, private readonly now: () => number = () => Date.now()) {
    this.o = { ...DEFAULT_SIM_OPTIONS, ...opts };
    this.s = {
      usb: false,
      running: false,
      session: 0,
      cycle: 0,
      phase: 'BOOT_LOCKED',
      homed: false,
      busy: false,
      done: false,
      fault: false,
      valid: false,
      ok: false,
      faultCode: 'NONE',
      stopGate: 'closed',
      diverter: 'center',
      permit: false,
      plcCmd: null,
      plcReq: false,
      plcStep: 'idle',
      wafer: null,
      collection: 'none',
      disturb: { hand: false, glare: false, blur: false, dim: false },
      options: this.o,
      log: [],
    };
    this.boot(0);
  }

  get snapshot(): SimSnapshot {
    return this.s;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SimSnapshot>) {
    this.s = { ...this.s, ...patch };
    for (const fn of this.listeners) fn();
  }

  private say(text: string) {
    const log = [...this.s.log, { t: this.now(), text }];
    if (log.length > 60) log.splice(0, log.length - 60);
    this.set({ log });
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  setOptions(patch: Partial<SimOptions>) {
    this.o = { ...this.o, ...patch };
    this.set({ options: this.o });
    if (patch.configured !== undefined && this.s.running && !this.s.busy) {
      if (!this.o.configured) this.set({ phase: 'BOOT_LOCKED', homed: false });
      else if (this.s.phase === 'BOOT_LOCKED') this.set({ phase: 'NEED_HOME' });
    }
  }

  setDisturb(patch: Partial<SimDisturb>) {
    this.set({ disturb: { ...this.s.disturb, ...patch } });
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.inspectTimer) clearTimeout(this.inspectTimer);
    if (this.outFlush) clearTimeout(this.outFlush);
    this.listeners.clear();
  }

  // ---------------- USB ----------------

  connectUsb(out: (chunk: string) => void) {
    this.usbOut = out;
    this.set({ usb: true });
    if (this.o.resetOnOpen) {
      this.say('USB 포트 열림 → 보드 리셋 (DTR)');
      this.boot(this.o.bootMs);
    }
  }

  disconnectUsb() {
    this.usbOut = null;
    this.outQueue = [];
    this.set({ usb: false });
    this.say('USB 끊김 — Uno는 계속 돌고, PC 연결 시간 초과를 감시해요');
  }

  /** 전원·리셋: 세션·cycle·원점이 모두 사라진다 */
  reboot() {
    this.say('Uno 재부팅');
    this.boot(this.o.bootMs);
  }

  private boot(ms: number) {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.inspectTimer) clearTimeout(this.inspectTimer);
    this.inspectTimer = null;
    this.accepted = null;
    this.rxBuf = '';
    this.rxDrop = false;
    const passing = this.s.wafer?.at === 'passing';
    this.set({
      running: false,
      session: 0,
      cycle: 0,
      phase: 'BOOT_LOCKED',
      homed: false,
      busy: false,
      done: false,
      fault: false,
      valid: false,
      ok: false,
      faultCode: 'NONE',
      plcReq: false,
      plcCmd: null,
      plcStep: this.s.permit ? 'hold' : 'idle',
      stopGate: passing ? 'open' : this.s.stopGate,
    });
    if (!this.watchdog) this.watchdog = setInterval(() => this.checkLink(), 100);
    this.later(ms, () => {
      this.set({ running: true, phase: this.o.configured ? 'NEED_HOME' : 'BOOT_LOCKED' });
      this.out('V1,BOOT,101.6MM,PLC_MAIN,NO_AUTOSTART');
      this.say(this.o.configured ? '부팅 완료 — 원점 필요, 자동 시작 없음' : '부팅 완료 — 교정 플래그 false라 잠김');
    });
  }

  private out(line: string) {
    if (!this.usbOut) return;
    if (!this.o.chunkNoise) {
      this.usbOut(`${line}\r\n`);
      return;
    }
    this.outQueue.push(`${line}\r\n`);
    if (this.outFlush) return;
    this.outFlush = setTimeout(() => {
      this.outFlush = null;
      const all = this.outQueue.join('');
      this.outQueue = [];
      // 여러 줄을 붙이고, 아무 데서나 둘로 쪼개 보낸다
      const cut = Math.max(1, Math.floor(all.length * 0.37));
      this.usbOut?.(all.slice(0, cut));
      setTimeout(() => this.usbOut?.(all.slice(cut)), 3);
    }, 15);
  }

  private event(name: string) {
    this.out(`V1,EVENT,${this.s.session},${this.s.cycle},${name}`);
  }

  private statusLine() {
    const b = (x: boolean) => (x ? 1 : 0);
    const s = this.s;
    return `V1,STATUS,${s.session},${s.cycle},${s.phase},${b(this.o.configured)},${b(s.homed)},${b(s.busy)},${b(s.done)},${b(s.fault)},${b(s.valid)},${b(s.ok)},${s.faultCode}`;
  }

  receiveFromHost(text: string) {
    if (!this.s.running) return; // 부트로더 구간: 버린다
    let data = text;
    if (this.rxDrop) {
      const i = data.indexOf('\n');
      if (i < 0) return;
      data = data.slice(i + 1);
      this.rxDrop = false;
    }
    this.rxBuf += data;
    let idx: number;
    while ((idx = this.rxBuf.indexOf('\n')) >= 0) {
      let line = this.rxBuf.slice(0, idx);
      this.rxBuf = this.rxBuf.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) continue;
      if (line.length > MAX_LINE) {
        this.out('V1,REJECT,LINE_TOO_LONG');
        continue;
      }
      this.handlePc(line);
    }
    if (this.rxBuf.length > MAX_LINE + 1) {
      this.rxBuf = '';
      this.rxDrop = true;
      this.out('V1,REJECT,LINE_TOO_LONG');
    }
  }

  private reject(reason: string) {
    this.out(`V1,REJECT,${reason}`);
  }

  private handlePc(line: string) {
    const f = line.split(',');
    if (f[0] !== 'V1') return this.reject('BAD_FORMAT');
    const sessionOf = (x: string | undefined) => {
      const n = x === undefined ? null : parseUint(x);
      return n && n > 0 ? n : null;
    };
    const now = this.now();
    switch (f[1]) {
      case 'HELLO': {
        const sid = sessionOf(f[2]);
        if (f.length !== 3 || !sid) return this.reject('BAD_FORMAT');
        const had = this.s.session !== 0;
        this.lastPcAt = now;
        this.set({ session: sid });
        if (had || this.s.busy) {
          this.say(`HELLO 다시 받음 (세션 ${sid}) → HOST_RECONNECTED HOLD`);
          this.enterHold('HOST_RECONNECTED');
          this.event('HOST_RECONNECTED');
        } else {
          this.say(`PC 세션 ${sid} 등록`);
          this.event('CONNECTED_NO_AUTOSTART');
        }
        this.out(this.statusLine());
        return;
      }
      case 'PING':
      case 'STATUS': {
        const sid = sessionOf(f[2]);
        if (f.length !== 3 || !sid) return this.reject('BAD_FORMAT');
        if (this.s.session === 0) return this.reject('NO_SESSION');
        if (sid !== this.s.session) return this.reject('SESSION_MISMATCH');
        this.lastPcAt = now;
        if (f[1] === 'STATUS') this.out(this.statusLine());
        return;
      }
      case 'RESULT': {
        if (f.length !== 7) return this.reject('BAD_FORMAT');
        const sid = sessionOf(f[2]);
        const seq = sessionOf(f[3]);
        const cycle = sessionOf(f[4]);
        const capture = sessionOf(f[5]);
        const verdict = f[6];
        if (!sid || !seq || !cycle || !capture || (verdict !== 'OK' && verdict !== 'NG')) return this.reject('BAD_FORMAT');
        if (sid !== this.s.session) return this.reject('SESSION_MISMATCH');
        this.lastPcAt = now;
        const a = this.accepted;
        if (a && a.cycle === cycle) {
          if (a.seq === seq && a.capture === capture && a.verdict === verdict) return this.event('RESULT_DUPLICATE_IGNORED');
          return this.reject(a.seq === seq ? 'BODY_CHANGED' : 'ALREADY_DECIDED');
        }
        if (cycle !== this.s.cycle) return this.reject(cycle < this.s.cycle ? 'OLD_CYCLE' : 'BAD_CYCLE');
        if (this.s.phase !== 'WAIT_INSPECTION') return this.reject('PHASE_MISMATCH');
        this.accepted = { seq, cycle, capture, verdict };
        if (this.inspectTimer) clearTimeout(this.inspectTimer);
        this.inspectTimer = null;
        this.set({ phase: 'RESULT_PENDING' });
        this.event('RESULT_ACCEPTED_PENDING_VALID');
        this.say(`결과 ${verdict} 접수 (cycle ${cycle}) — ${this.o.validDelayMs}ms 뒤 RESULT_VALID`);
        this.later(this.o.validDelayMs, () => {
          if (this.s.phase !== 'RESULT_PENDING' || this.s.cycle !== cycle) return;
          this.set({ phase: 'RESULT_READY', valid: true, ok: verdict === 'OK' });
          this.event('RESULT_VALID');
          this.plcOnValid();
        });
        return;
      }
      case 'CAPTURE_FAILED': {
        const sid = sessionOf(f[2]);
        const cycle = sessionOf(f[3]);
        if (f.length !== 4 || !sid || !cycle) return this.reject('BAD_FORMAT');
        if (sid !== this.s.session) return this.reject('SESSION_MISMATCH');
        this.lastPcAt = now;
        if (cycle !== this.s.cycle) return this.reject('OLD_CYCLE');
        if (this.s.phase !== 'WAIT_INSPECTION') return this.reject('PHASE_MISMATCH');
        this.say('PC가 촬영 실패를 알림 → HOLD (자동 NG·재촬영·방출 없음)');
        this.enterHold('CAPTURE_FAILED');
        this.event('CAPTURE_FAILED');
        return;
      }
      default:
        // 운영 빌드는 START/HOME/JOG/OPEN/DIVERTER 같은 이동 명령을 받지 않는다
        return this.reject('UNSUPPORTED');
    }
  }

  private checkLink() {
    const s = this.s;
    if (!s.running || s.session === 0 || !ACTIVE.includes(s.phase)) return;
    if (this.now() - this.lastPcAt > this.o.linkTimeoutMs) {
      this.say(`PC 연결 ${this.o.linkTimeoutMs}ms 끊김 → HOLD`);
      this.enterHold('PC_LINK_TIMEOUT');
    }
  }

  private enterHold(code: string) {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.inspectTimer) clearTimeout(this.inspectTimer);
    this.inspectTimer = null;
    const w = this.s.wafer;
    // 이미 게이트를 지나 미끄러지는 원판은 소프트웨어가 멈출 수 없다
    if (w?.at === 'passing') this.later(this.o.drainMs, () => this.landWafer());
    this.set({
      phase: 'HOLD_FAULT',
      fault: true,
      faultCode: code,
      valid: false,
      ok: false,
      busy: false,
      stopGate: this.s.stopGate === 'moving' ? 'closed' : this.s.stopGate,
      diverter: this.s.diverter === 'moving' ? 'center' : this.s.diverter,
      plcStep: 'hold',
      plcReq: false,
      plcCmd: null,
      done: false,
    });
  }

  private landWafer() {
    const w = this.s.wafer;
    if (!w || w.at !== 'passing') return;
    const at: WaferAt = this.s.diverter === 'ng' ? 'cassette_ng' : 'cassette_ok';
    this.set({ wafer: { ...w, at, since: this.now() } });
  }

  // ---------------- 가상 PLC ↔ Uno 핸드셰이크 ----------------

  /** PLC가 코드를 세우고 REQ를 유지한다. 이전 요청이 풀리기 전에는 다음 요청을 내지 않는다. */
  private plcRequest(code: string, then?: () => void) {
    if (this.s.plcReq) {
      this.say(`이전 PLC 요청이 아직 풀리지 않아 ${code}를 보내지 않음`);
      return;
    }
    this.set({ plcCmd: code, plcReq: true });
    this.say(`PLC → Uno 명령 ${code} ${CMD_NAME[code]} · REQ ON`);
    // 릴레이 바운스를 지나 안정된 뒤 래치
    this.later(40, () => this.unoLatch(code, then));
  }

  private unoDone(code: string, then?: () => void) {
    this.set({ busy: false, done: true });
    this.out(`V1,DONE,${CMD_NAME[code]},${this.s.phase}`);
    this.later(40, () => {
      this.set({ plcReq: false, plcCmd: null });
      this.later(20, () => {
        this.set({ done: false });
        then?.();
      });
    });
  }

  private refuse(code: string, why: string, hold: boolean) {
    this.say(`Uno가 PLC 명령 ${code} 거부: ${why}`);
    this.event('PLC_CMD_REFUSED');
    if (hold) this.enterHold('PLC_SEQUENCE');
    else this.set({ plcReq: false, plcCmd: null, plcStep: this.s.plcStep === 'hold' ? 'hold' : 'idle' });
  }

  private unoLatch(code: string, then?: () => void) {
    const s = this.s;
    if (!s.running) return;
    if (s.phase === 'BOOT_LOCKED') return this.refuse(code, '교정 플래그가 잠겨 있어요', false);
    if (code === '111') return this.refuse(code, '예약 코드', false);
    if (!s.permit) return this.refuse(code, '운전 허가 없음', false);
    switch (code) {
      case '100': {
        if (s.phase !== 'NEED_HOME' && s.phase !== 'IDLE_CLOSED') return this.refuse(code, `지금 단계(${s.phase})에서 원점 불가`, false);
        if (s.wafer && (s.wafer.at === 'gate' || s.wafer.at === 'passing' || s.wafer.at === 'chute')) return this.refuse(code, '통로에 원판이 있어요', false);
        this.set({ busy: true, stopGate: 'moving', diverter: 'moving' });
        this.later(this.o.homeMs, () => {
          this.set({ homed: true, stopGate: 'closed', diverter: 'center', phase: 'IDLE_CLOSED' });
          this.unoDone(code, then);
        });
        return;
      }
      case '000': {
        if (s.phase !== 'IDLE_CLOSED') return this.refuse(code, `지금 단계(${s.phase})`, true);
        return this.unoDone(code, then);
      }
      case '110': {
        if (s.phase !== 'IDLE_CLOSED' || !s.homed || s.stopGate !== 'closed') return this.refuse(code, '닫힘·원점·대기 조건이 아니에요', true);
        // 이전 RESULT_VALID를 먼저 내리고 새 cycle 발행
        this.accepted = null;
        this.set({ valid: false, ok: false, cycle: s.cycle + 1, phase: 'WAIT_INSPECTION' });
        this.event('INSPECT_REQUEST');
        this.inspectTimer = setTimeout(() => {
          this.inspectTimer = null;
          if (this.s.phase === 'WAIT_INSPECTION') {
            this.say(`${this.o.inspectionTimeoutMs / 1000}초 안에 결과가 없어 HOLD`);
            this.enterHold('INSPECTION_TIMEOUT');
          }
        }, this.o.inspectionTimeoutMs);
        // 즉시 끝나는 명령: BUSY 없이 DONE
        return this.unoDone(code, then);
      }
      case '001':
      case '010': {
        const wantOk = code === '001';
        if (s.phase === 'OPEN_WAIT_DRAIN') return this.refuse(code, '배출 중 분기 변경', true);
        if (s.phase !== 'RESULT_READY' || !s.valid) return this.refuse(code, '유효한 검사 결과 없음', true);
        if (s.stopGate !== 'closed') return this.refuse(code, '정지 게이트가 닫혀 있지 않아요', true);
        if (wantOk !== s.ok) return this.refuse(code, '판정과 반대 경로', true);
        this.set({ busy: true, diverter: 'moving' });
        this.later(this.o.routeMs, () => {
          this.set({ diverter: wantOk ? 'ok' : 'ng', phase: 'ROUTE_SET' });
          this.unoDone(code, then);
        });
        return;
      }
      case '011': {
        if (s.phase !== 'ROUTE_SET' || !s.valid) return this.refuse(code, '분기 완료 전 또는 결과 없이 열기', true);
        this.set({ busy: true, stopGate: 'moving' });
        this.later(this.o.openMs, () => {
          const w = this.s.wafer;
          this.set({ stopGate: 'open', phase: 'OPEN_WAIT_DRAIN', wafer: w && w.at === 'gate' ? { ...w, at: 'passing', since: this.now() } : w });
          this.later(this.o.drainMs, () => {
            this.landWafer();
            this.set({ stopGate: 'closed', phase: 'IDLE_CLOSED', valid: false, ok: false });
            this.unoDone(code, then);
          });
        });
        return;
      }
      case '101': {
        if (s.phase !== 'HOLD_FAULT') return this.refuse(code, 'HOLD가 아니에요', false);
        this.accepted = null;
        this.set({ fault: false, faultCode: 'NONE', valid: false, ok: false, homed: false, phase: 'NEED_HOME' });
        return this.unoDone(code, then);
      }
    }
  }

  private plcOnValid() {
    if (this.s.plcStep !== 'wait_result') return;
    const right = this.s.ok ? '001' : '010';
    const code = this.oppositeNext ? (this.s.ok ? '010' : '001') : right;
    if (this.oppositeNext) this.say(`(오류 주입) 가상 PLC가 판정과 반대 경로 ${code}를 요청`);
    this.oppositeNext = false;
    this.set({ plcStep: 'routing' });
    this.plcRequest(code, () => {
      if (this.s.phase !== 'ROUTE_SET') return;
      this.set({ plcStep: 'opening' });
      this.plcRequest('011', () => {
        if (this.s.phase !== 'IDLE_CLOSED') return;
        this.set({ plcStep: 'wait_collection', collection: 'pending' });
        this.say('배출 동작 종료 — 출구 센서가 없어 실물 수거는 미확인');
      });
    });
  }

  // ---------------- 가상 HMI ----------------

  hmiPermit(on: boolean) {
    this.set({ permit: on });
    this.say(on ? 'HMI 준비 → PLC 운전 허가 ON' : 'HMI 정지 → PLC 운전 허가 OFF');
    if (!on && this.s.running && (ACTIVE.includes(this.s.phase) || this.s.busy)) this.enterHold('RUN_PERMIT_LOST');
  }

  hmiHome() {
    if (this.s.plcStep !== 'idle' && this.s.plcStep !== 'wait_collection') return this.say('PLC가 다른 순서를 진행 중');
    this.set({ plcStep: 'homing' });
    this.plcRequest('100', () => this.set({ plcStep: 'idle' }));
  }

  /** 한 장 투입 후 1사이클 시작 */
  hmiStart(kind: SimWafer) {
    const s = this.s;
    if (s.plcStep === 'wait_collection') return this.say('이전 원판의 수거 확인이 먼저예요');
    if (s.plcStep !== 'idle') return this.say('PLC가 다른 순서를 진행 중');
    if (s.phase !== 'IDLE_CLOSED') return this.say(`지금 단계(${s.phase})에서는 시작할 수 없어요`);
    this.set({ plcStep: 'closing', collection: 'none' });
    this.plcRequest('000', () => {
      this.set({ plcStep: 'inserting', wafer: { kind, at: 'chute', since: this.now() } });
      this.later(this.o.slideMs, () => {
        const w = this.s.wafer;
        if (!w || this.s.phase !== 'IDLE_CLOSED') return;
        this.set({ wafer: { ...w, at: 'gate', since: this.now() }, plcStep: 'arming' });
        this.later(350, () =>
          this.plcRequest('110', () => {
            if (this.s.phase === 'WAIT_INSPECTION') this.set({ plcStep: 'wait_result' });
          }),
        );
      });
    });
  }

  hmiConfirmCollection() {
    if (this.s.plcStep !== 'wait_collection') return;
    this.set({ plcStep: 'idle', collection: 'confirmed', wafer: null });
    this.say('HMI 수거 확인 (가상) — 다음 사이클 준비');
  }

  /** 원인 확인 → 통로 비움 → RESET_HOLD(101). 그다음 원점은 따로. */
  hmiRecover() {
    if (this.s.phase !== 'HOLD_FAULT') return this.say('HOLD가 아니에요');
    const w = this.s.wafer;
    if (w && (w.at === 'gate' || w.at === 'chute')) {
      this.set({ wafer: { ...w, at: 'removed', since: this.now() } });
      this.say('작업자가 통로의 원판을 꺼냄 (가상)');
    }
    this.set({ plcStep: 'resetting' });
    this.plcRequest('101', () => this.set({ plcStep: 'idle', collection: 'none' }));
  }

  // ---------------- 오류 주입 (시험 전용) ----------------

  /** 다음 경로 요청을 판정과 반대로 보내는 가상 PLC 래더 오류 */
  injectOppositeRoute() {
    this.oppositeNext = true;
    this.say('(오류 주입) 다음 경로 요청을 판정과 반대로 보내요');
  }

  injectRouteDuringDrain() {
    if (this.s.phase !== 'OPEN_WAIT_DRAIN') return this.say('배출 중(OPEN_WAIT_DRAIN)에만 시험할 수 있어요');
    // 실제 PLC라면 이전 요청이 끝나기 전 보내지 않는다 — 여기서는 강제로 REQ를 바꿔 Uno의 거부를 본다
    this.set({ plcReq: false });
    this.plcRequest(this.s.ok ? '010' : '001');
  }

  /** PC가 아닌 곳에서 늦게 도착한 이전 cycle 결과 */
  injectStaleResult() {
    if (this.s.session === 0 || this.s.cycle < 1) return this.say('세션과 cycle이 있어야 해요');
    const line = `V1,RESULT,${this.s.session},999,${Math.max(1, this.s.cycle - 1)},999,OK`;
    this.say(`늦게 온 이전 결과 주입: ${line}`);
    this.handlePc(line);
  }
}
