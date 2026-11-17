import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the UI runs on :5173 and proxies /api to the Express server (default :8787).
// Same-origin requests mean no CORS setup and Server-Sent Events stream through untouched.
const apiTarget = process.env.RECALLAI_API || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});
