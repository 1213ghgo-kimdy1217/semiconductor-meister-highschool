import type { CloseReason, Transport } from './types';

export const DEFAULT_BAUD = 115200;

export type SerialSupport = 'ok' | 'unsupported' | 'insecure' | 'blocked';

/** Web Serial을 쓸 수 있는지. 미리보기처럼 iframe 안이면 권한 정책으로 막힐 수 있다. */
export function serialSupport(): SerialSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!('serial' in navigator)) return 'unsupported';
  const policy = (document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy;
  if (policy && !policy.allowsFeature('serial')) return 'blocked';
  return 'ok';
}

/** 포트 고르기 창. 정품 Uno USB ID만 걸러 호환 보드를 빼지 않도록 필터를 두지 않는다. */
export async function requestSerialPort(): Promise<SerialPort> {
  return navigator.serial.requestPort();
}

export function describeSerialError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  switch (err?.name) {
    case 'NotFoundError':
      return '포트를 고르지 않았어요. 다시 장치 연결을 눌러 Uno 포트를 골라 주세요.';
    case 'SecurityError':
      return '이 창에서는 USB 연결이 막혀 있어요. 새 탭(Chrome·Edge)에서 열어 주세요.';
    case 'InvalidStateError':
      return 'USB 포트가 이미 열려 있어요. 연결 해제 후 다시 시도해 주세요.';
    case 'NetworkError':
      return 'USB 포트 사용 중 — Arduino IDE 시리얼 모니터나 다른 프로그램을 닫고 다시 연결해 주세요.';
    default:
      return `USB 포트를 열지 못했어요 (${err?.name ?? '알 수 없음'}). 케이블과 포트를 확인해 주세요.`;
  }
}

function hex4(n?: number) {
  return n === undefined ? '????' : n.toString(16).toUpperCase().padStart(4, '0');
}

export class SerialTransport implements Transport {
  readonly kind = 'serial' as const;
  readonly label: string;
  onData: ((text: string) => void) | null = null;
  onClose: ((reason: CloseReason, detail?: string) => void) | null = null;

  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private loop: Promise<void> | null = null;
  private closing = false;
  private closed = false;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly port: SerialPort,
    private readonly baudRate = DEFAULT_BAUD,
  ) {
    const info = port.getInfo();
    this.label = info.usbVendorId !== undefined ? `USB ${hex4(info.usbVendorId)}:${hex4(info.usbProductId)}` : 'USB 시리얼';
  }

  async open() {
    await this.port.open({ baudRate: this.baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 1024 });
    if (!this.port.writable) throw new Error('쓰기 스트림 없음');
    // writer는 포트를 여는 동안 하나만 잡아 둔다 (중복 writer 방지)
    this.writer = this.port.writable.getWriter();
    this.port.addEventListener('disconnect', this.handleDisconnect);
    this.loop = this.readLoop();
  }

  private handleDisconnect = () => {
    void this.reader?.cancel().catch(() => undefined);
  };

  private async readLoop() {
    while (this.port.readable && !this.closing) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) this.onData?.(this.decoder.decode(value, { stream: true }));
        }
      } catch {
        // 프레이밍/패리티 오류는 readable이 살아 있어 다시 읽고, 케이블 단절이면 readable이 null이 된다
      } finally {
        reader.releaseLock();
        this.reader = null;
      }
    }
    if (!this.closing) {
      await this.release();
      this.finish('lost', 'USB 연결이 끊겼어요');
    }
  }

  write(line: string): Promise<void> {
    const run = async () => {
      if (!this.writer || this.closing) throw new Error('포트가 열려 있지 않아요');
      await this.writer.write(this.encoder.encode(`${line}\n`));
    };
    // 쓰기는 한 번에 하나씩
    const p = this.writeChain.then(run, run);
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  private async release() {
    try {
      this.writer?.releaseLock();
    } catch {
      /* 이미 해제됨 */
    }
    this.writer = null;
    try {
      await this.port.close();
    } catch {
      /* 이미 닫힘 */
    }
    this.port.removeEventListener('disconnect', this.handleDisconnect);
  }

  private finish(reason: CloseReason, detail?: string) {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.(reason, detail);
  }

  async close() {
    if (this.closed) return;
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* 무시 */
    }
    try {
      await this.loop;
    } catch {
      /* 무시 */
    }
    await this.release();
    this.finish('user');
  }
}
