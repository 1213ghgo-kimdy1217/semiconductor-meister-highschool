// 시험 모드 가상 카메라: 위에서 내려다본 이송로를 캔버스로 그리고 captureStream으로 실제 카메라와 같은 영상 경로에 넣는다.
// 놓을 때마다 위치·회전·조명이 조금씩 달라지고, 손 가림·반사·흐림·어둡게를 켤 수 있다.
import { drawSpecimen, WAFER_MM, type SpecimenId } from '../specimen/specimen';

export const VCAM_W = 1280;
export const VCAM_H = 720;
/** 기본 ROI(영상 높이의 0.7) 한 변의 96%가 원판 지름이 되게 */
const PX_PER_MM = (0.7 * VCAM_H * 0.96) / WAFER_MM;
const R_PX = (WAFER_MM / 2) * PX_PER_MM;
const CX = VCAM_W / 2;
const CY = VCAM_H / 2;

export type VirtualItem = SpecimenId | 'empty';

export interface VirtualDisturb {
  hand: boolean;
  glare: boolean;
  blur: boolean;
  dim: boolean;
}

export interface VirtualView {
  /** 이송로 위의 물체. at: 들어오는 중 / 촬영 위치 / 빠져나가는 중 */
  wafer: { kind: VirtualItem; at: 'chute' | 'gate' | 'passing'; since: number; placement: number } | null;
  stopGate: 'closed' | 'open' | 'moving';
  disturb: VirtualDisturb;
  slideMs: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 놓을 때마다 달라지는 작은 위치·회전·조명 */
export function placementPose(placement: number) {
  const r = rng(placement * 7919 + 17);
  const span = (a: number) => (r() * 2 - 1) * a;
  return { dxMm: span(1.6), dyMm: span(1.6), rot: span(4), gain: 1 + span(0.08), gradient: span(0.12) };
}

export class VirtualCamera {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private sprites = new Map<SpecimenId, HTMLCanvasElement>();
  private noise: HTMLCanvasElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stream: MediaStream | null = null;
  private frame = 0;

  constructor(private readonly view: () => VirtualView) {
    this.canvas.width = VCAM_W;
    this.canvas.height = VCAM_H;
    this.noise = makeNoise(256);
  }

  start(): MediaStream {
    this.stop();
    this.draw();
    // rAF는 창이 가려지면 멈춘다. 실제 카메라처럼 계속 프레임을 내도록 타이머로 그린다
    this.timer = setInterval(() => this.draw(), 1000 / 30);
    this.stream = this.canvas.captureStream(30);
    return this.stream;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** 테스트 도구: 지금 장면을 한 번 그린다 */
  draw() {
    const ctx = this.ctx;
    const v = this.view();
    const now = Date.now();
    this.frame++;

    // 이송로 바닥
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#30373d';
    ctx.fillRect(0, 0, VCAM_W, VCAM_H);
    ctx.fillStyle = '#3a4248';
    ctx.fillRect(0, CY - R_PX - 34, VCAM_W, 2 * R_PX + 68);
    ctx.strokeStyle = '#59636b';
    ctx.lineWidth = 6;
    for (const y of [CY - R_PX - 34, CY + R_PX + 34]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VCAM_W, y);
      ctx.stroke();
    }

    // 정지 게이트 (촬영 위치 하류)
    const gx = CX + R_PX + 22;
    ctx.fillStyle = '#11161a';
    if (v.stopGate === 'closed') ctx.fillRect(gx, CY - R_PX * 0.55, 14, R_PX * 1.1);
    else if (v.stopGate === 'moving') ctx.fillRect(gx, CY - R_PX - 30, 14, R_PX * 0.7);
    else ctx.fillRect(gx, CY - R_PX - 90, 14, R_PX * 0.5);

    const w = v.wafer;
    if (w && w.kind !== 'empty') {
      const pose = placementPose(w.placement);
      const t = now - w.since;
      let x = CX + pose.dxMm * PX_PER_MM;
      const y = CY + pose.dyMm * PX_PER_MM;
      if (w.at === 'chute') {
        const k = Math.min(1, t / Math.max(1, v.slideMs));
        const ease = 1 - (1 - k) ** 3;
        x = -R_PX * 1.3 + (x + R_PX * 1.3) * ease;
      } else if (w.at === 'gate') {
        // 게이트에 닿은 뒤 잠깐 흔들림
        x += 6 * PX_PER_MM * Math.exp(-t / 110) * Math.cos(t / 38);
      } else if (w.at === 'passing') {
        x += (VCAM_W + R_PX) * Math.min(1, (t / 600) ** 2);
      }
      const sprite = this.sprite(w.kind);
      ctx.save();
      if (v.disturb.blur) ctx.filter = 'blur(5px)';
      ctx.translate(x, y);
      ctx.rotate((pose.rot * Math.PI) / 180);
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
      ctx.restore();
      ctx.filter = 'none';

      // 조명 차이: 전체 밝기와 좌우 기울기
      const g = ctx.createLinearGradient(x - R_PX, 0, x + R_PX, 0);
      const a = Math.abs(pose.gradient) * 0.5;
      const dark = `rgba(0,0,0,${a.toFixed(3)})`;
      const clear = 'rgba(0,0,0,0)';
      g.addColorStop(0, pose.gradient > 0 ? dark : clear);
      g.addColorStop(1, pose.gradient > 0 ? clear : dark);
      ctx.fillStyle = g;
      ctx.fillRect(x - R_PX, y - R_PX, 2 * R_PX, 2 * R_PX);
      if (pose.gain < 1) {
        ctx.fillStyle = `rgba(0,0,0,${(1 - pose.gain).toFixed(3)})`;
        ctx.fillRect(0, 0, VCAM_W, VCAM_H);
      } else {
        ctx.fillStyle = `rgba(255,255,255,${((pose.gain - 1) * 0.6).toFixed(3)})`;
        ctx.fillRect(0, 0, VCAM_W, VCAM_H);
      }

      if (v.disturb.glare) {
        const gx2 = x - R_PX * 0.2;
        const gy2 = y - R_PX * 0.25;
        const rg = ctx.createRadialGradient(gx2, gy2, 0, gx2, gy2, R_PX * 0.26);
        rg.addColorStop(0, 'rgba(255,255,255,1)');
        rg.addColorStop(0.55, 'rgba(255,255,255,0.95)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(gx2 - R_PX, gy2 - R_PX, 2 * R_PX, 2 * R_PX);
      }
    }

    if (v.disturb.hand) drawHand(ctx, now);
    if (v.disturb.dim) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, VCAM_W, VCAM_H);
    }

    // 센서 잡음
    ctx.globalAlpha = 0.07;
    const ox = -((this.frame * 97) % 256);
    const oy = -((this.frame * 61) % 256);
    for (let yy = oy; yy < VCAM_H; yy += 256) for (let xx = ox; xx < VCAM_W; xx += 256) ctx.drawImage(this.noise, xx, yy);
    ctx.globalAlpha = 1;
  }

  private sprite(id: SpecimenId) {
    let c = this.sprites.get(id);
    if (!c) {
      c = document.createElement('canvas');
      const size = Math.ceil(2 * R_PX + 8);
      c.width = c.height = size;
      drawSpecimen(c.getContext('2d')!, id, size / 2, size / 2, PX_PER_MM, 0);
      this.sprites.set(id, c);
    }
    return c;
  }
}

function makeNoise(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const r = rng(42);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(r() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 오른쪽 아래에서 들어온 손. 사람 손은 가만있지 않으니 조금씩 움직인다 */
function drawHand(ctx: CanvasRenderingContext2D, now: number) {
  const wob = Math.sin(now / 160) * 10;
  const bx = CX + R_PX * 0.25 + wob;
  const by = CY + R_PX * 0.1 + wob * 0.6;
  ctx.save();
  ctx.fillStyle = '#c69a7c';
  ctx.beginPath();
  ctx.roundRect(bx, by, R_PX * 1.6, R_PX * 1.2, 60);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.roundRect(bx - R_PX * 0.42, by + 10 + i * 44, R_PX * 0.6, 36, 18);
    ctx.fill();
  }
  ctx.restore();
}
