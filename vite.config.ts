import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { searchSources } from './src/services/sources.ts';
import { readBody } from './src/services/body.ts';
function localSearch(): Plugin {
  return {
    name: 'local-scholarly-search',
    configureServer(server) {
      server.middlewares.use('/api/search', async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        const origin = request.headers.origin;
        if (request.method !== 'POST' || (origin && origin !== `http://${request.headers.host}`)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'Only local app requests are allowed.' }));
          return;
        }
        try {
          const { query, settings } = JSON.parse(await readBody(request, 32000));
          response.end(JSON.stringify(await searchSources(query, settings)));
        } catch (error) {
          response.statusCode = 400;
          response.end(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Search failed.' }),
          );
        }
      });
    },
  };
}
export default defineConfig({
  base: './',
  plugins: [
    react(),
    localSearch(),
    {
      name: 'production-csp',
      apply: 'build',
      transformIndexHtml: (html) => {
        const development = "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*";
        if (!html.includes(development))
          throw new Error('The production content-security policy could not be tightened.');
        return html.replace(development, "connect-src 'self'");
      },
    },
  ],
  server: { host: '127.0.0.1', port: Number(process.env.APT_DEV_PORT) || 5173, strictPort: true },
  build: { outDir: 'dist' },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/**/*.e2e.test.ts'] },
});
