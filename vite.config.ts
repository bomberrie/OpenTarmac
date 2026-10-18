import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com https://s3.amazonaws.com",
  "connect-src 'self' https://overpass-api.de https://overpass.private.coffee https://overpass.kumi.systems https://nominatim.openstreetmap.org https://s3.amazonaws.com https://server.arcgisonline.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function productionCspPlugin(): Plugin {
  return {
    name: 'opentarmac-production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: PRODUCTION_CSP,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), productionCspPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          leaflet: ['leaflet'],
          jszip: ['jszip'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
