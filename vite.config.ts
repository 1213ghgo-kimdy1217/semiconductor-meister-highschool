/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { validateCloudConfig } from './src/config/cloud';

function cloudConfigEndpoint(): Plugin {
  const attach = (server: { middlewares: { use: (handler: (req: { url?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/api/cloud-config') return next();
      const config = validateCloudConfig({
        url: process.env.SUPABASE_URL ?? 'https://ebrpuysakbfjjnjwesjh.supabase.co',
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

