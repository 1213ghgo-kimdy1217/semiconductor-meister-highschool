// Local writes and the upload queue commit together; neither path controls the device.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { InspectionRecord, ProfileSettings, StoredEvent } from './types';
import { canUpload, createOutboxItem, shouldAcknowledge, type CloudOwnerMeta, type OutboxItem } from '../cloud/outbox';

interface WaferDB extends DBSchema {
  kv: { key: string; value: unknown };
  records: { key: string; value: InspectionRecord; indexes: { byTime: string } };
  events: { key: number; value: StoredEvent; indexes: { byRecord: string } };
  outbox: { key: string; value: OutboxItem };
}
export type StoreState = 'opening' | 'ok' | 'saving' | 'retrying' | 'unavailable';
export interface StoreStatus { state: StoreState; pending: number; error: string | null; savedAt: number | null }
type Op = (
  | { kind: 'record'; value: InspectionRecord }
  | { kind: 'event'; value: StoredEvent }
  | { kind: 'kv'; key: string; value: unknown }
) & { ownerId: string | null };
const DB_NAME = 'wafer-inspection-4inch';
const metaKey = (kind: string, id: string | number) => `cloud:owner:${kind}:${id}`;
function describe(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return '저장 공간이 부족해요';
  if (name === 'InvalidStateError' || name === 'SecurityError') return '이 창에서는 브라우저 저장소를 쓸 수 없어요';
  return '이 PC에 저장하지 못했어요. 다시 시도 중이에요';
}

export class LocalStore {
  private db: IDBPDatabase<WaferDB> | null = null;
  private queue: Op[] = [];
  private pumping = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private st: StoreStatus = { state: 'opening', pending: 0, error: null, savedAt: null };
  private listeners = new Set<() => void>();
  private cloudListeners = new Set<() => void>();
  private ownerId: string | null = null;
  private device = '';
  private disposed = false;
  constructor(private readonly dbName = DB_NAME) {}
  get status() { return this.st; }
  get deviceId() { return this.device; }
  setOwner(ownerId: string | null) { this.ownerId = ownerId; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  subscribeCloud(fn: () => void) { this.cloudListeners.add(fn); return () => this.cloudListeners.delete(fn); }
  private cloudChanged() { for (const fn of this.cloudListeners) fn(); }
  private set(p: Partial<StoreStatus>) { this.st = { ...this.st, ...p }; for (const fn of this.listeners) fn(); }

  async open(): Promise<boolean> {
    try {
      this.disposed = false;
      this.db = await openDB<WaferDB>(this.dbName, 2, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            db.createObjectStore('kv');
            db.createObjectStore('records', { keyPath: 'id' }).createIndex('byTime', 'requestedAt');
            db.createObjectStore('events', { keyPath: 'id', autoIncrement: true }).createIndex('byRecord', 'recordId');
          }
          if (oldVersion < 2) db.createObjectStore('outbox', { keyPath: 'key' });
        },
        blocked: () => this.set({ state: 'unavailable', error: '다른 탭을 닫고 새로고침해 주세요' }),
        blocking: () => { this.db?.close(); this.db = null; this.set({ state: 'unavailable', error: '앱이 갱신됐어요. 새로고침해 주세요' }); },
      });
      await this.prepareCloudIndex();
      this.set({ state: this.queue.length ? 'saving' : 'ok', error: null });
      void this.pump();
      return true;
    } catch (e) {
      this.db?.close(); this.db = null;
      this.set({ state: 'unavailable', error: describe(e), pending: this.queue.length });
      return false;
    }
  }
  private async prepareCloudIndex() {
    const tx = this.db!.transaction(['kv', 'records', 'events', 'outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    this.device = (await kv.get('cloud:device-id') as string | undefined) ?? crypto.randomUUID();
    await kv.put(this.device, 'cloud:device-id');
    if (!(await kv.get('cloud:legacy-indexed:v2'))) {
      const meta: CloudOwnerMeta = { ownerId: null, deviceId: this.device };
      for (const record of await tx.objectStore('records').getAll()) {
        await kv.put(meta, metaKey('record', record.id));
        await tx.objectStore('outbox').put(createOutboxItem('inspection', record.id, record, meta));
      }
      for (const event of await tx.objectStore('events').getAll()) {
        if (event.id == null) continue;
        await kv.put(meta, metaKey('event', event.id));
        await tx.objectStore('outbox').put(createOutboxItem('event', String(event.id), event, meta));
      }
      for (const camera of ['real', 'virtual'] as const) {
        const settings = await kv.get(`profile:${camera}`) as ProfileSettings | undefined;
        if (!settings) continue;
        await kv.put(meta, metaKey('profile', camera));
        const updatedAt = new Date().toISOString();
        await tx.objectStore('outbox').put(createOutboxItem('settings', camera, { camera, settings, updatedAt }, meta));
      }
      await kv.put(true, 'cloud:legacy-indexed:v2');
    }
    await tx.done;
    this.cloudChanged();
  }
  async getKv<T>(key: string): Promise<T | undefined> {
    if (!this.db) return undefined;
    try { return await this.db.get('kv', key) as T | undefined; } catch { return undefined; }
  }
  async recentRecords(limit: number): Promise<InspectionRecord[]> {
    if (!this.db) return [];
    const out: InspectionRecord[] = [];
    try {
      let cursor = await this.db.transaction('records').store.index('byTime').openCursor(null, 'prev');
      while (cursor && out.length < limit) { out.push(cursor.value); cursor = await cursor.continue(); }
    } catch { /* Read failure never affects inspection. */ }
    return out;
  }
  async allRecords(): Promise<InspectionRecord[]> { return this.db ? this.db.getAllFromIndex('records', 'byTime') : []; }
  async allEvents(): Promise<StoredEvent[]> { return this.db ? this.db.getAll('events') : []; }
  putRecord(value: InspectionRecord) {
    const op: Op = { kind: 'record', value: structuredClone(value), ownerId: this.ownerId };
    const i = this.queue.findIndex((p, k) => k > 0 && p.kind === 'record' && p.value.id === value.id);
    if (i >= 0) this.queue[i] = { ...op, ownerId: this.queue[i].ownerId }; else this.queue.push(op);
    this.kick();
  }
  addEvent(value: StoredEvent) { this.queue.push({ kind: 'event', value: structuredClone(value), ownerId: this.ownerId }); this.kick(); }
  putKv(key: string, value: unknown) {
    const op: Op = { kind: 'kv', key, value: structuredClone(value), ownerId: this.ownerId };
    const i = this.queue.findIndex((p, k) => k > 0 && p.kind === 'kv' && p.key === key && p.ownerId === op.ownerId);
    if (i >= 0) this.queue[i] = op; else this.queue.push(op);
    this.kick();
  }
  private kick() { this.set({ pending: this.queue.length }); if (this.db) void this.pump(); }
  private async persist(op: Op) {
    const tx = this.db!.transaction(['kv', 'records', 'events', 'outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    let item: OutboxItem | null = null;
    const captured: CloudOwnerMeta = { ownerId: op.ownerId, deviceId: this.device };
    if (op.kind === 'record') {
      const key = metaKey('record', op.value.id);
      const owner = (await kv.get(key) as CloudOwnerMeta | undefined) ?? captured;
      await kv.put(owner, key);
      await tx.objectStore('records').put(op.value);
      item = createOutboxItem('inspection', op.value.id, op.value, owner);
    } else if (op.kind === 'event') {
      const id = await tx.objectStore('events').add(op.value);
      const parent = op.value.recordId ? await kv.get(metaKey('record', op.value.recordId)) as CloudOwnerMeta | undefined : undefined;
      const owner = parent ?? captured;
      const event = { ...op.value, id };
      await kv.put(owner, metaKey('event', id));
      item = createOutboxItem('event', String(id), event, owner);
    } else {
      await kv.put(op.value, op.key);
      if (op.key === 'profile:real' || op.key === 'profile:virtual') {
        const camera = op.key.slice(8) as 'real' | 'virtual';
        const key = metaKey('profile', camera);
        const previous = await kv.get(key) as CloudOwnerMeta | undefined;
        // A new calibration change belongs to its author, never a previous login.
        const owner = captured;
        if (previous?.ownerId === null && owner.ownerId !== null) {
          await tx.objectStore('outbox').delete(createOutboxItem('settings', camera, { camera, settings: op.value as ProfileSettings, updatedAt: '' }, previous).key);
        }
        await kv.put(owner, key);
        const updatedAt = new Date().toISOString();
        item = createOutboxItem('settings', camera, { camera, settings: op.value as ProfileSettings, updatedAt }, owner);
      }
    }
    if (item) await tx.objectStore('outbox').put(item);
    await tx.done;
    this.cloudChanged();
  }
  private async pump() {
    if (this.pumping || !this.db || this.disposed) return;
    this.pumping = true;
    try {
      while (this.queue.length && this.db && !this.disposed) {
        const op = this.queue[0];
        this.set({ state: 'saving', pending: this.queue.length });
        try {
          await this.persist(op);
          this.queue.shift();
          this.set({ pending: this.queue.length, savedAt: Date.now(), error: null });
        } catch (e) {
          this.set({ state: 'retrying', error: describe(e), pending: this.queue.length });
          if (!this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.pump(); }, 3000);
          return;
        }
      }
      if (!this.queue.length) this.set({ state: 'ok', pending: 0 });
    } finally { this.pumping = false; }
  }
  async listOutbox(ownerId?: string): Promise<OutboxItem[]> {
    if (!this.db) return [];
    const items = await this.db.getAll('outbox');
    return ownerId === undefined ? items : items.filter(item => canUpload(item, ownerId));
  }
  async cloudCounts(ownerId: string | null): Promise<{ pending: number; unassigned: number }> {
    const items = await this.listOutbox();
    return { pending: ownerId ? items.filter(item => canUpload(item, ownerId)).length : 0, unassigned: items.filter(item => item.ownerId === null).length };
  }
  async ackOutbox(key: string, revision: string): Promise<boolean> {
    if (!this.db) return false;
    const tx = this.db.transaction('outbox', 'readwrite');
    const item = await tx.store.get(key);
    const remove = !!item && shouldAcknowledge(item, revision);
    if (remove) await tx.store.delete(key);
    await tx.done;
    this.cloudChanged();
    return remove;
  }
  async waitForIdle(): Promise<void> {
    if (!this.db || this.disposed) throw new Error('브라우저 저장소를 사용할 수 없어요');
    if (!this.queue.length && !this.pumping) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { unsub(); reject(new Error('로컬 저장을 기다린 뒤 다시 시도해 주세요')); }, 15000);
      const unsub = this.subscribe(() => {
        if (this.st.state === 'retrying' || this.st.state === 'unavailable') { clearTimeout(timer); unsub(); reject(new Error('로컬 저장을 먼저 확인해 주세요')); }
        else if (!this.queue.length) { clearTimeout(timer); unsub(); resolve(); }
      });
    });
  }
  /** Explicit consent only. A previously bound owner can never be replaced. */
  async claimUnassigned(ownerId: string): Promise<void> {
    if (!ownerId || ownerId !== this.ownerId) throw new Error('로그인 상태를 다시 확인해 주세요');
    await this.waitForIdle();
    if (ownerId !== this.ownerId) throw new Error('로그인 상태를 다시 확인해 주세요');
    const tx = this.db!.transaction(['kv', 'outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const outbox = tx.objectStore('outbox');
    const items = await outbox.getAll();
    const claimableRecords = new Set(items.filter(i => i.kind === 'inspection' && i.ownerId === null).map(i => (i.payload as InspectionRecord).id));
    for (const item of items) {
      if (item.ownerId !== null) continue;
      const kind = item.kind === 'inspection' ? 'record' : item.kind === 'settings' ? 'profile' : 'event';
      const id = item.kind === 'inspection' ? item.payload.id : item.kind === 'event' ? item.payload.id! : item.payload.camera;
      if (item.kind === 'event' && item.payload.recordId) {
        const parent = await kv.get(metaKey('record', item.payload.recordId)) as CloudOwnerMeta | undefined;
        if (parent?.ownerId && parent.ownerId !== ownerId) continue;
        if (!parent && !claimableRecords.has(item.payload.recordId)) continue;
      }
      const owner: CloudOwnerMeta = { ownerId, deviceId: item.deviceId };
      await kv.put(owner, metaKey(kind, id));
      await outbox.delete(item.key);
      await outbox.put(createOutboxItem(item.kind, String(id), item.payload, owner));
    }
    if (ownerId !== this.ownerId) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error('로그인 상태를 다시 확인해 주세요');
    }
    await tx.done;
    this.cloudChanged();
  }
  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.db?.close(); this.db = null;
    this.listeners.clear(); this.cloudListeners.clear();
  }
}
