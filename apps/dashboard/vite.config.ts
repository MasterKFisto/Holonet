import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
