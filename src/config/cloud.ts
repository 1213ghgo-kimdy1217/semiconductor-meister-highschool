// 공개용 설정만 받는다. 비밀값은 서버의 환경 변수 밖으로 나오지 않는다.
export interface BrowserCloudConfig {
  url: string;
  publishableKey: string;
}

export function validateCloudConfig(input: unknown): BrowserCloudConfig | null {
  if (!input || typeof input !== 'object') return null;
  const { url, publishableKey } = input as Record<string, unknown>;
  if (typeof url !== 'string' || typeof publishableKey !== 'string') return null;
  if (publishableKey.trim() !== publishableKey || !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname) || parsed.port) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return null;
    return { url: parsed.origin, publishableKey };
  } catch {
    return null;
  }
}

export async function loadCloudConfig(): Promise<BrowserCloudConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/api/cloud-config', { cache: 'no-store', signal: controller.signal });
    if (response.ok) {
      const config = validateCloudConfig(await response.json());
      if (config) return config;
    }
  } catch {
    // 서버 설정이 없는 로컬 정적 앱도 계속 사용할 수 있다.
  } finally {
    clearTimeout(timer);
  }
  return validateCloudConfig({
    url: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
}
