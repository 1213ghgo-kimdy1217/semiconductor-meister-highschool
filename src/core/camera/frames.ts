// 카메라 프레임 → ROI 회색 영상. 화면(미러 없음)과 캡처가 같은 좌표를 쓴다.
import type { Frame, FrameSource } from '../inspect/runner';
import { makeRoiImage, planCrop, rgbaToGray, type Roi, type RoiImage } from '../vision/image';
import type { CameraController } from './camera';

export class RoiGrabber {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  grab(src: CanvasImageSource, vw: number, vh: number, roi: Roi): RoiImage {
    const p = planCrop(roi, vw, vh);
    if (this.canvas.width !== p.dw || this.canvas.height !== p.dh) {
      this.canvas.width = p.dw;
      this.canvas.height = p.dh;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, p.dw, p.dh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 영상 밖으로 나간 부분은 투명으로 남고 휘도 0이 된다
    ctx.drawImage(src, p.sx, p.sy, p.sw, p.sh, 0, 0, p.dw, p.dh);
    const { data } = ctx.getImageData(0, 0, p.dw, p.dh);
    return makeRoiImage(rgbaToGray(data, p.dw, p.dh), roi.rot);
  }
}

export interface LiveFrameSource extends FrameSource {
  readonly live: boolean;
}

/** 요청 시각 이후에 들어온 카메라 프레임만 내준다 */
export class CameraFrames implements LiveFrameSource {
  constructor(
    private readonly cam: CameraController,
    private readonly grabber: RoiGrabber,
    private readonly roi: () => Roi,
  ) {}

  get live() {
    return this.cam.live;
  }

  nextFrame(after: number, signal: AbortSignal): Promise<Frame> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
      const onAbort = () => {
        off();
        reject(new DOMException('aborted', 'AbortError'));
      };
      const off = this.cam.onFrame((t, no) => {
        if (t <= after) return;
        off();
        signal.removeEventListener('abort', onAbort);
        try {
          const v = this.cam.video;
          const img = this.grabber.grab(v, v.videoWidth, v.videoHeight, this.roi());
          resolve({ id: `cam${this.cam.snapshot.session}-f${no}`, t, img });
        } catch (e) {
          reject(e);
        }
      });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
