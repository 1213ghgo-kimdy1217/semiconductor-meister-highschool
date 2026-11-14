// 최근 10개 기록 · 정상/불량/보류 집계 · 기록 내보내기. 실제 운전·시험 모드·검사만 시험을 섞지 않는다.
import { useMemo, useState } from 'react';
import type { StationSnapshot } from '../../app/station';
import { getStation } from '../../app/useStation';
import { MODE_LABEL } from '../../core/store/csv';
import { EXPECTED_LABEL, PLC_STATE_LABEL, type Expected, type InspectionRecord, type RecordMode } from '../../core/store/types';
import { HOLD_LABEL } from '../../core/vision/analyze';
import { btn, Card, clock, day, VerdictChip } from './kit';

function Stats({ list, mode }: { list: InspectionRecord[]; mode: RecordMode }) {
  const c = { OK: 0, NG: 0, HOLD: 0, valid: 0, released: 0, collected: 0 };
  for (const r of list) {
    c[r.verdict]++;
    if (r.plc === 'valid') c.valid++;
    if (r.released) c.released++;
    if (r.collectionConfirmed) c.collected++;
  }
  return (
    <div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-ok-soft py-2">
          <dt className="text-[12px] text-ok">정상</dt>
          <dd className="text-[22px] font-bold tnum">{c.OK}</dd>
        </div>
        <div className="rounded-md bg-ng-soft py-2">
          <dt className="text-[12px] text-ng">불량</dt>
          <dd className="text-[22px] font-bold tnum">{c.NG}</dd>
        </div>
        <div className="rounded-md bg-hold-soft py-2">
          <dt className="text-[12px] text-hold-ink">판정보류</dt>
          <dd className="text-[22px] font-bold tnum">{c.HOLD}</dd>
        </div>
      </dl>
      <p className="mt-1 text-[12px] text-steel">카메라 판정 기준 · {MODE_LABEL[mode]} {list.length}건</p>
      {mode !== 'check' && (
        <dl className="mt-3 grid gap-1 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-steel">PLC 전달 래치</dt>
            <dd className="font-semibold tnum">{c.valid}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-steel">배출 동작 종료</dt>
            <dd className="font-semibold tnum">{c.released}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-steel">실물 수거 확인</dt>
            <dd className="font-semibold tnum">{c.collected}</dd>
          </div>
          <dd className="text-[12px] text-steel">수거 확인은 HMI가 해요. 웹은 수거를 확인할 수 없어, 배출 동작이 끝난 것만으로 수거 통계에 넣지 않아요.</dd>
        </dl>
      )}
    </div>
  );
}

const CONF_ROWS: Expected[] = ['ok', 'ng', 'empty', 'occluded', 'other'];

function Confusion({ list }: { list: InspectionRecord[] }) {
  const rows = CONF_ROWS.map((e) => {
    const m = { OK: 0, NG: 0, HOLD: 0 };
    for (const r of list) if (r.expected === e) m[r.verdict]++;
    return { e, ...m, n: m.OK + m.NG + m.HOLD };
  }).filter((r) => r.n > 0);
  const unlabeled = list.filter((r) => !r.expected).length;
  return (
    <div className="mt-4">
      <h3 className="text-[13px] font-bold">재촬영 혼동 표</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-[12px] text-steel">‘놓은 것’을 고르고 검사만 시험을 하면 여기에 쌓여요.</p>
      ) : (
        <table className="mt-1 w-full text-center text-[13px] tnum">
          <thead>
            <tr className="text-[12px] text-steel">
              <th scope="col" className="py-1 text-left font-normal">
                놓은 것 \ 판정
              </th>
              <th scope="col" className="font-normal text-ok">
                정상
              </th>
              <th scope="col" className="font-normal text-ng">
                불량
              </th>
              <th scope="col" className="font-normal text-hold-ink">
                보류
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const wrong = (k: 'OK' | 'NG' | 'HOLD') => (r.e === 'ok' && k === 'NG') || (r.e === 'ng' && k === 'OK') || ((r.e === 'empty' || r.e === 'occluded') && k !== 'HOLD');
              return (
                <tr key={r.e} className="border-t border-rule">
                  <th scope="row" className="py-1 text-left font-normal">
                    {EXPECTED_LABEL[r.e]}
                  </th>
                  {(['OK', 'NG', 'HOLD'] as const).map((k) => (
                    <td key={k} className={r[k] && wrong(k) ? 'font-bold text-ng' : ''}>
                      {r[k]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {unlabeled > 0 && <p className="mt-1 text-[12px] text-steel">‘놓은 것’을 고르지 않은 시험 {unlabeled}건은 표에서 뺐어요.</p>}
      <p className="mt-1 text-[12px] text-steel">빨간 숫자는 오판정(정상↔불량, 빈 자리·가림에서 OK/NG)이에요.</p>
    </div>
  );
}

function ExportMenu() {
  const station = getStation();
  const items: [string, () => void][] = [
    ['실제 운전 기록 CSV', () => void station.exportCsv('live')],
    ['시험 모드 기록 CSV', () => void station.exportCsv('sim')],
    ['검사만 시험(재촬영) CSV', () => void station.exportCsv('check')],
    ['전체 기록 CSV', () => void station.exportCsv('all')],
    ['이벤트·통신 기록 CSV', () => void station.exportEvents()],
  ];
  return (
    <details className="relative mt-3">
      <summary className={`${btn.secondary} w-full cursor-pointer list-none`}>기록 내보내기</summary>
      <ul className="absolute right-0 bottom-full z-10 mb-1 grid w-full gap-px overflow-hidden rounded-md border border-rule bg-rule shadow-lg">
        {items.map(([label, fn]) => (
          <li key={label}>
            <button
              type="button"
              className="w-full bg-panel px-3 py-2 text-left text-[13px] hover:bg-paper"
              onClick={(e) => {
                fn();
                (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
              }}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function RecordsPanel({ st }: { st: StationSnapshot }) {
  const [tab, setTab] = useState<RecordMode | null>(null);
  const mode: RecordMode = tab ?? (st.mode === 'sim' ? 'sim' : 'live');
  const list = useMemo(() => st.records.filter((r) => r.mode === mode), [st.records, mode]);
  const recent = list.slice(0, 10);

  return (
    <section aria-label="기록" className="grid gap-4 px-4 pb-6 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <Card
        id="records-title"
        title="최근 10개 기록"
        right={
          <div role="tablist" aria-label="기록 종류" className="flex rounded-md border border-rule p-0.5 text-[13px]">
            {(['live', 'sim', 'check'] as RecordMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setTab(m)}
                className={`rounded px-2.5 py-0.5 ${mode === m ? 'bg-ink font-semibold text-white' : 'text-steel hover:text-ink'}`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        }
      >
        {recent.length === 0 ? (
          <p className="text-[14px] text-steel">{MODE_LABEL[mode]} 기록이 아직 없어요.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-steel">
                  <th scope="col" className="py-1 pr-2 font-normal">근거</th>
                  <th scope="col" className="pr-2 font-normal">시각</th>
                  <th scope="col" className="pr-2 font-normal">{mode === 'check' ? '놓은 것' : 'cycle'}</th>
                  <th scope="col" className="pr-2 font-normal">카메라 판정</th>
                  <th scope="col" className="pr-2 font-normal">{mode === 'check' ? '시도' : 'PLC 전달'}</th>
                  {mode !== 'check' && <th scope="col" className="pr-2 font-normal">배출 동작</th>}
                  {mode !== 'check' && <th scope="col" className="font-normal">실물 수거</th>}
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-rule align-middle">
                    <td className="py-1.5 pr-2">
                      {r.thumb ? <img src={r.thumb} alt="" className="size-8 rounded bg-well" /> : <span className="inline-block size-8 rounded bg-paper" />}
                    </td>
                    <td className="pr-2 font-mono text-[12px] whitespace-nowrap tnum">
                      <span className="text-steel">{day(r.requestedAt)}</span> {clock(r.requestedAt)}
                    </td>
                    <td className="pr-2 tnum">{mode === 'check' ? (r.expected ? EXPECTED_LABEL[r.expected] : '—') : (r.cycle ?? '—')}</td>
                    <td className="pr-2">
                      <VerdictChip verdict={r.verdict} reason={r.holdReason} />
                    </td>
                    <td className="pr-2 text-[12px]">{mode === 'check' ? r.trail.map((t) => (t in HOLD_LABEL ? HOLD_LABEL[t as keyof typeof HOLD_LABEL] : t)).join(' › ') : PLC_STATE_LABEL[r.plc]}</td>
                    {mode !== 'check' && <td className="pr-2 text-[12px]">{r.released ? `종료${r.route ? ` · ${r.route}` : ''}` : r.route ? `${r.route} 분기` : '—'}</td>}
                    {mode !== 'check' && <td className="text-[12px]">{r.collectionConfirmed ? '확인됨' : '미확인'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card id="stats-title" title={`집계 · ${MODE_LABEL[mode]}`}>
        <Stats list={list} mode={mode} />
        {mode === 'check' && <Confusion list={list} />}
        <ExportMenu />
      </Card>
    </section>
  );
}
