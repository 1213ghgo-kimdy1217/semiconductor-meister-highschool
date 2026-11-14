import { describe, expect, it } from 'vitest';
import { createOutboxItem, canUpload, outboxPriority, shouldAcknowledge } from '../src/core/cloud/outbox';
import { classifyCloudError, retryDelay } from '../src/core/cloud/retry';
import { eventToRow, inspectionToRow, rowToInspection, settingsToRow } from '../src/core/cloud/mapping';
import { DEVICE_A, DEVICE_B, OWNER_A, OWNER_B, RECORD_ID, WHEN, inspection, profile, storedEvent } from './helpers/cloud-fixtures';

describe('durable outbox identity and ownership', () => {
  const meta = { ownerId: OWNER_A, deviceId: DEVICE_A };

  it('keeps the same logical record key while its revision advances', () => {
    const first = createOutboxItem('inspection', RECORD_ID, inspection(), meta, 'revision-1', WHEN);
    const later = createOutboxItem('inspection', RECORD_ID, inspection({ plc: 'valid', released: true }), meta, 'revision-2', WHEN);
    expect(first.key).toBe(later.key);
    expect(first.revision).not.toBe(later.revision);
    expect(later.payload).toEqual(inspection({ plc: 'valid', released: true }));
  });

  it('does not acknowledge a newer snapshot when an older request completes', () => {
    const item = createOutboxItem('inspection', RECORD_ID, inspection(), meta, 'revision-2', WHEN);
    expect(shouldAcknowledge(item, 'revision-1')).toBe(false);
    expect(shouldAcknowledge(item, 'revision-2')).toBe(true);
    expect(shouldAcknowledge(undefined, 'revision-2')).toBe(false);
    expect(shouldAcknowledge(null, 'revision-2')).toBe(false);
  });

  it('uploads only records explicitly bound to the current signed-in owner', () => {
    const item = createOutboxItem('inspection', RECORD_ID, inspection(), meta);
    expect(canUpload(item, OWNER_A)).toBe(true);
    expect(canUpload(item, OWNER_B)).toBe(false);
    expect(canUpload(item, null)).toBe(false);
  });

  it('does not silently claim signed-out records for the next account', () => {
    const item = createOutboxItem('inspection', RECORD_ID, inspection(), { ownerId: null, deviceId: DEVICE_A });
    expect(canUpload(item, OWNER_A)).toBe(false);
    expect(canUpload(item, OWNER_B)).toBe(false);
  });

  it('keeps different account queues separate even for the same local record', () => {
    const a = createOutboxItem('inspection', RECORD_ID, inspection(), meta);
    const b = createOutboxItem('inspection', RECORD_ID, inspection(), { ...meta, ownerId: OWNER_B });
    expect(a.key).not.toBe(b.key);
  });

  it('keeps independently calibrated PCs separate', () => {
    const payload = { camera: 'real' as const, settings: profile(), updatedAt: WHEN };
    const a = createOutboxItem('settings', 'real', payload, meta);
    const b = createOutboxItem('settings', 'real', payload, { ...meta, deviceId: DEVICE_B });
    expect(a.key).not.toBe(b.key);
  });

  it('orders parent inspections before their dependent events', () => {
    const record = createOutboxItem('inspection', RECORD_ID, inspection(), meta);
    const event = createOutboxItem('event', '12', storedEvent(), meta);
    expect(outboxPriority(record)).toBeLessThan(outboxPriority(event));
  });
});

describe('cloud retry policy', () => {
  it('retries network failures and transient server/rate-limit responses', () => {
    for (const error of [new TypeError('Failed to fetch'), { status: 503 }, { status: 429 }]) {
      const classified = classifyCloudError(error);
      expect(classified.kind).toBe('network');
      expect(classified.retryable).toBe(true);
    }
  });

  it('pauses authentication failures instead of endlessly retrying them', () => {
    for (const error of [{ status: 401 }, { code: 'PGRST301' }]) {
      const classified = classifyCloudError(error);
      expect(classified.kind).toBe('auth');
      expect(classified.retryable).toBe(false);
    }
  });

  it('distinguishes policy rejection, conflict and missing schema', () => {
    for (const [error, kind] of [
      [{ status: 403 }, 'policy'],
      [{ code: '42501' }, 'policy'],
      [{ status: 409 }, 'conflict'],
      [{ code: '23505' }, 'conflict'],
      [{ code: 'PGRST205' }, 'schema'],
      [{ code: '42P01' }, 'schema'],
      [{ code: '42703' }, 'schema'],
    ] as const) {
      const classified = classifyCloudError(error);
      expect(classified.kind).toBe(kind);
      expect(classified.retryable).toBe(false);
    }
  });

  it('does not surface arbitrary server details in the operator status', () => {
    const error = { status: 403, message: 'sensitive_detail_marker', details: 'sensitive_detail_marker' };
    expect(classifyCloudError(error).message).not.toContain('sensitive_detail_marker');
    expect(classifyCloudError(error).message.length).toBeGreaterThan(0);
  });

  it('backs off exponentially with bounded jitter and a five-minute cap', () => {
    expect(retryDelay(0, () => 0.5)).toBe(2000);
    expect(retryDelay(1, () => 0.5)).toBe(4000);
    expect(retryDelay(2, () => 0.5)).toBe(8000);
    expect(retryDelay(4, () => 0)).toBeLessThan(retryDelay(4, () => 1));
    for (const attempt of [0, 1, 4, 20, 1000]) {
      for (const random of [0, 0.5, 1]) {
        const delay = retryDelay(attempt, () => random);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(300_000);
      }
    }
  });

  it('handles malformed attempt counters without scheduling NaN or infinite delays', () => {
    for (const attempt of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const delay = retryDelay(attempt, () => 0.5);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(300_000);
    }
  });
});

describe('database record mapping', () => {
  it('keeps classification, PLC receipt, release and physical collection distinct', () => {
    const row = inspectionToRow(inspection({ verdict: 'NG', plc: 'accepted', route: null, released: false }), OWNER_A, DEVICE_A);
    expect(row.verdict).toBe('NG');
    expect(row.plc_result_state).toBe('accepted');
    expect(row.route).toBeNull();
    expect(row.released).toBe(false);
    expect(row.collection_confirmed).toBe(false);
    expect(row.owner_id).toBe(OWNER_A);
    expect(row.device_id).toBe(DEVICE_A);
  });

  it('persists HOLD as HOLD without inventing a PLC result', () => {
    const row = inspectionToRow(inspection({ verdict: 'HOLD', holdReason: 'low_margin', plc: 'withheld', route: null, released: false }), OWNER_A, DEVICE_A);
    expect(row.verdict).toBe('HOLD');
    expect(row.hold_reason).toBe('low_margin');
    expect(row.plc_result_state).toBe('withheld');
    expect(row.route).toBeNull();
    expect(row.released).toBe(false);
  });

  it('preserves all stored fields in a team-history round trip', () => {
    const record = inspection();
    const row = inspectionToRow(record, OWNER_A, DEVICE_A, `${OWNER_A}/inspections/${RECORD_ID}.png`);
    const restored = rowToInspection(row);
    expect(restored).toEqual(record);
  });

  it('keeps simulation and check records separate from live statistics', () => {
    for (const mode of ['live', 'sim', 'check'] as const) {
      const row = inspectionToRow(inspection({ mode }), OWNER_A, DEVICE_A);
      expect(row.mode).toBe(mode);
      expect(rowToInspection(row).mode).toBe(mode);
    }
  });

  it('stores the private image path without copying a data URL into database rows', () => {
    const original = inspection({ thumb: 'data:image/png;base64,fixture' });
    const path = `${OWNER_A}/inspections/${RECORD_ID}.png`;
    const row = inspectionToRow(original, OWNER_A, DEVICE_A, path);
    expect(row.image_path).toBe(path);
    expect(JSON.stringify(row)).not.toContain('data:image');
    expect(original.thumb).toBe('data:image/png;base64,fixture');
  });

  it('binds event idempotency to the owner and source PC', () => {
    const event = storedEvent();
    const row = eventToRow(event, OWNER_A, DEVICE_A);
    expect(row.owner_id).toBe(OWNER_A);
    expect(row.device_id).toBe(DEVICE_A);
    expect(row.local_event_id).toBe(12);
    expect(row.inspection_id).toBe(RECORD_ID);
    expect(row.event_type).toBe(event.type);
    expect(row.payload).toEqual(event.payload);
    expect(row.created_at).toBe(WHEN);
  });

  it('rejects events without a persisted, safe local id instead of losing deduplication', () => {
    for (const id of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => eventToRow(storedEvent({ id }), OWNER_A, DEVICE_A)).toThrow();
    }
  });

  it('keeps camera settings scoped to one owner, source PC and camera profile', () => {
    const settings = profile();
    const row = settingsToRow(settings, 'real', OWNER_A, DEVICE_A, {}, WHEN);
    expect(row.owner_id).toBe(OWNER_A);
    expect(row.device_id).toBe(DEVICE_A);
    expect(row.camera_id).toBe('real');
    expect(row.roi).toEqual(settings.roi);
    expect(row.thresholds).toEqual(settings.thresholds);
    expect(row.calibration_version).toBe(settings.calibrationVersion);
    expect(row.local_updated_at).toBe(WHEN);
  });

  it('does not serialize reference pixel arrays as database metadata', () => {
    const settings = profile();
    settings.refs.ok = {
      kind: 'ok', w: 2, h: 2, pixels: new Uint8Array([1, 2, 3, 4]), roi: settings.roi,
      frames: 8, captureIds: ['ref-1'], capturedAt: WHEN, cameraLabel: 'USB inspection camera',
    };
    const row = settingsToRow(settings, 'real', OWNER_A, DEVICE_A, {}, WHEN);
    expect(JSON.stringify(row.refs)).not.toContain('pixels');
    expect(settings.refs.ok.pixels).toBeInstanceOf(Uint8Array);
  });
});
