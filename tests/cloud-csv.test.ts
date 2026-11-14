import { describe, expect, it } from 'vitest';
import { recordsCsv } from '../src/core/store/csv';
import { inspection } from './helpers/cloud-fixtures';

function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\r' && csv[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += char;
  }
  return rows;
}

describe('team CSV spreadsheet boundary', () => {
  it('exports formula-like remote text as literal text, including hidden leading whitespace', () => {
    for (const dangerous of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(A1)', ' \t=1+1', '\r\n=1+1']) {
      const [headers, row] = parse(recordsCsv([inspection({ cameraLabel: dangerous, plcDetail: dangerous })]).slice(1));
      expect(row).toHaveLength(headers.length);
      expect(row[headers.indexOf('카메라 이름')]).toBe("'" + dangerous);
      expect(row[headers.indexOf('전달 상세')]).toBe("'" + dangerous);
    }
  });

  it('preserves ordinary labels and negative numeric measurement values', () => {
    const record = inspection({
      cameraLabel: 'USB Cam - front, "HD"',
      scores: {
        pose: { dx: -2.5, dy: 1, rot: -1.25 }, align: 0.9, gOk: 0.95, gNg: 0.2,
        gEmpty: null, lOk: 0.8, lNg: 0.1, margin: 0.7, texture: 1, sharp: 1,
        glare: 0, occlusion: 0,
      },
    });
    const [headers, row] = parse(recordsCsv([record]).slice(1));
    expect(row[headers.indexOf('카메라 이름')]).toBe(record.cameraLabel);
    expect(row[headers.indexOf('위치 보정 x')]).toBe('-2.5000');
    expect(row[headers.indexOf('회전 보정(도)')]).toBe('-1.2500');
  });
});
