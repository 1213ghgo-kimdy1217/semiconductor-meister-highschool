// 공정 표시 (지시서 10장). 기준은 장치가 STATUS로 보고한 phase이고, 웹은 자기 촬영·판정 진행만 덧붙인다.
// 웹이 공정 상태를 정하거나 READY로 되돌리지 않는다.
import type { DeviceStatus } from '../protocol/v1';

export type FlowState =
  | 'LOCKED'
  | 'HOMING'
  | 'READY'
  | 'WAIT_WAFER'
  | 'CAPTURE'
  | 'CLASSIFY'
  | 'WAIT_PLC_ROUTE'
  | 'ROUTING_OK'
  | 'ROUTING_NG'
  | 'RELEASING'
  | 'WAIT_COLLECTION';

export type ProcessState = FlowState | 'HOLD_FAULT';

export const STATE_LABEL: Record<ProcessState, string> = {
  LOCKED: '잠김',
  HOMING: '원점 복귀',
  READY: '준비',
  WAIT_WAFER: '웨이퍼 확인',
  CAPTURE: '촬영',
  CLASSIFY: '판정',
  WAIT_PLC_ROUTE: 'PLC 경로 대기',
  ROUTING_OK: '정상 분기',
  ROUTING_NG: '불량 분기',
  RELEASING: '배출',
  WAIT_COLLECTION: '수거 확인 대기',
  HOLD_FAULT: 'HOLD/FAULT',
};

export const STATE_HINT: Record<ProcessState, string> = {
  LOCKED: '교정값 확인 또는 원점 복귀 전이라 운전이 잠겨 있어요. HMI·PLC에서 진행해요.',
  HOMING: '게이트 원점을 찾고 있어요.',
  READY: '정지 게이트가 닫혀 있어요. PLC가 한 장 투입 뒤 새 검사 요청을 낼 차례예요.',
  WAIT_WAFER: 'PLC 검사 요청을 받았어요. 원판이 보이고 멈출 때까지 결과를 보내지 않고 기다려요.',
  CAPTURE: '요청 이후의 새 프레임으로 정지 여부를 확인하고 있어요.',
  CLASSIFY: '정상·불량 기준과 비교하고 있어요.',
  WAIT_PLC_ROUTE: '결과가 래치됐어요. PLC가 경로를 고를 차례예요.',
  ROUTING_OK: '분기 게이트가 정상 쪽이에요.',
  ROUTING_NG: '분기 게이트가 불량 쪽이에요.',
  RELEASING: '정지 게이트를 열어 카세트로 배출하고 있어요.',
  WAIT_COLLECTION: '배출 동작은 끝났지만 실물 수거는 확인되지 않았어요. HMI에서 확인해 주세요.',
  HOLD_FAULT: '방출하지 않고 멈췄어요. 원인 확인 → RESET_HOLD → 통로 비움 확인 → 원점 → 새 사이클 순서로 HMI에서 복구해요.',
};

/** 현재 열린 검사 요청에 대한 웹 쪽 진행 */
export type WebStage = 'idle' | 'waiting_object' | 'stabilizing' | 'judging' | 'sending' | 'gave_up';

export interface FlowInput {
  status: DeviceStatus | null;
  web: WebStage;
  /** 정지 게이트 열기(OPEN_STOP) 완료 알림을 본 cycle */
  releasedCycle: number | null;
}

/** valid=1일 때만 ok를 판정으로 읽는다 */
export function latchedRoute(s: DeviceStatus | null): 'OK' | 'NG' | null {
  if (!s || !s.valid) return null;
  return s.ok ? 'OK' : 'NG';
}

export function processState({ status: s, web, releasedCycle }: FlowInput): ProcessState | null {
  if (!s) return null;
  const route = latchedRoute(s);
  switch (s.phase) {
    case 'BOOT_LOCKED':
      return 'LOCKED';
    case 'NEED_HOME':
      return s.busy ? 'HOMING' : 'LOCKED';
    case 'IDLE_CLOSED':
      return releasedCycle !== null && releasedCycle === s.cycle && s.cycle > 0 ? 'WAIT_COLLECTION' : 'READY';
    case 'WAIT_INSPECTION':
      if (web === 'waiting_object') return 'WAIT_WAFER';
      if (web === 'judging' || web === 'sending' || web === 'gave_up') return 'CLASSIFY';
      return 'CAPTURE';
    case 'RESULT_PENDING':
      return 'CLASSIFY';
    case 'RESULT_READY':
      if (s.busy && route) return route === 'OK' ? 'ROUTING_OK' : 'ROUTING_NG';
      return 'WAIT_PLC_ROUTE';
    case 'ROUTE_SET':
      if (s.busy) return 'RELEASING';
      return route === 'OK' ? 'ROUTING_OK' : route === 'NG' ? 'ROUTING_NG' : 'WAIT_PLC_ROUTE';
    case 'OPEN_WAIT_DRAIN':
      return 'RELEASING';
    case 'HOLD_FAULT':
      return 'HOLD_FAULT';
    default:
      return null;
  }
}

/** 공정 그림에서 한 칸으로 보여 줄 단계 */
export const TRACK_STEPS: { key: string; label: string; states: ProcessState[] }[] = [
  { key: 'lock', label: '잠김·원점', states: ['LOCKED', 'HOMING'] },
  { key: 'ready', label: '준비', states: ['READY'] },
  { key: 'request', label: '검사 요청', states: ['WAIT_WAFER', 'CAPTURE'] },
  { key: 'classify', label: '판정', states: ['CLASSIFY'] },
  { key: 'route-wait', label: 'PLC 경로', states: ['WAIT_PLC_ROUTE'] },
  { key: 'route', label: '분기', states: ['ROUTING_OK', 'ROUTING_NG'] },
  { key: 'release', label: '배출', states: ['RELEASING'] },
  { key: 'collect', label: '수거 확인', states: ['WAIT_COLLECTION'] },
];
