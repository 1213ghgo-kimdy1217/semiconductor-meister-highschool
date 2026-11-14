import type { CameraProfile, Expected, InspectionRecord, PlcState, ProfileSettings, RecordMode, StoredEvent } from '../store/types';
import type { FrameScores, HoldReason } from '../vision/analyze';
import type { RefKind, StoredReference } from '../vision/reference';

export type ReferenceMetadata = Omit<StoredReference, 'pixels'> & { image_path: string };
export type ReferenceMetadataMap = Partial<Record<RefKind, ReferenceMetadata>>;

export function inspectionToRow(record: InspectionRecord, ownerId: string, deviceId: string, imagePath: string | null = null) {
  return {
    id: record.id,
    owner_id: ownerId,
    device_id: deviceId,
    device_session: record.deviceSession,
    cycle_id: record.cycle,
    capture_id: record.capture,
    mode: record.mode,
    verdict: record.verdict,
    hold_reason: record.holdReason,
    method: record.method,
    version: record.version,
    calibration_version: record.calibrationVersion,
    scores: record.scores,
    capture_time: record.firstFrameAt,
    decision_time: record.decidedAt,
    requested_at: record.requestedAt,
    image_path: imagePath,
    plc_result_state: record.plc,
    plc_detail: record.plcDetail,
    route: record.route,
    released: record.released,
    collection_confirmed: record.collectionConfirmed,
    fault_code: record.faultCode,
    closed_why: record.closedWhy,
    expected: record.expected,
    camera: record.camera,
    camera_label: record.cameraLabel,
    attempts: record.attempts,
    trail: [...record.trail],
    frame_ids: [...record.frameIds],
    local_updated_at: record.updatedAt,
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Cloud images remain private; the list does not fabricate a thumbnail URL. */
export function rowToInspection(row: Record<string, unknown>): InspectionRecord {
  return {
    id: String(row.id),
    mode: row.mode as RecordMode,
    camera: row.camera as CameraProfile,
    expected: (row.expected ?? null) as Expected | null,
    deviceSession: nullableNumber(row.device_session),
    cycle: nullableNumber(row.cycle_id),
    capture: nullableNumber(row.capture_id),
    frameIds: strings(row.frame_ids),
    verdict: row.verdict as InspectionRecord['verdict'],
    holdReason: (row.hold_reason ?? null) as HoldReason | null,
    attempts: nullableNumber(row.attempts) ?? 0,
    trail: strings(row.trail),
    method: String(row.method),
    version: String(row.version),
    calibrationVersion: nullableNumber(row.calibration_version) ?? 0,
    scores: (row.scores ?? null) as FrameScores | null,
    requestedAt: String(row.requested_at),
    firstFrameAt: stringOrNull(row.capture_time),
    decidedAt: stringOrNull(row.decision_time),
    cameraLabel: stringOrNull(row.camera_label),
    plc: row.plc_result_state as PlcState,
    plcDetail: stringOrNull(row.plc_detail),
    route: (row.route ?? null) as InspectionRecord['route'],
    released: row.released === true,
    collectionConfirmed: row.collection_confirmed === true,
    faultCode: stringOrNull(row.fault_code),
    closedWhy: stringOrNull(row.closed_why),
    thumb: null,
    updatedAt: String(row.local_updated_at),
  };
}

export function eventToRow(event: StoredEvent, ownerId: string, deviceId: string) {
  if (!Number.isSafeInteger(event.id) || (event.id ?? 0) < 1) throw new Error('로컬 이벤트 번호를 확인해 주세요.');
  return {
    owner_id: ownerId,
    inspection_id: event.recordId,
    device_id: deviceId,
    local_event_id: event.id as number,
    event_type: event.type,
    payload: event.payload,
    created_at: event.createdAt,
  };
}

export function settingsToRow(
  profile: ProfileSettings,
  camera: CameraProfile,
  ownerId: string,
  deviceId: string,
  refsMetadata: ReferenceMetadataMap = {},
  updatedAt: string = new Date().toISOString(),
) {
  return {
    owner_id: ownerId,
    device_id: deviceId,
    camera_id: camera,
    roi: { ...profile.roi },
    calibration_version: profile.calibrationVersion,
    thresholds: { ...profile.thresholds },
    refs: refsMetadata,
    local_updated_at: updatedAt,
  };
}
