import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
} as never);
