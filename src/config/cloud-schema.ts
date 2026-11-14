// Pure validation shared by the browser, development server and deployed API.
export const DEFAULT_SUPABASE_URL = 'https://ebrpuysakbfjjnjwesjh.supabase.co';

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
