// 실시간 영상 + ROI 표시 + 카메라 고르기 + 작업자 버튼(카메라 연결 · 기준 사진 등록 · 검사만 시험)
// 미리보기를 좌우 반전하지 않아 화면 좌표와 캡처 좌표가 같다.
import { useEffect, useRef, useState } from 'react';
import type { StationSnapshot } from '../../app/station';
import { getStation } from '../../app/useStation';
import type { CameraSnapshot } from '../../core/camera/camera';
import type { RunProgress } from '../../core/inspect/runner';
import type { CycleState } from '../../core/station/cycle';
import { EXPECTED_LABEL, type Expected } from '../../core/store/types';
import { HOLD_LABEL } from '../../core/vision/analyze';
import type { Roi } from '../../core/vision/image';
import { CMP_RATIO, REF_LABEL, type RefKind } from '../../core/vision/reference';
import { btn } from './kit';

function progressText(p: RunProgress | null): string | null {
  if (!p) return null;
  if (p.phase === 'stabilizing') return `정지 확인 ${p.stable}/${p.need}${p.motion !== null ? ` · 움직임 ${p.motion.toFixed(2)}` : ''}`;
  return `판정 프레임 ${p.frames.filter((f) => f.v.verdict !== 'HOLD').length}/${p.need}`;
}

function cycleText(c: CycleState): { text: string; tone: 'info' | 'warn' | 'ok' | 'bad' } {
  const head = `장치 요청 cycle ${c.cycle} · 시도 ${c.attempt}`;
  if (c.closed) return { text: `${head} — 요청이 닫혔어요 (${c.closed})`, tone: 'warn' };
  if (c.sendError) return { text: `${head} — 보내지 못했어요: ${c.sendError}`, tone: 'bad' };
  if (c.captureFailed) return { text: `${head} — 카메라 실패를 알렸어요 → 장치 HOLD`, tone: 'bad' };
  if (c.sent) {
    const s = c.sent.state;
    const what = s === 'valid' ? 'PLC 전달 래치 준비' : s === 'accepted' ? 'Uno 접수 · 래치 전' : s === 'sending' ? '전송 중' : s === 'rejected' ? `장치가 거부 (${c.sent.reason ?? ''})` : '접수 응답 없음';
    return { text: `${head} — ${c.sent.verdict} 전송 · ${what}`, tone: s === 'rejected' || s === 'no_ack' ? 'bad' : 'ok' };
  }
  if (c.stage === 'gave_up') {
    const why = c.outcome?.reason ? HOLD_LABEL[c.outcome.reason] : '판정보류';
    return { text: `${head} — 판정보류(${why}): 결과를 보내지 않았어요. 장치는 검사 시간 초과 뒤 HOLD해요`, tone: 'warn' };
  }
  if (c.stage === 'waiting_object') return { text: `${head} — 원판이 보이길 기다려요 (결과를 보내지 않아요)`, tone: 'info' };
  const p = progressText(c.progress);
  return { text: `${head} — ${c.stage === 'judging' ? '판정 중' : '정지 확인 중'}${p ? ` · ${p}` : ''}`, tone: 'info' };
}

function RoiShape({ roi, w, h, color, dashed, faint }: { roi: Roi; w: number; h: number; color: string; dashed?: boolean; faint?: boolean }) {
  const side = roi.size * h;
  const half = side / 2;
  const tick = side * 0.08;
  return (
    <g transform={`translate(${roi.cx * w} ${roi.cy * h}) rotate(${roi.rot})`} opacity={faint ? 0.45 : 1}>
      <rect x={-half} y={-half} width={side} height={side} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray={dashed ? '8 6' : undefined} />
      <circle r={half * CMP_RATIO} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="3 5" />
      {/* 위쪽 표시: 기준과 같은 방향으로 놓였는지 보기 */}
      <path d={`M ${-tick} ${-half - tick * 0.2} L 0 ${-half - tick} L ${tick} ${-half - tick * 0.2}`} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

export function VideoPanel({
  st,
  cam,
  refOpen,
  onToggleRef,
  draftRoi,
}: {
  st: StationSnapshot;
  cam: CameraSnapshot;
  refOpen: boolean;
  onToggleRef: () => void;
  draftRoi: Roi | null;
}) {
  const station = getStation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [expected, setExpected] = useState<Expected | ''>('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const v = station.camera.video;
    host.prepend(v);
    return () => v.remove();
  }, [station]);

  const live = cam.phase === 'live';
  const watching = station.busyWithDevice;
  const checkWhy = station.canCheck;
  const w = cam.width || 1280;
  const h = cam.height || 720;
  const roiColor = st.register ? '#f4b740' : watching || st.checking ? '#6fb1ff' : '#ffffff';
  const hud = st.cycle && st.cycle.cycle > 0 && !(st.cycle.closed && st.cycle.sent?.state === 'valid') ? cycleText(st.cycle) : null;
  const checkText = st.checking ? `검사만 시험 — ${progressText(st.checking.progress) ?? '새 프레임을 기다려요'} (장치로 보내지 않아요)` : null;
  const regText = st.register ? `${REF_LABEL[st.register.kind]} 기준 ${st.register.got}/${st.register.need} · ${st.register.note}` : null;
  const refs = st.settings.refs;

  return (
    <section aria-label="실시간 영상" className="rounded-lg border border-rule bg-panel">
      <div ref={hostRef} className="relative aspect-video overflow-hidden rounded-t-lg bg-well">
        {live && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
            <RoiShape roi={st.settings.roi} w={w} h={h} color={roiColor} faint={!!draftRoi} />
            {draftRoi && <RoiShape roi={draftRoi} w={w} h={h} color="#f4b740" dashed />}
          </svg>
        )}
        {live && (
          <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/55 px-2 py-0.5 text-[12px] text-white">
            ROI{draftRoi ? ' (노란 점선: 적용 전 새 위치)' : ''} · 점선 원 안을 비교해요
          </div>
        )}
        {!live && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[14px] text-[#b6c4d0]">
            {cam.phase === 'choose' ? (
              <div className="w-full max-w-md">
                <p className="font-semibold text-white">검사에 쓸 카메라를 골라 주세요</p>
                {cam.error && <p className="mt-1 text-[13px] text-hold">{cam.error}</p>}
                <ul className="mt-3 grid gap-2">
                  {cam.devices.map((d) => (
                    <li key={d.deviceId}>
                      <button type="button" className="w-full rounded-md border border-[#3b4b58] bg-[#1b252d] px-3 py-2 text-left text-white hover:border-white" onClick={() => void station.selectCamera(d.deviceId)}>
                        {d.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12px]">노트북 내장 카메라가 아니라 검사대 위 USB 카메라를 골라요.</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white">
                  {cam.phase === 'starting' ? '카메라를 여는 중이에요' : cam.phase === 'lost' ? '카메라 연결이 끊겼어요' : cam.phase === 'error' ? '카메라를 열지 못했어요' : '카메라 영상이 여기에 보여요'}
                </p>
                <p className="mt-1">
                  {cam.error ??
                    (st.mode === 'sim'
                      ? '카메라 연결을 누르면 가상 이송로 영상이 나와요. 인쇄한 시편을 실제 카메라로 보려면 실제 카메라 쓰기를 눌러요.'
                      : '카메라 연결을 누르고 권한을 허용한 뒤 검사대의 USB 카메라를 고르세요.')}
                </p>
              </div>
            )}
          </div>
        )}
        {(hud || checkText || regText) && (
          <div
            role="status"
            className={`absolute right-0 bottom-0 left-0 px-3 py-1.5 text-[13px] font-semibold ${
              regText ? 'bg-hold text-ink' : hud?.tone === 'bad' ? 'bg-ng text-white' : hud?.tone === 'warn' ? 'bg-hold text-ink' : hud?.tone === 'ok' ? 'bg-ok text-white' : 'bg-signal text-white'
            }`}
          >
            {regText ?? checkText ?? hud?.text}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule p-3">
        {live ? (
          <button type="button" className={btn.secondary} onClick={() => station.disconnectCamera()} disabled={watching}>
            카메라 해제
          </button>
        ) : (
          <button type="button" className={btn.primary} onClick={() => void station.connectCamera()} disabled={cam.phase === 'starting'}>
            카메라 연결
          </button>
        )}
        {st.mode === 'sim' && !(live && !cam.virtual) && (
          <button type="button" className={btn.small} onClick={() => void station.connectRealCamera()} disabled={cam.phase === 'starting' || watching}>
            실제 카메라 쓰기
          </button>
        )}
        {live && !cam.virtual && cam.devices.length > 1 && (
          <label className="flex items-center gap-1 text-[13px] text-steel">
            <span className="sr-only">카메라 바꾸기</span>
            <select
              className="max-w-[12rem] rounded border border-rule bg-panel px-1.5 py-1 text-[13px] text-ink"
              value={cam.deviceId ?? ''}
              disabled={watching}
              onChange={(e) => void station.selectCamera(e.target.value)}
            >
              {cam.devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className={btn.secondary} aria-expanded={refOpen} onClick={onToggleRef}>
          기준 사진 등록
        </button>
        <span className="flex items-center gap-1.5">
          <label className="flex items-center gap-1 text-[13px] text-steel">
            놓은 것
            <select className="rounded border border-rule bg-panel px-1.5 py-1 text-[13px] text-ink" value={expected} onChange={(e) => setExpected(e.target.value as Expected | '')}>
              <option value="">선택 안 함</option>
              {(Object.keys(EXPECTED_LABEL) as Expected[]).map((k) => (
                <option key={k} value={k}>
                  {EXPECTED_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={btn.secondary} disabled={!!checkWhy} title={checkWhy ?? '장치로 보내지 않고 판정만 해 봐요'} onClick={() => void station.runCheck(expected || null)}>
            {st.checking ? '검사 중…' : '검사만 시험'}
          </button>
        </span>
        <span className="ml-auto text-[12px] text-steel">
          기준:{' '}
          {(['empty', 'ok', 'ng'] as RefKind[]).map((k, i) => (
            <span key={k} className={refs[k] ? 'font-semibold text-ok' : ''}>
              {i > 0 && ' · '}
              {REF_LABEL[k]} {refs[k] ? '등록' : '미등록'}
            </span>
          ))}
        </span>
      </div>
      {(checkWhy && live && !st.checking && !st.register) || st.refsNote ? (
        <p className="border-t border-rule px-3 py-2 text-[12px] text-hold-ink">{st.refsNote ?? checkWhy}</p>
      ) : null}
    </section>
  );
}
