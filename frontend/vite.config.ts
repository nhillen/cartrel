import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/billing': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/status': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, '../backend/public/app'),
    emptyOutDir: true,
  },
});
