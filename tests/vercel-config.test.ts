import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import configApi from '../api/cloud-config';
import missingApi from '../api/not-found';
import { DEFAULT_SUPABASE_URL } from '../src/config/cloud-schema';

// Synthetic settings only; no deployment credentials are used by this suite.
const fixtureKey = 'sb_publishable_vercel_unit_test_only_12345';
const fixtureUrl = 'https://vercel-fixture.supabase.co';
const request = (method = 'GET') => new Request('https://console.example/api/cloud-config', { method });

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', fixtureUrl);
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', fixtureKey);
});
afterEach(() => vi.unstubAllEnvs());

describe('deployed public cloud configuration API', () => {
  it('returns only the public allowlist even when unrelated server values exist', async () => {
    vi.stubEnv('SUPABASE_DB_PASSWORD', 'synthetic-database-test-marker');
    vi.stubEnv('UNRELATED_SERVER_SECRET', 'synthetic-unrelated-test-marker');
    const response = configApi.fetch(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: fixtureUrl, publishableKey: fixtureKey });
  });

  it('uses the dedicated project URL when the URL variable is absent', async () => {
    vi.stubEnv('SUPABASE_URL', undefined);
    expect(await configApi.fetch(request()).json()).toEqual({ url: DEFAULT_SUPABASE_URL, publishableKey: fixtureKey });
  });

  it('keeps the app in local-only mode when the publishable key is missing', async () => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', undefined);
    const response = configApi.fetch(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false });
  });

  it('never reflects invalid or privileged-looking key values into responses', async () => {
    for (const key of ['sb_secret_synthetic_not_a_real_key', 'eyJhbGciOiJIUzI1NiJ9.synthetic.signature', `${fixtureKey}\n`, 'wrong-key']) {
      vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', key);
      expect(await configApi.fetch(request()).json()).toEqual({ configured: false });
    }
  });

  it('never reflects invalid resource URLs or embedded credentials', async () => {
    for (const url of ['http://vercel-fixture.supabase.co', 'https://name:synthetic-password@vercel-fixture.supabase.co', `${fixtureUrl}/auth/v1`, `${fixtureUrl}?secret=synthetic`]) {
      vi.stubEnv('SUPABASE_URL', url);
      expect(await configApi.fetch(request()).json()).toEqual({ configured: false });
    }
  });

  it('disables browser and CDN caching and serves only JSON without CORS access', () => {
    const response = configApi.fetch(request());
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('rejects non-GET methods before exposing configuration', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = configApi.fetch(request(method));
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(await response.json()).toEqual({ error: 'method_not_allowed' });
    }
  });

  it('unknown API paths return JSON 404 rather than the React HTML shell', async () => {
    const response = missingApi.fetch();
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});
