export type CloudErrorKind = 'network' | 'auth' | 'policy' | 'conflict' | 'schema' | 'unknown';

export interface CloudError {
  kind: CloudErrorKind;
  message: string;
  retryable: boolean;
}

/** Only fixed, user-facing messages leave this boundary; server text can contain secrets. */
export function classifyCloudError(error: unknown): CloudError {
  const e = error !== null && typeof error === 'object'
    ? error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; originalError?: unknown; cause?: unknown }
    : {};
  const status = Number(e.status ?? e.statusCode);
  const code = typeof e.code === 'string' ? e.code : '';
  if (status === 401 || code === 'PGRST301' || code === 'PGRST302' || code === 'refresh_token_not_found' || code === 'refresh_token_already_used') {
    return { kind: 'auth', message: '로그인이 만료됐어요. 다시 로그인해 주세요.', retryable: false };
  }
  if (status === 403 || code === '42501') {
    return { kind: 'policy', message: '팀 저장 권한을 확인해 주세요.', retryable: false };
  }
  if (status === 409 || code === '23505') {
    return { kind: 'conflict', message: '저장 기록이 충돌했어요. 설정을 확인해 주세요.', retryable: false };
  }
  if (code === 'PGRST205' || code === 'PGRST204' || code === '42P01' || code === '42703' || code === '42804' || code === '23503' || code === '23514') {
    return { kind: 'schema', message: '팀 저장소의 표 구성을 확인해 주세요.', retryable: false };
  }
  const wrappedNetworkFailure = e.originalError instanceof TypeError || e.cause instanceof TypeError;
  if (error instanceof TypeError || wrappedNetworkFailure || e.name === 'AbortError' || e.name === 'TimeoutError' || status === 0 || status === 408 || status === 429 || status >= 500 || code === 'NETWORK_ERROR') {
    return { kind: 'network', message: '네트워크 연결을 확인해 주세요. 자동으로 다시 시도해요.', retryable: true };
  }
  return { kind: 'unknown', message: '팀 저장에 실패했어요. 다시 시도해 주세요.', retryable: false };
}

/** 2 seconds initially, exponential growth, bounded jitter, at most 5 minutes. */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.min(30, Math.floor(attempt))) : 0;
  const sample = random();
  const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  return Math.min(300_000, Math.round(2_000 * 2 ** n * (0.75 + 0.5 * jitter)));
}
