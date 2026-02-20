import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    envPrefix: ['VITE_', 'KUCOIN_', 'NEXT_PUBLIC_'],
    plugins: [react()],
    define: {
      'process.env.NEXT_PUBLIC_API_URL': JSON.stringify(env.NEXT_PUBLIC_API_URL || ''),
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: env.NEXT_PUBLIC_API_URL || 'http://localhost:8787',
          changeOrigin: true,
          secure: true,
          rewrite: path => `/api${path.replace(/^\/api/, '')}`,
        },
        '/kucoin-api': {
          target: 'https://api.kucoin.com',
          changeOrigin: true,
          secure: true,
          rewrite: path => path.replace(/^\/kucoin-api/, ''),
        },
      },
    },
    resolve: {
      alias: {
        ccxt: 'https://esm.sh/ccxt@4.5.38',
      },
    },
    optimizeDeps: {
      exclude: ['ccxt'],
    },
    build: {
      rollupOptions: {
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
  };
});
