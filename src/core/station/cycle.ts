// PLC 검사 요청 하나를 웹 쪽에서 처리하는 규칙 (지시서 5·6·8장).
// - 확정 OK/NG만 현재 요청에 한 번 보낸다. HOLD를 NG로 바꾸지 않는다.
// - 물체 없음·흔들림·일시적 방해(손·반사·흐림)는 보내지 않고 새 프레임으로 계속 본다.
// - 판정 불확실·기준 미등록은 보내지 않고 멈춘다. 장치는 검사 시간 초과(60초)로 HOLD한다.
// - 복구할 수 없는 카메라 실패만 CAPTURE_FAILED를 보낸다.
import { runInspection, DEFAULT_RUN, type FrameSource, type Outcome, type RunOptions, type RunProgress } from '../inspect/runner';
import { LinkError, type DeviceLink, type SentResult } from '../protocol/link';
import type { WebStage } from '../process/flow';
import type { HoldReason, Thresholds } from '../vision/analyze';
import type { PreparedRefs } from '../vision/reference';

export interface LiveFrames extends FrameSource {
  readonly live: boolean;
}

export type Action = 'send' | 'capture_failed' | 'keep_watching' | 'withhold' | 'stop';

const WITHHOLD: HoldReason[] = ['mismatch', 'low_margin', 'no_consensus', 'no_reference'];

/** 시도 한 번의 결과로 다음 할 일을 정한다 */
export function decide(o: Outcome, cameraLive: boolean, cameraFailures: number): Action {
  if (o.verdict === 'OK' || o.verdict === 'NG') return 'send';
  const r = o.reason;
  if (r === 'aborted') return 'stop';
  if (r === 'camera') return !cameraLive || cameraFailures >= 1 ? 'capture_failed' : 'keep_watching';
  if (r && WITHHOLD.includes(r)) return 'withhold';
  return 'keep_watching';
}

export interface CycleState {
  session: number;
  cycle: number;
  stage: WebStage;
  attempt: number;
  progress: RunProgress | null;
  /** 마지막 시도 */
  outcome: Outcome | null;
  /** 시도마다 OK/NG 또는 보류 사유 */
  trail: string[];
  action: Action | null;
  capture: number | null;
  sent: SentResult | null;
  captureFailed: boolean;
  sendError: string | null;
  closed: string | null;
  startedAt: number;
}

export interface CycleHooks {
  refs(): PreparedRefs | null;
  thresholds(): Thresholds;
  run?: RunOptions;
  now?: () => number;
  retryDelayMs?: number;
  onState(s: CycleState): void;
  onAttempt?(s: CycleState, o: Outcome): void;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export class CycleRunner {
  private cur: { s: CycleState; ctl: AbortController } | null = null;

  constructor(
    private readonly link: DeviceLink,
    private readonly frames: LiveFrames,
    private readonly hooks: CycleHooks,
  ) {}

  get state(): CycleState | null {
    return this.cur?.s ?? null;
  }

  /** 웹이 지금 이 요청을 보고 있는지 (결과를 보냈거나 멈췄으면 false) */
  get watching() {
    const s = this.cur?.s;
    return !!s && !s.closed && (s.stage === 'waiting_object' || s.stage === 'stabilizing' || s.stage === 'judging' || s.stage === 'sending');
  }

  begin(session: number, cycle: number) {
    if (this.cur && !this.cur.s.closed) this.close(this.cur.s.cycle, '다음 요청');
    const now = this.hooks.now ?? (() => performance.now());
    const s: CycleState = {
      session,
      cycle,
      stage: 'stabilizing',
      attempt: 0,
      progress: null,
      outcome: null,
      trail: [],
      action: null,
      capture: null,
      sent: null,
      captureFailed: false,
      sendError: null,
      closed: null,
      startedAt: now(),
    };
    const cur = { s, ctl: new AbortController() };
    this.cur = cur;
    this.emit(cur);
    void this.loop(cur);
  }

  /** 장치 쪽에서 요청이 닫혔다 (단계 변경·연결 끊김·재부팅…) */
  close(cycle: number, why: string) {
    const cur = this.cur;
    if (!cur || cur.s.cycle !== cycle || cur.s.closed) return;
    cur.ctl.abort();
    this.patch(cur, { closed: why, progress: null });
  }

  /** 보낸 결과의 상태가 바뀌었다 (접수·래치·거부) */
  resultUpdate(r: SentResult) {
    const cur = this.cur;
    if (!cur || cur.s.cycle !== r.cycle || cur.s.sent?.seq !== r.seq) return;
    this.patch(cur, { sent: r });
  }

  dispose() {
    this.cur?.ctl.abort();
    this.cur = null;
  }

  private emit(cur: { s: CycleState }) {
    if (this.cur === cur) this.hooks.onState(cur.s);
  }

  private patch(cur: { s: CycleState }, p: Partial<CycleState>) {
    cur.s = { ...cur.s, ...p };
    this.emit(cur);
  }

  private async loop(cur: { s: CycleState; ctl: AbortController }) {
    const signal = cur.ctl.signal;
    const now = this.hooks.now ?? (() => performance.now());
    let cameraFailures = 0;
    for (;;) {
      if (signal.aborted || cur.s.closed) return;
      const refs = this.hooks.refs();
      this.patch(cur, { attempt: cur.s.attempt + 1, stage: cur.s.stage === 'waiting_object' ? 'waiting_object' : 'stabilizing', progress: null });
      const o = await runInspection(
        this.frames,
        refs,
        this.hooks.thresholds(),
        signal,
        (p) => {
          if (signal.aborted) return;
          // 원판을 기다리는 중이면, 물체가 보인 프레임이 나오기 전까지 '판정 중'으로 바꾸지 않는다
          const waiting = cur.s.stage === 'waiting_object';
          const stage: WebStage =
            p.phase === 'judging' ? (waiting && p.frames.every((f) => f.v.reason === 'no_object') ? 'waiting_object' : 'judging') : waiting ? 'waiting_object' : 'stabilizing';
          this.patch(cur, { progress: p, stage });
        },
        this.hooks.run ?? DEFAULT_RUN,
        now,
      );
      if (signal.aborted || cur.s.closed) return;
      const action = decide(o, this.frames.live, cameraFailures);
      const trail = [...cur.s.trail, o.verdict === 'HOLD' ? (o.reason ?? 'HOLD') : o.verdict];
      this.patch(cur, { outcome: o, trail, action, progress: null });
      this.hooks.onAttempt?.(cur.s, o);

      switch (action) {
        case 'send': {
          const capture = this.link.nextCapture();
          this.patch(cur, { stage: 'sending', capture });
          try {
            const r = await this.link.sendResult(cur.s.cycle, capture, o.verdict as 'OK' | 'NG');
            this.patch(cur, { sent: r });
          } catch (e) {
            this.patch(cur, { sendError: e instanceof LinkError ? e.message : String(e), stage: 'gave_up' });
          }
          return;
        }
        case 'capture_failed': {
          const ok = this.link.sendCaptureFailed(cur.s.cycle);
          this.patch(cur, { captureFailed: ok, stage: 'gave_up', sendError: ok ? null : (this.link.canSend(cur.s.cycle) ?? '보내지 못했어요') });
          return;
        }
        case 'withhold':
          this.patch(cur, { stage: 'gave_up' });
          return;
        case 'stop':
          return;
        case 'keep_watching':
          if (o.reason === 'camera') cameraFailures++;
          this.patch(cur, { stage: o.reason === 'no_object' ? 'waiting_object' : 'stabilizing' });
          await sleep(this.hooks.retryDelayMs ?? 250, signal);
          break;
      }
    }
  }
}
