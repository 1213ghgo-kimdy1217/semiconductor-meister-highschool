// 자동 시험용 가상 촬영: 시편을 ROI 둘레 잘라 온 영상(RoiImage)으로 직접 그린다.
import { CROP_HALF, makeGray, makeRoiImage, ROI_SIDE_PX, type RoiImage } from '../../src/core/vision/image';
import { makeShader, WAFER_MM, type SpecimenId } from '../../src/core/specimen/specimen';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Shot {
  specimen: SpecimenId | null;
  /** ROI 한 변 대비 이동 */
  dx?: number;
  dy?: number;
  rot?: number;
  gain?: number;
  offset?: number;
  /** 왼쪽→오른쪽 밝기 기울기 비율 */
  gradient?: number;
  noise?: number;
  blur?: number;
  /** 손 가림: 가린 비율(0~1) */
  occlude?: number;
  glare?: boolean;
  seed?: number;
}

const shaders = new Map<SpecimenId, ReturnType<typeof makeShader>>();
const TRAY = 64;

export function shoot(s: Shot): RoiImage {
  const size = Math.max(8, Math.round(2 * CROP_HALF * ROI_SIDE_PX));
  const g = makeGray(size, size);
  const rand = rng(s.seed ?? 1);
  const shader = s.specimen ? (shaders.get(s.specimen) ?? shaders.set(s.specimen, makeShader(s.specimen)).get(s.specimen)!) : null;
  const pxPerMm = (ROI_SIDE_PX * 0.96) / WAFER_MM;
  const cx = size / 2 + (s.dx ?? 0) * ROI_SIDE_PX;
  const cy = size / 2 + (s.dy ?? 0) * ROI_SIDE_PX;
  const th = (-(s.rot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const gain = s.gain ?? 1;
  const grad = s.gradient ?? 0;
  const off = s.offset ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = x + 0.25 + sx * 0.5 - cx;
          const py = y + 0.25 + sy * 0.5 - cy;
          const u = (px * cos - py * sin) / pxPerMm;
          const v = (px * sin + py * cos) / pxPerMm;
          const val = shader?.at(u, v) ?? TRAY + 6 * Math.sin(x * 0.05) * Math.cos(y * 0.04);
          acc += val;
        }
      }
      let val = (acc / 4) * gain * (1 + grad * (x / size - 0.5)) + off;
      if (s.occlude) {
        // 손: 오른쪽 아래에서 들어오는 둥근 덩어리
        const hx = size / 2 + ROI_SIDE_PX * (0.62 - s.occlude);
        const hy = size / 2 + ROI_SIDE_PX * 0.1;
        if (x > hx && Math.abs(y - hy) < ROI_SIDE_PX * 0.5) val = 168 + 8 * Math.sin(y * 0.1);
      }
      if (s.glare) {
        const d2 = (x - size * 0.42) ** 2 + (y - size * 0.45) ** 2;
        val += 400 * Math.exp(-d2 / (2 * 16 * 16));
      }
      g.data[y * size + x] = val;
    }
  }
  if (s.blur) boxBlur(g.data, size, size, s.blur);
  const n = s.noise ?? 0;
  for (let i = 0; i < g.data.length; i++) {
    const gauss = (rand() + rand() + rand() - 1.5) * 2;
    g.data[i] = Math.max(0, Math.min(255, g.data[i] + gauss * n));
  }
  return makeRoiImage(g, 0);
}

function boxBlur(d: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(d.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let k = -r; k <= r; k++) {
          const xx = pass === 0 ? x + k : x;
          const yy = pass === 0 ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += d[yy * w + xx];
          c++;
        }
        tmp[y * w + x] = s / c;
      }
    }
    d.set(tmp);
  }
}

/** 놓을 때마다 달라지는 작은 위치·회전·조명 변화 */
export function jitter(seed: number, specimen: SpecimenId | null, extra: Partial<Shot> = {}): Shot {
  const r = rng(seed * 7919 + 13);
  const span = (a: number) => (r() * 2 - 1) * a;
  return {
    specimen,
    dx: span(0.03),
    dy: span(0.03),
    rot: span(4),
    gain: 1 + span(0.15),
    offset: span(8),
    gradient: span(0.15),
    noise: 3,
    seed,
    ...extra,
  };
}
