// 기록 자료형. 카메라 판정 · PLC 전달 · 배출 동작 · 실물 수거 확인을 따로 적는다 (지시서 8장).
import type { FrameScores, HoldReason, Thresholds } from '../vision/analyze';
import type { Roi } from '../vision/image';
import type { RefKind, StoredReference } from '../vision/reference';

/** live: 실제 장치 운전 · sim: 시험 모드(가상 Uno·PLC) · check: 검사만 시험(장치로 아무것도 보내지 않음) */
export type RecordMode = 'live' | 'sim' | 'check';
export type CameraProfile = 'real' | 'virtual';

/** 검사만 시험에서 작업자가 고른 실제 놓인 것 */
export type Expected = 'ok' | 'ng' | 'empty' | 'occluded' | 'other';

export const EXPECTED_LABEL: Record<Expected, string> = {
  ok: '정상 시편',
  ng: '불량 시편',
  empty: '빈 자리',
  occluded: '가림 시험',
  other: '기타',
};

/** 결과 전달 상태 (장치 쪽) */
export type PlcState =
  | 'none'
  | 'withheld'
  | 'sending'
  | 'accepted'
  | 'valid'
  | 'rejected'
  | 'no_ack'
  | 'capture_failed'
  | 'closed';

export const PLC_STATE_LABEL: Record<PlcState, string> = {
  none: '보내지 않음',
  withheld: '보내지 않음 (판정보류)',
  sending: '전송 중',
  accepted: 'Uno 접수 · 래치 전',
  valid: 'PLC 전달 래치 준비',
  rejected: '장치가 거부',
  no_ack: '접수 응답 없음',
  capture_failed: '촬영 실패 전송 → HOLD',
  closed: '요청이 닫힘',
};

export interface InspectionRecord {
  id: string;
  mode: RecordMode;
  camera: CameraProfile;
  expected: Expected | null;
  deviceSession: number | null;
  cycle: number | null;
  capture: number | null;
  frameIds: string[];
  verdict: 'OK' | 'NG' | 'HOLD';
  holdReason: HoldReason | null;
  attempts: number;
  trail: string[];
  method: string;
  version: string;
  calibrationVersion: number;
  scores: FrameScores | null;
  requestedAt: string;
  firstFrameAt: string | null;
  decidedAt: string | null;
  cameraLabel: string | null;
  plc: PlcState;
  plcDetail: string | null;
  /** PLC가 요청해 Uno가 마친 분기 (DONE 001/010) */
  route: 'OK' | 'NG' | null;
  /** 정지 게이트 열기 완료 (DONE 011) — 배출 동작 종료일 뿐 실물 수거가 아니다 */
  released: boolean;
  /** 웹은 실물 수거를 확인할 수 없다. HMI 확인 정보가 들어오기 전까지 false */
  collectionConfirmed: boolean;
  faultCode: string | null;
  closedWhy: string | null;
  /** 판정 프레임 ROI (96px 회색 PNG) */
  thumb: string | null;
  updatedAt: string;
}

export interface StoredEvent {
  id?: number;
  recordId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ProfileSettings {
  roi: Roi;
  thresholds: Thresholds;
  calibrationVersion: number;
  refs: Partial<Record<RefKind, StoredReference>>;
}

export interface CameraChoice {
  deviceId: string;
  label: string;
}
