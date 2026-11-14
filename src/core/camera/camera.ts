// 카메라: getUserMedia(영상만) → 권한을 얻은 뒤 장치를 고른다 → 고른 장치만 deviceId exact로 연다.
// 고른 USB 카메라가 사라지면 노트북 카메라로 바꾸지 않고 '끊김'으로 둔다 (지시서 5장).
export type CameraPhase = 'off' | 'starting' | 'choose' | 'live' | 'lost' | 'error';

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export interface CameraSnapshot {
  phase: CameraPhase;
  virtual: boolean;
  devices: CameraInfo[];
  deviceId: string | null;
  label: string | null;
  width: number;
  height: number;
  fps: number | null;
  error: string | null;
  /** 카메라를 열 때마다 바뀌는 번호 (프레임 번호와 함께 캡처 ID가 된다) */
  session: number;
}

export type CameraSupport = 'ok' | 'insecure' | 'unsupported';

export function cameraSupport(): CameraSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return 'ok';
}

/** 정확한 해상도를 강제하지 않는다: ideal만 준다 */
const RESOLUTION: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

export function describeCameraError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  switch (err?.name) {
    case 'NotAllowedError':
      return '카메라 권한이 필요해요. 주소창의 카메라 아이콘에서 허용한 뒤 다시 눌러 주세요.';
    case 'NotReadableError':
    case 'TrackStartError':
      return '다른 프로그램이 카메라를 쓰고 있어요. 화상회의·카메라 앱을 닫고 다시 연결해 주세요.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '카메라를 찾지 못했어요. USB 카메라 연결을 확인해 주세요.';
    case 'OverconstrainedError':
      return '고른 카메라가 연결돼 있지 않아요. 케이블을 확인하고 목록에서 다시 골라 주세요.';
    case 'SecurityError':
      return '이 창에서는 카메라가 막혀 있어요. 새 탭(Chrome·Edge)에서 열어 주세요.';
    case 'AbortError':
      return '카메라를 여는 중에 중단됐어요. 다시 눌러 주세요.';
    default:
      return `카메라를 열지 못했어요 (${err?.name ?? '알 수 없음'}).`;
  }
}

type FrameListener = (now: number, frameNo: number) => void;

export class CameraController {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private virtualStop: (() => void) | null = null;
  private s: CameraSnapshot = {
    phase: 'off',
    virtual: false,
    devices: [],
    deviceId: null,
    label: null,
    width: 0,
    height: 0,
    fps: null,
    error: null,
    session: 0,
  };
  private listeners = new Set<() => void>();
  private frameListeners = new Set<FrameListener>();
  private frameNo = 0;
  private lastFrameAt = 0;
  private fpsEma: number | null = null;
  private fpsShownAt = 0;
  private rvfc: number | null = null;
  private raf: number | null = null;
  private lastVideoTime = -1;
  private opening = 0;

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('aria-label', '카메라 영상');
    v.className = 'block h-full w-full object-contain';
    this.video = v;
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.refreshDevices());
    window.addEventListener('pagehide', () => this.close());
  }

  get snapshot() {
    return this.s;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.s;

  private set(patch: Partial<CameraSnapshot>) {
    this.s = { ...this.s, ...patch };
    for (const fn of this.listeners) fn();
  }

  get live() {
    return this.s.phase === 'live' && this.video.videoWidth > 0;
  }

  onFrame(fn: FrameListener) {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all
        .filter((d) => d.kind === 'videoinput' && d.deviceId)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `카메라 ${i + 1}` }));
      this.set({ devices });
    } catch {
      /* 목록을 못 읽어도 연결은 유지 */
    }
  }

  /** 카메라 연결 버튼. saved가 있으면 그 카메라만 연다. 없으면 권한을 얻고 카메라가 하나일 때만 바로 쓴다. */
  async connect(saved: CameraInfo | null) {
    const token = ++this.opening;
    this.stopStream();
    this.set({ phase: 'starting', error: null, virtual: false });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: saved ? { ...RESOLUTION, deviceId: { exact: saved.deviceId } } : RESOLUTION,
        audio: false,
      });
    } catch (e) {
      if (token !== this.opening) return;
      const name = (e as Error)?.name;
      if (saved && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        // 저장해 둔 카메라가 없다: 다른 카메라로 바꾸지 않는다. 권한만 확인하고 목록에서 고르게 한다.
        await this.permissionOnly();
        if (token !== this.opening) return;
        await this.refreshDevices();
        this.set({ phase: 'choose', error: `저장해 둔 카메라(${saved.label})가 연결돼 있지 않아요. 목록에서 검사 카메라를 골라 주세요.` });
        return;
      }
      this.set({ phase: 'error', error: describeCameraError(e) });
      return;
    }
    if (token !== this.opening) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    await this.refreshDevices();
    const track = stream.getVideoTracks()[0];
    const id = track?.getSettings().deviceId ?? null;
    const label = track?.label || this.s.devices.find((d) => d.deviceId === id)?.label || '카메라';
    if (!saved && this.s.devices.length > 1) {
      stream.getTracks().forEach((t) => t.stop());
      this.set({ phase: 'choose', error: null });
      return;
    }
    await this.attach(stream, id, label, false);
  }

  private async permissionOnly() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      /* 권한이 없으면 라벨 없이 목록만 */
    }
  }

  /** 목록에서 고른 카메라만 연다 (exact) */
  async select(deviceId: string) {
    const token = ++this.opening;
    this.stopStream();
    this.set({ phase: 'starting', error: null, virtual: false });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { ...RESOLUTION, deviceId: { exact: deviceId } }, audio: false });
      if (token !== this.opening) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const label = stream.getVideoTracks()[0]?.label || this.s.devices.find((d) => d.deviceId === deviceId)?.label || '카메라';
      await this.attach(stream, deviceId, label, false);
    } catch (e) {
      if (token === this.opening) this.set({ phase: 'error', error: describeCameraError(e) });
    }
  }

  /** 시험 모드 가상 카메라 (캔버스 스트림). 실제 카메라와 같은 영상 경로를 쓴다. */
  async openVirtual(source: { start(): MediaStream; stop(): void }, label: string) {
    const token = ++this.opening;
    this.stopStream();
    const stream = source.start();
    this.virtualStop = () => source.stop();
    if (token !== this.opening) return;
    await this.attach(stream, 'virtual', label, true);
  }

  private async attach(stream: MediaStream, deviceId: string | null, label: string, virtual: boolean) {
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    track?.addEventListener('ended', this.onEnded);
    const v = this.video;
    v.srcObject = stream;
    await new Promise<void>((resolve) => {
      if (v.readyState >= 1) return resolve();
      const done = () => resolve();
      v.addEventListener('loadedmetadata', done, { once: true });
      setTimeout(done, 3000);
    });
    try {
      await v.play();
    } catch {
      /* 자동 재생이 막혀도 프레임은 들어온다 (muted) */
    }
    this.fpsEma = null;
    this.set({
      phase: 'live',
      virtual,
      deviceId,
      label,
      width: v.videoWidth,
      height: v.videoHeight,
      fps: null,
      error: null,
      session: this.s.session + 1,
    });
    this.startLoop();
  }

  private onEnded = () => {
    // 케이블을 뽑았거나 다른 프로그램이 가져갔다. 다른 카메라로 바꾸지 않는다.
    this.stopLoop();
    this.set({ phase: 'lost', error: `카메라(${this.s.label ?? ''}) 연결이 끊겼어요. 다른 카메라로 바꾸지 않아요 — USB를 확인하고 카메라 연결을 다시 눌러 주세요.` });
  };

  private startLoop() {
    this.stopLoop();
    const v = this.video;
    if ('requestVideoFrameCallback' in v) {
      const step = (now: number, meta: VideoFrameCallbackMetadata) => {
        // 카메라가 찍은 시각을 알 수 있으면 그것으로 '요청 이후 프레임'을 가린다
        const ct = meta.captureTime;
        const t = ct !== undefined && ct <= now && now - ct < 1000 ? ct : now;
        this.tick(Math.max(t, this.lastFrameAt + 0.001));
        this.rvfc = v.requestVideoFrameCallback(step);
      };
      this.rvfc = v.requestVideoFrameCallback(step);
    } else {
      const step = (now: number) => {
        const vt = (v as HTMLVideoElement).currentTime;
        if (vt !== this.lastVideoTime) {
          this.lastVideoTime = vt;
          this.tick(now);
        }
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
  }

  private stopLoop() {
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (this.rvfc !== null) v.cancelVideoFrameCallback?.(this.rvfc);
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.rvfc = this.raf = null;
  }

  private tick(now: number) {
    this.frameNo++;
    if (this.lastFrameAt > 0) {
      const dt = now - this.lastFrameAt;
      if (dt > 0) this.fpsEma = this.fpsEma === null ? 1000 / dt : this.fpsEma * 0.9 + (1000 / dt) * 0.1;
    }
    this.lastFrameAt = now;
    const v = this.video;
    if (v.videoWidth !== this.s.width || v.videoHeight !== this.s.height) this.set({ width: v.videoWidth, height: v.videoHeight });
    if (now - this.fpsShownAt > 1000 && this.fpsEma !== null) {
      this.fpsShownAt = now;
      this.set({ fps: Math.round(this.fpsEma) });
    }
    for (const fn of this.frameListeners) fn(now, this.frameNo);
  }

  /** 시험 모드 오류 주입: 케이블이 뽑힌 것처럼 프레임을 끊는다 */
  simulateLost() {
    if (this.s.phase !== 'live') return;
    this.onEnded();
  }

  /** 마지막 프레임 시각 (performance.now 기준) */
  get lastFrameTime() {
    return this.lastFrameAt;
  }

  private stopStream() {
    this.stopLoop();
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.removeEventListener('ended', this.onEnded);
        t.stop();
      }
    }
    this.stream = null;
    this.virtualStop?.();
    this.virtualStop = null;
    this.video.srcObject = null;
    this.lastFrameAt = 0;
  }

  close() {
    ++this.opening;
    this.stopStream();
    this.set({ phase: 'off', virtual: false, deviceId: null, label: null, width: 0, height: 0, fps: null, error: null });
  }
}
