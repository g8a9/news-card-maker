import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildCsp } from './csp.ts';

// The dev gallery is only part of the build for e2e runs (VITE_E2E=1); the public site never ships it.
const includeDevPages = process.env.VITE_E2E === '1';

/** Adds the Content-Security-Policy <meta> tag to the built index.html (PLAN.md §12.6). */
function contentSecurityPolicy(proxyUrl: string | undefined): Plugin {
  return {
    name: 'ncm:content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        // Only the public page: the dev gallery is a test tool and loads what it likes.
        if (ctx.path !== '/index.html') return [];
        return [
          {
            tag: 'meta',
            // First in <head>, so it is in force before any script or style is requested.
            injectTo: 'head-prepend',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp({ proxyUrl }) },
          },
        ];
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    base: env.VITE_BASE ?? '/',
    plugins: [contentSecurityPolicy(env.VITE_PROXY_URL)],
    build: {
      target: 'es2022',
      rolldownOptions: {
        input: {
          main: 'index.html',
          ...(includeDevPages ? { gallery: 'dev/gallery.html' } : {}),
        },
      },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.ts'],
    },
  };
});
