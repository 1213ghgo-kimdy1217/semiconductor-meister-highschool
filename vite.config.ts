/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { DEFAULT_SUPABASE_URL, validateCloudConfig } from './src/config/cloud-schema';

function cloudConfigEndpoint(): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/api/cloud-config') return next();
      const config = validateCloudConfig({
        url: process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
        publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.statusCode = 200;
      res.end(JSON.stringify(config ?? { configured: false }));
    });
  };
  return { name: 'wafer-cloud-config', configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudConfigEndpoint()],
  server: { host: '0.0.0.0', port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});

