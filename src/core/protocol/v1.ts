// 동봉 Uno 펌웨어 직렬 규약 V1 (지시서 8장). 대상: arduino/Wafer_Two_Gate_PLC/controller.h
// 115200 baud, ASCII CSV, LF(CRLF 수신 가능), 줄끝 제외 최대 95바이트. 쉼표·따옴표·긴 문자열 없음.
// 이 파일은 문자열 ↔ 값 변환만 한다. 상태 판단은 link.ts가 한다.

export const BAUD = 115200;
/** 한 행 최대 길이 (줄끝 제외) */
export const MAX_LINE = 95;
export const UINT32_MAX = 4294967295;

/** 장치가 STATUS로 보고하는 단계 */
export const PHASES = [
  'BOOT_LOCKED',
  'NEED_HOME',
  'IDLE_CLOSED',
  'WAIT_INSPECTION',
  'RESULT_PENDING',
  'RESULT_READY',
  'ROUTE_SET',
  'OPEN_WAIT_DRAIN',
  'HOLD_FAULT',
] as const;
export type Phase = (typeof PHASES)[number];

export function isPhase(v: string): v is Phase {
  return (PHASES as readonly string[]).includes(v);
}

export const PHASE_LABEL: Record<Phase, string> = {
  BOOT_LOCKED: '잠김 (교정값 미확인)',
  NEED_HOME: '원점 복귀 필요',
  IDLE_CLOSED: '정지 게이트 닫힘 · 대기',
  WAIT_INSPECTION: '검사 결과 대기',
  RESULT_PENDING: '결과 접수 · 래치 준비 중',
  RESULT_READY: '결과 래치 · PLC 경로 대기',
  ROUTE_SET: '분기 게이트 위치 완료',
  OPEN_WAIT_DRAIN: '정지 게이트 열림 · 배출 대기',
  HOLD_FAULT: 'HOLD/FAULT',
};

/** 웹이 다루는 이벤트. 이 밖의 이벤트는 기록만 한다. */
export const EV = {
  CONNECTED: 'CONNECTED_NO_AUTOSTART',
  HOST_RECONNECTED: 'HOST_RECONNECTED',
  INSPECT_REQUEST: 'INSPECT_REQUEST',
  ACCEPTED: 'RESULT_ACCEPTED_PENDING_VALID',
  VALID: 'RESULT_VALID',
  DUPLICATE: 'RESULT_DUPLICATE_IGNORED',
} as const;

export const EVENT_LABEL: Record<string, string> = {
  CONNECTED_NO_AUTOSTART: '접속 등록 (자동 시작 없음)',
  HOST_RECONNECTED: 'PC 재접속 — HOLD, 이전 판정 무효',
  INSPECT_REQUEST: 'PLC 새 검사 요청',
  RESULT_ACCEPTED_PENDING_VALID: '결과 접수 (PLC 전달 래치 전)',
  RESULT_VALID: 'PLC 전달 래치 준비 (수거 완료 아님)',
  RESULT_DUPLICATE_IGNORED: '중복 결과 — 다시 실행하지 않음',
};

/** 알려진 고장/HOLD 코드. 동봉 펌웨어의 실제 문자열과 대조 필요 — 모르는 코드는 그대로 보인다. */
export const FAULT_LABEL: Record<string, string> = {
  NONE: '없음',
  PC_LINK_TIMEOUT: 'PC 연결 시간 초과',
  INSPECTION_TIMEOUT: '검사 시간 초과 (60초)',
  CAPTURE_FAILED: '카메라 촬영 실패',
  RUN_PERMIT_LOST: '운전 허가 상실',
  HOST_RECONNECTED: 'PC 재접속',
  HOME_FAILED: '원점 이상',
};

export function faultLabel(code: string): string {
  return FAULT_LABEL[code] ?? code;
}

/** PLC 명령 코드 (지시서 9·14장). DONE의 plc_command는 숫자 코드나 이름 어느 쪽이 와도 읽는다. */
export const PLC_COMMANDS: { code: string; name: string; label: string }[] = [
  { code: '000', name: 'CLOSE_STOP', label: '정지 게이트 닫기' },
  { code: '001', name: 'ROUTE_OK', label: '분기 OK' },
  { code: '010', name: 'ROUTE_NG', label: '분기 NG' },
  { code: '011', name: 'OPEN_STOP', label: '정지 게이트 열기' },
  { code: '100', name: 'HOME', label: '원점 복귀' },
  { code: '101', name: 'RESET_HOLD', label: 'HOLD 복구 요청' },
  { code: '110', name: 'ARM_INSPECTION', label: '새 검사 사이클' },
  { code: '111', name: 'RESERVED', label: '예약·거부' },
];

export function plcCommandLabel(token: string): string {
  const c = PLC_COMMANDS.find((p) => p.code === token || p.name === token);
  return c ? `${c.code} ${c.label}` : token;
}

export const REJECT_LABEL: Record<string, string> = {
  LINE_TOO_LONG: '한 줄이 너무 길어요 (95바이트 초과)',
};

export type Verdict = 'OK' | 'NG';

export interface DeviceStatus {
  session: number;
  cycle: number;
  phase: string;
  configured: boolean;
  homed: boolean;
  busy: boolean;
  done: boolean;
  fault: boolean;
  valid: boolean;
  /** valid일 때만 판정으로 읽는다 */
  ok: boolean;
  faultCode: string;
}

export type Incoming =
  | { kind: 'boot'; size: string; build: string; autostart: string }
  | { kind: 'event'; session: number; cycle: number; event: string }
  | { kind: 'status'; status: DeviceStatus }
  | { kind: 'done'; command: string; phase: string }
  | { kind: 'reject'; reason: string }
  | { kind: 'unknown'; type: string }
  | { kind: 'invalid'; why: string };

const TOKEN = /^[A-Z0-9_.]{1,40}$/;
const INT = /^(0|[1-9][0-9]{0,9})$/;

export function parseUint(s: string): number | null {
  if (!INT.test(s)) return null;
  const n = Number(s);
  return n <= UINT32_MAX ? n : null;
}

function bit(s: string): boolean | null {
  return s === '1' ? true : s === '0' ? false : null;
}

/** Uno → PC 한 줄 (LF·CR 제거된 상태) */
export function parseLine(line: string): Incoming {
  if (line.length > MAX_LINE) return { kind: 'invalid', why: '95바이트 초과' };
  if (!/^[\x20-\x7e]*$/.test(line)) return { kind: 'invalid', why: 'ASCII가 아닌 글자' };
  const f = line.split(',');
  if (f[0] !== 'V1') return { kind: 'invalid', why: 'V1로 시작하지 않음' };
  const type = f[1] ?? '';
  switch (type) {
    case 'BOOT': {
      if (f.length !== 5 || !f.slice(2).every((x) => TOKEN.test(x))) return { kind: 'invalid', why: 'BOOT 형식' };
      return { kind: 'boot', size: f[2], build: f[3], autostart: f[4] };
    }
    case 'EVENT': {
      if (f.length !== 5) return { kind: 'invalid', why: 'EVENT 필드 수' };
      const session = parseUint(f[2]);
      const cycle = parseUint(f[3]);
      if (session === null || cycle === null || !TOKEN.test(f[4])) return { kind: 'invalid', why: 'EVENT 값' };
      return { kind: 'event', session, cycle, event: f[4] };
    }
    case 'STATUS': {
      if (f.length !== 13) return { kind: 'invalid', why: 'STATUS 필드 수' };
      const session = parseUint(f[2]);
      const cycle = parseUint(f[3]);
      const bits = f.slice(5, 12).map(bit);
      if (session === null || cycle === null || !TOKEN.test(f[4]) || !TOKEN.test(f[12]) || bits.some((b) => b === null))
        return { kind: 'invalid', why: 'STATUS 값' };
      const [configured, homed, busy, done, fault, valid, ok] = bits as boolean[];
      return { kind: 'status', status: { session, cycle, phase: f[4], configured, homed, busy, done, fault, valid, ok, faultCode: f[12] } };
    }
    case 'DONE': {
      if (f.length !== 4 || !TOKEN.test(f[2]) || !TOKEN.test(f[3])) return { kind: 'invalid', why: 'DONE 형식' };
      return { kind: 'done', command: f[2], phase: f[3] };
    }
    case 'REJECT': {
      if (f.length !== 3 || !TOKEN.test(f[2])) return { kind: 'invalid', why: 'REJECT 형식' };
      return { kind: 'reject', reason: f[2] };
    }
    default:
      return TOKEN.test(type) ? { kind: 'unknown', type } : { kind: 'invalid', why: '알 수 없는 형식' };
  }
}

function nonzero(name: string, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_MAX) throw new RangeError(`${name}는 1~${UINT32_MAX} 정수여야 해요`);
}

/** PC → Uno 운영 명령. 여기 없는 이동 명령(START/HOME/JOG/OPEN/DIVERTER)은 만들 수 없다. */
export const fmt = {
  hello(session: number) {
    nonzero('session', session);
    return `V1,HELLO,${session}`;
  },
  ping(session: number) {
    nonzero('session', session);
    return `V1,PING,${session}`;
  },
  status(session: number) {
    nonzero('session', session);
    return `V1,STATUS,${session}`;
  },
  result(session: number, seq: number, cycle: number, capture: number, verdict: Verdict) {
    nonzero('session', session);
    nonzero('seq', seq);
    nonzero('cycle', cycle);
    nonzero('capture', capture);
    if (verdict !== 'OK' && verdict !== 'NG') throw new RangeError('결과는 OK 또는 NG만 보낼 수 있어요');
    return `V1,RESULT,${session},${seq},${cycle},${capture},${verdict}`;
  },
  captureFailed(session: number, cycle: number) {
    nonzero('session', session);
    nonzero('cycle', cycle);
    return `V1,CAPTURE_FAILED,${session},${cycle}`;
  },
};

/** 포트를 열 때마다 새 세션 번호. 펌웨어가 부호 있는 정수로 읽어도 안전하게 2^31 미만 */
export function newSessionNonce(rand: () => number = secureRandom): number {
  return 1 + Math.floor(rand() * 2147483646);
}

function secureRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}
