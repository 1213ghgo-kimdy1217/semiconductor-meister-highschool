// 마지막 판정 · 근거 영역 · 점수(확률 아님) · 카메라 판정 / PLC 전달 / 배출 동작 / 실물 수거를 따로 표시
import { useEffect, useRef } from 'react';
import type { LastShown, StationSnapshot } from '../../app/station';
import { EXPECTED_LABEL, PLC_STATE_LABEL, type InspectionRecord } from '../../core/store/types';
import { HOLD_LABEL, type FrameDetail, type Thresholds } from '../../core/vision/analyze';
import { evidenceImage, type EvidenceLayer } from '../evidence';
import { Card, clock, num, VerdictChip } from './kit';

function Evidence({ detail, layer, label }: { detail: FrameDetail; layer: EvidenceLayer; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = c.height = detail.n;
    c.getContext('2d')!.putImageData(evidenceImage(detail, layer), 0, 0);
  }, [detail, layer]);
  return (
    <figure className="min-w-0">
      <canvas ref={ref} className="aspect-square w-full rounded bg-well" role="img" aria-label={label} />
      <figcaption className="mt-1 text-center text-[12px] text-steel">{label}</figcaption>
    </figure>
  );
}

function expectedMatch(last: LastShown): string | null {
  if (!last.expected) return null;
  const v = last.outcome.verdict;
  const want = last.expected === 'ok' ? 'OK' : last.expected === 'ng' ? 'NG' : 'HOLD';
  if (last.expected === 'other') return `놓은 것: ${EXPECTED_LABEL.other}`;
  return `놓은 것: ${EXPECTED_LABEL[last.expected]} → ${v === want ? '맞음' : '다름 (혼동 기록)'}`;
}

function Delivery({ rec }: { rec: InspectionRecord }) {
  const plcOk = rec.plc === 'valid';
  const steps: { name: string; value: string; tone: 'ok' | 'warn' | 'off' | 'bad' }[] = [
    { name: '카메라 판정', value: rec.verdict === 'HOLD' ? `판정보류${rec.holdReason ? ` (${HOLD_LABEL[rec.holdReason]})` : ''}` : rec.verdict, tone: rec.verdict === 'HOLD' ? 'warn' : 'ok' },
    { name: 'PLC 전달', value: PLC_STATE_LABEL[rec.plc], tone: plcOk ? 'ok' : rec.plc === 'rejected' || rec.plc === 'no_ack' || rec.plc === 'capture_failed' ? 'bad' : rec.plc === 'accepted' || rec.plc === 'sending' ? 'warn' : 'off' },
    {
      name: '분기 · 배출 동작',
      value: rec.released ? `배출 동작 종료${rec.route ? ` · ${rec.route} 경로` : ''}` : rec.route ? `${rec.route} 경로 분기 완료` : '아직 없음',
      tone: rec.released ? 'ok' : rec.route ? 'warn' : 'off',
    },
    { name: '실물 수거', value: rec.collectionConfirmed ? '확인됨' : '미확인 — HMI 확인 필요', tone: rec.collectionConfirmed ? 'ok' : 'off' },
  ];
  const dot = { ok: 'bg-ok', warn: 'bg-hold', off: 'bg-[#b8c1c9]', bad: 'bg-ng' };
  return (
    <ol className="mt-3 grid gap-1 rounded-md border border-rule p-2.5 text-[13px]">
      {steps.map((s) => (
        <li key={s.name} className="flex items-baseline gap-2">
          <span aria-hidden className={`inline-block size-2 shrink-0 translate-y-[-1px] rounded-full ${dot[s.tone]}`} />
          <span className="w-28 shrink-0 text-steel">{s.name}</span>
          <span className="min-w-0 font-semibold">{s.value}</span>
        </li>
      ))}
      {rec.faultCode && rec.faultCode !== 'NONE' && <li className="pl-4 text-ng">장치 HOLD 코드: {rec.faultCode}</li>}
    </ol>
  );
}

function Scores({ last, th }: { last: LastShown; th: Thresholds }) {
  const s = last.outcome.decisive?.frame.v.scores;
  if (!s) return null;
  const rows: [string, string, string][] = [
    ['정상 유사도', num(s.gOk), `일치 ≥ ${th.minMatch}`],
    ['불량 유사도', num(s.gNg), `일치 ≥ ${th.minMatch}`],
    ['차이 영역: 정상 / 불량', `${num(s.lOk)} / ${num(s.lNg)}`, ''],
    ['판정 여유', num(s.margin), `≥ ${th.minMargin}`],
    ['정렬 점수', num(s.align), ''],
    ['위치·회전 보정', `${num(s.pose.dx, 3)}, ${num(s.pose.dy, 3)} · ${num(s.pose.rot, 1)}°`, ''],
    ['무늬 진하기 · 선명도', `${num(s.texture, 2)} · ${num(s.sharp, 2)}`, `선명도 ≥ ${th.minSharp}`],
    ['반사 · 가림 비율', `${num(s.glare)} · ${num(s.occlusion)}`, `≤ ${th.maxGlare} · ≤ ${th.maxOcclusion}`],
  ];
  return (
    <table className="mt-3 w-full text-[12.5px]">
      <caption className="mb-1 text-left text-[12px] text-steel">결정 프레임 점수 — 확률이 아니라 기준과의 유사도·판정 여유예요</caption>
      <tbody>
        {rows.map(([k, v, t]) => (
          <tr key={k} className="border-t border-rule/70">
            <th scope="row" className="py-1 pr-2 text-left font-normal text-steel">
              {k}
            </th>
            <td className="py-1 font-mono tnum">{v}</td>
            <td className="py-1 pl-2 text-right text-[11.5px] text-steel">{t}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VerdictPanel({ st }: { st: StationSnapshot }) {
  const last = st.last;
  const rec = last ? st.records.find((r) => r.id === last.recordId) : undefined;
  const o = last?.outcome;
  const match = last ? expectedMatch(last) : null;

  return (
    <Card
      id="verdict-title"
      title="마지막 판정"
      right={
        last && (
          <span className={`rounded px-2 py-0.5 text-[12px] font-semibold ${last.source === 'check' ? 'bg-paper text-steel' : 'bg-[#e5eef9] text-signal'}`}>
            {last.source === 'check' ? '검사만 시험 — 장치로 보내지 않음' : `장치 요청 cycle ${last.cycle}`}
          </span>
        )
      }
    >
      {!last || !o ? (
        <p className="py-6 text-center text-[14px] text-steel">아직 판정이 없어요. 기준 사진을 등록한 뒤 검사만 시험으로 먼저 확인해 보세요.</p>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <VerdictChip verdict={o.verdict} reason={o.reason} size="lg" />
            <div className="text-[12px] text-steel">
              <div>판정 {clock(new Date(performance.timeOrigin + o.decidedAt).toISOString())}</div>
              <div>
                프레임 {o.frames.length}장 · {o.firstFrameAt !== null ? `첫 프레임까지 ${Math.round(o.firstFrameAt - o.requestedAt)}ms` : '프레임 없음'}
              </div>
            </div>
          </div>
          {match && <p className="mt-2 text-[13px] font-semibold">{match}</p>}
          {o.verdict === 'HOLD' && (
            <p className="mt-2 text-[13px] text-hold-ink">
              판정보류는 불량으로 바꾸지 않아요.{last.source === 'device' ? ' 장치에 결과를 보내지 않아 방출하지 않아요.' : ''}
            </p>
          )}
          {o.frames.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1" aria-label="프레임별 결과">
              {o.frames.map((f) => (
                <span key={f.id} title={f.id} className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${f.v.verdict === 'OK' ? 'bg-ok-soft text-ok' : f.v.verdict === 'NG' ? 'bg-ng-soft text-ng' : 'bg-hold-soft text-hold-ink'}`}>
                  {f.v.verdict === 'HOLD' ? (f.v.reason ? HOLD_LABEL[f.v.reason] : 'HOLD') : f.v.verdict}
                </span>
              ))}
            </div>
          )}
          {last.detail ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Evidence detail={last.detail} layer="view" label="판정 프레임 (밝기 보정)" />
              <Evidence detail={last.detail} layer="diff" label="근거: 빨강 = 기준과 다른 곳" />
            </div>
          ) : (
            <p className="mt-3 rounded bg-paper p-2 text-[12px] text-steel">근거 그림이 없어요 (물체 없음·카메라 실패처럼 비교 전에 멈춘 경우).</p>
          )}
          {last.detail?.disc && <p className="mt-1 text-[12px] text-steel">파란 점: 정상·불량 기준이 서로 다른 곳 (차이 영역 점수를 보는 곳)</p>}
          <Scores last={last} th={st.settings.thresholds} />
          {rec && last.source === 'device' && <Delivery rec={rec} />}
        </div>
      )}
    </Card>
  );
}
