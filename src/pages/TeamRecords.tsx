import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCloud } from '../app/useCloud';
import { getStation } from '../app/useStation';
import { downloadText, MODE_LABEL, recordsCsv, stamp } from '../core/store/csv';
import { PLC_STATE_LABEL, type InspectionRecord, type RecordMode } from '../core/store/types';
import { CloudPanel } from '../ui/console/CloudPanel';
import { btn, VerdictChip } from '../ui/console/kit';

const PAGE_SIZE = 25;

interface Results {
  ownerId: string;
  mode: RecordMode;
  page: number;
  records: InspectionRecord[];
  total: number;
}

export default function TeamRecords() {
  const cloud = useCloud();
  const [mode, setMode] = useState<RecordMode>('live');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const canRead = Boolean(cloud.ownerId) && cloud.state !== 'auth_required' && cloud.state !== 'signed_out' && cloud.state !== 'unconfigured';
  const service = getStation().cloud;
  const visible = canRead && result?.ownerId === cloud.ownerId && result.mode === mode && result.page === page ? result : null;

  useEffect(() => {
    setPage(0);
    exportController.current?.abort();
    setExporting(false);
    setError(null);
  }, [cloud.ownerId, canRead, mode]);

  useEffect(() => {
    const ownerId = cloud.ownerId;
    if (!ownerId || !canRead) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void service.history({ mode, page, pageSize: PAGE_SIZE }, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && service.snapshot.ownerId === ownerId) {
          setResult({ ownerId, mode, page, records: data.records, total: data.total });
          setLoading(false);
        }
      },
      () => {
        if (!controller.signal.aborted && service.snapshot.ownerId === ownerId) {
          setResult(null);
          setLoading(false);
          setError('팀 기록을 읽지 못했어요. 로그인과 연결 상태를 확인하고 다시 조회해 주세요.');
        }
      },
    );
    return () => controller.abort();
  }, [service, cloud.ownerId, canRead, mode, page, refresh]);

  useEffect(() => () => exportController.current?.abort(), []);

  async function exportCsv() {
    const ownerId = service.snapshot.ownerId;
    if (!ownerId || !canRead || exporting) return;
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExporting(true);
    setError(null);
    const selectedMode = mode;
    try {
      const records = new Map<string, InspectionRecord>();
      let exportPage = 0;
      let total = 0;
      do {
        const data = await service.history({ mode: selectedMode, page: exportPage, pageSize: 200 }, controller.signal);
        if (controller.signal.aborted || service.snapshot.ownerId !== ownerId || service.snapshot.state === 'auth_required') return;
        for (const record of data.records) records.set(record.id, record);
        total = data.total;
        exportPage += 1;
        if (!data.records.length) break;
      } while (exportPage * 200 < total);
      if (controller.signal.aborted || service.snapshot.ownerId !== ownerId) return;
      downloadText(`wafer-team-${selectedMode}-${stamp()}.csv`, recordsCsv([...records.values()]));
    } catch {
      if (!controller.signal.aborted && service.snapshot.ownerId === ownerId) setError('CSV를 만들지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.');
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        setExporting(false);
      }
    }
  }

  return (
    <div className="min-h-screen pb-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule bg-panel px-5 py-4">
        <div>
          <h1 className="text-[20px] font-bold">팀 검사 기록</h1>
          <p className="mt-1 text-[13px] text-steel">같은 팀 계정으로 저장한 여러 PC의 기록을 확인해요. 실제 운전 중에는 검사 콘솔을 앞에 띄워 두세요.</p>
        </div>
        <Link to="/" className={`${btn.secondary} ml-auto`}>검사 콘솔로</Link>
      </header>
      <CloudPanel />
      <p className="mx-4 mt-3 text-[13px] text-hold-ink">실제 검사 중에는 검사 콘솔을 앞에 유지해 주세요. 팀 기록은 검사가 끝난 뒤 확인해 주세요.</p>
      <main className="m-4 rounded-lg border border-rule bg-panel" aria-labelledby="team-records-heading">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule p-4">
          <h2 id="team-records-heading" className="text-[15px] font-bold">저장한 기록</h2>
          <label className="flex items-center gap-2 text-[13px]">
            기록 모드
            <select data-testid="team-mode" value={mode} onChange={(e) => { setMode(e.target.value as RecordMode); setPage(0); }} className="rounded border border-rule bg-panel px-2 py-1">
              {(['live', 'sim', 'check'] as RecordMode[]).map((value) => <option key={value} value={value}>{MODE_LABEL[value]}</option>)}
            </select>
          </label>
          <button data-testid="team-refresh" type="button" className={btn.small} disabled={!canRead || loading} onClick={() => setRefresh((value) => value + 1)}>새로 조회</button>
          <button data-testid="team-csv" type="button" className={`${btn.secondary} ml-auto`} disabled={!canRead || exporting} onClick={() => void exportCsv()}>{exporting ? 'CSV 만드는 중이에요' : '선택한 모드 전체 CSV'}</button>
        </div>
        <div className="p-4">
          <p className="mb-3 text-[12px] text-steel">선택한 모드만 조회해요. 배출 동작 종료와 실물 수거 확인은 다른 항목이에요. 기준 사진은 이 화면에서 변경하지 않아요.</p>
          {!canRead && <p className="py-6 text-center text-steel">팀 계정으로 로그인하면 기록을 볼 수 있어요.</p>}
          {loading && <p role="status" className="py-6 text-center text-steel">팀 기록을 불러오고 있어요.</p>}
          {error && <p role="alert" className="mb-3 rounded bg-hold-soft p-3 text-hold-ink">{error}</p>}
          {visible && !loading && (
            <>
              <div className="overflow-x-auto">
                <table data-testid="team-records" className="w-full min-w-[880px] border-collapse text-left text-[13px]">
                  <thead className="bg-paper text-steel"><tr>{['요청 시각', '카메라', '판정', 'PLC 전달', '분기', '배출 동작 종료', '실물 수거'].map((label) => <th key={label} scope="col" className="border-b border-rule px-3 py-2 font-semibold">{label}</th>)}</tr></thead>
                  <tbody>
                    {visible.records.map((record) => (
                      <tr key={record.id} className="border-b border-rule last:border-0">
                        <td className="px-3 py-3 tnum"><time dateTime={record.requestedAt}>{new Date(record.requestedAt).toLocaleString('ko-KR')}</time><span className="mt-0.5 block font-mono text-[10px] text-steel" title={record.id}>{record.id.slice(0, 8)}</span></td>
                        <td className="px-3 py-3">{record.cameraLabel ?? (record.camera === 'real' ? '실제 카메라' : '가상 카메라')}</td>
                        <td className="px-3 py-3"><VerdictChip verdict={record.verdict} reason={record.holdReason} /></td>
                        <td className="px-3 py-3">{record.mode === 'check' ? '해당 없음' : PLC_STATE_LABEL[record.plc]}</td>
                        <td className="px-3 py-3">{record.route ?? '—'}</td>
                        <td className="px-3 py-3">{record.released ? '종료' : '미종료'}</td>
                        <td className="px-3 py-3">{record.collectionConfirmed ? '확인' : '미확인'}</td>
                      </tr>
                    ))}
                    {!visible.records.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-steel">이 모드에 저장된 팀 기록이 없어요.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-[13px] text-steel">전체 {visible.total}건 · {page + 1} / {Math.max(1, Math.ceil(visible.total / PAGE_SIZE))}쪽</p>
                <div className="ml-auto flex gap-2">
                  <button data-testid="team-prev" type="button" className={btn.small} disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>이전</button>
                  <button data-testid="team-next" type="button" className={btn.small} disabled={(page + 1) * PAGE_SIZE >= visible.total} onClick={() => setPage((value) => value + 1)}>다음</button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
