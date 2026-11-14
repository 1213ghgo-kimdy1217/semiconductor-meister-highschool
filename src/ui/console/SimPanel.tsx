// 시험 모드 전용: 가상 HMI·PLC 순서, 가상 작업대, 방해와 고장 주입. 실제 포트·PLC와 관계없다.
import type { StationSnapshot } from '../../app/station';
import { getStation, useSim } from '../../app/useStation';
import type { VirtualItem } from '../../core/camera/virtual';
import { PLC_STEP_LABEL, SIM_WAFER_LABEL, type SimDisturb, type SimWafer } from '../../core/transport/simDevice';
import { btn } from './kit';

const WAFERS: SimWafer[] = ['normal-a', 'defect-a', 'defect-b', 'defect-c', 'empty'];
const AT_LABEL: Record<string, string> = {
  chute: '이송로로 미끄러지는 중',
  gate: '촬영 위치 (정지 게이트 앞)',
  passing: '분기 구간 통과 중',
  cassette_ok: '정상 카세트',
  cassette_ng: '불량 카세트',
  removed: '작업자가 꺼냄',
};
const DISTURB: [keyof SimDisturb, string][] = [
  ['hand', '손 가림'],
  ['glare', '반사'],
  ['blur', '흐림'],
  ['dim', '어둡게'],
];

export function SimPanel({ st }: { st: StationSnapshot }) {
  const station = getStation();
  const sim = st.sim;
  const s = useSim(sim);
  if (!sim || !s) return null;
  const onTrack = s.wafer && (s.wafer.at === 'chute' || s.wafer.at === 'gate' || s.wafer.at === 'passing');
  const place = (k: VirtualItem | null) => {
    const why = station.placeVirtual(k);
    if (why) window.alert(why);
  };

  return (
    <section aria-labelledby="sim-title" className="overflow-hidden rounded-lg border-2 border-hold bg-panel">
      <div className="test-band h-1.5" aria-hidden />
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
        <h2 id="sim-title" className="text-[15px] font-bold">
          가상 장치 조작 <span className="text-[13px] font-semibold text-hold-ink">시험 모드 전용</span>
        </h2>
        <span className="ml-auto text-[12px] text-steel">가상 HMI·PLC·이송로예요. 실제 운전 화면에는 이 칸이 없어요.</span>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <h3 className="text-[13px] font-bold">가상 HMI</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" className={btn.small} aria-pressed={s.permit} onClick={() => sim.hmiPermit(!s.permit)}>
              {s.permit ? '운전 허가 끄기' : '준비 · 운전 허가'}
            </button>
            <button type="button" className={btn.small} onClick={() => sim.hmiHome()}>
              원점 복귀 (100)
            </button>
            <button type="button" className={btn.small} disabled={s.plcStep !== 'wait_collection'} onClick={() => sim.hmiConfirmCollection()}>
              수거 확인
            </button>
            <button type="button" className={btn.small} disabled={s.phase !== 'HOLD_FAULT'} onClick={() => sim.hmiRecover()}>
              HOLD 복구 (101)
            </button>
          </div>
          <p className="mt-2 text-[12px] text-steel">한 장 투입 · 시작 (정지 게이트 닫기 000 → 투입 → 새 검사 요청 110)</p>
          <div role="group" aria-label="한 장 투입 · 시작" className="mt-1 flex flex-wrap gap-1.5">
            {WAFERS.map((k) => (
              <button key={k} type="button" className={btn.small} disabled={s.phase !== 'IDLE_CLOSED' || s.plcStep !== 'idle'} onClick={() => sim.hmiStart(k)}>
                {SIM_WAFER_LABEL[k]} 투입
              </button>
            ))}
          </div>
          <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5 text-[12.5px]">
            <dt className="text-steel">PLC 순서</dt>
            <dd className="font-semibold">{PLC_STEP_LABEL[s.plcStep]}</dd>
            <dt className="text-steel">운전 허가</dt>
            <dd>{s.permit ? 'ON' : 'OFF'}</dd>
            <dt className="text-steel">정지 게이트</dt>
            <dd>{s.stopGate === 'closed' ? '닫힘' : s.stopGate === 'open' ? '열림' : '움직이는 중'}</dd>
            <dt className="text-steel">분기 게이트</dt>
            <dd>{s.diverter === 'center' ? '기준 자세' : s.diverter === 'ok' ? '정상 쪽' : s.diverter === 'ng' ? '불량 쪽' : '움직이는 중'}</dd>
            <dt className="text-steel">원판</dt>
            <dd>{s.wafer ? `${SIM_WAFER_LABEL[s.wafer.kind]} · ${AT_LABEL[s.wafer.at]}` : '없음'}</dd>
            <dt className="text-steel">수거 (가상 HMI)</dt>
            <dd>{s.collection === 'confirmed' ? '확인됨 — 웹은 이 값을 받지 못해요' : s.collection === 'pending' ? '확인 대기' : '—'}</dd>
          </dl>
        </div>

        <div>
          <h3 className="text-[13px] font-bold">가상 작업대 (기준 등록 · 검사만 시험용)</h3>
          <div role="group" aria-label="가상 작업대" className="mt-1.5 flex flex-wrap gap-1.5">
            {(['empty', 'normal-a', 'defect-a', 'defect-b', 'defect-c'] as VirtualItem[]).map((k) => (
              <button key={k} type="button" className={btn.small} aria-pressed={st.manual?.kind === k} disabled={!!onTrack} onClick={() => place(k)}>
                {k === 'empty' ? '빈 자리' : SIM_WAFER_LABEL[k as SimWafer].replace(' (기준 미등록)', '').replace(' (어려움)', '')}
              </button>
            ))}
            <button type="button" className={btn.small} disabled={!st.manual} onClick={() => place(null)}>
              치우기
            </button>
          </div>
          <p className="mt-1 text-[12px] text-steel">올릴 때마다 위치·회전·조명이 조금씩 달라져요 (꺼냈다 다시 놓기와 같음).</p>

          <h3 className="mt-3 text-[13px] font-bold">방해</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DISTURB.map(([k, label]) => (
              <button key={k} type="button" className={btn.small} aria-pressed={s.disturb[k]} onClick={() => sim.setDisturb({ [k]: !s.disturb[k] })}>
                {s.disturb[k] ? `✓ ${label}` : label}
              </button>
            ))}
          </div>

          <h3 className="mt-3 text-[13px] font-bold">고장 주입</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" className={btn.danger} onClick={() => station.unplugSim()}>
              USB 케이블 뽑기
            </button>
            <button type="button" className={btn.danger} onClick={() => station.rebootSim()}>
              Uno 재부팅
            </button>
            <button type="button" className={btn.danger} onClick={() => station.dropCamera()}>
              카메라 끊김
            </button>
            <button type="button" className={btn.danger} onClick={() => sim.injectOppositeRoute()}>
              반대 경로 요청
            </button>
            <button type="button" className={btn.danger} onClick={() => sim.injectRouteDuringDrain()}>
              배출 중 분기 요청
            </button>
            <button type="button" className={btn.danger} onClick={() => sim.injectStaleResult()}>
              늦게 온 이전 결과
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!s.options.configured} onChange={(e) => sim.setOptions({ configured: !e.target.checked })} />
              교정 미확인 (실제 초기 상태처럼 잠금)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.options.chunkNoise} onChange={(e) => sim.setOptions({ chunkNoise: e.target.checked })} />
              수신 줄 쪼개기·붙이기
            </label>
          </div>
        </div>

        <details className="md:col-span-2">
          <summary className="cursor-pointer text-[13px] font-semibold">가상 장치 기록 ({s.log.length})</summary>
          <ol className="mt-1 max-h-40 overflow-auto rounded bg-[#f7f9fa] p-2 font-mono text-[11.5px] leading-5">
            {[...s.log].reverse().map((l, i) => (
              <li key={`${l.t}-${i}`}>
                <span className="text-[#8a96a0]">{new Date(l.t).toLocaleTimeString('ko-KR', { hour12: false })}</span> {l.text}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </section>
  );
}
