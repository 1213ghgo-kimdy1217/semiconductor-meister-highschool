// 화면에서 연결부 상태를 읽는 훅. 연결부는 페이지마다 하나만 만든다.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { SimDevice } from '../core/transport/simDevice';
import { Station } from './station';

let instance: Station | null = null;

export function getStation(): Station {
  if (!instance) {
    instance = new Station();
    void instance.init();
    // 개발 서버에서만: 브라우저 시나리오 시험(tests/e2e)이 상태를 읽는 손잡이. 배포 빌드에는 없다.
    if (import.meta.env.DEV) (window as unknown as { __station?: Station }).__station = instance;
  }
  return instance;
}

const subStation = (fn: () => void) => getStation().subscribe(fn);
const subCamera = (fn: () => void) => getStation().camera.subscribe(fn);
const subStore = (fn: () => void) => getStation().store.subscribe(fn);
const subLink = (fn: () => void) =>
  getStation().link.on((e) => {
    if (e.type === 'change') fn();
  });
const subLog = (fn: () => void) =>
  getStation().link.on((e) => {
    if (e.type === 'log') fn();
  });

export function useStation() {
  return useSyncExternalStore(subStation, () => getStation().getSnapshot());
}

export function useCamera() {
  return useSyncExternalStore(subCamera, () => getStation().camera.snapshot);
}

export function useLink() {
  return useSyncExternalStore(subLink, () => getStation().link.snapshot);
}

export function useStore() {
  return useSyncExternalStore(subStore, () => getStation().store.status);
}

/** 통신 기록이 늘 때마다 다시 그린다 (마지막 줄 번호) */
export function useLinkLogVersion() {
  return useSyncExternalStore(subLog, () => {
    const log = getStation().link.log;
    return log.length ? log[log.length - 1].id : 0;
  });
}

export function useSim(sim: SimDevice | null) {
  const sub = useCallback((fn: () => void) => (sim ? sim.subscribe(fn) : () => false), [sim]);
  return useSyncExternalStore(sub, () => sim?.snapshot ?? null);
}

/** '몇 초 전' 표시용 시계 */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
