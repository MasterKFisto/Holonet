import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the production build is uploaded to OSS under
  // app/ (infra/scripts/upload-dashboard-assets.mjs) and served from
  // OSS_PUBLIC_BASE_URL, so index.html must reference assets relatively.
  base: './',
  server: {
    port: 5173,
    proxy: {
      // Local development: API and dev storage traffic is proxied to the
      // local Holonet API (http://localhost:3000). In production the app is
      // served behind https://holonet.section-zero.link, so no proxy is used.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/storage': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
