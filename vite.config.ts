import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2019' },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DEV_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
});
