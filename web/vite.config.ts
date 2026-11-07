import { defineConfig } from 'vitest/config';

// The dev gallery is only part of the build for e2e runs (VITE_E2E=1); the public site never ships it.
const includeDevPages = process.env.VITE_E2E === '1';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
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
});
