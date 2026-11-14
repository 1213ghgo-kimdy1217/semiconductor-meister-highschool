// 실제 USB 시리얼과 시험용 시뮬레이터가 같은 인터페이스를 쓴다 (지시서 10장).
export type TransportKind = 'serial' | 'sim';
export type CloseReason = 'user' | 'lost';

export interface Transport {
  readonly kind: TransportKind;
  readonly label: string;
  open(): Promise<void>;
  close(): Promise<void>;
  /** 한 줄을 보낸다. LF는 전송 계층이 붙인다. */
  write(line: string): Promise<void>;
  onData: ((text: string) => void) | null;
  onClose: ((reason: CloseReason, detail?: string) => void) | null;
}
