import { DEFAULT_SUPABASE_URL, validateCloudConfig } from '../src/config/cloud-schema.js';

// Node.js Vercel Function. Only the two explicitly selected public fields leave it.
export default {
  fetch(request: Request): Response {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { ...headers, Allow: 'GET' },
      });
    }
    const config = validateCloudConfig({
      url: process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    });
    return new Response(JSON.stringify(config ?? { configured: false }), { status: 200, headers });
  },
};
