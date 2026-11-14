import type { InspectionRecord, ProfileSettings, StoredEvent } from '../../src/core/store/types';
import { DEFAULT_THRESHOLDS } from '../../src/core/vision/analyze';
import { DEFAULT_ROI } from '../../src/core/vision/image';

export const OWNER_A = '11111111-1111-4111-8111-111111111111';
export const OWNER_B = '22222222-2222-4222-8222-222222222222';
export const DEVICE_A = '33333333-3333-4333-8333-333333333333';
export const DEVICE_B = '44444444-4444-4444-8444-444444444444';
export const RECORD_ID = '55555555-5555-4555-8555-555555555555';
export const WHEN = '2026-11-14T12:00:00.000Z';

export function inspection(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    id: RECORD_ID,
    mode: 'live',
    camera: 'real',
    expected: null,
    deviceSession: 30125,
    cycle: 7,
    capture: 3,
    frameIds: ['new-1', 'new-2', 'new-3'],
    verdict: 'OK',
    holdReason: null,
    attempts: 2,
    trail: ['unstable', 'OK'],
    method: 'ref-compare',
    version: 'cmp1.0',
    calibrationVersion: 4,
    scores: null,
    requestedAt: WHEN,
    firstFrameAt: WHEN,
    decidedAt: WHEN,
    cameraLabel: 'USB inspection camera',
    plc: 'valid',
    plcDetail: null,
    route: 'OK',
    released: true,
    collectionConfirmed: false,
    faultCode: null,
    closedWhy: null,
    thumb: null,
    updatedAt: WHEN,
    ...overrides,
  };
}

export function storedEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 12,
    recordId: RECORD_ID,
    type: 'result_valid',
    payload: { cycle: 7, capture: 3 },
    createdAt: WHEN,
    ...overrides,
  };
}

export function profile(overrides: Partial<ProfileSettings> = {}): ProfileSettings {
  return {
    roi: { ...DEFAULT_ROI },
    thresholds: { ...DEFAULT_THRESHOLDS },
    calibrationVersion: 4,
    refs: {},
    ...overrides,
  };
}
