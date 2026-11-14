// 기록 내보내기와 인쇄용 시편
import { describe, expect, it } from 'vitest';
import { recordsCsv } from '../src/core/store/csv';
import type { InspectionRecord } from '../src/core/store/types';
import { PRINT_BOX_MM, SPECIMENS, specimenSvgDocument, WAFER_MM } from '../src/core/specimen/specimen';

function record(p: Partial<InspectionRecord>): InspectionRecord {
  return {
    id: 'r1',
    mode: 'live',
    camera: 'real',
    expected: null,
    deviceSession: 30125,
    cycle: 1,
    capture: 1,
    frameIds: ['a', 'b', 'c'],
    verdict: 'OK',
    holdReason: null,
    attempts: 1,
    trail: ['OK'],
    method: 'ref-compare',
    version: 'test',
    calibrationVersion: 1,
    scores: null,
    requestedAt: '2026-11-14T00:00:00.000Z',
    firstFrameAt: null,
    decidedAt: null,
    cameraLabel: null,
    plc: 'valid',
    plcDetail: null,
    route: 'OK',
    released: true,
    collectionConfirmed: false,
    faultCode: null,
    closedWhy: null,
    thumb: null,
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...p,
  } as InspectionRecord;
}

function parse(csv: string): string[][] {
  // 따옴표 안의 쉼표·줄바꿈까지 처리하는 작은 파서 (시험용)
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (q) {
      if (c === '"' && csv[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\r' && csv[i + 1] === '\n') row.push(cell), rows.push(row), (row = []), (cell = ''), i++;
    else cell += c;
  }
  return rows;
}

describe('기록 CSV', () => {
  it('엑셀용 BOM·CRLF, 쉼표·따옴표·줄바꿈이 든 값도 칸이 밀리지 않는다', () => {
    const csv = recordsCsv([record({ cameraLabel: 'USB Cam, "HD"\n2' })]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const rows = parse(csv.slice(1));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(rows[0].length);
    expect(rows[1][rows[0].indexOf('카메라 이름')]).toBe('USB Cam, "HD"\n2');
  });

  it('배출 동작 종료와 실물 수거를 따로 적고, 미확인 수거를 확인으로 적지 않는다', () => {
    const [head, row] = parse(recordsCsv([record({ released: true, collectionConfirmed: false })]).slice(1));
    expect(row[head.indexOf('배출 동작 종료')]).toBe('예');
    expect(row[head.indexOf('실물 수거 확인')]).toBe('미확인');
    expect(row[head.indexOf('결과 전달')]).toBe('PLC 전달 래치 준비');
  });

  it('검사만 시험 기록은 PLC 전달 칸을 해당 없음으로 적는다', () => {
    const [head, row] = parse(recordsCsv([record({ mode: 'check', plc: 'none', route: null, released: false, expected: 'ok' })]).slice(1));
    expect(row[head.indexOf('모드')]).toBe('검사만 시험');
    expect(row[head.indexOf('결과 전달')]).toBe('해당 없음(검사만 시험)');
    expect(row[head.indexOf('실제 놓은 것(검사만 시험)')]).toBe('정상 시편');
  });
});

describe('인쇄용 시편', () => {
  it('실제 크기 SVG: 자르는 선 지름 101.6mm, 시편 안에 글자 없음', () => {
    for (const s of SPECIMENS) {
      const svg = specimenSvgDocument(s.id);
      expect(svg).toContain(`width="${PRINT_BOX_MM}mm"`);
      expect(svg).toContain(`r="${WAFER_MM / 2}"`);
      expect(svg).not.toMatch(/<text|<image|<foreignObject/);
    }
  });

  it('정상과 불량 무늬가 서로 다르다', () => {
    const docs = new Set(SPECIMENS.map((s) => specimenSvgDocument(s.id)));
    expect(docs.size).toBe(SPECIMENS.length);
  });
});
