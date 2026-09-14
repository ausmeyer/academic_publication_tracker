import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { searchSources } from './src/services/sources.ts';
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
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 32000) throw new Error('Search request is too large.');
          }
          const { query, settings } = JSON.parse(body);
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
      transformIndexHtml: (html) =>
        html.replace(
          "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
          "connect-src 'self'",
        ),
    },
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist' },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/**/*.e2e.test.ts'] },
});
