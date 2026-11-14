import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { LocalStore } from '../store/local';
import type { InspectionRecord, RecordMode } from '../store/types';
import type { RefKind } from '../vision/reference';
import { referenceBlob, thumbnailBlob } from './images';
import { eventToRow, inspectionToRow, rowToInspection, settingsToRow, type ReferenceMetadataMap } from './mapping';
import { canUpload, outboxPriority, type OutboxItem } from './outbox';
import { classifyCloudError, retryDelay, type CloudError } from './retry';

export interface CloudConfig { url: string; publishableKey: string }
export type CloudState = 'unconfigured' | 'signed_out' | 'ready' | 'syncing' | 'retrying' | 'auth_required' | 'blocked';
export interface CloudSnapshot {
  state: CloudState;
  email: string | null;
  ownerId: string | null;
  pending: number;
  unassigned: number;
  lastSyncedAt: number | null;
  error: CloudError | null;
}
export interface HistoryOptions { mode?: RecordMode; page: number; pageSize?: number }

const BUCKET = 'inspection-images';

/** Storage is an observer. This class has no camera, station, or transport reference. */
export class CloudService {
  private client: SupabaseClient | null = null;
  private state: CloudSnapshot = { state: 'unconfigured', email: null, ownerId: null, pending: 0, unassigned: 0, lastSyncedAt: null, error: null };
  private listeners = new Set<() => void>();
  private running = false;
  private wakeRequested = false;
  private disposed = false;
  private generation = 0;
  private countRequest = 0;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller = new AbortController();
  private authUnsubscribe: (() => void) | null = null;
  private storeUnsubscribe: (() => void) | null = null;
  private authStorageKey = '';
  private forcedSignedOut = false;
  private authOperation = 0;
  private pendingLogins = 0;
  private resume = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (this.state.state === 'retrying' || this.state.state === 'ready' || this.state.state === 'syncing') this.retry();
  };

  constructor(private readonly store: LocalStore) {}
  get snapshot(): CloudSnapshot { return this.state; }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private set(patch: Partial<CloudSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  async start(config: CloudConfig | null): Promise<void> {
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = this.store.subscribeCloud(() => {
      void this.refreshCounts();
      if (this.state.state === 'ready' || this.state.state === 'syncing') void this.pump();
    });
    await this.refreshCounts();
    if (!config || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) {
      this.set({ state: 'unconfigured' });
      return;
    }
    let url: URL;
    try { url = new URL(config.url); } catch { this.set({ state: 'unconfigured' }); return; }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      this.set({ state: 'unconfigured' }); return;
    }
    this.authStorageKey = `wafer-cloud-auth:${url.hostname}`;
    this.client = createClient(url.origin, config.publishableKey, {
      auth: { storageKey: this.authStorageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: {
        fetch: (input, init) => {
          const signals = [this.controller.signal, AbortSignal.timeout(15_000)];
          if (init?.signal) signals.push(init.signal);
          return fetch(input, { ...init, signal: AbortSignal.any(signals) });
        },
      },
    });
    const { data: auth } = this.client.auth.onAuthStateChange((_event, session) => {
      // Do not await another Auth API while inside its callback lock.
      queueMicrotask(() => {
        if (this.disposed || (session && this.pendingLogins > 0)) return;
        this.applySession(this.forcedSignedOut ? null : session);
      });
    });
    this.authUnsubscribe = () => auth.subscription.unsubscribe();
    if (typeof window !== 'undefined') window.addEventListener('online', this.resume);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.resume);
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) { this.applySession(null); this.set({ error: classifyCloudError(error) }); }
      else this.applySession(data.session);
    } catch { this.applySession(null); }
  }
  private applySession(session: Session | null) {
    const user = session?.user;
    const ownerId = user && !user.is_anonymous ? user.id : null;
    if (this.state.ownerId !== ownerId) {
      this.generation++;
      this.controller.abort();
      this.controller = new AbortController();
      this.cancelTimer();
      this.attempts = 0;
    }
    this.store.setOwner(ownerId);
    this.set({ ownerId, email: ownerId ? user?.email ?? null : null, state: ownerId ? 'ready' : 'signed_out', error: null });
    void this.refreshCounts();
    if (ownerId) void this.pump();
  }
  private async refreshCounts() {
    const request = ++this.countRequest;
    const owner = this.state.ownerId;
    try {
      const counts = await this.store.cloudCounts(owner);
      if (request === this.countRequest && owner === this.state.ownerId) this.set(counts);
    } catch {
      this.set({ error: { kind: 'unknown', message: '이 PC의 저장 상태를 확인해 주세요.', retryable: false } });
    }
  }
  async login(email: string, password: string): Promise<void> {
    if (!this.client) throw new Error('팀 저장 설정을 먼저 확인해 주세요.');
    const operation = ++this.authOperation;
    this.pendingLogins++;
    try {
      const { data, error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
      if (operation !== this.authOperation || this.disposed) {
        if (this.forcedSignedOut && this.authStorageKey) {
          try { localStorage.removeItem(this.authStorageKey); } catch { /* Uploads stay disabled. */ }
        }
        throw new Error('로그인 요청이 취소됐어요.');
      }
      if (error || !data.session || data.user?.is_anonymous) {
      throw new Error(error && (error.status === 429 || (error.status ?? 0) >= 500) ? '연결이 원활하지 않아요. 잠시 뒤 다시 로그인해 주세요.' : '이메일과 비밀번호를 확인해 주세요.');
      }
      this.forcedSignedOut = false;
      this.applySession(data.session);
    } finally {
      this.pendingLogins--;
    }
  }
  async signOut(): Promise<void> {
    this.authOperation++;
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.cancelTimer();
    this.forcedSignedOut = true;
    this.applySession(null);
    if (this.authStorageKey && typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(this.authStorageKey); } catch { /* Keep the in-memory session blocked. */ }
    }
    try { await this.client?.auth.signOut({ scope: 'local' }); } catch { /* Local logout is already effective. */ }
  }
  async backfill(): Promise<void> {
    const ownerId = this.state.ownerId;
    const generation = this.generation;
    if (!ownerId || this.state.state === 'auth_required') throw new Error('먼저 팀 계정으로 로그인해 주세요.');
    await this.store.claimUnassigned(ownerId);
    if (generation !== this.generation || ownerId !== this.state.ownerId) return;
    await this.refreshCounts();
    this.retry();
  }
  retry(): void {
    if (!this.state.ownerId || this.state.state === 'auth_required') return;
    this.cancelTimer();
    this.attempts = 0;
    this.set({ state: 'ready', error: null });
    void this.pump();
  }
  private cancelTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private async pump() {
    if (this.running) { this.wakeRequested = true; return; }
    if (this.disposed || !this.client || !this.state.ownerId || !['ready', 'syncing'].includes(this.state.state)) return;
    this.running = true;
    this.wakeRequested = false;
    const generation = this.generation;
    const ownerId = this.state.ownerId;
    try {
      const drain = async () => { while (!this.disposed && generation === this.generation && ownerId === this.state.ownerId) {
        const items = (await this.store.listOutbox(ownerId)).sort((a, b) => outboxPriority(a) - outboxPriority(b) || a.updatedAt.localeCompare(b.updatedAt));
        if (generation !== this.generation) return;
        if (!items.length) { this.attempts = 0; this.set({ state: 'ready', pending: 0, error: null }); return; }
        const item = items[0];
        if (!canUpload(item, ownerId)) return;
        this.set({ state: 'syncing', pending: items.length, error: null });
        try {
          await this.upload(item, ownerId, generation);
          if (generation !== this.generation || ownerId !== this.state.ownerId) return;
          await this.store.ackOutbox(item.key, item.revision);
          this.attempts = 0;
          this.set({ lastSyncedAt: Date.now() });
          await this.refreshCounts();
        } catch (error) {
          if (generation !== this.generation || this.disposed) return;
          const classified = classifyCloudError(error);
          if (classified.kind === 'auth') {
            this.store.setOwner(null);
            this.set({ state: 'auth_required', error: classified });
          } else if (classified.retryable) {
            this.set({ state: 'retrying', error: classified });
            this.timer = setTimeout(() => { this.timer = null; this.set({ state: 'ready' }); void this.pump(); }, retryDelay(this.attempts++));
          } else this.set({ state: 'blocked', error: classified });
          return;
        }
      } };
      // Tabs share IndexedDB. One uploader per PC prevents a slow old tab from
      // overwriting a newer row or thumbnail after its revision was acknowledged.
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request(`wafer-cloud-upload:${this.store.deviceId}`, { signal: this.controller.signal }, drain);
      } else this.set({ state: 'blocked', error: { kind: 'unknown', message: '팀 저장은 최신 Chrome 또는 Edge의 HTTPS·localhost 화면에서 사용해 주세요.', retryable: false } });
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.set({ state: 'blocked', error: classifyCloudError(error) });
    } finally {
      this.running = false;
      if ((this.wakeRequested || generation !== this.generation) && this.state.ownerId && ['ready', 'syncing'].includes(this.state.state)) void this.pump();
    }
  }
  private requireCurrent(ownerId: string, generation: number) {
    if (this.disposed || generation !== this.generation || ownerId !== this.state.ownerId) throw new DOMException('Account changed', 'AbortError');
  }
  private async uploadImage(path: string, image: Blob, ownerId: string, generation: number) {
    this.requireCurrent(ownerId, generation);
    const { error } = await this.client!.storage.from(BUCKET).upload(path, image, { contentType: image.type, upsert: true });
    if (error) throw error;
    this.requireCurrent(ownerId, generation);
  }
  private async upload(item: OutboxItem, ownerId: string, generation: number) {
    this.requireCurrent(ownerId, generation);
    if (item.kind === 'inspection') {
      const image = thumbnailBlob(item.payload.thumb);
      const imagePath = image ? `${ownerId}/inspections/${item.payload.id}.png` : null;
      if (image && imagePath) await this.uploadImage(imagePath, image, ownerId, generation);
      this.requireCurrent(ownerId, generation);
      const { error, status } = await this.client!.from('inspections').upsert(inspectionToRow(item.payload, ownerId, item.deviceId, imagePath), { onConflict: 'id' });
      if (error) throw { ...error, status };
    } else if (item.kind === 'settings') {
      const { camera, settings, updatedAt } = item.payload;
      const refs: ReferenceMetadataMap = {};
      for (const kind of ['empty', 'ok', 'ng'] as RefKind[]) {
        const reference = settings.refs[kind];
        if (!reference) continue;
        const path = `${ownerId}/refs/${item.deviceId}/${camera}/${kind}-v${settings.calibrationVersion}-${item.revision}.png`;
        const image = await referenceBlob(reference);
        await this.uploadImage(path, image, ownerId, generation);
        const { pixels: _pixels, ...metadata } = reference;
        refs[kind] = { ...metadata, image_path: path };
      }
      this.requireCurrent(ownerId, generation);
      const { error, status } = await this.client!.from('settings').upsert(settingsToRow(settings, camera, ownerId, item.deviceId, refs, updatedAt), { onConflict: 'owner_id,device_id,camera_id' });
      if (error) throw { ...error, status };
    } else {
      const { error, status } = await this.client!.from('events').upsert(eventToRow(item.payload, ownerId, item.deviceId), { onConflict: 'owner_id,device_id,local_event_id', ignoreDuplicates: true });
      if (error) throw { ...error, status };
    }
    this.requireCurrent(ownerId, generation);
  }
  async history(options: HistoryOptions, signal?: AbortSignal): Promise<{ records: InspectionRecord[]; total: number }> {
    const ownerId = this.state.ownerId;
    const generation = this.generation;
    if (!this.client || !ownerId || this.state.state === 'auth_required') throw new Error('팀 계정으로 로그인해 주세요.');
    const pageSize = Math.max(1, Math.min(200, Math.floor(options.pageSize ?? 25)));
    const page = Math.max(0, Math.floor(options.page));
    let query = this.client.from('inspections').select('*', { count: 'exact' }).eq('owner_id', ownerId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
    if (options.mode) query = query.eq('mode', options.mode);
    if (signal) query = query.abortSignal(signal);
    try {
      const { data, error, count, status } = await query;
      this.requireCurrent(ownerId, generation);
      if (error) throw { ...error, status };
      return { records: (data ?? []).map(row => rowToInspection(row as Record<string, unknown>)), total: count ?? data?.length ?? 0 };
    } catch (error) { throw new Error(classifyCloudError(error).message); }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.controller.abort();
    this.cancelTimer();
    this.authUnsubscribe?.(); this.storeUnsubscribe?.();
    this.client?.auth.stopAutoRefresh();
    this.store.setOwner(null);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.resume);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.resume);
    this.listeners.clear();
  }
}
