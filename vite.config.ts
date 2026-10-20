import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web-client',
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 8017, proxy: { '/mcp': 'http://127.0.0.1:8016', '/demo-token': 'http://127.0.0.1:8016', '/phone': 'http://127.0.0.1:8016' } },
});
