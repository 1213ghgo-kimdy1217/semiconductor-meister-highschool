// 공개용 설정만 받는다. 비밀값은 서버의 환경 변수 밖으로 나오지 않는다.
import { validateCloudConfig, type BrowserCloudConfig } from './cloud-schema';
export { validateCloudConfig, type BrowserCloudConfig } from './cloud-schema';

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
