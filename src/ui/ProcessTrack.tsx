import { STATE_HINT, STATE_LABEL, TRACK_STEPS, type ProcessState } from '../core/process/flow';

type Route = 'OK' | 'NG' | null;

const INSPECT_POS = { x: 178, y: 80 };

function waferPos(state: ProcessState | null, route: Route) {
  switch (state) {
    case 'WAIT_WAFER':
    case 'HOLD_FAULT':
      // 카메라로 아직 확인하지 않았거나, HOLD라 실제 위치를 장비에서 봐야 하는 경우
      return { ...INSPECT_POS, show: true, dashed: true };
    case 'CAPTURE':
    case 'CLASSIFY':
    case 'WAIT_PLC_ROUTE':
    case 'ROUTING_OK':
    case 'ROUTING_NG':
      return { ...INSPECT_POS, show: true, dashed: false };
    case 'RELEASING':
      return { x: 300, y: 80, show: true, dashed: false };
    case 'WAIT_COLLECTION':
      return { x: 509, y: route === 'NG' ? 124 : 36, show: true, dashed: true };
    default:
      return { x: 52, y: 80, show: false, dashed: false };
  }
}

function ringColor(state: ProcessState | null, route: Route) {
  if (state === 'HOLD_FAULT') return '#f4b740';
  if (state === 'CAPTURE' || state === 'CLASSIFY') return '#1f5fad';
  if (route === 'OK') return '#16803c';
  if (route === 'NG') return '#c8312b';
  return '#15202b';
}

export function ProcessTrack({
  state,
  route,
  sourceLabel,
}: {
  state: ProcessState | null;
  route: Route;
  sourceLabel: string;
}) {
  const routing: Route =
    state === 'ROUTING_OK' ? 'OK' : state === 'ROUTING_NG' ? 'NG' : state === 'RELEASING' || state === 'WAIT_COLLECTION' ? route : null;
  const gateOpen = state === 'RELEASING';
  const w = waferPos(state, routing ?? route);
  const flap = routing === 'OK' ? 'M330 80 L370 101' : routing === 'NG' ? 'M330 80 L370 59' : 'M330 80 L374 80';
  const isError = state === 'HOLD_FAULT';

  return (
    <div>
      <svg viewBox="0 0 560 160" className="w-full" role="img" aria-label={`공정 그림: ${state ? STATE_LABEL[state] : '장치 상태 없음'}`}>
        {/* 이송로 (위에서 본 모습) */}
        <path d="M24 80 H316" stroke="#e1e7ec" strokeWidth="46" strokeLinecap="round" fill="none" />
        <path d="M316 80 L470 36" stroke={routing === 'OK' ? '#cfe9d8' : '#e1e7ec'} strokeWidth="40" strokeLinecap="round" fill="none" />
        <path d="M316 80 L470 124" stroke={routing === 'NG' ? '#f6d4d1' : '#e1e7ec'} strokeWidth="40" strokeLinecap="round" fill="none" />
        {[96, 120, 252, 276].map((x) => (
          <path key={x} d={`M${x} 72 l6 8 l-6 8`} stroke="#aab6c0" strokeWidth="2" fill="none" />
        ))}

        {/* 카메라 시야 */}
        <circle cx={INSPECT_POS.x} cy={INSPECT_POS.y} r="33" fill="none" stroke={state === 'CAPTURE' || state === 'CLASSIFY' ? '#1f5fad' : '#9aa7b2'} strokeWidth="1.5" strokeDasharray="4 4" />
        <path d="M178 22 V45" stroke="#9aa7b2" strokeWidth="1.5" />
        <rect x="163" y="8" width="30" height="16" rx="3" fill="#15202b" />
        <circle cx="178" cy="16" r="4.5" fill="#9fb3c4" />

        {/* 정지 게이트 */}
        {gateOpen ? (
          <rect x="219" y="14" width="7" height="34" rx="2" fill="none" stroke="#15202b" strokeWidth="1.5" strokeDasharray="3 3" />
        ) : (
          <rect x="219" y="50" width="7" height="60" rx="2" fill="#15202b" />
        )}

        {/* 분기 게이트 */}
        <path d={flap} stroke="#15202b" strokeWidth="6" strokeLinecap="round" style={{ transition: 'd 400ms ease' }} />
        <circle cx="330" cy="80" r="5" fill="#15202b" />

        {/* 카세트 */}
        <rect x="474" y="14" width="72" height="44" rx="6" fill="#fff" stroke="#16803c" strokeWidth={routing === 'OK' ? 2.5 : 1.5} />
        <text x="510" y="41" textAnchor="middle" fontSize="12" fontWeight="600" fill="#16803c">정상 카세트</text>
        <rect x="474" y="102" width="72" height="44" rx="6" fill="#fff" stroke="#c8312b" strokeWidth={routing === 'NG' ? 2.5 : 1.5} />
        <text x="510" y="129" textAnchor="middle" fontSize="12" fontWeight="600" fill="#c8312b">불량 카세트</text>

        {/* 웨이퍼 */}
        <g style={{ transform: `translate(${w.x}px, ${w.y}px)`, transition: 'transform 700ms cubic-bezier(.4,.1,.3,1), opacity 300ms', opacity: w.show ? 1 : 0 }}>
          <circle r="17" fill="#b9c7d3" stroke={ringColor(state, routing ?? route)} strokeWidth="3" strokeDasharray={w.dashed ? '4 3' : undefined} />
          <path d="M-12 -6 H12 M-14 0 H14 M-12 6 H12 M-6 -12 V12 M0 -14 V14 M6 -12 V12" stroke="#8193a3" strokeWidth="1" />
        </g>

        <text x="52" y="122" textAnchor="middle" fontSize="11.5" fill="#56636f">투입</text>
        <text x="200" y="134" textAnchor="middle" fontSize="11.5" fill="#56636f">촬영 위치 · 정지 게이트</text>
        <text x="334" y="122" textAnchor="middle" fontSize="11.5" fill="#56636f">분기</text>
      </svg>

      <ol className="mt-1 flex flex-wrap gap-1" aria-label="공정 단계">
        {TRACK_STEPS.map((step, i) => {
          const active = state !== null && step.states.includes(state);
          return (
            <li
              key={step.key}
              aria-current={active ? 'step' : undefined}
              className={`rounded px-1.5 py-0.5 text-[12px] tnum ${
                active ? 'bg-ink font-semibold text-white' : 'bg-[#e6ebef] text-steel'
              }`}
            >
              {i + 1}. {step.label}
            </li>
          );
        })}
        <li
          aria-current={isError ? 'step' : undefined}
          className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${isError ? 'bg-hold text-ink' : 'border border-dashed border-rule text-steel'}`}
        >
          HOLD/FAULT
        </li>
      </ol>

      <p className={`mt-2 text-[13px] ${isError ? 'font-semibold text-hold-ink' : 'text-steel'}`}>
        {state ? (
          <>
            <span className="font-semibold text-ink">{STATE_LABEL[state]}</span> — {STATE_HINT[state]}
          </>
        ) : (
          '장치 상태를 아직 받지 않았어요. 장치를 연결하면 Uno가 보고한 상태가 여기에 보여요.'
        )}
      </p>
      <p className="mt-0.5 text-[12px] text-steel">{sourceLabel}</p>
    </div>
  );
}
