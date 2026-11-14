import type { CameraProfile, InspectionRecord, ProfileSettings, StoredEvent } from '../store/types';

export interface CloudOwnerMeta {
  ownerId: string | null;
  deviceId: string;
}

export interface SettingPayload {
  camera: CameraProfile;
  settings: ProfileSettings;
  updatedAt: string;
}

export interface OutboxPayloads {
  inspection: InspectionRecord;
  event: StoredEvent;
  settings: SettingPayload;
}

export type OutboxKind = keyof OutboxPayloads;

interface OutboxBase extends CloudOwnerMeta {
  key: string;
  revision: string;
  updatedAt: string;
}

export type OutboxItem<K extends OutboxKind = OutboxKind> = {
  [P in K]: OutboxBase & { kind: P; payload: OutboxPayloads[P] };
}[K];

/** Owner and PC are part of the key: an account switch cannot merge two queues. */
export function createOutboxItem<K extends OutboxKind>(
  kind: K,
  id: string | number,
  payload: OutboxPayloads[K],
  meta: CloudOwnerMeta,
  revision: string = crypto.randomUUID(),
  now: string = new Date().toISOString(),
): OutboxItem<K> {
  return {
    key: `${meta.ownerId ?? 'unassigned'}:${meta.deviceId}:${kind}:${id}`,
    kind,
    payload,
    ownerId: meta.ownerId,
    deviceId: meta.deviceId,
    revision,
    updatedAt: now,
  } as OutboxItem<K>;
}

export function canUpload(item: OutboxItem, ownerId: string | null): boolean {
  return ownerId !== null && item.ownerId === ownerId;
}

/** A slow response for revision A must never remove a newer revision B. */
export function shouldAcknowledge(item: OutboxItem | undefined | null, revision: string): boolean {
  return item?.revision === revision;
}

export function outboxPriority(item: OutboxItem): number {
  return item.kind === 'inspection' ? 0 : item.kind === 'settings' ? 1 : 2;
}
