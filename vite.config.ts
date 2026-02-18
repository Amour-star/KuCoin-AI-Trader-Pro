import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      ccxt: 'https://esm.sh/ccxt@4.5.38',
    },
  },
  optimizeDeps: {
    // ccxt has dynamic imports for node-only modules that break vite pre-bundling
    exclude: ['ccxt'],
  },
  build: {
    rollupOptions: {
      // These modules are dynamically imported by ccxt but not needed in the browser
      external: [
        'ccxt',
        'http-proxy-agent',
        'https-proxy-agent',
        'socks-proxy-agent',
        'node:http',
        'node:https',
        'node:zlib',
        'node:crypto',
        'node:stream',
        'node:url',
        'node:fs',
        'node:path',
      ],
    },
  },
});
