// 기록 내보내기 (엑셀에서 한글이 깨지지 않게 BOM + CRLF)
import { HOLD_LABEL, type HoldReason } from '../vision/analyze';
import { EXPECTED_LABEL, PLC_STATE_LABEL, type InspectionRecord, type RecordMode, type StoredEvent } from './types';

export const MODE_LABEL: Record<RecordMode, string> = { live: '실제 운전', sim: '시험 모드', check: '검사만 시험' };

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function table(head: string[], rows: unknown[][]) {
  return '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const yesNo = (b: boolean) => (b ? '예' : '아니오');

export function recordsCsv(list: InspectionRecord[]): string {
  const head = [
    '기록 ID', '모드', '카메라 종류', '실제 놓은 것(검사만 시험)', '장치 세션', 'cycle', 'capture', '카메라 판정', '보류 사유',
    '시도 횟수', '시도 내역', '정상 유사도', '불량 유사도', '차이 영역 정상', '차이 영역 불량', '판정 여유', '정렬 점수',
    '위치 보정 x', '위치 보정 y', '회전 보정(도)', '무늬 진하기 비율', '선명도 비율', '반사 비율', '가림 비율',
    '요청 시각', '첫 프레임 시각', '판정 시각', '결과 전달', '전달 상세', 'PLC 분기', '배출 동작 종료', '실물 수거 확인',
    '장치 HOLD 코드', '요청 닫힘 사유', '방법', '검사기 버전', '교정 버전', '카메라 이름', '판정 프레임',
  ];
  const rows = list.map((r) => {
    const s = r.scores;
    return [
      r.id, MODE_LABEL[r.mode], r.camera === 'real' ? '실제 카메라' : '가상 카메라', r.expected ? EXPECTED_LABEL[r.expected] : '',
      r.deviceSession, r.cycle, r.capture, r.verdict, r.holdReason ? HOLD_LABEL[r.holdReason as HoldReason] : '',
      r.attempts, r.trail.join(' > '), s?.gOk, s?.gNg, s?.lOk, s?.lNg, s?.margin, s?.align,
      s?.pose.dx, s?.pose.dy, s?.pose.rot, s?.texture, s?.sharp, s?.glare, s?.occlusion,
      r.requestedAt, r.firstFrameAt, r.decidedAt, r.mode === 'check' ? '해당 없음(검사만 시험)' : PLC_STATE_LABEL[r.plc], r.plcDetail,
      r.route ?? '', yesNo(r.released), r.collectionConfirmed ? '예' : '미확인',
      r.faultCode, r.closedWhy, r.method, r.version, r.calibrationVersion, r.cameraLabel, r.frameIds.join(' '),
    ];
  });
  return table(head, rows);
}

export function eventsCsv(list: StoredEvent[]): string {
  return table(
    ['시각', '기록 ID', '종류', '내용'],
    list.map((e) => [e.createdAt, e.recordId, e.type, JSON.stringify(e.payload)]),
  );
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
