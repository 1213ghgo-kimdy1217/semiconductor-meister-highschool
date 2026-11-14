// 상단: 제목 · 운전/시험 모드 · 카메라 / Uno USB / PLC 요청 / 기록 저장 상태 (지시서 4장)
// USB가 열렸다고 PLC까지 연결됐다고 표시하지 않는다.
import { Link } from 'react-router';
import { SERIAL_SUPPORT_MSG, type Mode, type StationSnapshot } from '../../app/station';
import { getStation, useNow } from '../../app/useStation';
import { PLC_INTERFACE_VERIFIED } from '../../config/hardware';
import { cameraSupport, type CameraSnapshot } from '../../core/camera/camera';
import type { LinkSnapshot } from '../../core/protocol/link';
import { faultLabel, isPhase, PHASE_LABEL } from '../../core/protocol/v1';
import type { StoreStatus } from '../../core/store/local';
import { serialSupport } from '../../core/transport/serial';
import { StatusCell, type Tone } from '../Lamp';
import { ago, btn } from './kit';

interface Cell {
  tone: Tone;
  value: string;
  detail?: string;
}

function cameraCell(c: CameraSnapshot, mode: Mode): Cell {
  const sup = cameraSupport();
  if (c.phase === 'off' && sup !== 'ok') {
    return {
      tone: 'bad',
      value: '이 창에서 카메라를 쓸 수 없어요',
      detail: sup === 'insecure' ? 'https 주소 또는 이 PC의 localhost에서 열어 주세요' : 'PC의 Chrome 또는 Edge에서 열어 주세요',
    };
  }
  switch (c.phase) {
    case 'off':
      return { tone: 'off', value: '연결 안 됨', detail: mode === 'sim' ? '카메라 연결을 누르면 가상 카메라를 켜요' : '영상 아래 카메라 연결을 눌러 주세요' };
    case 'starting':
      return { tone: 'busy', value: '카메라 여는 중', detail: '권한 창이 뜨면 허용해 주세요' };
    case 'choose':
      return { tone: 'warn', value: '검사 카메라를 골라 주세요', detail: c.error ?? '영상 자리의 목록에서 골라요' };
    case 'live':
      return {
        tone: 'ok',
        value: c.label ?? '카메라',
        detail: `${c.width}×${c.height}${c.fps ? ` · ${c.fps}fps` : ''}${c.virtual ? ' · 시험용 가상 영상' : ''}`,
      };
    case 'lost':
      return { tone: 'bad', value: '카메라 끊김', detail: c.error ?? 'USB를 확인하고 다시 연결해 주세요' };
    case 'error':
      return { tone: 'bad', value: '카메라 연결 실패', detail: c.error ?? undefined };
  }
}

function unoCell(l: LinkSnapshot, mode: Mode, now: number): Cell {
  if (l.phase === 'closed' && mode === 'live') {
    const sup = serialSupport();
    if (sup !== 'ok') return { tone: 'bad', value: 'USB 연결을 쓸 수 없어요', detail: SERIAL_SUPPORT_MSG[sup] };
  }
  switch (l.phase) {
    case 'closed':
      return { tone: 'off', value: '연결 안 됨', detail: l.detail ?? (mode === 'sim' ? '장치 연결을 누르면 가상 Uno에 붙어요' : '장치 연결을 누르면 포트를 골라요') };
    case 'opening':
      return { tone: 'busy', value: '포트 여는 중', detail: l.label ?? undefined };
    case 'waiting_boot':
      return { tone: 'busy', value: '보드 시작 확인 중', detail: '포트를 열면 Uno가 다시 시작될 수 있어 BOOT를 기다려요' };
    case 'hello':
      return { tone: 'busy', value: '접속 등록 중 (HELLO)', detail: `세션 ${l.session}` };
    case 'online': {
      if (l.foreignSession !== null)
        return { tone: 'warn', value: '다른 세션이 등록돼 있어요', detail: `장치 세션 ${l.foreignSession} — 다른 탭이나 PC가 연결했을 수 있어요` };
      const rx = l.lastRxAt ? ` · 응답 ${ago(now - l.lastRxAt)}` : '';
      return { tone: 'ok', value: `연결됨 · 세션 ${l.session}`, detail: `${l.boot ? `${l.boot.build} · ${l.boot.autostart}` : 'BOOT 없이 응답한 보드'}${rx}` };
    }
    case 'silent':
      return { tone: 'warn', value: 'Uno 응답 끊김', detail: l.detail ?? '케이블과 보드 전원을 확인해 주세요' };
    case 'no_response':
      return { tone: 'bad', value: 'Uno 응답 없음', detail: l.detail ?? 'Arduino 시리얼 모니터를 닫고, 펌웨어·115200 baud를 확인해 주세요' };
    case 'lost':
      return { tone: 'bad', value: 'USB 케이블 단절', detail: l.detail ?? '장치는 PC 연결 시간 초과로 HOLD해요' };
  }
}

function plcCell(l: LinkSnapshot, mode: Mode): Cell {
  const unverified = mode === 'sim' ? '가상 PLC (시험 모드)' : PLC_INTERFACE_VERIFIED ? 'PLC 인터페이스 시운전 확인됨' : 'PLC 인터페이스 미확인';
  const st = l.status;
  if (l.phase !== 'online' || !st) return { tone: 'off', value: unverified, detail: 'Uno가 장치 상태(STATUS)를 아직 보고하지 않았어요' };
  const phase = isPhase(st.phase) ? PHASE_LABEL[st.phase] : st.phase;
  if (st.phase === 'HOLD_FAULT') return { tone: 'bad', value: `HOLD · ${faultLabel(st.faultCode)}`, detail: `${unverified} · 복구는 HMI에서 해요` };
  if (!st.configured) return { tone: 'warn', value: '운전 잠김 · 교정값 미확인', detail: `${unverified} · configured=0` };
  if (l.request?.open) return { tone: 'busy', value: `검사 요청 · cycle ${l.request.cycle}`, detail: `${unverified} · Uno가 PLC 110 요청을 알렸어요` };
  if (st.phase === 'NEED_HOME') return { tone: 'warn', value: '원점 복귀 필요', detail: `${unverified} · HMI에서 원점 복귀해요` };
  return { tone: 'off', value: 'PLC 검사 요청 대기', detail: `${unverified} · 장치 단계: ${phase}` };
}

function storeCell(s: StoreStatus, count: number): Cell {
  const local = '이 PC 브라우저에만 저장 — 팀 공유 저장 연결 전';
  switch (s.state) {
    case 'opening':
      return { tone: 'busy', value: '저장소 여는 중', detail: local };
    case 'ok':
      return { tone: 'ok', value: count ? `저장됨 · ${count}건` : '준비됨 · 기록 0건', detail: local };
    case 'saving':
      return { tone: 'busy', value: `저장 중 · 대기 ${s.pending}건`, detail: local };
    case 'retrying':
      return { tone: 'warn', value: `저장 실패 · 대기 ${s.pending}건`, detail: `${s.error ?? ''} — 3초마다 다시 시도해요. 검사는 계속돼요` };
    case 'unavailable':
      return { tone: 'bad', value: '저장 불가 · 화면에만 있음', detail: `${s.error ?? ''} — 기록 내보내기로 CSV를 받아 두세요` };
  }
}

export function TopBar({ st, cam, link, store }: { st: StationSnapshot; cam: CameraSnapshot; link: LinkSnapshot; store: StoreStatus }) {
  const now = useNow(1000);
  const station = getStation();
  const c = cameraCell(cam, st.mode);
  const u = unoCell(link, st.mode, now);
  const p = plcCell(link, st.mode);
  const s = storeCell(store, st.records.length);
  const open = link.phase !== 'closed' && link.phase !== 'lost';

  const switchMode = (m: Mode) => {
    if (m === st.mode) return;
    if ((open || cam.phase === 'live') && !window.confirm('모드를 바꾸면 카메라와 장치 연결을 닫아요. 바꿀까요?')) return;
    station.setMode(m);
  };

  const toggleDevice = () => {
    if (open) {
      if (link.request?.open && !window.confirm('검사 요청을 처리하는 중이에요. 연결을 끊으면 장치가 PC 연결 시간 초과로 HOLD해요. 끊을까요?')) return;
      void station.disconnectDevice();
    } else void station.connectDevice();
  };

  return (
    <header className="border-b border-rule bg-panel">
      {st.mode === 'sim' && (
        <div className="test-band px-4 py-1">
          <p className="mx-auto w-fit rounded bg-ink px-3 py-0.5 text-center text-[13px] font-bold text-white">
            시험 모드 — 실제 포트를 열지 않고 PLC 판정 신호를 내보내지 않아요. 기록은 실제 운전 통계와 따로 쌓여요.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold">인쇄 이미지 기반 모형 웨이퍼 검사</h1>
          <p className="text-[12px] text-steel">4인치(지름 101.6mm) 모형 · 한 장씩 투입 · 실제 반도체 미세 결함 검사가 아니에요</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Link to="/print" target="_blank" rel="noopener" className="text-[13px] font-semibold text-signal underline-offset-2 hover:underline">
            인쇄용 시편<span className="sr-only"> (새 탭)</span>
          </Link>
          <div role="group" aria-label="운전 모드" className="flex rounded-md border border-rule p-0.5 text-[13px]">
            {(['live', 'sim'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={st.mode === m}
                onClick={() => switchMode(m)}
                className={`rounded px-3 py-1 ${st.mode === m ? (m === 'sim' ? 'bg-hold font-bold text-ink' : 'bg-ink font-semibold text-white') : 'text-steel hover:text-ink'}`}
              >
                {m === 'live' ? '실제 장치' : '시험 모드'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-px border-t border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4 [&>*]:bg-panel">
        <StatusCell tone={c.tone} title="카메라" value={c.value} detail={c.detail} />
        <StatusCell
          tone={st.deviceError && !open ? 'bad' : u.tone}
          title={st.mode === 'sim' ? 'Uno USB (가상)' : 'Uno USB'}
          value={u.value}
          detail={st.deviceError ?? u.detail}
          action={
            <button type="button" className={open ? btn.small : btn.primary + ' !px-2.5 !py-1 !text-[13px]'} onClick={toggleDevice} disabled={link.phase === 'opening'}>
              {open ? '연결 해제' : '장치 연결'}
            </button>
          }
        />
        <StatusCell tone={p.tone} title={st.mode === 'sim' ? 'PLC 요청 · 운전 허가 (가상)' : 'PLC 요청 · 운전 허가'} value={p.value} detail={p.detail} />
        <StatusCell tone={s.tone} title="기록 저장" value={s.value} detail={s.detail} />
      </div>
    </header>
  );
}
