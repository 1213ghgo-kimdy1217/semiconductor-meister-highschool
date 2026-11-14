// 화면 뒤 연결부: 카메라 · Uno 연결 · 검사 규칙 · 기록을 묶는다. 각 규칙은 core/ 아래 모듈에 있다.
// 웹은 이동 명령을 만들지 않는다. 판정과 촬영 실패만 보내고, 운전·복구는 PLC/HMI가 한다.
import { CameraController } from '../core/camera/camera';
import { CameraFrames, RoiGrabber } from '../core/camera/frames';
import { VirtualCamera, type VirtualItem, type VirtualView } from '../core/camera/virtual';
import { runInspection, type Frame, type Outcome, type RunProgress } from '../core/inspect/runner';
import { DeviceLink, type DeviceNotice, type LinkEvent } from '../core/protocol/link';
import { CycleRunner, type CycleState } from '../core/station/cycle';
import { recordsCsv, eventsCsv, downloadText, stamp } from '../core/store/csv';
import { LocalStore } from '../core/store/local';
import type { CameraChoice, CameraProfile, Expected, InspectionRecord, PlcState, ProfileSettings, RecordMode } from '../core/store/types';
import { describeSerialError, requestSerialPort, SerialTransport, serialSupport, type SerialSupport } from '../core/transport/serial';
import { SimTransport } from '../core/transport/sim';
import { SimDevice } from '../core/transport/simDevice';
import { DEFAULT_THRESHOLDS, ENGINE_VERSION, METHOD, motionBetween, type FrameDetail, type Thresholds } from '../core/vision/analyze';
import { DEFAULT_ROI, type Roi } from '../core/vision/image';
import { buildStored, prepareRefs, REF_LABEL, sameRoi, type PreparedRefs, type RefKind } from '../core/vision/reference';
import { thumbnail } from '../ui/evidence';

export type Mode = 'live' | 'sim';

export interface RegisterProgress {
  kind: RefKind;
  got: number;
  need: number;
  note: string;
}

export interface LastShown {
  source: 'device' | 'check';
  recordId: string;
  outcome: Outcome;
  detail: FrameDetail | null;
  cycle: number | null;
  expected: Expected | null;
}

interface Manual {
  kind: VirtualItem;
  since: number;
  placement: number;
}

export interface StationSnapshot {
  ready: boolean;
  mode: Mode;
  profile: CameraProfile;
  settings: ProfileSettings;
  prepared: PreparedRefs | null;
  refsNote: string | null;
  cycle: CycleState | null;
  checking: { progress: RunProgress | null } | null;
  last: LastShown | null;
  records: InspectionRecord[];
  register: RegisterProgress | null;
  registerError: string | null;
  deviceError: string | null;
  releasedCycle: number | null;
  manual: Manual | null;
  sim: SimDevice | null;
}

const NO_DISTURB = { hand: false, glare: false, blur: false, dim: false };

export const SERIAL_SUPPORT_MSG: Record<Exclude<SerialSupport, 'ok'>, string> = {
  unsupported: '이 브라우저는 USB 시리얼을 지원하지 않아요. PC의 Chrome 또는 Edge에서 열어 주세요.',
  insecure: 'USB 연결은 https 주소(또는 이 PC의 localhost)에서만 쓸 수 있어요.',
  blocked: '이 창에서는 USB 연결이 막혀 있어요. 새 탭(Chrome·Edge)에서 열어 주세요.',
};

function defaultProfile(): ProfileSettings {
  return { roi: { ...DEFAULT_ROI }, thresholds: { ...DEFAULT_THRESHOLDS }, calibrationVersion: 1, refs: {} };
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** performance.now() 기준 시각 → ISO */
function iso(t: number | null | undefined): string | null {
  return t === null || t === undefined ? null : new Date(performance.timeOrigin + t).toISOString();
}

function plcFrom(s: CycleState): PlcState {
  if (s.captureFailed) return 'capture_failed';
  if (s.sent) return s.sent.state;
  if (s.stage === 'gave_up' && !s.sendError) return 'withheld';
  if (s.closed) return 'closed';
  return 'none';
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
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

export class Station {
  readonly camera = new CameraController();
  readonly link = new DeviceLink();
  readonly store = new LocalStore();
  private grabber = new RoiGrabber();
  private frames = new CameraFrames(this.camera, this.grabber, () => this.settings.roi);
  private runner: CycleRunner;
  private profiles: Record<CameraProfile, ProfileSettings> = { real: defaultProfile(), virtual: defaultProfile() };
  private cameraChoice: CameraChoice | null = null;
  private vcam: VirtualCamera | null = null;
  private simOff: (() => void) | null = null;
  private simTransport: SimTransport | null = null;
  private checkCtl: AbortController | null = null;
  private regCtl: AbortController | null = null;
  private cycleRec: InspectionRecord | null = null;
  private placementSeq = 1;
  private simPlacement = 1;
  private prevSimAt: string | null = null;
  private listeners = new Set<() => void>();
  private s: StationSnapshot;

  constructor() {
    this.s = {
      ready: false,
      mode: 'live',
      profile: 'real',
      settings: this.profiles.real,
      prepared: null,
      refsNote: null,
      cycle: null,
      checking: null,
      last: null,
      records: [],
      register: null,
      registerError: null,
      deviceError: null,
      releasedCycle: null,
      manual: null,
      sim: null,
    };
    this.runner = new CycleRunner(this.link, this.frames, {
      refs: () => this.s.prepared,
      thresholds: () => this.settings.thresholds,
      onState: (c) => this.onCycleState(c),
      onAttempt: (c, o) => this.onAttempt(c, o),
    });
    this.link.on(this.onLink);
    this.camera.subscribe(this.onCamera);
    this.reprepare();
  }

  // ---------- 구독 ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.s;

  private set(p: Partial<StationSnapshot>) {
    this.s = { ...this.s, ...p };
    for (const fn of this.listeners) fn();
  }

  get settings(): ProfileSettings {
    return this.profiles[this.s.profile];
  }

  async init() {
    await this.store.open();
    const [real, virtual, choice, recent] = await Promise.all([
      this.store.getKv<ProfileSettings>('profile:real'),
      this.store.getKv<ProfileSettings>('profile:virtual'),
      this.store.getKv<CameraChoice>('camera:choice'),
      this.store.recentRecords(2000),
    ]);
    if (real) this.profiles.real = { ...defaultProfile(), ...real, thresholds: { ...DEFAULT_THRESHOLDS, ...real.thresholds } };
    if (virtual) this.profiles.virtual = { ...defaultProfile(), ...virtual, thresholds: { ...DEFAULT_THRESHOLDS, ...virtual.thresholds } };
    this.cameraChoice = choice ?? null;
    // 다른 기록이 이미 화면에 생겼으면 합친다
    const seen = new Set(this.s.records.map((r) => r.id));
    this.set({ ready: true, records: [...this.s.records, ...recent.filter((r) => !seen.has(r.id))] });
    this.reprepare();
    // 탭이 뒤로 가면 브라우저가 타이머를 늦춘다 → PING이 늦어 장치가 PC_LINK_TIMEOUT으로 HOLD할 수 있다 (지시서 8장)
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', () => {
        if (!this.link.isOpen) return;
        if (document.hidden) this.link.note('검사 화면이 뒤로 갔어요 — 연결 유지(PING)가 늦어지면 장치가 PC 연결 시간 초과로 HOLD할 수 있어요', 'warn');
        else this.link.note('검사 화면이 다시 앞에 있어요');
      });
  }

  // ---------- 모드 ----------

  setMode(mode: Mode) {
    if (mode === this.s.mode) return;
    this.abortCheck();
    this.regCtl?.abort();
    void this.link.close();
    this.camera.close();
    this.vcam?.stop();
    this.vcam = null;
    this.simOff?.();
    this.simOff = null;
    this.s.sim?.dispose();
    this.simTransport = null;
    let sim: SimDevice | null = null;
    if (mode === 'sim') {
      sim = new SimDevice();
      this.simOff = sim.subscribe(this.onSim);
      this.vcam = new VirtualCamera(this.virtualView);
    }
    this.cycleRec = null;
    this.set({ mode, sim, manual: null, deviceError: null, registerError: null, releasedCycle: null, cycle: null, last: null });
    this.setProfile(mode === 'sim' ? 'virtual' : 'real');
  }

  private setProfile(p: CameraProfile) {
    if (p === this.s.profile) return;
    this.set({ profile: p });
    this.reprepare();
  }

  // ---------- 카메라 ----------

  get cameraSaved() {
    return this.cameraChoice;
  }

  async connectCamera() {
    if (this.s.mode === 'sim') return this.connectVirtual();
    await this.camera.connect(this.cameraChoice);
  }

  async connectVirtual() {
    if (!this.vcam) return;
    const v = this.vcam;
    await this.camera.openVirtual({ start: () => v.start(), stop: () => v.stop() }, '가상 카메라 (시험 모드)');
  }

  /** 시험 모드에서도 실제 카메라로 인쇄 시편을 볼 수 있다 (장치는 가상) */
  async connectRealCamera() {
    await this.camera.connect(this.cameraChoice);
  }

  async selectCamera(deviceId: string) {
    await this.camera.select(deviceId);
  }

  disconnectCamera() {
    this.camera.close();
  }

  private onCamera = () => {
    const c = this.camera.snapshot;
    if (c.phase !== 'live') return;
    this.setProfile(c.virtual ? 'virtual' : 'real');
    if (!c.virtual && c.deviceId && (this.cameraChoice?.deviceId !== c.deviceId || this.cameraChoice.label !== c.label)) {
      this.cameraChoice = { deviceId: c.deviceId, label: c.label ?? '카메라' };
      this.store.putKv('camera:choice', this.cameraChoice);
    }
  };

  // ---------- 장치 ----------

  async connectDevice() {
    this.set({ deviceError: null });
    if (this.s.mode === 'sim') {
      if (!this.s.sim) return;
      try {
        const t = new SimTransport(this.s.sim);
        this.simTransport = t;
        await this.link.open(t);
      } catch (e) {
        this.set({ deviceError: (e as Error).message });
      }
      return;
    }
    const sup = serialSupport();
    if (sup !== 'ok') return this.set({ deviceError: SERIAL_SUPPORT_MSG[sup] });
    let port: SerialPort;
    try {
      port = await requestSerialPort();
    } catch (e) {
      if ((e as Error)?.name === 'NotFoundError') return; // 고르기 창을 닫음
      return this.set({ deviceError: describeSerialError(e) });
    }
    try {
      await this.link.open(new SerialTransport(port));
    } catch (e) {
      this.set({ deviceError: describeSerialError(e) });
    }
  }

  async disconnectDevice() {
    await this.link.close();
  }

  private onLink = (e: LinkEvent) => {
    switch (e.type) {
      case 'inspect_request':
        this.beginCycle(e.session, e.cycle);
        break;
      case 'request_closed':
        this.runner.close(e.cycle, e.why);
        this.event('request_closed', { cycle: e.cycle, why: e.why });
        break;
      case 'result':
        this.runner.resultUpdate(e.result);
        if (e.result.state !== 'sending') this.event('result', { ...e.result });
        break;
      case 'notice':
        this.onNotice(e.notice);
        break;
    }
  };

  private onNotice(n: DeviceNotice) {
    const st = this.link.snapshot.status;
    const rec = this.cycleRec;
    const mine = rec && st && rec.deviceSession === st.session && rec.cycle === st.cycle ? rec : null;
    if (n.name === 'done') {
      const cmd = n.command;
      if (mine && (cmd === '001' || cmd === 'ROUTE_OK')) this.patchRecord(mine.id, { route: 'OK' });
      if (mine && (cmd === '010' || cmd === 'ROUTE_NG')) this.patchRecord(mine.id, { route: 'NG' });
      if (cmd === '011' || cmd === 'OPEN_STOP') {
        if (mine) this.patchRecord(mine.id, { released: true });
        if (st) this.set({ releasedCycle: st.cycle });
      }
      this.event('done', { command: cmd, phase: n.phase, cycle: st?.cycle ?? null });
    } else if (n.name === 'phase') {
      if (n.to === 'HOLD_FAULT' && rec && rec.cycle === n.cycle) this.patchRecord(rec.id, { faultCode: n.faultCode });
      this.event('phase', { from: n.from, to: n.to, cycle: n.cycle, faultCode: n.faultCode });
    } else if (n.name === 'boot') {
      this.set({ releasedCycle: null });
      this.event('boot', { build: n.build, autostart: n.autostart });
    } else if (n.name === 'link') {
      this.event('link', { phase: n.phase, detail: n.detail });
    } else {
      this.event(n.name, { ...n });
    }
  }

  // ---------- 검사 요청 ----------

  private beginCycle(session: number, cycle: number) {
    this.abortCheck();
    this.regCtl?.abort();
    const now = new Date().toISOString();
    const rec: InspectionRecord = {
      id: uuid(),
      mode: this.s.mode === 'sim' ? 'sim' : 'live',
      camera: this.s.profile,
      expected: null,
      deviceSession: session,
      cycle,
      capture: null,
      frameIds: [],
      verdict: 'HOLD',
      holdReason: null,
      attempts: 0,
      trail: [],
      method: METHOD,
      version: ENGINE_VERSION,
      calibrationVersion: this.settings.calibrationVersion,
      scores: null,
      requestedAt: now,
      firstFrameAt: null,
      decidedAt: null,
      cameraLabel: this.camera.snapshot.label,
      plc: 'none',
      plcDetail: null,
      route: null,
      released: false,
      collectionConfirmed: false,
      faultCode: null,
      closedWhy: null,
      thumb: null,
      updatedAt: now,
    };
    this.cycleRec = rec;
    this.addRecord(rec);
    this.event('inspect_request', { session, cycle }, rec.id);
    this.runner.begin(session, cycle);
  }

  private onCycleState(c: CycleState) {
    this.set({ cycle: c });
    const rec = this.cycleRec;
    if (!rec || rec.cycle !== c.cycle || rec.deviceSession !== c.session) return;
    const o = c.outcome;
    const sentVerdict = c.sent?.verdict;
    this.patchRecord(rec.id, {
      attempts: c.attempt,
      trail: c.trail,
      capture: c.capture,
      verdict: sentVerdict ?? (o ? o.verdict : 'HOLD'),
      holdReason: sentVerdict ? null : (o?.reason ?? null),
      plc: plcFrom(c),
      plcDetail: c.sendError ?? c.sent?.reason ?? null,
      closedWhy: c.closed,
    });
  }

  private onAttempt(c: CycleState, o: Outcome) {
    const rec = this.cycleRec;
    if (!rec || rec.cycle !== c.cycle) return;
    const detail = o.decisive?.detail ?? null;
    this.patchRecord(rec.id, {
      frameIds: o.frames.map((f) => f.id),
      scores: o.decisive?.frame.v.scores ?? null,
      firstFrameAt: iso(o.firstFrameAt),
      decidedAt: iso(o.decidedAt),
      thumb: detail ? thumbnail(detail) : rec.thumb,
    });
    this.event('attempt', { cycle: c.cycle, attempt: c.attempt, verdict: o.verdict, reason: o.reason, action: c.action }, rec.id);
    this.set({ last: { source: 'device', recordId: rec.id, outcome: o, detail, cycle: c.cycle, expected: null } });
  }

  // ---------- 검사만 시험 ----------

  get canCheck(): string | null {
    if (!this.camera.live) return '카메라를 먼저 연결해 주세요';
    if (this.runner.watching) return '장치 검사 요청을 처리하는 중이에요';
    if (this.s.register) return '기준 사진을 찍는 중이에요';
    if (this.checkCtl) return '검사 중이에요';
    return null;
  }

  async runCheck(expected: Expected | null) {
    if (this.canCheck) return;
    const ctl = new AbortController();
    this.checkCtl = ctl;
    this.set({ checking: { progress: null } });
    const o = await runInspection(this.frames, this.s.prepared, this.settings.thresholds, ctl.signal, (p) => {
      if (!ctl.signal.aborted) this.set({ checking: { progress: p } });
    });
    if (this.checkCtl === ctl) this.checkCtl = null;
    if (o.reason === 'aborted') {
      this.set({ checking: null });
      return;
    }
    const detail = o.decisive?.detail ?? null;
    const now = new Date().toISOString();
    const rec: InspectionRecord = {
      id: uuid(),
      mode: 'check',
      camera: this.s.profile,
      expected,
      deviceSession: null,
      cycle: null,
      capture: null,
      frameIds: o.frames.map((f) => f.id),
      verdict: o.verdict,
      holdReason: o.reason,
      attempts: 1,
      trail: [o.verdict === 'HOLD' ? (o.reason ?? 'HOLD') : o.verdict],
      method: METHOD,
      version: ENGINE_VERSION,
      calibrationVersion: this.settings.calibrationVersion,
      scores: o.decisive?.frame.v.scores ?? null,
      requestedAt: iso(o.requestedAt) ?? now,
      firstFrameAt: iso(o.firstFrameAt),
      decidedAt: iso(o.decidedAt),
      cameraLabel: this.camera.snapshot.label,
      plc: 'none',
      plcDetail: null,
      route: null,
      released: false,
      collectionConfirmed: false,
      faultCode: null,
      closedWhy: null,
      thumb: detail ? thumbnail(detail) : null,
      updatedAt: now,
    };
    this.addRecord(rec);
    this.set({ checking: null, last: { source: 'check', recordId: rec.id, outcome: o, detail, cycle: null, expected } });
  }

  private abortCheck() {
    this.checkCtl?.abort();
    this.checkCtl = null;
    if (this.s.checking) this.set({ checking: null });
  }

  // ---------- 기준 사진 · ROI · 기준값 ----------

  get canRegister(): string | null {
    if (!this.camera.live) return '카메라를 먼저 연결해 주세요';
    if (this.runner.watching) return '장치 검사 요청을 처리하는 중이에요';
    if (this.checkCtl) return '검사만 시험이 끝난 뒤 찍어 주세요';
    if (this.s.register) return '찍는 중이에요';
    return null;
  }

  /** 새 프레임 여러 장을 움직임 없이 모아 평균한다 */
  async registerRef(kind: RefKind) {
    const why = this.canRegister;
    if (why) return this.set({ registerError: why });
    const need = 8;
    const ctl = new AbortController();
    this.regCtl = ctl;
    this.set({ register: { kind, got: 0, need, note: '움직임이 멈추길 기다려요' }, registerError: null });
    const th = this.settings.thresholds;
    const roi = { ...this.settings.roi };
    const profile = this.s.profile;
    try {
      const frames: Frame[] = [];
      const deadline = performance.now() + 10000;
      let after = performance.now() + 150;
      let prev: Frame | null = null;
      while (frames.length < need) {
        if (performance.now() > deadline) throw new Error('10초 안에 화면이 멈추지 않았어요. 손을 떼고 다시 눌러 주세요.');
        const f = await withTimeout(this.frames.nextFrame(after, ctl.signal), 2000, '카메라 프레임이 들어오지 않아요.');
        after = f.t + 80;
        let note = `${REF_LABEL[kind]} 기준을 모으는 중`;
        if (prev && motionBetween(prev.img, f.img) > th.maxMotion) {
          frames.length = 0;
          note = '움직임이 있어 처음부터 다시 모아요';
        } else frames.push(f);
        prev = f;
        this.set({ register: { kind, got: frames.length, need, note } });
      }
      if (this.s.profile !== profile) throw new Error('찍는 동안 카메라가 바뀌었어요. 다시 찍어 주세요.');
      const stored = buildStored(kind, frames.map((f) => f.img), roi, frames.map((f) => f.id), this.camera.snapshot.label);
      this.updateProfile((p) => ({ ...p, refs: { ...p.refs, [kind]: stored }, calibrationVersion: p.calibrationVersion + 1 }));
      this.event('reference', { kind, frames: need, roi, camera: stored.cameraLabel });
      this.set({ register: null });
    } catch (e) {
      const aborted = ctl.signal.aborted || (e as Error)?.name === 'AbortError';
      this.set({ register: null, registerError: aborted ? '장치 요청이 들어와 기준 촬영을 멈췄어요.' : (e as Error).message });
    } finally {
      if (this.regCtl === ctl) this.regCtl = null;
    }
  }

  cancelRegister() {
    this.regCtl?.abort();
  }

  clearRef(kind: RefKind) {
    this.updateProfile((p) => {
      const refs = { ...p.refs };
      delete refs[kind];
      return { ...p, refs, calibrationVersion: p.calibrationVersion + 1 };
    });
  }

  /** ROI를 바꾸면 그 ROI로 찍은 기준은 쓸 수 없어 지운다 */
  setRoi(roi: Roi) {
    this.updateProfile((p) => ({ ...p, roi: { ...roi }, refs: {}, calibrationVersion: p.calibrationVersion + 1 }));
    this.event('roi', { ...roi });
  }

  setThresholds(patch: Partial<Thresholds>) {
    this.updateProfile((p) => ({ ...p, thresholds: { ...p.thresholds, ...patch }, calibrationVersion: p.calibrationVersion + 1 }));
    this.event('thresholds', { ...patch });
  }

  resetThresholds() {
    this.updateProfile((p) => ({ ...p, thresholds: { ...DEFAULT_THRESHOLDS }, calibrationVersion: p.calibrationVersion + 1 }));
  }

  private updateProfile(fn: (p: ProfileSettings) => ProfileSettings) {
    const key = this.s.profile;
    this.profiles[key] = fn(this.profiles[key]);
    this.store.putKv(`profile:${key}`, this.profiles[key]);
    this.reprepare();
  }

  private reprepare() {
    const st = this.settings;
    const { ok, ng, empty } = st.refs;
    let prepared: PreparedRefs | null = null;
    let note: string | null = null;
    const missing = (['ok', 'ng'] as RefKind[]).filter((k) => !st.refs[k]).map((k) => REF_LABEL[k]);
    const stale = [ok, ng, empty].some((r) => r && !sameRoi(r.roi, st.roi));
    if (stale) note = 'ROI가 바뀌어 기준 사진을 다시 등록해야 해요.';
    else if (ok) {
      try {
        prepared = prepareRefs({ ok, ng: ng ?? null, empty: empty ?? null }, st.thresholds.flatten, { maxShift: st.thresholds.maxShift, maxRot: st.thresholds.maxRot });
      } catch (e) {
        note = `기준 사진을 읽지 못했어요 (${(e as Error).message})`;
      }
    }
    if (!note && missing.length) note = `기준 사진 미등록: ${missing.join(' · ')}`;
    if (!note && prepared?.separation !== null && prepared?.separation !== undefined && prepared.separation < 0.03)
      note = `정상·불량 기준이 너무 비슷해요 (차이 ${prepared.separation.toFixed(3)}). 더 뚜렷한 불량 시편으로 다시 찍어 주세요.`;
    const label = this.camera.snapshot.label;
    if (!note && this.camera.live && ok?.cameraLabel && label && ok.cameraLabel !== label) note = `다른 카메라(${ok.cameraLabel})로 찍은 기준이에요. 이 카메라로 다시 찍어 주세요.`;
    this.set({ settings: st, prepared, refsNote: note });
  }

  // ---------- 시험 모드: 가상 이송로 ----------

  private onSim = () => {
    const w = this.s.sim?.snapshot.wafer;
    const at = w?.at ?? null;
    if (at === 'chute' && this.prevSimAt !== 'chute') {
      this.simPlacement = ++this.placementSeq;
      if (this.s.manual) this.set({ manual: null });
    }
    this.prevSimAt = at;
  };

  private virtualView = (): VirtualView => {
    const sim = this.s.sim?.snapshot;
    const w = sim?.wafer;
    let wafer: VirtualView['wafer'] = null;
    if (w && (w.at === 'chute' || w.at === 'gate' || w.at === 'passing')) wafer = { kind: w.kind, at: w.at, since: w.since, placement: this.simPlacement };
    else if (this.s.manual) wafer = { kind: this.s.manual.kind, at: 'gate', since: this.s.manual.since, placement: this.s.manual.placement };
    return { wafer, stopGate: sim?.stopGate ?? 'closed', disturb: sim?.disturb ?? NO_DISTURB, slideMs: sim?.options.slideMs ?? 900 };
  };

  /** 가상 작업대에 직접 올리기 (기준 등록·검사만 시험용). 이송로에 원판이 있으면 안 된다 */
  placeVirtual(kind: VirtualItem | null): string | null {
    const w = this.s.sim?.snapshot.wafer;
    if (w && (w.at === 'chute' || w.at === 'gate' || w.at === 'passing')) return '이송로에 가상 원판이 있어요. 사이클이 끝난 뒤 올려 주세요.';
    this.set({ manual: kind ? { kind, since: Date.now(), placement: ++this.placementSeq } : null });
    return null;
  }

  /** 시험: 카메라가 갑자기 끊긴 것처럼 */
  dropCamera() {
    this.camera.simulateLost();
  }

  /** 시험: USB 케이블을 뽑은 것처럼 */
  unplugSim() {
    this.simTransport?.unplug();
  }

  /** 시험: Uno 전원·리셋 */
  rebootSim() {
    this.s.sim?.reboot();
  }

  /** 지금 장치 요청을 처리 중인지 (기준·ROI·검사만 시험을 막는다) */
  get busyWithDevice() {
    return this.runner.watching;
  }

  // ---------- 기록 ----------

  private addRecord(r: InspectionRecord) {
    this.set({ records: [r, ...this.s.records] });
    this.store.putRecord(r);
  }

  private patchRecord(id: string, p: Partial<InspectionRecord>) {
    const i = this.s.records.findIndex((r) => r.id === id);
    if (i < 0) return;
    const next = { ...this.s.records[i], ...p, updatedAt: new Date().toISOString() };
    const records = this.s.records.slice();
    records[i] = next;
    if (this.cycleRec?.id === id) this.cycleRec = next;
    this.set({ records });
    this.store.putRecord(next);
  }

  private event(type: string, payload: Record<string, unknown>, recordId?: string) {
    this.store.addEvent({ recordId: recordId ?? this.cycleRec?.id ?? null, type, payload, createdAt: new Date().toISOString() });
  }

  async exportCsv(which: RecordMode | 'all') {
    const all = this.store.status.state === 'unavailable' ? [...this.s.records].reverse() : await this.store.allRecords();
    // 아직 저장되지 않은 최신 내용으로 덮어쓴다
    const mem = new Map(this.s.records.map((r) => [r.id, r]));
    const merged = all.map((r) => mem.get(r.id) ?? r);
    for (const r of this.s.records) if (!merged.some((m) => m.id === r.id)) merged.push(r);
    merged.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    const list = which === 'all' ? merged : merged.filter((r) => r.mode === which);
    downloadText(`wafer-records-${which}-${stamp()}.csv`, recordsCsv(list));
  }

  async exportEvents() {
    const ev = await this.store.allEvents();
    downloadText(`wafer-events-${stamp()}.csv`, eventsCsv(ev));
  }
}
