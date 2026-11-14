// Uno 직렬 연결 (규약 V1). 포트 열기 → BOOT 확인 → HELLO 한 번 → PING/STATUS 유지.
// 이 계층은 결과(OK/NG)·CAPTURE_FAILED 말고는 장치에 아무 동작도 요청하지 않는다.
// 이동·정지·복구 명령은 규약에 없고 만들 수도 없다 (fmt 참조).
import type { CloseReason, Transport, TransportKind } from '../transport/types';
import { LineBuffer } from './linebuffer';
import { EV, fmt, newSessionNonce, parseLine, type DeviceStatus, type Verdict } from './v1';

export type LinkPhase =
  /** 포트 닫힘 */
  | 'closed'
  | 'opening'
  /** 포트를 열면 보드가 리셋될 수 있어 BOOT 줄을 기다림 */
  | 'waiting_boot'
  /** HELLO를 보내고 등록 응답을 기다림 */
  | 'hello'
  /** 세션 등록됨, 응답이 오고 있음 */
  | 'online'
  /** 등록 뒤 응답이 끊김 */
  | 'silent'
  /** HELLO에 응답 없음 (펌웨어·속도·보드 확인) */
  | 'no_response'
  /** 케이블 단절 등으로 포트가 닫힘 */
  | 'lost';

export interface BootInfo {
  size: string;
  build: string;
  autostart: string;
  at: number;
}

export interface InspectRequest {
  cycle: number;
  at: number;
  /** 장치가 아직 이 cycle의 결과를 기다리는 중 */
  open: boolean;
  closedWhy: string | null;
}

export type ResultState = 'sending' | 'accepted' | 'valid' | 'rejected' | 'no_ack';

export interface SentResult {
  cycle: number;
  capture: number;
  seq: number;
  verdict: Verdict;
  state: ResultState;
  reason: string | null;
  sentAt: number;
  tries: number;
  duplicateSeen: boolean;
}

export interface LinkSnapshot {
  phase: LinkPhase;
  transport: TransportKind | null;
  label: string | null;
  session: number | null;
  boot: BootInfo | null;
  status: DeviceStatus | null;
  statusAt: number | null;
  /** 다른 세션 번호가 담긴 STATUS (다른 탭·PC가 등록했거나 장치가 세션을 잃음) */
  foreignSession: number | null;
  lastRxAt: number | null;
  request: InspectRequest | null;
  result: SentResult | null;
  captureFailedCycle: number | null;
  lastReject: { reason: string; at: number } | null;
  lastDone: { command: string; phase: string; at: number } | null;
  hostReconnected: boolean;
  reboots: number;
  detail: string | null;
}

export interface LogEntry {
  id: number;
  t: number;
  dir: 'tx' | 'rx' | 'sys';
  text: string;
  note?: string;
  level: 'info' | 'warn' | 'error';
}

export type DeviceNotice =
  | { name: 'boot'; build: string; autostart: string }
  | { name: 'event'; cycle: number; event: string }
  | { name: 'done'; command: string; phase: string }
  | { name: 'reject'; reason: string }
  | { name: 'phase'; from: string | null; to: string; cycle: number; faultCode: string }
  | { name: 'link'; phase: LinkPhase; detail: string | null };

export type LinkEvent =
  | { type: 'change' }
  | { type: 'log'; entry: LogEntry }
  | { type: 'inspect_request'; session: number; cycle: number }
  | { type: 'request_closed'; cycle: number; why: string }
  | { type: 'result'; result: SentResult }
  | { type: 'notice'; notice: DeviceNotice };

export interface LinkOptions {
  bootWaitMs: number;
  helloWaitMs: number;
  pingMs: number;
  statusMs: number;
  silentMs: number;
  ackMs: number;
  maxTries: number;
  now: () => number;
  random?: () => number;
}

export const DEFAULT_LINK: LinkOptions = {
  bootWaitMs: 3000,
  helloWaitMs: 2500,
  pingMs: 500,
  statusMs: 1000,
  silentMs: 3000,
  ackMs: 400,
  maxTries: 3,
  now: () => Date.now(),
};

export class LinkError extends Error {}

const EMPTY: LinkSnapshot = {
  phase: 'closed',
  transport: null,
  label: null,
  session: null,
  boot: null,
  status: null,
  statusAt: null,
  foreignSession: null,
  lastRxAt: null,
  request: null,
  result: null,
  captureFailedCycle: null,
  lastReject: null,
  lastDone: null,
  hostReconnected: false,
  reboots: 0,
  detail: null,
};

export class DeviceLink {
  private s: LinkSnapshot = { ...EMPTY };
  private readonly o: LinkOptions;
  private transport: Transport | null = null;
  private lines = new LineBuffer();
  private listeners = new Set<(e: LinkEvent) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private registered = false;
  private seq = 0;
  private capture = 0;
  /** 이 세션에서 이미 받은 INSPECT_REQUEST cycle (중복·늦은 이벤트 무시) */
  private seenCycles = new Set<number>();
  private resultWaiters: ((r: SentResult) => void)[] = [];
  private lastSessionLoss = -Infinity;
  private logId = 0;
  readonly log: LogEntry[] = [];

  constructor(opts: Partial<LinkOptions> = {}) {
    this.o = { ...DEFAULT_LINK, ...opts };
  }

  get snapshot(): LinkSnapshot {
    return this.s;
  }

  on(fn: (e: LinkEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: LinkEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private set(patch: Partial<LinkSnapshot>) {
    const prev = this.s.phase;
    this.s = { ...this.s, ...patch };
    if (patch.phase && patch.phase !== prev) this.emit({ type: 'notice', notice: { name: 'link', phase: patch.phase, detail: this.s.detail } });
    this.emit({ type: 'change' });
  }

  private addLog(dir: LogEntry['dir'], text: string, note?: string, level: LogEntry['level'] = 'info') {
    const entry: LogEntry = { id: ++this.logId, t: this.o.now(), dir, text, note, level };
    this.log.push(entry);
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    this.emit({ type: 'log', entry });
  }

  /** 시스템 메모를 통신 기록에 남긴다 (카메라 실패 등) */
  note(text: string, level: LogEntry['level'] = 'info') {
    this.addLog('sys', text, undefined, level);
  }

  get isOpen() {
    return this.transport !== null;
  }

  async open(transport: Transport) {
    if (this.transport) throw new LinkError('이미 연결돼 있어요. 연결 해제 후 다시 시도해 주세요.');
    this.reset();
    const session = newSessionNonce(this.o.random);
    this.transport = transport;
    this.set({ ...EMPTY, phase: 'opening', transport: transport.kind, label: transport.label, session });
    transport.onData = (chunk) => this.onChunk(chunk);
    transport.onClose = (reason, detail) => this.onTransportClose(reason, detail);
    try {
      await transport.open();
    } catch (e) {
      this.transport = null;
      this.set({ phase: 'closed', session: null });
      throw e;
    }
    this.addLog('sys', `포트 열림 · 새 세션 ${session}`, '보드가 리셋될 수 있어 BOOT 줄을 기다려요');
    this.set({ phase: 'waiting_boot' });
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      if (this.s.phase === 'waiting_boot') {
        this.addLog('sys', 'BOOT 줄이 오지 않아 HELLO를 보내요', '보드가 열기 때 리셋되지 않았을 수 있어요');
        this.sendHello();
      }
    }, this.o.bootWaitMs);
  }

  async close() {
    const t = this.transport;
    if (!t) return;
    this.closeRequest('연결 해제');
    this.stopTimers();
    this.transport = null;
    this.registered = false;
    this.set({ phase: 'closed', detail: '연결을 해제했어요. 장치는 PC 연결 시간 초과로 HOLD할 수 있어요.' });
    this.addLog('sys', '연결 해제');
    t.onData = null;
    t.onClose = null;
    try {
      await t.close();
    } catch {
      /* 이미 닫힘 */
    }
  }

  private reset() {
    this.stopTimers();
    this.lines.reset();
    this.registered = false;
    this.seq = 0;
    this.capture = 0;
    this.seenCycles.clear();
    this.flushWaiters();
  }

  private stopTimers() {
    for (const t of this.timers) clearTimeout(t);
    for (const t of this.intervals) clearInterval(t);
    this.timers = [];
    this.intervals = [];
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.helloTimer) clearTimeout(this.helloTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.bootTimer = this.helloTimer = this.ackTimer = null;
  }

  private onTransportClose(reason: CloseReason, detail?: string) {
    if (!this.transport) return;
    this.closeRequest('USB 연결 끊김');
    this.stopTimers();
    this.transport = null;
    this.registered = false;
    const msg =
      reason === 'lost'
        ? `${detail ?? 'USB 연결이 끊겼어요'}. 자동으로 다시 연결하지 않아요 — 장치는 HOLD로 멈춰요. 케이블 확인 후 장치 연결을 다시 눌러 주세요.`
        : '연결을 해제했어요.';
    this.addLog('sys', msg, undefined, reason === 'lost' ? 'error' : 'info');
    this.set({ phase: reason === 'lost' ? 'lost' : 'closed', detail: msg });
  }

  private write(line: string, note?: string) {
    const t = this.transport;
    if (!t) return;
    this.addLog('tx', line, note);
    t.write(line).catch((e: unknown) => {
      this.addLog('sys', `보내기 실패: ${(e as Error)?.message ?? e}`, undefined, 'error');
    });
  }

  private sendHello() {
    const session = this.s.session;
    if (!session) return;
    this.set({ phase: 'hello' });
    this.write(fmt.hello(session), '접속·세션 등록 (게이트 동작 없음)');
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = setTimeout(() => {
      this.helloTimer = null;
      if (this.s.phase === 'hello') {
        // HELLO를 되풀이하지 않는다: 이미 등록됐는데 응답만 잃었다면 재전송이 HOST_RECONNECTED HOLD를 일으킨다
        this.set({
          phase: 'no_response',
          detail: 'HELLO에 응답이 없어요. 동봉 펌웨어가 올라갔는지, 속도 115200, 포트(시리얼 모니터 종료)를 확인해 주세요.',
        });
        this.addLog('sys', 'HELLO 응답 없음 — 자동으로 다시 보내지 않아요', undefined, 'warn');
      }
    }, this.o.helloWaitMs);
  }

  private becomeOnline() {
    if (this.registered) {
      if (this.s.phase !== 'online') this.set({ phase: 'online', detail: null });
      return;
    }
    this.registered = true;
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.set({ phase: 'online', detail: null });
    const session = this.s.session!;
    this.intervals.push(setInterval(() => this.write(fmt.ping(session)), this.o.pingMs));
    this.intervals.push(setInterval(() => this.write(fmt.status(session)), this.o.statusMs));
    this.intervals.push(
      setInterval(() => {
        const last = this.s.lastRxAt ?? 0;
        if (this.s.phase === 'online' && this.o.now() - last > this.o.silentMs) {
          this.set({ phase: 'silent', detail: 'Uno 응답이 끊겼어요. 결과를 보내지 않아요.' });
          this.addLog('sys', `${this.o.silentMs}ms 동안 응답 없음`, undefined, 'warn');
        }
      }, 250),
    );
    this.write(fmt.status(session));
  }

  private onChunk(chunk: string) {
    for (const ev of this.lines.push(chunk)) {
      if (ev.type === 'overflow') {
        this.addLog('rx', `${ev.preview}…`, '95바이트를 넘는 줄 — 버림', 'warn');
        continue;
      }
      this.onLine(ev.line);
    }
  }

  private onLine(line: string) {
    const now = this.o.now();
    this.s = { ...this.s, lastRxAt: now };
    if (this.s.phase === 'silent' && this.registered) this.set({ phase: 'online', detail: null });
    const m = parseLine(line);
    switch (m.kind) {
      case 'invalid':
        this.addLog('rx', line, `잘못된 행 (${m.why}) — 무시`, 'warn');
        return;
      case 'unknown':
        this.addLog('rx', line, `모르는 종류 ${m.type} — 기록만`, 'warn');
        return;
      case 'boot':
        return this.onBoot(line, m.size, m.build, m.autostart, now);
      case 'event':
        return this.onEvent(line, m.session, m.cycle, m.event, now);
      case 'status':
        return this.onStatus(line, m.status, now);
      case 'done':
        this.addLog('rx', line, 'PLC 요청 완료 알림 — 웹은 다음 동작을 명령하지 않아요');
        this.set({ lastDone: { command: m.command, phase: m.phase, at: now } });
        this.emit({ type: 'notice', notice: { name: 'done', command: m.command, phase: m.phase } });
        // DONE에는 session/cycle이 없어 곧바로 STATUS로 함께 해석한다
        if (this.registered && this.s.session) this.write(fmt.status(this.s.session), 'DONE 뒤 상태 조회');
        return;
      case 'reject':
        return this.onReject(line, m.reason, now);
    }
  }

  private onBoot(line: string, size: string, build: string, autostart: string, now: number) {
    const warn = build !== 'PLC_MAIN' || autostart !== 'NO_AUTOSTART';
    this.addLog('rx', line, warn ? '운영 빌드(PLC_MAIN·NO_AUTOSTART)가 아니에요' : '보드 시작', warn ? 'warn' : 'info');
    this.emit({ type: 'notice', notice: { name: 'boot', build, autostart } });
    const boot = { size, build, autostart, at: now };
    if (this.registered) {
      // 열린 채로 재부팅: 장치 세션·cycle이 사라졌다. 새 세션으로 다시 등록하고 이전 판정은 버린다.
      this.closeRequest('장치 재부팅');
      this.stopTimers();
      this.registered = false;
      this.seenCycles.clear();
      const session = newSessionNonce(this.o.random);
      this.addLog('sys', `장치 재부팅 감지 — 새 세션 ${session}으로 다시 등록, 이전 판정 무효`, undefined, 'warn');
      this.set({ boot, session, status: null, statusAt: null, result: null, reboots: this.s.reboots + 1 });
      this.sendHello();
      return;
    }
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.bootTimer = null;
    this.set({ boot });
    // 아직 등록 전: 앞서 보낸 HELLO는 부트로더가 삼켰을 수 있으니 지금 보낸다 (같은 세션)
    if (this.s.phase === 'waiting_boot' || this.s.phase === 'hello' || this.s.phase === 'no_response') this.sendHello();
  }

  private onEvent(line: string, session: number, cycle: number, event: string, now: number) {
    if (session !== this.s.session) {
      this.addLog('rx', line, '다른 세션의 이벤트 — 무시', 'warn');
      return;
    }
    this.emit({ type: 'notice', notice: { name: 'event', cycle, event } });
    switch (event) {
      case EV.CONNECTED:
        this.addLog('rx', line, '등록됨 — 자동 시작 없음');
        this.becomeOnline();
        return;
      case EV.HOST_RECONNECTED:
        this.addLog('rx', line, '재접속으로 장치가 HOLD — 이전 판정 무효, HMI에서 복구', 'warn');
        this.set({ hostReconnected: true });
        this.becomeOnline();
        return;
      case EV.INSPECT_REQUEST: {
        if (!this.registered) this.becomeOnline();
        if (cycle === 0 || this.seenCycles.has(cycle)) {
          this.addLog('rx', line, cycle === 0 ? 'cycle 0 요청 — 무시' : '이미 받은 요청 — 다시 촬영하지 않아요', 'warn');
          return;
        }
        this.seenCycles.add(cycle);
        this.closeRequest('다음 요청');
        this.addLog('rx', line, `PLC 새 검사 요청 cycle ${cycle} — 이 뒤의 새 프레임만 써요`);
        this.set({ request: { cycle, at: now, open: true, closedWhy: null }, result: null, captureFailedCycle: null });
        this.emit({ type: 'inspect_request', session, cycle });
        return;
      }
      case EV.ACCEPTED:
      case EV.VALID:
      case EV.DUPLICATE: {
        const r = this.s.result;
        if (!r || r.cycle !== cycle) {
          this.addLog('rx', line, '보낸 결과와 cycle이 달라요 — 무시', 'warn');
          return;
        }
        const state: ResultState = event === EV.VALID ? 'valid' : r.state === 'valid' ? 'valid' : 'accepted';
        this.addLog(
          'rx',
          line,
          event === EV.VALID
            ? 'PLC 전달 래치 준비 — 실제 분류·수거 완료는 아니에요'
            : event === EV.DUPLICATE
              ? '같은 결과의 재전송 — 장치가 다시 실행하지 않음'
              : '접수 — 아직 PLC 전달 전',
        );
        this.updateResult({ ...r, state, duplicateSeen: r.duplicateSeen || event === EV.DUPLICATE });
        return;
      }
      default:
        this.addLog('rx', line, '기록만');
    }
  }

  private onStatus(line: string, st: DeviceStatus, now: number) {
    if (st.session !== this.s.session) {
      this.addLog('rx', line, st.session === 0 ? '장치에 등록된 세션 없음' : '다른 세션이 등록돼 있어요', 'warn');
      this.set({ foreignSession: st.session });
      if (st.session === 0 && this.registered && now - this.lastSessionLoss > 5000) {
        // BOOT 줄을 놓친 재부팅: 새 세션으로 등록 (HELLO는 게이트를 움직이지 않는다)
        this.lastSessionLoss = now;
        this.closeRequest('장치가 세션을 잃음');
        this.stopTimers();
        this.registered = false;
        this.seenCycles.clear();
        const session = newSessionNonce(this.o.random);
        this.addLog('sys', `장치 세션이 비어 새 세션 ${session}으로 다시 등록 — 이전 판정 무효`, undefined, 'warn');
        this.set({ session, status: null, result: null, reboots: this.s.reboots + 1 });
        this.sendHello();
      }
      return;
    }
    const prev = this.s.status;
    if (!prev || prev.phase !== st.phase || prev.cycle !== st.cycle || prev.faultCode !== st.faultCode) {
      this.addLog('rx', line, `단계 ${st.phase}${st.faultCode !== 'NONE' ? ` · ${st.faultCode}` : ''}`);
      this.emit({ type: 'notice', notice: { name: 'phase', from: prev?.phase ?? null, to: st.phase, cycle: st.cycle, faultCode: st.faultCode } });
    }
    this.set({ status: st, statusAt: now, foreignSession: null });
    if (!this.registered) this.becomeOnline();
    const req = this.s.request;
    if (req?.open) {
      const ours = this.s.result && this.s.result.cycle === req.cycle && this.s.result.state !== 'rejected' && this.s.result.state !== 'no_ack';
      if (st.cycle !== req.cycle) this.closeRequest(`장치 cycle이 ${st.cycle}로 바뀜`);
      else if (st.phase !== 'WAIT_INSPECTION' && !ours) this.closeRequest(`장치 단계 ${st.phase}${st.faultCode !== 'NONE' ? ` (${st.faultCode})` : ''}`);
    }
  }

  private onReject(line: string, reason: string, now: number) {
    this.addLog('rx', line, '거부 — 자동으로 다시 보내지 않아요', 'warn');
    this.set({ lastReject: { reason, at: now } });
    this.emit({ type: 'notice', notice: { name: 'reject', reason } });
    const r = this.s.result;
    if (r && r.state === 'sending' && now - r.sentAt < 2000) {
      if (this.ackTimer) clearTimeout(this.ackTimer);
      this.ackTimer = null;
      this.updateResult({ ...r, state: 'rejected', reason });
    }
    if (this.registered && this.s.session) this.write(fmt.status(this.s.session), '거부 뒤 장치 상태 조회');
  }

  private closeRequest(why: string) {
    const req = this.s.request;
    if (!req?.open) return;
    this.set({ request: { ...req, open: false, closedWhy: why } });
    this.emit({ type: 'request_closed', cycle: req.cycle, why });
  }

  private updateResult(r: SentResult) {
    this.set({ result: r });
    this.emit({ type: 'result', result: r });
    if (r.state !== 'sending') this.flushWaiters(r);
  }

  private flushWaiters(r?: SentResult) {
    const w = this.resultWaiters;
    this.resultWaiters = [];
    if (r) for (const fn of w) fn(r);
  }

  /** 새 캡처 번호 (세션 안에서 1부터) */
  nextCapture(): number {
    this.capture = this.capture >= 4294967295 ? 1 : this.capture + 1;
    return this.capture;
  }

  /** 보낼 수 있는지: 열린 현재 요청 · 이 요청에 아직 결과 없음 · 응답 중 */
  canSend(cycle: number): string | null {
    if (!this.transport || !this.registered) return '장치가 연결돼 있지 않아요';
    if (this.s.phase !== 'online') return 'Uno 응답이 끊겨 보내지 않아요';
    const req = this.s.request;
    if (!req || req.cycle !== cycle) return '현재 검사 요청과 cycle이 달라요';
    if (!req.open) return `요청이 이미 닫혔어요 (${req.closedWhy ?? ''})`;
    if (this.s.result && this.s.result.cycle === cycle) return '이 요청에는 이미 결과를 보냈어요';
    if (this.s.captureFailedCycle === cycle) return '이 요청에는 촬영 실패를 보냈어요';
    return null;
  }

  /** 확정 OK/NG를 현재 요청에 한 번만 보낸다. 응답이 없으면 같은 줄(같은 seq)로만 다시 보낸다. */
  sendResult(cycle: number, capture: number, verdict: Verdict): Promise<SentResult> {
    const why = this.canSend(cycle);
    if (why) return Promise.reject(new LinkError(why));
    const session = this.s.session!;
    this.seq = this.seq >= 4294967295 ? 1 : this.seq + 1;
    const line = fmt.result(session, this.seq, cycle, capture, verdict);
    const r: SentResult = { cycle, capture, seq: this.seq, verdict, state: 'sending', reason: null, sentAt: this.o.now(), tries: 1, duplicateSeen: false };
    const done = new Promise<SentResult>((resolve) => this.resultWaiters.push(resolve));
    this.updateResult(r);
    this.write(line, `결과 전송 cycle ${cycle} capture ${capture}`);
    const arm = () => {
      this.ackTimer = setTimeout(() => {
        this.ackTimer = null;
        const cur = this.s.result;
        if (!cur || cur.seq !== r.seq || cur.state !== 'sending') return;
        if (cur.tries < this.o.maxTries && this.transport && this.s.request?.open) {
          this.updateResult({ ...cur, tries: cur.tries + 1 });
          this.write(line, '응답 없음 — 같은 줄로 다시 보냄 (장치는 중복을 다시 실행하지 않음)');
          arm();
        } else {
          this.addLog('sys', '결과 접수 응답을 받지 못했어요 — 장치는 시간 초과로 HOLD할 수 있어요', undefined, 'error');
          this.updateResult({ ...cur, state: 'no_ack' });
        }
      }, this.o.ackMs);
    };
    arm();
    return done;
  }

  /** 복구할 수 없는 카메라 실패: 현재 cycle로 한 번. 장치는 HOLD하고 자동 NG·재촬영·방출을 하지 않는다. */
  sendCaptureFailed(cycle: number): boolean {
    const why = this.canSend(cycle);
    if (why) {
      this.addLog('sys', `촬영 실패를 보내지 않음: ${why}`, undefined, 'warn');
      return false;
    }
    const session = this.s.session!;
    this.set({ captureFailedCycle: cycle });
    this.write(fmt.captureFailed(session, cycle), '카메라 실패 → 장치 HOLD');
    this.write(fmt.status(session));
    return true;
  }
}
