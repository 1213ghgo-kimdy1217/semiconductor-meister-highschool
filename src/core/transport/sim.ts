import type { SimDevice } from './simDevice';
import type { CloseReason, Transport } from './types';

/** 가상 Uno에 붙는 전송 계층. 실제 SerialTransport와 같은 인터페이스라 상위 로직은 구분하지 않는다. */
export class SimTransport implements Transport {
  readonly kind = 'sim' as const;
  readonly label = '시뮬레이터 (가상 Uno·PLC)';
  onData: ((text: string) => void) | null = null;
  onClose: ((reason: CloseReason, detail?: string) => void) | null = null;
  private opened = false;

  constructor(private readonly device: SimDevice) {}

  async open() {
    this.opened = true;
    this.device.connectUsb((chunk) => {
      if (this.opened) this.onData?.(chunk);
    });
  }

  async write(line: string) {
    if (!this.opened) throw new Error('포트가 열려 있지 않아요');
    const text = `${line}\n`;
    // 실제 USB처럼 약간 늦게 도착
    setTimeout(() => this.device.receiveFromHost(text), 5);
  }

  async close() {
    if (!this.opened) return;
    this.opened = false;
    this.device.disconnectUsb();
    this.onClose?.('user');
  }

  /** 케이블을 뽑은 것처럼 끊는다 */
  unplug() {
    if (!this.opened) return;
    this.opened = false;
    this.device.disconnectUsb();
    this.onClose?.('lost', '케이블 단절 (시뮬레이션)');
  }
}
