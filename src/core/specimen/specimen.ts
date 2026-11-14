// 인쇄용 정상·불량 시편. 같은 도형 목록으로 SVG(인쇄), 캔버스(가상 카메라), 점 단위 계산(자동 시험)을 만든다.
// 시편 안에는 글자·QR이 없다. 판정은 무늬 비교로만 한다.

export const WAFER_MM = 101.6;
const R = WAFER_MM / 2;

export type SpecimenId = 'normal-a' | 'defect-a' | 'defect-b' | 'defect-c';

export interface SpecimenInfo {
  id: SpecimenId;
  kind: 'normal' | 'defect';
  title: string;
  note: string;
}

export const SPECIMENS: SpecimenInfo[] = [
  { id: 'normal-a', kind: 'normal', title: '정상 시편 A', note: '칩 격자와 정렬 표시만 있는 기준 무늬' },
  { id: 'defect-a', kind: 'defect', title: '불량 시편 A (권장)', note: '긴 긁힘 + 타버린 칩 군집 + 빠진 칩 2개 — 처음 시연용' },
  { id: 'defect-b', kind: 'defect', title: '불량 시편 B', note: '넓은 얼룩 + 짧은 긁힘' },
  { id: 'defect-c', kind: 'defect', title: '불량 시편 C (어려움)', note: '빠진 칩 1개 + 작은 점 — 검출 한계 확인용' },
];

type Pt = [number, number];

export type Prim =
  | { t: 'disc'; cx: number; cy: number; r: number; fill: string }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { t: 'tri'; pts: [Pt, Pt, Pt]; fill: string }
  | { t: 'line'; pts: Pt[]; w: number; fill: string }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rot: number; fill: string; alpha: number };

const C = {
  base: '#c7ced6',
  ring: '#aab3bd',
  die: '#6f7c89',
  core: '#47525e',
  pad: '#e0e5ea',
  markBg: '#2c3640',
  mark: '#eef1f4',
  scratch: '#14191e',
  burnt: '#222930',
  missing: '#e9edf0',
  stain: '#3a2c1e',
  notch: '#ffffff',
};

const PITCH = 9;
const DIE = 8;
const EDGE = 3.5;

function dieCenters(): { i: number; j: number; x: number; y: number }[] {
  const out: { i: number; j: number; x: number; y: number }[] = [];
  const lim = R - EDGE;
  for (let j = -6; j <= 5; j++) {
    for (let i = -6; i <= 5; i++) {
      const x = (i + 0.5) * PITCH;
      const y = (j + 0.5) * PITCH;
      const h = DIE / 2;
      const far = Math.hypot(Math.abs(x) + h, Math.abs(y) + h);
      if (far <= lim) out.push({ i, j, x, y });
    }
  }
  return out;
}

const MARKS = new Set(['-4,1', '3,-3']);

function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 10): Pt[] {
  const pts: Pt[] = [];
  for (let s = 0; s <= steps; s++) {
    const a = ((a0 + ((a1 - a0) * s) / steps) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** 시편 도형 목록 (단위 mm, 원점 = 웨이퍼 중심, y는 아래로) */
export function specimenPrims(id: SpecimenId): Prim[] {
  const burnt = new Set<string>();
  const missing = new Set<string>();
  const extra: Prim[] = [];
  if (id === 'defect-a') {
    for (const d of dieCenters()) if (Math.hypot(d.x + 22, d.y - 22) < 12.5) burnt.add(`${d.i},${d.j}`);
    missing.add('1,3');
    missing.add('2,3');
    extra.push({ t: 'line', pts: arc(-34, 40, 72, -78, -22, 12), w: 1.7, fill: C.scratch });
  } else if (id === 'defect-b') {
    extra.push({ t: 'ellipse', cx: 14, cy: 12, rx: 17, ry: 10, rot: 25, fill: C.stain, alpha: 0.6 });
    extra.push({ t: 'line', pts: [[-36, -9], [-24, -15], [-12, -19], [-2, -20]], w: 1.3, fill: C.scratch });
  } else if (id === 'defect-c') {
    missing.add('-1,-2');
    extra.push({ t: 'disc', cx: 22, cy: -21, r: 1.3, fill: C.scratch });
    extra.push({ t: 'disc', cx: 25, cy: -18.5, r: 0.9, fill: C.scratch });
  }

  const prims: Prim[] = [
    { t: 'disc', cx: 0, cy: 0, r: R, fill: C.ring },
    { t: 'disc', cx: 0, cy: 0, r: R - 2.2, fill: C.base },
  ];
  for (const d of dieCenters()) {
    const key = `${d.i},${d.j}`;
    const x = d.x - DIE / 2;
    const y = d.y - DIE / 2;
    if (missing.has(key)) {
      prims.push({ t: 'rect', x, y, w: DIE, h: DIE, fill: C.missing });
      continue;
    }
    if (burnt.has(key)) {
      prims.push({ t: 'rect', x, y, w: DIE, h: DIE, fill: C.burnt });
      continue;
    }
    if (MARKS.has(key)) {
      prims.push({ t: 'rect', x, y, w: DIE, h: DIE, fill: C.markBg });
      prims.push({ t: 'rect', x: x + 1, y: y + DIE / 2 - 0.6, w: DIE - 2, h: 1.2, fill: C.mark });
      prims.push({ t: 'rect', x: x + DIE / 2 - 0.6, y: y + 1, w: 1.2, h: DIE - 2, fill: C.mark });
      continue;
    }
    prims.push({ t: 'rect', x, y, w: DIE, h: DIE, fill: C.die });
    prims.push({ t: 'rect', x: x + 0.8, y: y + 0.8, w: 3.8, h: 3.0, fill: C.core });
    for (let p = 0; p < 4; p++) prims.push({ t: 'rect', x: x + 1.0 + p * 1.7, y: y + 6.3, w: 0.9, h: 0.9, fill: C.pad });
  }
  prims.push(...extra);
  // 방향 표시 노치 (6시 방향)
  prims.push({ t: 'tri', pts: [[-2.2, R + 0.2], [2.2, R + 0.2], [0, R - 3]], fill: C.notch });
  return prims;
}

// ---------- SVG (인쇄) ----------

function svgPrim(p: Prim): string {
  const f = (n: number) => Number(n.toFixed(3));
  switch (p.t) {
    case 'disc':
      return `<circle cx="${f(p.cx)}" cy="${f(p.cy)}" r="${f(p.r)}" fill="${p.fill}"/>`;
    case 'rect':
      return `<rect x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}" fill="${p.fill}"/>`;
    case 'tri':
      return `<polygon points="${p.pts.map((q) => `${f(q[0])},${f(q[1])}`).join(' ')}" fill="${p.fill}"/>`;
    case 'line':
      return `<polyline points="${p.pts.map((q) => `${f(q[0])},${f(q[1])}`).join(' ')}" fill="none" stroke="${p.fill}" stroke-width="${f(p.w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'ellipse':
      return `<ellipse cx="${f(p.cx)}" cy="${f(p.cy)}" rx="${f(p.rx)}" ry="${f(p.ry)}" transform="rotate(${p.rot} ${f(p.cx)} ${f(p.cy)})" fill="${p.fill}" fill-opacity="${p.alpha}"/>`;
  }
}

/** 시편 본체 SVG 조각 (원점 중심, 지름 diameterMm로 맞춤) */
export function specimenSvgGroup(id: SpecimenId, diameterMm = WAFER_MM): string {
  const k = diameterMm / WAFER_MM;
  return `<g transform="scale(${k})">${specimenPrims(id).map(svgPrim).join('')}</g>`;
}

/** 인쇄 한 장 크기: 시편 지름 + 자르기 표시 여백 (mm) */
export const PRINT_BOX_MM = 112;

/** 자르는 선(시편 바깥 테두리)과 상하좌우 맞춤 표시. 시편 무늬 밖에만 그린다. */
export function cutGuideSvg(): string {
  const ticks = [0, 90, 180, 270]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const p = (r: number) => `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
      return `<polyline points="${p(R + 1.5)} ${p(R + 4.5)}" stroke="#15202b" stroke-width="0.25" fill="none"/>`;
    })
    .join('');
  return `<circle cx="0" cy="0" r="${R}" fill="none" stroke="#15202b" stroke-width="0.2"/>${ticks}`;
}

/** 실제 크기 SVG 파일 (다른 프로그램에서 100%로 인쇄할 때) */
export function specimenSvgDocument(id: SpecimenId): string {
  const h = PRINT_BOX_MM / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PRINT_BOX_MM}mm" height="${PRINT_BOX_MM}mm" viewBox="${-h} ${-h} ${PRINT_BOX_MM} ${PRINT_BOX_MM}">${specimenSvgGroup(id)}${cutGuideSvg()}</svg>
`;
}

// ---------- 캔버스 (가상 카메라) ----------

export function drawSpecimen(ctx: CanvasRenderingContext2D, id: SpecimenId, cx: number, cy: number, pxPerMm: number, rotDeg: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.scale(pxPerMm, pxPerMm);
  for (const p of specimenPrims(id)) {
    ctx.globalAlpha = p.t === 'ellipse' ? p.alpha : 1;
    ctx.fillStyle = p.fill;
    ctx.strokeStyle = p.fill;
    ctx.beginPath();
    switch (p.t) {
      case 'disc':
        ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'rect':
        ctx.fillRect(p.x, p.y, p.w, p.h);
        break;
      case 'tri':
        ctx.moveTo(p.pts[0][0], p.pts[0][1]);
        ctx.lineTo(p.pts[1][0], p.pts[1][1]);
        ctx.lineTo(p.pts[2][0], p.pts[2][1]);
        ctx.closePath();
        ctx.fill();
        break;
      case 'line':
        ctx.lineWidth = p.w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        p.pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.stroke();
        break;
      case 'ellipse':
        ctx.ellipse(p.cx, p.cy, p.rx, p.ry, (p.rot * Math.PI) / 180, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }
  ctx.restore();
}

// ---------- 점 단위 계산 (Node 자동 시험) ----------

export function hexLuma(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
}

function segDist2(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  let t = l2 ? ((px - a[0]) * vx + (py - a[1]) * vy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (a[0] + t * vx);
  const dy = py - (a[1] + t * vy);
  return dx * dx + dy * dy;
}

function inside(p: Prim, x: number, y: number): boolean {
  switch (p.t) {
    case 'disc':
      return (x - p.cx) ** 2 + (y - p.cy) ** 2 <= p.r * p.r;
    case 'rect':
      return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
    case 'tri': {
      const [a, b, c] = p.pts;
      const s = (q: Pt, r: Pt) => (x - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (y - r[1]);
      const d1 = s(a, b);
      const d2 = s(b, c);
      const d3 = s(c, a);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    }
    case 'line': {
      const r2 = (p.w / 2) ** 2;
      for (let i = 1; i < p.pts.length; i++) if (segDist2(x, y, p.pts[i - 1], p.pts[i]) <= r2) return true;
      return false;
    }
    case 'ellipse': {
      const a = (-p.rot * Math.PI) / 180;
      const dx = x - p.cx;
      const dy = y - p.cy;
      const u = dx * Math.cos(a) - dy * Math.sin(a);
      const v = dx * Math.sin(a) + dy * Math.cos(a);
      return (u / p.rx) ** 2 + (v / p.ry) ** 2 <= 1;
    }
  }
}

function bbox(p: Prim): [number, number, number, number] {
  switch (p.t) {
    case 'disc':
      return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
    case 'rect':
      return [p.x, p.y, p.x + p.w, p.y + p.h];
    case 'tri':
    case 'line': {
      const pad = p.t === 'line' ? p.w / 2 : 0;
      const xs = p.pts.map((q) => q[0]);
      const ys = p.pts.map((q) => q[1]);
      return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    }
    case 'ellipse': {
      const r = Math.max(p.rx, p.ry);
      return [p.cx - r, p.cy - r, p.cx + r, p.cy + r];
    }
  }
}

export interface Shader {
  /** (x, y) mm 지점의 휘도. 웨이퍼 바깥이면 null */
  at(x: number, y: number): number | null;
}

const CELL = 4;
const SPAN = 56;

/** 격자 색인을 둔 점 단위 휘도 계산기 */
export function makeShader(id: SpecimenId): Shader {
  const prims = specimenPrims(id);
  const lum = prims.map((p) => hexLuma(p.fill));
  const nc = Math.ceil((2 * SPAN) / CELL);
  const cells: number[][] = Array.from({ length: nc * nc }, () => []);
  prims.forEach((p, i) => {
    const [x0, y0, x1, y1] = bbox(p);
    const cx0 = Math.max(0, Math.floor((x0 + SPAN) / CELL));
    const cy0 = Math.max(0, Math.floor((y0 + SPAN) / CELL));
    const cx1 = Math.min(nc - 1, Math.floor((x1 + SPAN) / CELL));
    const cy1 = Math.min(nc - 1, Math.floor((y1 + SPAN) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) cells[cy * nc + cx].push(i);
  });
  return {
    at(x, y) {
      if (x * x + y * y > R * R) return null;
      const cx = Math.floor((x + SPAN) / CELL);
      const cy = Math.floor((y + SPAN) / CELL);
      if (cx < 0 || cy < 0 || cx >= nc || cy >= nc) return null;
      let v: number | null = null;
      for (const i of cells[cy * nc + cx]) {
        const p = prims[i];
        if (!inside(p, x, y)) continue;
        const a = p.t === 'ellipse' ? p.alpha : 1;
        v = v === null ? lum[i] : v + (lum[i] - v) * a;
      }
      return v;
    },
  };
}
