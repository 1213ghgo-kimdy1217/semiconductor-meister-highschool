import { useSyncExternalStore } from 'react';
import { getStation } from './useStation';

const subscribe = (fn: () => void) => getStation().cloud.subscribe(fn);
const snapshot = () => getStation().cloud.snapshot;

export function useCloud() {
  return useSyncExternalStore(subscribe, snapshot);
}

export type CloudView = ReturnType<typeof useCloud>;

export function cloudStatusText(cloud: CloudView): string {
  if (cloud.state === 'unconfigured') return '이 PC에만 저장해요 · 팀 저장 설정이 필요해요';
  if (cloud.state === 'signed_out') return '이 PC에만 저장해요 · 팀 계정으로 로그인해 주세요';
  if (cloud.state === 'auth_required') return '로그인이 만료됐어요 · 다시 로그인해 주세요';
  if (cloud.state === 'blocked') return `팀 저장이 멈췄어요 · ${cloud.error?.message ?? '설정을 확인해 주세요'}`;
  if (cloud.state === 'retrying') return `저장 실패 · 다시 시도 중이에요 (${cloud.pending}건 대기)`;
  if (cloud.pending > 0 || cloud.state === 'syncing') return `팀 저장 대기 ${cloud.pending}건`;
  if (cloud.lastSyncedAt) return `모두 저장됐어요 · ${new Date(cloud.lastSyncedAt).toLocaleTimeString('ko-KR')}`;
  return '팀 저장이 준비됐어요';
}
