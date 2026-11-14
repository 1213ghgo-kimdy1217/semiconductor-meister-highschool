// 이 PC의 브라우저 저장소(IndexedDB). 쓰기는 대기열로 순서대로 하고, 실패하면 다시 시도한다.
// 저장이 늦거나 실패해도 검사·전송 흐름은 기다리지 않는다 (지시서 7·11장).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { InspectionRecord, StoredEvent } from './types';

interface WaferDB extends DBSchema {
  kv: { key: string; value: unknown };
  records: { key: string; value: InspectionRecord; indexes: { byTime: string } };
  events: { key: number; value: StoredEvent; indexes: { byRecord: string } };
}

export type StoreState = 'opening' | 'ok' | 'saving' | 'retrying' | 'unavailable';

export interface StoreStatus {
  state: StoreState;
  pending: number;
  error: string | null;
  savedAt: number | null;
}

type Op =
  | { kind: 'record'; value: InspectionRecord }
  | { kind: 'event'; value: StoredEvent }
  | { kind: 'kv'; key: string; value: unknown };

const DB_NAME = 'wafer-inspection-4inch';

function describe(e: unknown) {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'QuotaExceededError') return '저장 공간이 부족해요';
  if (err?.name === 'InvalidStateError' || err?.name === 'SecurityError') return '이 창에서는 브라우저 저장소를 쓸 수 없어요 (시크릿 창 등)';
  return err?.message || err?.name || '알 수 없는 오류';
}

export class LocalStore {
  private db: IDBPDatabase<WaferDB> | null = null;
  private queue: Op[] = [];
  private pumping = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private st: StoreStatus = { state: 'opening', pending: 0, error: null, savedAt: null };
  private listeners = new Set<() => void>();

  get status() {
    return this.st;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<StoreStatus>) {
    this.st = { ...this.st, ...p };
    for (const fn of this.listeners) fn();
  }

  async open(): Promise<boolean> {
    try {
      this.db = await openDB<WaferDB>(DB_NAME, 1, {
        upgrade(db) {
          db.createObjectStore('kv');
          db.createObjectStore('records', { keyPath: 'id' }).createIndex('byTime', 'requestedAt');
          db.createObjectStore('events', { keyPath: 'id', autoIncrement: true }).createIndex('byRecord', 'recordId');
        },
      });
      this.set({ state: this.queue.length ? 'saving' : 'ok', error: null });
      void this.pump();
      return true;
    } catch (e) {
      this.db = null;
      this.set({ state: 'unavailable', error: describe(e), pending: this.queue.length });
      return false;
    }
  }

  async getKv<T>(key: string): Promise<T | undefined> {
    if (!this.db) return undefined;
    try {
      return (await this.db.get('kv', key)) as T | undefined;
    } catch {
      return undefined;
    }
  }

  /** 최근 기록 (새것부터) */
  async recentRecords(limit: number): Promise<InspectionRecord[]> {
    if (!this.db) return [];
    const out: InspectionRecord[] = [];
    try {
      let cur = await this.db.transaction('records').store.index('byTime').openCursor(null, 'prev');
      while (cur && out.length < limit) {
        out.push(cur.value);
        cur = await cur.continue();
      }
    } catch {
      /* 읽기 실패는 빈 목록 */
    }
    return out;
  }

  async allRecords(): Promise<InspectionRecord[]> {
    if (!this.db) return [];
    return this.db.getAllFromIndex('records', 'byTime');
  }

  async allEvents(): Promise<StoredEvent[]> {
    if (!this.db) return [];
    return this.db.getAll('events');
  }

  putRecord(r: InspectionRecord) {
    // 같은 기록의 쓰기가 아직 대기 중이면 최신 내용으로 바꾼다
    const i = this.queue.findIndex((op, k) => k > 0 && op.kind === 'record' && op.value.id === r.id);
    if (i >= 0) this.queue[i] = { kind: 'record', value: r };
    else this.queue.push({ kind: 'record', value: r });
    this.kick();
  }

  addEvent(e: StoredEvent) {
    this.queue.push({ kind: 'event', value: e });
    this.kick();
  }

  putKv(key: string, value: unknown) {
    const i = this.queue.findIndex((op, k) => k > 0 && op.kind === 'kv' && op.key === key);
    if (i >= 0) this.queue[i] = { kind: 'kv', key, value };
    else this.queue.push({ kind: 'kv', key, value });
    this.kick();
  }

  private kick() {
    this.set({ pending: this.queue.length });
    if (!this.db) return;
    void this.pump();
  }

  private async pump() {
    if (this.pumping || !this.db) return;
    this.pumping = true;
    try {
      while (this.queue.length && this.db) {
        const op = this.queue[0];
        this.set({ state: 'saving', pending: this.queue.length });
        try {
          if (op.kind === 'record') await this.db.put('records', op.value);
          else if (op.kind === 'event') await this.db.add('events', op.value);
          else await this.db.put('kv', op.value, op.key);
          this.queue.shift();
          this.set({ pending: this.queue.length, savedAt: Date.now(), error: null });
        } catch (e) {
          this.set({ state: 'retrying', error: describe(e), pending: this.queue.length });
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.pump();
          }, 3000);
          return;
        }
      }
      if (!this.queue.length) this.set({ state: 'ok', pending: 0 });
    } finally {
      this.pumping = false;
    }
  }

  dispose() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.db?.close();
    this.db = null;
  }
}
