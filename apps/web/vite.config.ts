import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Avoid clashing with other local Vite apps on 5173 (e.g. Nexora BI on 0.0.0.0:5173),
    // which made Chrome's http://localhost:5173/api/* return foreign 404s.
    port: 5174,
    strictPort: true,
    // LAN access for other devices on same Wi‑Fi (e.g. http://192.168.x.x:5174/simulator2)
    host: '0.0.0.0',
    // Allow Cloudflare / ngrok tunnels + LAN hostnames
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        // Brain summarization on large Studio saves can exceed the default proxy timeout.
        // SSE live events also need an open connection.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
